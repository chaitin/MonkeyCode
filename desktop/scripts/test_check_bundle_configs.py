#!/usr/bin/env python3

import json
import pathlib
import tempfile
import unittest

from check_bundle_configs import SIDECAR, WSL_SIDECAR, check


def write(root: pathlib.Path, name: str, bundle: dict) -> None:
    (root / name).write_text(json.dumps({"bundle": bundle}), encoding="utf-8")


class BundleConfigContractTest(unittest.TestCase):
    def test_real_repo_configs_satisfy_the_contract(self) -> None:
        self.assertEqual(check(), [])

    def test_bundling_config_without_sidecar_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            # 图标齐备,把断言隔离在 sidecar 这一个关注点上
            (root / "icons").mkdir()
            (root / "icons" / "icon.icns").write_bytes(b"x")
            write(root, "tauri.conf.json", {"active": False})
            write(root, "bundle.macos.conf.json",
                  {"active": True, "targets": ["dmg"], "icon": ["icons/icon.icns"]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("bundle.macos.conf.json", errors[0])
            self.assertIn("externalBin", errors[0])

    def test_base_config_may_not_declare_external_bin(self) -> None:
        # 基础配置带 sidecar 会让普通 cargo check 强依赖宿主 triple 二进制。
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False, "externalBin": [SIDECAR]})
            write(root, "bundle.win.conf.json", {"active": True, "externalBin": [SIDECAR]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("tauri.conf.json", errors[0])

    def test_pure_overlay_needs_no_sidecar(self) -> None:
        # 只叠 resources/endpoints 的 overlay(如 tauri.release.conf.json)不独立打包。
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            write(root, "bundle.win.conf.json", {"active": True, "externalBin": [SIDECAR]})
            write(root, "bundle.extra.conf.json", {"resources": {"extras/*": "./"}})
            self.assertEqual(check(root), [])

    # ---- WSL 引擎不变量 ----
    # Windows(nsis)包必须经 resources 附带 binaries/ohmyagent-linux,
    # 否则 WSL 运行环境的 find_ohmyagent_linux 落空,功能静默残废。

    def test_nsis_without_wsl_engine_resource_is_rejected(self) -> None:
        root = self.nsis_root(nsis={"installerIcon": "icons/icon.ico",
                                    "uninstallerIcon": "icons/icon.ico"})
        cfg = json.loads((root / "bundle.windows.conf.json").read_text(encoding="utf-8"))
        del cfg["bundle"]["resources"]
        (root / "bundle.windows.conf.json").write_text(json.dumps(cfg), encoding="utf-8")
        errors = check(root)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("ohmyagent-linux", errors[0])

    def test_non_windows_targets_need_no_wsl_engine(self) -> None:
        # WSL 只是 Windows 包的义务;macOS/Linux 包不受牵连
        root = pathlib.Path(tempfile.mkdtemp())
        (root / "icons").mkdir()
        (root / "icons" / "icon.icns").write_bytes(b"x")
        write(root, "tauri.conf.json", {"active": False})
        write(root, "bundle.macos.conf.json", {
            "active": True, "targets": ["app", "dmg"],
            "externalBin": [SIDECAR], "icon": ["icons/icon.icns"]})
        self.assertEqual(check(root), [])

    # ---- 图标不变量 ----
    # bundle.icon 缺 .ico 会让 tauri-build 硬失败,所以不用测"在不在";真正
    # 会静默丢的是 NSIS 的 installerIcon —— 不设就用 NSIS 通用安装图标,
    # 官方没有"回落到应用图标"这一说。

    def nsis_root(self, nsis: dict | None = None, icon: list[str] | None = None) -> pathlib.Path:
        root = pathlib.Path(tempfile.mkdtemp())
        (root / "icons").mkdir()
        for f in ("icon.ico", "icon.icns"):
            (root / "icons" / f).write_bytes(b"x")
        win = {"active": True, "targets": ["nsis"], "externalBin": [SIDECAR],
               "resources": {WSL_SIDECAR: "./"},
               "icon": ["icons/icon.ico"] if icon is None else icon}
        if nsis is not None:
            win["windows"] = {"nsis": nsis}
        write(root, "tauri.conf.json", {"active": False})
        write(root, "bundle.windows.conf.json", win)
        return root

    def test_nsis_without_installer_icon_is_reported(self) -> None:
        errors = check(self.nsis_root(nsis={"languages": ["English"]}))
        self.assertEqual(len(errors), 2, errors)  # installerIcon + uninstallerIcon
        self.assertTrue(all("nsis." in e for e in errors), errors)

    def test_nsis_with_both_installer_icons_passes(self) -> None:
        root = self.nsis_root(nsis={"installerIcon": "icons/icon.ico",
                                    "uninstallerIcon": "icons/icon.ico"})
        self.assertEqual(check(root), [])

    def test_installer_icon_pointing_at_missing_file_is_reported(self) -> None:
        root = self.nsis_root(nsis={"installerIcon": "icons/nope.ico",
                                    "uninstallerIcon": "icons/icon.ico"})
        errors = check(root)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("nope.ico", errors[0])

    def test_windows_target_without_ico_is_reported(self) -> None:
        errors = check(self.nsis_root(
            nsis={"installerIcon": "icons/icon.ico", "uninstallerIcon": "icons/icon.ico"},
            icon=["icons/icon.icns"]))
        self.assertEqual(len(errors), 1, errors)
        self.assertIn(".ico", errors[0])

    def test_macos_target_is_not_asked_for_an_ico(self) -> None:
        # 格式要求按目标平台分开:macOS 只该被要求 .icns
        root = pathlib.Path(tempfile.mkdtemp())
        (root / "icons").mkdir()
        (root / "icons" / "icon.icns").write_bytes(b"x")
        write(root, "tauri.conf.json", {"active": False})
        write(root, "bundle.macos.conf.json", {
            "active": True, "targets": ["app", "dmg"],
            "externalBin": [SIDECAR], "icon": ["icons/icon.icns"]})
        self.assertEqual(check(root), [])

    # ---- 平台自动合并名 ----
    # 这条是本轮最贵的一课:tauri.<平台>.conf.json 会被 Tauri 无条件并进该平台
    # 上的每次 cargo build/check(不需要 --config),打包专属的
    # active/externalBin/resources 一并生效 —— 实测普通 cargo check 直接报
    # "resource path binaries/ohmyagent-<triple> doesn't exist"。

    def test_platform_auto_merged_name_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "icons").mkdir()
            (root / "icons" / "icon.icns").write_bytes(b"x")
            write(root, "tauri.conf.json", {"active": False})
            write(root, "tauri.macos.conf.json", {
                "active": True, "targets": ["app"],
                "externalBin": [SIDECAR], "icon": ["icons/icon.icns"]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("自动合并名", errors[0])
            self.assertIn("bundle.macos.conf.json", errors[0])

    def test_json5_variant_of_auto_merged_name_is_also_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            (root / "icons").mkdir()
            (root / "icons" / "32x32.png").write_bytes(b"x")
            (root / "tauri.linux.conf.json5").write_text("{}", encoding="utf-8")
            write(root, "bundle.linux.conf.json", {
                "active": True, "targets": ["deb"],
                "externalBin": [SIDECAR], "icon": ["icons/32x32.png"]})
            self.assertTrue(any("自动合并名" in e for e in check(root)), check(root))

    def test_bundle_prefixed_names_are_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "icons").mkdir()
            (root / "icons" / "32x32.png").write_bytes(b"x")
            write(root, "tauri.conf.json", {"active": False})
            write(root, "bundle.linux.conf.json", {
                "active": True, "targets": ["deb", "rpm", "appimage"],
                "externalBin": [SIDECAR], "icon": ["icons/32x32.png"]})
            self.assertEqual(check(root), [])

    def test_linux_target_without_png_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "icons").mkdir()
            (root / "icons" / "icon.ico").write_bytes(b"x")
            write(root, "tauri.conf.json", {"active": False})
            write(root, "bundle.linux.conf.json", {
                "active": True, "targets": ["appimage"],
                "externalBin": [SIDECAR], "icon": ["icons/icon.ico"]})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn(".png", errors[0])

    def test_missing_bundling_entry_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, "tauri.conf.json", {"active": False})
            errors = check(root)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("打包入口丢失", errors[0])


if __name__ == "__main__":
    unittest.main()
