import gzip
import hashlib
import importlib.util
import io
import os
import stat
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SKILL_ROOT = Path(__file__).resolve().parents[1]
FIXED_TIMESTAMP = "20260727-120000"


def load_script(name: str):
    path = SKILL_ROOT / "scripts" / name
    spec = importlib.util.spec_from_file_location(name.removesuffix(".py"), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


packager = load_script("package-upload.py")
upload_shard = load_script("upload-shard.py")


def unpack_tar_bytes(shard_path: Path, compression: str) -> bytes:
    compressed = shard_path.read_bytes()
    if compression == "none":
        return compressed
    if compression == "gzip":
        return gzip.decompress(compressed)

    choice = packager.resolve_compression("zstd")
    if choice.implementation == "stdlib":
        module = packager.find_module("compression.zstd", "ZstdDecompressor")
        if module is None:
            raise RuntimeError("compression.zstd became unavailable")
        return module.decompress(compressed)
    if choice.implementation == "zstandard":
        module = packager.find_module("zstandard", "ZstdDecompressor")
        if module is None:
            raise RuntimeError("zstandard became unavailable")
        with module.ZstdDecompressor().stream_reader(io.BytesIO(compressed)) as reader:
            return reader.read()
    binary = choice.implementation.removeprefix("binary:")
    result = subprocess.run(
        [binary, "-q", "-d", "-c"],
        input=compressed,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    return result.stdout


def read_archive(shard_path: Path, compression: str) -> tuple[list[str], dict[str, bytes]]:
    names: list[str] = []
    contents: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(unpack_tar_bytes(shard_path, compression))) as archive:
        for member in archive:
            names.append(member.name)
            if member.isfile():
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise RuntimeError(f"cannot read {member.name}")
                contents[member.name] = extracted.read()
    return names, contents


def shard_path(manifest: dict[str, object], index: int = 0) -> Path:
    shards = manifest["shards"]
    if not isinstance(shards, list):
        raise TypeError("manifest shards must be a list")
    shard = shards[index]
    if not isinstance(shard, dict):
        raise TypeError("manifest shard must be an object")
    path = shard["path"]
    if not isinstance(path, str):
        raise TypeError("manifest shard path must be a string")
    return Path(path)


class PackageUploadTest(unittest.TestCase):
    def test_gzip_packaging_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            (source / "report.txt").write_text("workspace content", encoding="utf-8")

            manifest = packager.package_upload(
                source,
                root / "output",
                "Investor_Diligence",
                "gzip",
                FIXED_TIMESTAMP,
            )

            self.assertEqual(manifest["compression"], "gzip")
            self.assertTrue(shard_path(manifest).name.endswith(".tar.gz"))
            names, contents = read_archive(shard_path(manifest), "gzip")
            self.assertIn("Investor_Diligence/report.txt", names)
            self.assertEqual(
                contents["Investor_Diligence/report.txt"],
                b"workspace content",
            )

    def test_zstd_packaging_round_trip(self) -> None:
        if packager.find_zstd_implementation() is None:
            self.skipTest("no zstd implementation is available")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            (source / "report.txt").write_text("zstd content", encoding="utf-8")

            manifest = packager.package_upload(
                source,
                root / "output",
                "Research Files",
                "zstd",
                FIXED_TIMESTAMP,
            )

            self.assertEqual(manifest["compression"], "zstd")
            self.assertTrue(shard_path(manifest).name.endswith(".tar.zst"))
            names, contents = read_archive(shard_path(manifest), "zstd")
            self.assertIn("Research Files/report.txt", names)
            self.assertEqual(
                contents["Research Files/report.txt"],
                b"zstd content",
            )

    def test_auto_falls_back_to_gzip_but_explicit_zstd_fails(self) -> None:
        with patch.object(packager, "find_zstd_implementation", return_value=None):
            self.assertEqual(
                packager.resolve_compression("auto"),
                packager.CompressionChoice("gzip", "stdlib"),
            )
            with self.assertRaisesRegex(ValueError, "zstd compression requires"):
                packager.resolve_compression("zstd")

    def test_zstd_resolution_order(self) -> None:
        with (
            patch.object(packager, "find_module", return_value=object()),
            patch.object(packager.shutil, "which", return_value="/usr/bin/zstd"),
        ):
            self.assertEqual(packager.find_zstd_implementation(), "stdlib")

        with (
            patch.object(packager, "find_module", side_effect=[None, object()]),
            patch.object(packager.shutil, "which", return_value="/usr/bin/zstd"),
        ):
            self.assertEqual(packager.find_zstd_implementation(), "zstandard")

        with (
            patch.object(packager, "find_module", side_effect=[None, None]),
            patch.object(packager.shutil, "which", return_value="/usr/bin/zstd"),
        ):
            self.assertEqual(
                packager.find_zstd_implementation(),
                "binary:/usr/bin/zstd",
            )

    def test_manifest_matches_compressed_shard_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            (source / "report.bin").write_bytes(bytes(range(256)) * 8)

            manifest = packager.package_upload(
                source,
                root / "output",
                "Reports",
                "gzip",
                FIXED_TIMESTAMP,
            )
            path = shard_path(manifest)
            shards = manifest["shards"]
            if not isinstance(shards, list) or not isinstance(shards[0], dict):
                self.fail("invalid manifest shard shape")
            shard = shards[0]
            compressed_bytes = path.read_bytes()

            self.assertEqual(shard["sizeBytes"], len(compressed_bytes))
            uncompressed_bytes = unpack_tar_bytes(path, "gzip")
            self.assertEqual(shard["uncompressedBytes"], len(uncompressed_bytes))
            self.assertEqual(
                shard["sha256"],
                hashlib.sha256(compressed_bytes).hexdigest(),
            )
            self.assertEqual(manifest["totalBytes"], len(compressed_bytes))
            self.assertEqual(
                manifest["totalUncompressedBytes"],
                shard["uncompressedBytes"],
            )

    def test_repackaging_is_deterministic_despite_source_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            file_path = source / "report.txt"
            file_path.write_text("stable content", encoding="utf-8")

            first = packager.package_upload(
                source,
                root / "first",
                "Stable Layout",
                "gzip",
                FIXED_TIMESTAMP,
            )
            os.chmod(file_path, 0o600)
            os.utime(file_path, (1_700_000_000, 1_700_000_000))
            second = packager.package_upload(
                source,
                root / "second",
                "Stable Layout",
                "gzip",
                FIXED_TIMESTAMP,
            )

            self.assertEqual(
                shard_path(first).read_bytes(),
                shard_path(second).read_bytes(),
            )

    def test_tar_entries_are_sorted_and_metadata_is_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / "zeta").mkdir(parents=True)
            (source / "zeta" / "report.txt").write_text("zeta")
            (source / "alpha.txt").write_text("alpha")
            os.chmod(source / "zeta", 0o700)
            os.chmod(source / "alpha.txt", 0o600)

            manifest = packager.package_upload(
                source,
                root / "output",
                "Normalized",
                "none",
                FIXED_TIMESTAMP,
            )
            tar_bytes = unpack_tar_bytes(shard_path(manifest), "none")
            with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as archive:
                members = archive.getmembers()

            self.assertEqual(
                [member.name for member in members],
                sorted(member.name for member in members),
            )
            for member in members:
                self.assertEqual(member.uid, 0)
                self.assertEqual(member.gid, 0)
                self.assertEqual(member.uname, "")
                self.assertEqual(member.gname, "")
                self.assertEqual(member.mtime, 0)
                self.assertEqual(member.mode, 0o755 if member.isdir() else 0o644)

    def test_explicit_name_prefixes_every_entry_verbatim(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / "nested").mkdir(parents=True)
            (source / "nested" / "report.txt").write_text("content")

            manifest = packager.package_upload(
                source,
                root / "output",
                "Investor_Diligence",
                "none",
                FIXED_TIMESTAMP,
            )
            names, _contents = read_archive(shard_path(manifest), "none")

            self.assertEqual(manifest["topLevelPrefix"], "Investor_Diligence")
            self.assertTrue(
                all(
                    name == "Investor_Diligence"
                    or name.startswith("Investor_Diligence/")
                    for name in names
                )
            )

    def test_single_top_level_entry_keeps_its_own_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            file_source = root / "file-source"
            file_source.mkdir()
            (file_source / "report.txt").write_text("one file")
            direct_file = root / "direct.txt"
            direct_file.write_text("direct file")
            directory_source = root / "directory-source"
            (directory_source / "evidence").mkdir(parents=True)
            (directory_source / "evidence" / "report.txt").write_text("one directory")

            cases = [
                (file_source, "file-output", "report.txt"),
                (directory_source, "directory-output", "evidence"),
                (direct_file, "direct-output", "direct.txt"),
            ]
            for source, output_name, expected_prefix in cases:
                with self.subTest(expected_prefix=expected_prefix):
                    manifest = packager.package_upload(
                        source,
                        root / output_name,
                        None,
                        "none",
                        FIXED_TIMESTAMP,
                    )
                    names, _contents = read_archive(shard_path(manifest), "none")
                    self.assertEqual(manifest["topLevelPrefix"], expected_prefix)
                    self.assertTrue(
                        all(
                            name == expected_prefix
                            or name.startswith(f"{expected_prefix}/")
                            for name in names
                        )
                    )

    def test_multiple_top_level_entries_get_generated_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / "folder").mkdir(parents=True)
            (source / "alpha.txt").write_text("alpha")
            (source / "folder" / "beta.txt").write_text("beta")

            manifest = packager.package_upload(
                source,
                root / "output",
                None,
                "none",
                FIXED_TIMESTAMP,
            )
            names, _contents = read_archive(shard_path(manifest), "none")
            expected_prefix = f"upload-{FIXED_TIMESTAMP}"

            self.assertEqual(manifest["topLevelPrefix"], expected_prefix)
            self.assertTrue(
                all(
                    name == expected_prefix or name.startswith(f"{expected_prefix}/")
                    for name in names
                )
            )

    def test_explicit_name_is_preserved_verbatim(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            (source / "report.txt").write_text("content")
            layout_name = "研究 DATA_Set"

            manifest = packager.package_upload(
                source,
                root / "output",
                layout_name,
                "none",
                FIXED_TIMESTAMP,
            )
            names, _contents = read_archive(shard_path(manifest), "none")

            self.assertEqual(manifest["topLevelPrefix"], layout_name)
            self.assertIn(f"{layout_name}/report.txt", names)

    def test_rejects_unsafe_explicit_names(self) -> None:
        unsafe_names = [
            "",
            ".",
            "..",
            "-leading-hyphen",
            ".leading-dot",
            "nested/name",
            "control\nname",
            "nul\0name",
            "x" * 256,
        ]
        for unsafe_name in unsafe_names:
            with self.subTest(unsafe_name=repr(unsafe_name)):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    source = root / "source"
                    source.mkdir()
                    (source / "report.txt").write_text("content")

                    with self.assertRaises(ValueError):
                        packager.package_upload(
                            source,
                            root / "output",
                            unsafe_name,
                            "none",
                            FIXED_TIMESTAMP,
                        )

    def test_rejects_backslash_in_explicit_or_inferred_name(self) -> None:
        cases = ["explicit", "inferred"]
        for case in cases:
            with self.subTest(case=case):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    source = root / "source"
                    source.mkdir()
                    unsafe_name = r"safe\..\escape"
                    requested_name: str | None
                    if case == "explicit":
                        (source / "report.txt").write_text("content")
                        requested_name = unsafe_name
                    else:
                        inferred_entry = source / unsafe_name
                        inferred_entry.mkdir()
                        (inferred_entry / "report.txt").write_text("content")
                        requested_name = None

                    # An explicit name is refused by the layout-name check; an
                    # inferred one is refused earlier, by the source path check
                    # that now rejects a backslash in any component.
                    expected = (
                        "layout name must not contain"
                        if case == "explicit"
                        else r"path component must not contain"
                    )
                    with self.assertRaisesRegex(ValueError, expected):
                        packager.package_upload(
                            source,
                            root / "output",
                            requested_name,
                            "none",
                            FIXED_TIMESTAMP,
                        )

    def test_rejects_normalized_reserved_layout_names(self) -> None:
        reserved_names = [".CLAUDE", ".claude.", ".claude "]
        for reserved_name in reserved_names:
            with self.subTest(reserved_name=reserved_name):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    source = root / "source"
                    source.mkdir()
                    (source / "report.txt").write_text("content")

                    with self.assertRaisesRegex(
                        ValueError,
                        f"reserved workspace root entry: {reserved_name}",
                    ):
                        packager.package_upload(
                            source,
                            root / "output",
                            reserved_name,
                            "none",
                            FIXED_TIMESTAMP,
                        )


    def test_rejects_reserved_top_level_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / ".git").mkdir(parents=True)
            (source / ".git" / "config").write_text("config")

            with self.assertRaisesRegex(ValueError, "reserved workspace root entry"):
                packager.package_upload(
                    source,
                    root / "output",
                    None,
                    "none",
                    FIXED_TIMESTAMP,
                )

    def test_reserved_entry_is_allowed_below_safe_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            (source / ".git").mkdir(parents=True)
            (source / ".git" / "config").write_text("config")

            manifest = packager.package_upload(
                source,
                root / "output",
                "Project Files",
                "none",
                FIXED_TIMESTAMP,
            )
            names, _contents = read_archive(shard_path(manifest), "none")

            self.assertIn("Project Files/.git/config", names)

    def test_rejects_backslash_in_source_descendant_path(self) -> None:
        # A POSIX-legal component containing '\' would be embedded verbatim
        # under the safe --name prefix, letting a backslash-normalizing
        # extractor escape it into a reserved workspace-root entry.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            escape = source / "..\\..\\.claude"
            escape.mkdir(parents=True)
            (escape / "settings.json").write_text("{}")

            with self.assertRaisesRegex(ValueError, r"must not contain"):
                packager.package_upload(
                    source,
                    root / "output",
                    "Project Files",
                    "none",
                    FIXED_TIMESTAMP,
                )

    def test_rejects_secret_files(self) -> None:
        forbidden_paths = [
            ".env",
            ".env.production",
            ".mcp.json",
            ".claude.json",
            ".claude/settings.json",
            ".claude/settings.local.json",
        ]
        for forbidden_path in forbidden_paths:
            with self.subTest(forbidden_path=forbidden_path):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    source = root / "source"
                    path = source / forbidden_path
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("secret")

                    with self.assertRaisesRegex(ValueError, "forbidden configuration"):
                        packager.package_upload(
                            source,
                            root / "output",
                            "Safe Prefix",
                            "none",
                            FIXED_TIMESTAMP,
                        )

    def test_rejects_symbolic_link(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            target = root / "target.txt"
            target.write_text("secret")
            (source / "link.txt").symlink_to(target)

            with self.assertRaisesRegex(ValueError, "symbolic links"):
                packager.package_upload(
                    source,
                    root / "output",
                    "Safe Prefix",
                    "none",
                    FIXED_TIMESTAMP,
                )

    def test_rejects_device_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            output.mkdir()
            device = source / "device"
            device.write_bytes(b"")
            real_stat = os.stat

            def device_stat(path, *args, **kwargs):
                result = real_stat(path, *args, **kwargs)
                if Path(path) == device:
                    values = list(result)
                    values[0] = stat.S_IFCHR | 0o600
                    return os.stat_result(values)
                return result

            with patch.object(packager.os, "stat", side_effect=device_stat):
                with self.assertRaisesRegex(ValueError, "special filesystem entry"):
                    packager.inventory(source, output)

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
            source_root, entries = packager.inventory(source, output)
            _prefix, archive_entries = packager.choose_layout(
                entries,
                "Safe Prefix",
                FIXED_TIMESTAMP,
            )
            safe.unlink()
            safe.symlink_to(secret)

            with self.assertRaises((OSError, ValueError)):
                packager.create_shard(
                    source_root,
                    output,
                    0,
                    archive_entries,
                    packager.resolve_compression("none"),
                )

    def test_rejects_uncompressed_shard_above_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            (source / "compressible.txt").write_bytes(b"x" * 16 * 1024)

            with (
                patch.object(
                    packager,
                    "MAX_SHARD_UNCOMPRESSED_BYTES",
                    10 * 1024,
                ),
                patch.object(
                    packager,
                    "MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES",
                    64 * 1024,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    r"expands to \d+ bytes; "
                    r"allowed per-shard maximum is 10240 bytes",
                ),
            ):
                packager.package_upload(
                    source,
                    output,
                    "Compressible",
                    "gzip",
                    FIXED_TIMESTAMP,
                )

            self.assertEqual(list(output.glob("part-*.tar*")), [])
            self.assertFalse((output / "manifest.json").exists())

    def test_rejects_uncompressed_total_above_limit_without_partial_shards(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            output = root / "output"
            source.mkdir()
            (source / "compressible.txt").write_bytes(b"x" * 16 * 1024)

            with (
                patch.object(
                    packager,
                    "MAX_WORKSPACE_UPLOAD_EXTRACTED_BYTES",
                    10 * 1024,
                ),
                patch.object(
                    packager,
                    "MAX_SHARD_UNCOMPRESSED_BYTES",
                    64 * 1024,
                ),
                self.assertRaisesRegex(
                    ValueError,
                    r"uncompressed upload is \d+ bytes; "
                    r"allowed maximum is 10240 bytes",
                ),
            ):
                packager.package_upload(
                    source,
                    output,
                    "Compressible",
                    "gzip",
                    FIXED_TIMESTAMP,
                )

            self.assertEqual(list(output.glob("part-*.tar*")), [])
            self.assertFalse((output / "manifest.json").exists())

    def test_produced_shards_never_exceed_compressed_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            alpha = b"".join(
                hashlib.sha256(f"alpha-{index}".encode()).digest()
                for index in range(220)
            )
            beta = b"".join(
                hashlib.sha256(f"beta-{index}".encode()).digest()
                for index in range(220)
            )
            (source / "alpha.bin").write_bytes(alpha)
            (source / "beta.bin").write_bytes(beta)

            with patch.object(packager, "MAX_SHARD_BYTES", 10 * 1024):
                manifest = packager.package_upload(
                    source,
                    root / "output",
                    "Split Files",
                    "gzip",
                    FIXED_TIMESTAMP,
                )

            shards = manifest["shards"]
            if not isinstance(shards, list):
                self.fail("invalid manifest shard shape")
            self.assertEqual(len(shards), 2)
            self.assertTrue(
                all(
                    isinstance(shard, dict)
                    and isinstance(shard["sizeBytes"], int)
                    and shard["sizeBytes"] <= 10 * 1024
                    for shard in shards
                )
            )
            extracted_sizes: list[int] = []
            for shard in shards:
                if not isinstance(shard, dict):
                    self.fail("invalid manifest shard shape")
                local_path = shard["path"]
                if not isinstance(local_path, str):
                    self.fail("invalid manifest shard path")
                extracted_size = len(unpack_tar_bytes(Path(local_path), "gzip"))
                extracted_sizes.append(extracted_size)
                self.assertEqual(shard["uncompressedBytes"], extracted_size)
            self.assertEqual(
                manifest["totalUncompressedBytes"],
                sum(extracted_sizes),
            )


class UploadShardTest(unittest.TestCase):
    class FakeResponse:
        status = 308

        def __init__(self, uploaded_range: str | None) -> None:
            self.uploaded_range = uploaded_range

        def read(self) -> bytes:
            return b""

        def getheader(self, name: str) -> str | None:
            return self.uploaded_range if name == "Range" else None

    class FakeConnection:
        def __init__(self, uploaded_range: str | None) -> None:
            self.response = UploadShardTest.FakeResponse(uploaded_range)

        def request(self, *_args, **_kwargs) -> None:
            return None

        def getresponse(self):
            return self.response

        def close(self) -> None:
            return None

    def completed_offset(self, uploaded_range: str | None, total_bytes: int = 100) -> int:
        with patch.object(
            upload_shard,
            "connection_for",
            return_value=(self.FakeConnection(uploaded_range), "/upload"),
        ):
            return upload_shard.completed_offset(
                "https://storage.example/upload",
                total_bytes,
            )

    def test_rejects_plaintext_upload_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "must use HTTPS"):
            upload_shard.connection_for("http://storage.example/upload")

    def test_exact_complete_offset(self) -> None:
        self.assertEqual(self.completed_offset("bytes=0-99"), 100)

    def test_partial_offset(self) -> None:
        self.assertEqual(self.completed_offset("bytes=0-49"), 50)

    def test_rejects_offset_beyond_local_file_size(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "exceeds local file size"):
            self.completed_offset("bytes=0-100")

    def test_rejects_malformed_range_header(self) -> None:
        for uploaded_range in [
            "bytes=1-49",
            "bytes=0-+49",
            "bytes=0-49-extra",
            "garbage",
        ]:
            with self.subTest(uploaded_range=uploaded_range):
                with self.assertRaisesRegex(RuntimeError, "unexpected upload Range"):
                    self.completed_offset(uploaded_range)


if __name__ == "__main__":
    unittest.main()
