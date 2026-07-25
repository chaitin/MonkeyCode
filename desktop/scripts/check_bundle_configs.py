#!/usr/bin/env python3
"""Fail when a bundling Tauri config could ship without the engine sidecar.

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

    if not bundling:
        errors.append(
            "没有任何配置置 bundle.active=true:打包入口丢失,"
            "sidecar 不变量无从校验"
        )
    return errors


def main() -> int:
    errors = check()
    if errors:
        print("打包配置缺少引擎 sidecar:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("打包配置 sidecar 契约 OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
