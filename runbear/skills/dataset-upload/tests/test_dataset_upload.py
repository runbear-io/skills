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


class UploadShardTest(unittest.TestCase):
    def test_rejects_plaintext_upload_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            upload_shard.connection_for("http://storage.example/upload")


if __name__ == "__main__":
    unittest.main()
