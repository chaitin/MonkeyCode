#!/usr/bin/env python3

import pathlib
import tempfile
import unittest

from set_release_version import apply_version, release_version


class ReleaseVersionTest(unittest.TestCase):
    def test_release_version_validates_tag(self) -> None:
        self.assertEqual(release_version("v26072208"), "26072208.0.0")
        for invalid in ("26072208", "vv26072208", "2607228", "v26073208", "latest"):
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                release_version(invalid)

    def test_apply_version_updates_every_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "tauri.conf.json").write_text(
                '{\n  "productName": "MonkeyCode",\n  "version": "1.0.0",\n  "bundle": {}\n}\n',
                encoding="utf-8",
            )
            (root / "Cargo.toml").write_text(
                '[package]\nname = "monkeycode-desktop"\nversion = "1.0.0"\n',
                encoding="utf-8",
            )
            lock = '[[package]]\nname = "monkeycode-desktop"\nversion = "1.0.0"\n'
            (root / "Cargo.lock").write_text(lock, encoding="utf-8")
            (root / "Cargo.lock.win7").write_text(lock, encoding="utf-8")

            self.assertEqual(apply_version(root, "v26072208"), "26072208.0.0")
            for name in ("tauri.conf.json", "Cargo.toml", "Cargo.lock", "Cargo.lock.win7"):
                self.assertIn("26072208.0.0", (root / name).read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
