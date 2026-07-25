#!/usr/bin/env python3
"""Fail when a bundling Tauri config could ship without the engine sidecar or logo.

externalBin 不能放在基础 tauri.conf.json:tauri_build 在**编译期**就为宿主
triple 解析 sidecar,基础配置一带上,每个开发者的 `cargo check` 都要先编出
binaries/ohmyagent-<host-triple>(实测报 "resource path ... doesn't exist")。
所以它只能落在各平台 overlay——而"任何打包产物都带引擎、不存在'包里没
引擎'的静默"这条不变量,就必须由本脚本在打包前/CI 里强制。

规则:
1. 任何 `bundle.active == true` 的配置(= 可独立发起打包)必须声明
   externalBin 且包含 SIDECAR。
2. 基础配置不得声明 externalBin(否则回归上面那条编译期负担)。
3. 纯叠加 overlay(未置 `bundle.active`)不要求 externalBin:它们叠在带
   active 的配置之上,且 Tauri 的配置合并对数组是整体替换、对缺失键不动,
   overlay 不写该键就不会把底层的 externalBin 抹掉。
4. 打包入口还必须带得动产品图标(见 icon_errors):按目标平台要求 .ico/.icns、
   引用的文件必须存在、打 nsis 必须显式设 installerIcon/uninstallerIcon。
   最后这条是本脚本存在的第二个理由——它不设不会报错,只会让安装包用 NSIS
   的通用图标,装机第一眼就不像自己的产品。
"""

from __future__ import annotations

import json
import pathlib
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE_CONFIG = "tauri.conf.json"
SIDECAR = "binaries/ohmyagent"


def bundle_of(config: dict) -> dict:
    bundle = config.get("bundle")
    return bundle if isinstance(bundle, dict) else {}


def icon_errors(root: pathlib.Path, name: str, bundle: dict) -> list[str]:
    """打包入口必须带得动 logo,且引用的图标文件真实存在。

    NSIS 的坑:`bundle.icon` 只管应用自身(tauri-build 把 .ico 编进 exe 资源,
    缺了会硬失败,所以那条不用查在不在)。**安装包 setup.exe 的图标是另一个
    开关** `bundle.windows.nsis.installerIcon`,不设就用 NSIS 自带的通用
    安装图标——官方文档明确没有"回落到应用图标"这一说(对比同结构的
    uninstallerHeaderImage 就写了默认回落)。装机第一眼看到的就是它,
    丢了不会报错、只会不像自己的产品。
    """
    errors: list[str] = []
    icons = bundle.get("icon") or []
    targets = bundle.get("targets") or []
    nsis = ((bundle.get("windows") or {}).get("nsis")) or {}

    def missing(rel: str) -> bool:
        return not (root / rel).is_file()

    # 按目标平台要求对应格式:Windows 取 .ico(tauri-build 编进 exe 资源),
    # macOS 取 .icns(.app 的 CFBundleIconFile)。不跨平台互相要求。
    needs = [
        (".ico", ("nsis", "msi"), "Windows 侧取不到应用图标"),
        (".icns", ("app", "dmg"), ".app 在 Finder/Dock 里没有图标"),
    ]
    for ext, plat_targets, why in needs:
        if any(t in targets for t in plat_targets) and not any(
            str(i).endswith(ext) for i in icons
        ):
            errors.append(f"{name} 打 {'/'.join(plat_targets)} 但 bundle.icon 没有 {ext}:{why}")
    errors += [f"{name} 的 bundle.icon 引用了不存在的文件: {i}" for i in icons if missing(str(i))]

    if "nsis" in targets:
        for key in ("installerIcon", "uninstallerIcon"):
            rel = nsis.get(key)
            if not rel:
                errors.append(
                    f"{name} 打 nsis 但未设 bundle.windows.nsis.{key}:"
                    f"安装/卸载程序会用 NSIS 通用图标,不带产品 logo"
                )
            elif missing(str(rel)):
                errors.append(f"{name} 的 nsis.{key} 指向不存在的文件: {rel}")
    return errors


def check(root: pathlib.Path = ROOT) -> list[str]:
    errors: list[str] = []
    configs = sorted(root.glob("tauri*.conf.json"))
    if not configs:
        raise ValueError(f"未找到任何 tauri*.conf.json({root})")

    bundling = []
    for path in configs:
        bundle = bundle_of(json.loads(path.read_text(encoding="utf-8")))
        external = bundle.get("externalBin") or []
        if path.name == BASE_CONFIG:
            if external:
                errors.append(
                    f"{path.name} 不得声明 externalBin:基础配置带 sidecar 会让"
                    f"普通 cargo check/build 强依赖宿主 triple 二进制"
                )
            continue
        if bundle.get("active") is not True:
            continue  # 纯叠加 overlay,不独立发起打包
        bundling.append(path.name)
        if SIDECAR not in external:
            errors.append(
                f"{path.name} 置了 bundle.active=true 但 externalBin 不含 "
                f"{SIDECAR!r}:该配置能打出不带引擎的包"
            )
        errors += icon_errors(root, path.name, bundle)

    if not bundling:
        errors.append(
            "没有任何配置置 bundle.active=true:打包入口丢失,"
            "sidecar 不变量无从校验"
        )
    return errors


def main() -> int:
    errors = check()
    if errors:
        print("打包配置契约破裂(引擎 sidecar / 产品图标):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("打包配置契约 OK(引擎 sidecar + 产品图标)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
