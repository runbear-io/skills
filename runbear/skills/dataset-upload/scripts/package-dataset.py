#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import tarfile
from pathlib import Path

MAX_SHARD_BYTES = 512 * 1024 * 1024
TARGET_SHARD_BYTES = 500 * 1024 * 1024
MAX_TOTAL_BYTES = 20 * 1024 * 1024 * 1024
MAX_FILES = 200_000
DATASET_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
FORBIDDEN_EXACT = {
    ".claude.json",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
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
    if relative_path in FORBIDDEN_EXACT or basename == ".env" or basename.startswith(".env."):
        raise ValueError(f"forbidden configuration or environment file: {relative_path}")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"invalid relative path: {relative_path}")


def inventory(source: Path, output: Path) -> list[tuple[Path, str, int]]:
    files: list[tuple[Path, str, int]] = []
    for root, directories, names in os.walk(source, followlinks=False):
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
            if path.is_symlink():
                raise ValueError(f"symbolic links are not supported: {path}")
            if not path.is_file():
                raise ValueError(f"special filesystem entry is not supported: {path}")
            relative_path = path.relative_to(source).as_posix()
            validate_relative_path(relative_path)
            files.append((path, relative_path, path.stat().st_size))
            if len(files) > MAX_FILES:
                raise ValueError(f"dataset exceeds {MAX_FILES} files")
    files.sort(key=lambda item: item[1])
    if not files:
        raise ValueError("dataset contains no regular files")
    return files


def group_files(
    files: list[tuple[Path, str, int]],
) -> list[list[tuple[Path, str, int]]]:
    groups: list[list[tuple[Path, str, int]]] = []
    current: list[tuple[Path, str, int]] = []
    current_bytes = 1024
    for item in files:
        entry_bytes = estimated_tar_bytes(item[1], item[2])
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
    return groups


def create_shard(
    output: Path,
    index: int,
    files: list[tuple[Path, str, int]],
) -> dict[str, object]:
    path = output / f"part-{index:05d}.tar"
    with tarfile.open(path, mode="w", format=tarfile.GNU_FORMAT) as archive:
        for source_path, relative_path, _size in files:
            info = archive.gettarinfo(str(source_path), arcname=relative_path)
            if not info.isreg():
                raise ValueError(f"non-regular entry encountered: {relative_path}")
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            info.mode = 0o640
            with source_path.open("rb") as source:
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
    shards = [create_shard(output, index, group) for index, group in enumerate(groups)]
    total_bytes = sum(int(shard["sizeBytes"]) for shard in shards)
    if total_bytes > MAX_TOTAL_BYTES:
        raise ValueError(f"dataset archives exceed {MAX_TOTAL_BYTES} bytes")
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
