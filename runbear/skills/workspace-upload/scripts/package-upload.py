#!/usr/bin/env python3
import argparse
import gzip
import hashlib
import importlib
import json
import os
import shutil
import stat as stat_module
import subprocess
import tarfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import BinaryIO, NamedTuple

MAX_SHARDS = 64
MAX_SHARD_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES = 40 * 1024 * 1024 * 1024
MAX_SHARD_UNCOMPRESSED_BYTES = MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES
MAX_FILES = 200_000
RESERVED_WORKSPACE_ROOT_ENTRIES = {
    ".claude",
    ".claude.json",
    ".git",
    ".mcp.json",
    ".pipedream-stash",
    ".runbear",
}
FORBIDDEN_BASENAMES = {
    ".claude.json",
    ".mcp.json",
}
FORBIDDEN_CLAUDE_SETTINGS = {
    "settings.json",
    "settings.local.json",
}


class CompressionChoice(NamedTuple):
    codec: str
    implementation: str


class SourceEntry(NamedTuple):
    path: Path
    source_path: str
    file_stat: os.stat_result
    is_directory: bool


class ArchiveEntry(NamedTuple):
    path: Path
    source_path: str
    archive_path: str
    file_stat: os.stat_result
    is_directory: bool


class ShardTooLarge(ValueError):
    pass


class UncompressedShardTooLarge(ValueError):
    def __init__(self, measured: int, allowed: int) -> None:
        self.measured = measured
        self.allowed = allowed
        super().__init__(
            f"uncompressed shard is {measured} bytes; "
            f"allowed maximum is {allowed} bytes"
        )


class SizeLimitedWriter:
    def __init__(self, output: BinaryIO, limit: int) -> None:
        self.output = output
        self.limit = limit
        self.size = 0

    def write(self, data: bytes) -> int:
        next_size = self.size + len(data)
        if next_size > self.limit:
            raise ShardTooLarge(
                f"compressed shard exceeds {self.limit} bytes"
            )
        written = self.output.write(data)
        if written != len(data):
            raise OSError("short write while creating shard")
        self.size = next_size
        return written

    def flush(self) -> None:
        self.output.flush()

    def tell(self) -> int:
        return self.size


class CountingWriter:
    def __init__(self, output: object) -> None:
        self.output = output
        self.size = 0

    def write(self, data: bytes) -> int:
        written = self.output.write(data)
        if written is not None and written != len(data):
            raise OSError("short write while creating tar stream")
        self.size += len(data)
        return len(data)

    def flush(self) -> None:
        flush = getattr(self.output, "flush", None)
        if flush is not None:
            flush()


class IncrementalCompressionWriter:
    def __init__(self, compressor: object, output: SizeLimitedWriter) -> None:
        self.compressor = compressor
        self.output = output
        self.finished = False

    def write(self, data: bytes) -> int:
        compressed = self.compressor.compress(data)
        if compressed:
            self.output.write(compressed)
        return len(data)

    def flush(self) -> None:
        self.output.flush()

    def finish(self) -> None:
        if self.finished:
            return
        final = self.compressor.flush()
        if final:
            self.output.write(final)
        self.finished = True
        self.output.flush()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def validate_layout_name(name: str) -> None:
    if not name or name in {".", ".."}:
        raise ValueError("layout name must name one workspace directory")
    normalized_name = name.rstrip(" .").casefold()
    if normalized_name in RESERVED_WORKSPACE_ROOT_ENTRIES:
        raise ValueError(f"reserved workspace root entry: {name}")
    if name.startswith(("-", ".")):
        raise ValueError("layout name must not start with '-' or '.'")
    if "/" in name or "\\" in name:
        raise ValueError("layout name must not contain '/' or '\\'")
    if any(unicodedata.category(character) == "Cc" for character in name):
        raise ValueError("layout name must not contain control characters")
    try:
        encoded = name.encode("utf-8")
    except UnicodeEncodeError as error:
        raise ValueError("layout name must be valid UTF-8") from error
    if len(encoded) > 255:
        raise ValueError("layout name must not exceed 255 UTF-8 bytes")


