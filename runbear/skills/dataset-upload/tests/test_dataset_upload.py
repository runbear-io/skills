import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SKILL_ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str):
    path = SKILL_ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package_dataset = load_script("package-dataset.py")
upload_shard = load_script("upload-shard.py")


class PackageDatasetTest(unittest.TestCase):
    def test_rejects_nested_claude_and_mcp_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            (source / "nested" / ".claude").mkdir(parents=True)
            output.mkdir()
            (source / "nested" / ".mcp.json").write_text("{}")
            (source / "nested" / ".claude" / "settings.local.json").write_text(
                "{}"
            )

            with self.assertRaisesRegex(ValueError, "forbidden configuration"):
                package_dataset.inventory(source, output)

    def test_archive_read_rejects_file_replaced_by_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            output.mkdir()
            safe = source / "safe.txt"
            secret = root / "secret.txt"
            safe.write_text("safe")
            secret.write_text("secret")
            files = package_dataset.inventory(source, output)
            safe.unlink()
            safe.symlink_to(secret)

            with self.assertRaises((OSError, ValueError)):
                package_dataset.create_shard(source, output, 0, files)

    def test_rejects_more_than_64_shards_before_writing_archives(self) -> None:
        size = package_dataset.TARGET_SHARD_BYTES - 4096
        file_stat = os.stat_result((stat.S_IFREG, 1, 1, 1, 0, 0, size, 0, 0, 0))
        files = [
            (Path(f"file-{index}"), f"file-{index}", file_stat)
            for index in range(65)
        ]

        with self.assertRaisesRegex(ValueError, "exceeds 64 shards"):
            package_dataset.group_files(files)

    def test_propagates_walk_errors(self) -> None:
        def failing_walk(*_args, **kwargs):
            kwargs["onerror"](PermissionError("denied"))
            return []

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            output.mkdir()
            with patch.object(package_dataset.os, "walk", side_effect=failing_walk):
                with self.assertRaises(PermissionError):
                    package_dataset.inventory(source, output)

    def test_rejects_aggregate_limit_before_writing_archives(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            output.mkdir()

            with (
                patch.object(
                    package_dataset,
                    "estimated_shard_bytes",
                    return_value=package_dataset.MAX_TOTAL_BYTES + 1,
                ),
                patch.object(package_dataset, "create_shard") as create_shard,
            ):
                with self.assertRaisesRegex(ValueError, "archives exceed"):
                    package_dataset.create_shards(source, output, [[]])

            create_shard.assert_not_called()
            self.assertEqual(list(output.iterdir()), [])

    def test_removes_partial_archives_when_shard_creation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            output.mkdir()

            def failing_create_shard(_source, shard_output, index, _group):
                path = shard_output / f"part-{index:05d}.tar"
                path.write_bytes(b"partial")
                if index == 1:
                    raise RuntimeError("injected shard failure")
                return {
                    "index": index,
                    "path": str(path),
                    "sizeBytes": path.stat().st_size,
                    "sha256": "0" * 64,
                    "fileCount": 0,
                }

            with patch.object(
                package_dataset,
                "create_shard",
                side_effect=failing_create_shard,
            ):
                with self.assertRaisesRegex(RuntimeError, "injected shard failure"):
                    package_dataset.create_shards(source, output, [[], []])

            self.assertEqual(list(output.iterdir()), [])


class UploadShardTest(unittest.TestCase):
    def test_rejects_plaintext_upload_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            upload_shard.connection_for("http://storage.example/upload")

    def test_validates_resumable_offsets_against_local_file_size(self) -> None:
        class FakeResponse:
            status = 308

            def __init__(self, uploaded_range: str) -> None:
                self.uploaded_range = uploaded_range

            def read(self) -> bytes:
                return b""

            def getheader(self, name: str) -> str | None:
                return self.uploaded_range if name == "Range" else None

        class FakeConnection:
            def __init__(self, uploaded_range: str) -> None:
                self.response = FakeResponse(uploaded_range)

            def request(self, *_args, **_kwargs) -> None:
                return None

            def getresponse(self) -> FakeResponse:
                return self.response

            def close(self) -> None:
                return None

        for uploaded_range, expected in [
            ("bytes=0-49", 50),
            ("bytes=0-99", 100),
        ]:
            with self.subTest(uploaded_range=uploaded_range):
                with patch.object(
                    upload_shard,
                    "connection_for",
                    return_value=(FakeConnection(uploaded_range), "/upload"),
                ):
                    self.assertEqual(
                        upload_shard.completed_offset(
                            "https://storage.example/upload",
                            100,
                        ),
                        expected,
                    )

        with patch.object(
            upload_shard,
            "connection_for",
            return_value=(FakeConnection("bytes=0-100"), "/upload"),
        ):
            with self.assertRaisesRegex(RuntimeError, "exceeds local file size"):
                upload_shard.completed_offset(
                    "https://storage.example/upload",
                    100,
                )


if __name__ == "__main__":
    unittest.main()
