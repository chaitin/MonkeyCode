#!/usr/bin/env python3

import json
import pathlib
import tempfile
import unittest

from check_bundle_configs import SIDECAR, check


def write(root: pathlib.Path, name: str, bundle: dict) -> None:
    (root / name).write_text(json.dumps({"bundle": bundle}), encoding="utf-8")


class BundleConfigContractTest(unittest.TestCase):
    def test_real_repo_configs_satisfy_the_contract(self) -> None:
        self.assertEqual(check(), [])

    def test_bundling_config_without_sidecar_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            write(root, "tauri.macos.conf.json", {"active": True, "targets": ["dmg"]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("tauri.macos.conf.json", errors[0])
            self.assertIn("externalBin", errors[0])

    def test_base_config_may_not_declare_external_bin(self) -> None:
        # 基础配置带 sidecar 会让普通 cargo check 强依赖宿主 triple 二进制。
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False, "externalBin": [SIDECAR]})
            write(root, "tauri.win.conf.json", {"active": True, "externalBin": [SIDECAR]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("tauri.conf.json", errors[0])

    def test_pure_overlay_needs_no_sidecar(self) -> None:
        # win7 那类只叠 resources/endpoints 的 overlay 不独立打包。
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            write(root, "tauri.win.conf.json", {"active": True, "externalBin": [SIDECAR]})
            write(root, "tauri.win7.conf.json", {"resources": {"ucrt/*": "./"}})
            self.assertEqual(check(root), [])

    def test_missing_bundling_entry_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("打包入口丢失", errors[0])


if __name__ == "__main__":
    unittest.main()