def validate_relative_path(relative_path: str) -> None:
    parts = relative_path.split("/")
    basename = parts[-1]
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"invalid relative path: {relative_path}")
    # A component may legally contain a backslash on POSIX, but the archive is
    # extracted elsewhere: an extractor that normalizes '\' would read
    # 'safe/..\..\.claude' as traversal out of the layout prefix and into a
    # reserved workspace-root entry. Refuse to build such an archive at all.
    if "\\" in relative_path:
        raise ValueError(f"path component must not contain '\\': {relative_path}")
    if any(unicodedata.category(character) == "Cc" for character in relative_path):
        raise ValueError(f"path must not contain control characters: {relative_path}")
    if (
        basename in FORBIDDEN_BASENAMES
        or basename == ".env"
        or basename.startswith(".env.")
        or (
            len(parts) >= 2
            and parts[-2] == ".claude"
            and basename in FORBIDDEN_CLAUDE_SETTINGS
        )
    ):
        raise ValueError(f"forbidden configuration or environment file: {relative_path}")


def raise_walk_error(error: OSError) -> None:
    raise error


def inspect_entry(path: Path) -> os.stat_result:
    file_stat = os.stat(path, follow_symlinks=False)
    if stat_module.S_ISLNK(file_stat.st_mode):
        raise ValueError(f"symbolic links are not supported: {path}")
    if not (
        stat_module.S_ISREG(file_stat.st_mode)
        or stat_module.S_ISDIR(file_stat.st_mode)
    ):
        raise ValueError(f"special filesystem entry is not supported: {path}")
    return file_stat


def inventory(
    source: Path,
    output: Path,
) -> tuple[Path, list[SourceEntry]]:
    source_stat = inspect_entry(source)
    if stat_module.S_ISREG(source_stat.st_mode):
        validate_relative_path(source.name)
        return source.parent, [
            SourceEntry(source, source.name, source_stat, False)
        ]

    entries: list[SourceEntry] = []
    file_count = 0
    for root, directories, names in os.walk(
        source,
        followlinks=False,
        onerror=raise_walk_error,
    ):
        root_path = Path(root)
        kept_directories: list[str] = []
        for directory in sorted(directories):
            directory_path = root_path / directory
            directory_stat = inspect_entry(directory_path)
            if directory_path.resolve() == output:
                continue
            relative_path = directory_path.relative_to(source).as_posix()
            validate_relative_path(relative_path)
            entries.append(
                SourceEntry(
                    directory_path,
                    relative_path,
                    directory_stat,
                    True,
                )
            )
            kept_directories.append(directory)
        directories[:] = kept_directories
        for name in sorted(names):
            path = root_path / name
            file_stat = inspect_entry(path)
            if not stat_module.S_ISREG(file_stat.st_mode):
                raise ValueError(f"special filesystem entry is not supported: {path}")
            relative_path = path.relative_to(source).as_posix()
            validate_relative_path(relative_path)
            entries.append(SourceEntry(path, relative_path, file_stat, False))
            file_count += 1
            if file_count > MAX_FILES:
                raise ValueError(f"upload exceeds {MAX_FILES} files")
    entries.sort(key=lambda entry: (entry.source_path, not entry.is_directory))
    if file_count == 0:
        raise ValueError("upload contains no regular files")
    return source, entries


def choose_layout(
    entries: list[SourceEntry],
    requested_name: str | None,
    timestamp: str,
) -> tuple[str, list[ArchiveEntry]]:
    top_level_entries = sorted(
        {entry.source_path.split("/", 1)[0] for entry in entries}
    )
    if requested_name is not None:
        top_level_prefix = requested_name
        prefix_entries = True
    elif len(top_level_entries) == 1:
        top_level_prefix = top_level_entries[0]
        prefix_entries = False
    else:
        top_level_prefix = f"upload-{timestamp}"
        prefix_entries = True

    validate_layout_name(top_level_prefix)
    archive_entries = [
        ArchiveEntry(
            entry.path,
            entry.source_path,
            (
                f"{top_level_prefix}/{entry.source_path}"
                if prefix_entries
                else entry.source_path
            ),
            entry.file_stat,
            entry.is_directory,
        )
        for entry in entries
    ]
    for entry in archive_entries:
        top_level = entry.archive_path.split("/", 1)[0]
        if top_level in RESERVED_WORKSPACE_ROOT_ENTRIES:
            raise ValueError(f"reserved workspace root entry: {top_level}")
    archive_entries.sort(
        key=lambda entry: (entry.archive_path, not entry.is_directory)
    )
    return top_level_prefix, archive_entries


