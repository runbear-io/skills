#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import stat as stat_module
import tarfile
from pathlib import Path

MAX_SHARDS = 64
MAX_SHARD_BYTES = 512 * 1024 * 1024
TARGET_SHARD_BYTES = 500 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
MAX_FILES = 200_000
DATASET_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
FORBIDDEN_BASENAMES = {
    ".claude.json",
    ".mcp.json",
}
FORBIDDEN_CLAUDE_SETTINGS = {
    "settings.json",
    "settings.local.json",
}


def padded(size: int) -> int:
    return ((size + 511) // 512) * 512


def estimated_tar_bytes(relative_path: str, size: int) -> int:
    name_bytes = relative_path.encode("utf-8")
    long_name = 0 if len(name_bytes) <= 100 else 512 + padded(len(name_bytes) + 1)
    return 512 + padded(size) + long_name


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_relative_path(relative_path: str) -> None:
    parts = relative_path.split("/")
    basename = parts[-1]
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
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"invalid relative path: {relative_path}")


def raise_walk_error(error: OSError) -> None:
    raise error


def inventory(source: Path, output: Path) -> list[tuple[Path, str, os.stat_result]]:
    files: list[tuple[Path, str, os.stat_result]] = []
    for root, directories, names in os.walk(
        source,
        followlinks=False,
        onerror=raise_walk_error,
    ):
        root_path = Path(root)
        kept_directories: list[str] = []
        for directory in sorted(directories):
            directory_path = root_path / directory
            if directory_path.is_symlink():
                raise ValueError(f"symbolic links are not supported: {directory_path}")
            if directory_path.resolve() == output:
                continue
            kept_directories.append(directory)
        directories[:] = kept_directories
        for name in sorted(names):
            path = root_path / name
            file_stat = os.stat(path, follow_symlinks=False)
            if stat_module.S_ISLNK(file_stat.st_mode):
                raise ValueError(f"symbolic links are not supported: {path}")
            if not stat_module.S_ISREG(file_stat.st_mode):
                raise ValueError(f"special filesystem entry is not supported: {path}")
            relative_path = path.relative_to(source).as_posix()
            validate_relative_path(relative_path)
            files.append((path, relative_path, file_stat))
            if len(files) > MAX_FILES:
                raise ValueError(f"dataset exceeds {MAX_FILES} files")
    files.sort(key=lambda item: item[1])
    if not files:
        raise ValueError("dataset contains no regular files")
    return files


def group_files(
    files: list[tuple[Path, str, os.stat_result]],
) -> list[list[tuple[Path, str, os.stat_result]]]:
    groups: list[list[tuple[Path, str, os.stat_result]]] = []
    current: list[tuple[Path, str, os.stat_result]] = []
    current_bytes = 1024
    for item in files:
        entry_bytes = estimated_tar_bytes(item[1], item[2].st_size)
        if entry_bytes + 1024 > MAX_SHARD_BYTES:
            raise ValueError(f"file cannot fit in a shard: {item[1]}")
        if current and current_bytes + entry_bytes > TARGET_SHARD_BYTES:
            groups.append(current)
            current = []
            current_bytes = 1024
        current.append(item)
        current_bytes += entry_bytes
    if current:
        groups.append(current)
    if len(groups) > MAX_SHARDS:
        raise ValueError(f"dataset exceeds {MAX_SHARDS} shards")
    return groups


def estimated_shard_bytes(
    files: list[tuple[Path, str, os.stat_result]],
) -> int:
    unpadded = 1024 + sum(
        estimated_tar_bytes(relative_path, file_stat.st_size)
        for _path, relative_path, file_stat in files
    )
    return (
        (unpadded + tarfile.RECORDSIZE - 1) // tarfile.RECORDSIZE
    ) * tarfile.RECORDSIZE


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


def create_shard(
    source_root: Path,
    output: Path,
    index: int,
    files: list[tuple[Path, str, os.stat_result]],
) -> dict[str, object]:
    path = output / f"part-{index:05d}.tar"
    with tarfile.open(path, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for _source_path, relative_path, expected in files:
            info = tarfile.TarInfo(name=relative_path)
            info.size = expected.st_size
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            info.mode = 0o640
            info.type = tarfile.REGTYPE
            file_fd = open_verified_file(source_root, relative_path, expected)
            with os.fdopen(file_fd, "rb") as source:
                archive.addfile(info, source)
    size = path.stat().st_size
    if size > MAX_SHARD_BYTES:
        path.unlink(missing_ok=True)
        raise ValueError(f"generated shard exceeds {MAX_SHARD_BYTES} bytes: {path.name}")
    return {
        "index": index,
        "path": str(path),
        "sizeBytes": size,
        "sha256": sha256(path),
        "fileCount": len(files),
    }


def create_shards(
    source: Path,
    output: Path,
    groups: list[list[tuple[Path, str, os.stat_result]]],
) -> tuple[list[dict[str, object]], int]:
    estimated_total = sum(estimated_shard_bytes(group) for group in groups)
    if estimated_total > MAX_TOTAL_BYTES:
        raise ValueError(f"dataset archives exceed {MAX_TOTAL_BYTES} bytes")

    try:
        shards = [
            create_shard(source, output, index, group)
            for index, group in enumerate(groups)
        ]
        total_bytes = sum(int(shard["sizeBytes"]) for shard in shards)
        if total_bytes > MAX_TOTAL_BYTES:
            raise ValueError(f"dataset archives exceed {MAX_TOTAL_BYTES} bytes")
        return shards, total_bytes
    except Exception:
        for shard_path in output.glob("part-*.tar"):
            shard_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--dataset-name", required=True)
    args = parser.parse_args()

    if not DATASET_NAME_RE.fullmatch(args.dataset_name):
        raise ValueError("dataset name must be lowercase letters, numbers, and hyphens")
    source = Path(args.source).expanduser().resolve(strict=True)
    if not source.is_dir():
        raise ValueError("source must be a directory")
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("output directory must be empty")

    files = inventory(source, output)
    groups = group_files(files)
    shards, total_bytes = create_shards(source, output, groups)
    manifest = {
        "datasetName": args.dataset_name,
        "source": str(source),
        "shards": shards,
        "totalBytes": total_bytes,
        "totalFileCount": len(files),
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)


if __name__ == "__main__":
    main()
