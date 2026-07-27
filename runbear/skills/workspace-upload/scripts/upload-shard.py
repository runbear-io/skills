#!/usr/bin/env python3
import argparse
import http.client
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

CHUNK_BYTES = 8 * 1024 * 1024


def connection_for(url: str) -> tuple[http.client.HTTPSConnection, str]:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("upload URL must use HTTPS")
    connection = http.client.HTTPSConnection(parsed.hostname, parsed.port, timeout=120)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return connection, path


def completed_offset(url: str, total_bytes: int) -> int:
    connection, path = connection_for(url)
    try:
        connection.request(
            "PUT",
            path,
            body=b"",
            headers={
                "Content-Length": "0",
                "Content-Range": f"bytes */{total_bytes}",
            },
        )
        response = connection.getresponse()
        response.read()
        if response.status in {200, 201}:
            return total_bytes
        if response.status != 308:
            raise RuntimeError(f"upload status query failed with HTTP {response.status}")
        uploaded_range = response.getheader("Range")
        if uploaded_range is None:
            return 0
        match = re.fullmatch(r"bytes=0-(0|[1-9][0-9]*)", uploaded_range)
        if match is None:
            raise RuntimeError(f"unexpected upload Range header: {uploaded_range}")
        offset = int(match.group(1)) + 1
        if offset > total_bytes:
            raise RuntimeError(
                f"upload Range exceeds local file size: {uploaded_range}"
            )
        return offset
    finally:
        connection.close()


def upload_remaining(url: str, file_path: Path, offset: int, total_bytes: int) -> None:
    if offset >= total_bytes:
        return
    connection, path = connection_for(url)
    remaining = total_bytes - offset
    try:
        connection.putrequest("PUT", path)
        connection.putheader("Content-Length", str(remaining))
        connection.putheader(
            "Content-Range", f"bytes {offset}-{total_bytes - 1}/{total_bytes}"
        )
        connection.putheader("Content-Type", "application/x-tar")
        connection.endheaders()
        with file_path.open("rb") as source:
            source.seek(offset)
            while True:
                chunk = source.read(CHUNK_BYTES)
                if not chunk:
                    break
                connection.send(chunk)
        response = connection.getresponse()
        body = response.read(4096)
        if response.status not in {200, 201}:
            detail = body.decode("utf-8", errors="replace")
            raise RuntimeError(f"upload failed with HTTP {response.status}: {detail}")
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--file", required=True)
    args = parser.parse_args()

    file_path = Path(args.file).expanduser().resolve(strict=True)
    if not file_path.is_file():
        raise ValueError("--file must be a regular file")
    total_bytes = os.path.getsize(file_path)
    offset = completed_offset(args.url, total_bytes)
    upload_remaining(args.url, file_path, offset, total_bytes)
    print(f"uploaded {file_path.name} ({total_bytes} bytes)")


if __name__ == "__main__":
    main()