def find_module(name: str, required_attribute: str) -> ModuleType | None:
    try:
        module = importlib.import_module(name)
    except (ImportError, OSError):
        return None
    if not hasattr(module, required_attribute):
        return None
    return module


def find_zstd_implementation() -> str | None:
    if find_module("compression.zstd", "ZstdCompressor") is not None:
        return "stdlib"
    if find_module("zstandard", "ZstdCompressor") is not None:
        return "zstandard"
    binary = shutil.which("zstd")
    if binary is not None:
        return f"binary:{binary}"
    return None


def resolve_compression(requested: str) -> CompressionChoice:
    if requested not in {"auto", "zstd", "gzip", "none"}:
        raise ValueError(f"unsupported compression: {requested}")
    if requested in {"auto", "zstd"}:
        implementation = find_zstd_implementation()
        if implementation is not None:
            return CompressionChoice("zstd", implementation)
        if requested == "zstd":
            raise ValueError(
                "zstd compression requires Python 3.14 compression.zstd, "
                "the zstandard package, or a zstd binary on PATH"
            )
    if requested in {"auto", "gzip"}:
        return CompressionChoice("gzip", "stdlib")
    return CompressionChoice("none", "none")


def archive_extension(codec: str) -> str:
    return {
        "zstd": ".tar.zst",
        "gzip": ".tar.gz",
        "none": ".tar",
    }[codec]


def padded(size: int) -> int:
    return ((size + 511) // 512) * 512


def estimated_tar_bytes(entry: ArchiveEntry) -> int:
    name_bytes = entry.archive_path.encode("utf-8")
    long_name = 0 if len(name_bytes) <= 100 else 512 + padded(len(name_bytes) + 1)
    content_size = 0 if entry.is_directory else entry.file_stat.st_size
    return 512 + padded(content_size) + long_name


def open_verified_file(
    source_root: Path,
    relative_path: str,
    expected: os.stat_result,
) -> int:
    parts = relative_path.split("/")
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    file_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    directory_fds = [os.open(source_root, directory_flags)]
    file_fd: int | None = None
    try:
        for part in parts[:-1]:
            directory_fds.append(
                os.open(part, directory_flags, dir_fd=directory_fds[-1])
            )
        file_fd = os.open(parts[-1], file_flags, dir_fd=directory_fds[-1])
        actual = os.fstat(file_fd)
        if (
            not stat_module.S_ISREG(actual.st_mode)
            or actual.st_dev != expected.st_dev
            or actual.st_ino != expected.st_ino
            or actual.st_size != expected.st_size
        ):
            raise ValueError(f"source file changed during packaging: {relative_path}")
        return file_fd
    except Exception:
        if file_fd is not None:
            os.close(file_fd)
        raise
    finally:
        for directory_fd in reversed(directory_fds):
            os.close(directory_fd)


def write_tar_stream(
    source_root: Path,
    output: object,
    entries: list[ArchiveEntry],
) -> int:
    counter = CountingWriter(output)
    with tarfile.open(
        fileobj=counter,
        mode="w|",
        format=tarfile.GNU_FORMAT,
    ) as archive:
        for entry in entries:
            info = tarfile.TarInfo(name=entry.archive_path)
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            info.mode = 0o755 if entry.is_directory else 0o644
            if entry.is_directory:
                info.size = 0
                info.type = tarfile.DIRTYPE
                archive.addfile(info)
                continue
            info.size = entry.file_stat.st_size
            info.type = tarfile.REGTYPE
            file_fd = open_verified_file(
                source_root,
                entry.source_path,
                entry.file_stat,
            )
            with os.fdopen(file_fd, "rb") as source:
                archive.addfile(info, source)
    return counter.size


def write_python_archive(
    path: Path,
    choice: CompressionChoice,
    source_root: Path,
    entries: list[ArchiveEntry],
) -> int:
    with path.open("wb") as raw_output:
        limited_output = SizeLimitedWriter(raw_output, MAX_SHARD_BYTES)
        if choice.codec == "none":
            return write_tar_stream(source_root, limited_output, entries)
        if choice.codec == "gzip":
            with gzip.GzipFile(
                filename="",
                mode="wb",
                compresslevel=9,
                fileobj=limited_output,
                mtime=0,
            ) as compressed_output:
                return write_tar_stream(source_root, compressed_output, entries)
        if choice.implementation == "stdlib":
            module = find_module("compression.zstd", "ZstdCompressor")
            if module is None:
                raise RuntimeError("compression.zstd became unavailable")
            compressor = module.ZstdCompressor(level=3)
        elif choice.implementation == "zstandard":
            module = find_module("zstandard", "ZstdCompressor")
            if module is None:
                raise RuntimeError("zstandard became unavailable")
            compressor = module.ZstdCompressor(level=3).compressobj()
        else:
            raise RuntimeError(f"unexpected zstd implementation: {choice.implementation}")
        compressed_output = IncrementalCompressionWriter(
            compressor,
            limited_output,
        )
        uncompressed_bytes = write_tar_stream(
            source_root,
            compressed_output,
            entries,
        )
        compressed_output.finish()
        return uncompressed_bytes


def write_binary_zstd_archive(
    path: Path,
    binary: str,
    source_root: Path,
    entries: list[ArchiveEntry],
) -> int:
    temporary_tar = path.with_name(f".{path.name}.uncompressed.tmp")
    try:
        with temporary_tar.open("wb") as uncompressed_output:
            uncompressed_bytes = write_tar_stream(
                source_root,
                uncompressed_output,
                entries,
            )
        with temporary_tar.open("rb") as uncompressed_input, path.open("wb") as output:
            result = subprocess.run(
                [binary, "-q", "-c", "-T1"],
                stdin=uncompressed_input,
                stdout=output,
                stderr=subprocess.PIPE,
                check=False,
            )
        if result.returncode != 0:
            detail = result.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"zstd failed with exit {result.returncode}: {detail}")
        if path.stat().st_size > MAX_SHARD_BYTES:
            raise ShardTooLarge(
                f"compressed shard exceeds {MAX_SHARD_BYTES} bytes"
            )
        return uncompressed_bytes
    finally:
        temporary_tar.unlink(missing_ok=True)


def create_shard(
    source_root: Path,
    output: Path,
    index: int,
    entries: list[ArchiveEntry],
    choice: CompressionChoice,
) -> tuple[dict[str, object], int]:
    path = output / f"part-{index:05d}{archive_extension(choice.codec)}"
    try:
        if choice.implementation.startswith("binary:"):
            uncompressed_bytes = write_binary_zstd_archive(
                path,
                choice.implementation.removeprefix("binary:"),
                source_root,
                entries,
            )
        else:
            uncompressed_bytes = write_python_archive(
                path,
                choice,
                source_root,
                entries,
            )
        size = path.stat().st_size
        if size > MAX_SHARD_BYTES:
            raise ShardTooLarge(
                f"compressed shard exceeds {MAX_SHARD_BYTES} bytes"
            )
        if uncompressed_bytes > MAX_SHARD_UNCOMPRESSED_BYTES:
            raise UncompressedShardTooLarge(
                uncompressed_bytes,
                MAX_SHARD_UNCOMPRESSED_BYTES,
            )
        return (
            {
                "index": index,
                "path": str(path),
                "sizeBytes": size,
                "uncompressedBytes": uncompressed_bytes,
                "sha256": sha256(path),
                "fileCount": sum(not entry.is_directory for entry in entries),
            },
            uncompressed_bytes,
        )
    except Exception:
        path.unlink(missing_ok=True)
        raise


def split_entries(
    entries: list[ArchiveEntry],
) -> tuple[list[ArchiveEntry], list[ArchiveEntry]] | None:
    total_files = sum(not entry.is_directory for entry in entries)
    if total_files < 2:
        return None
    total_weight = sum(estimated_tar_bytes(entry) for entry in entries)
    target = total_weight / 2
    cumulative = 0
    files_seen = 0
    best_index: int | None = None
    best_distance: float | None = None
    for index, entry in enumerate(entries[:-1], start=1):
        cumulative += estimated_tar_bytes(entry)
        if not entry.is_directory:
            files_seen += 1
        if files_seen == 0 or files_seen == total_files:
            continue
        distance = abs(cumulative - target)
        if best_distance is None or distance < best_distance:
            best_index = index
            best_distance = distance
    if best_index is None:
        return None
    return entries[:best_index], entries[best_index:]


def remove_shards(output: Path) -> None:
    for shard_path in output.glob("part-*.tar*"):
        shard_path.unlink(missing_ok=True)


def create_shards(
    source_root: Path,
    output: Path,
    entries: list[ArchiveEntry],
    choice: CompressionChoice,
) -> tuple[list[dict[str, object]], int, int]:
    shards: list[dict[str, object]] = []
    total_bytes = 0
    total_uncompressed_bytes = 0

    def create_group(group: list[ArchiveEntry]) -> None:
        nonlocal total_bytes, total_uncompressed_bytes
        if len(shards) >= MAX_SHARDS:
            raise ValueError(f"upload exceeds {MAX_SHARDS} shards")
        try:
            shard, uncompressed_bytes = create_shard(
                source_root,
                output,
                len(shards),
                group,
                choice,
            )
        except (ShardTooLarge, UncompressedShardTooLarge) as error:
            split = split_entries(group)
            if split is None:
                file_paths = [
                    entry.archive_path
                    for entry in group
                    if not entry.is_directory
                ]
                name = file_paths[0] if file_paths else group[0].archive_path
                if isinstance(error, UncompressedShardTooLarge):
                    raise ValueError(
                        f"entry {name} expands to {error.measured} bytes; "
                        f"allowed per-shard maximum is {error.allowed} bytes"
                    ) from error
                raise ValueError(f"entry cannot fit in a compressed shard: {name}") from error
            create_group(split[0])
            create_group(split[1])
            return
        shards.append(shard)
        total_bytes += int(shard["sizeBytes"])
        total_uncompressed_bytes += uncompressed_bytes
        if total_bytes > MAX_TOTAL_BYTES:
            raise ValueError(f"compressed upload exceeds {MAX_TOTAL_BYTES} bytes")
        if total_uncompressed_bytes > MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES:
            raise ValueError(
                f"uncompressed upload is {total_uncompressed_bytes} bytes; "
                "allowed maximum is "
                f"{MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES} bytes"
            )

    try:
        create_group(entries)
        return shards, total_bytes, total_uncompressed_bytes
    except Exception:
        remove_shards(output)
        raise


def package_upload(
    source: Path,
    output: Path,
    requested_name: str | None,
    requested_compression: str,
    timestamp: str | None = None,
) -> dict[str, object]:
    source = source.expanduser()
    source_stat = os.stat(source, follow_symlinks=False)
    if stat_module.S_ISLNK(source_stat.st_mode):
        raise ValueError(f"symbolic links are not supported: {source}")
    source = source.resolve(strict=True)
    output = output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("output directory must be empty")

    choice = resolve_compression(requested_compression)
    package_timestamp = timestamp or current_timestamp()
    source_root, source_entries = inventory(source, output)
    top_level_prefix, archive_entries = choose_layout(
        source_entries,
        requested_name,
        package_timestamp,
    )
    shards, total_bytes, total_uncompressed_bytes = create_shards(
        source_root,
        output,
        archive_entries,
        choice,
    )
    manifest = {
        "topLevelPrefix": top_level_prefix,
        "source": str(source),
        "compression": choice.codec,
        "shards": shards,
        "totalBytes": total_bytes,
        "totalUncompressedBytes": total_uncompressed_bytes,
        "totalFileCount": sum(
            not entry.is_directory for entry in archive_entries
        ),
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--name")
    parser.add_argument(
        "--compression",
        choices=["auto", "zstd", "gzip", "none"],
        default="auto",
    )
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    manifest = package_upload(
        Path(args.source),
        output,
        args.name,
        args.compression,
    )
    print(f"compression: {manifest['compression']}")
    print(output / "manifest.json")


if __name__ == "__main__":
    main()
