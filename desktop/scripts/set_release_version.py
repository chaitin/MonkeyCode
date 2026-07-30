#!/usr/bin/env python3
"""把 vYYMMDDNN 发布 tag 注入 desktop 的全部版本来源。"""

from __future__ import annotations

import pathlib
import re
import sys
from datetime import datetime


TAG_RE = re.compile(r"v([0-9]{8})")


def configure_utf8_output() -> None:
    """避免 Windows runner 的 cp1252 控制台无法输出中文诊断信息。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")


def release_version(tag: str) -> str:
    """校验 vYYMMDDNN tag，并转换为 Tauri/Cargo 所需的 SemVer。"""
    match = TAG_RE.fullmatch(tag)
    if not match:
        raise ValueError(f"发布 tag 必须是 vYYMMDDNN，收到: {tag!r}")
    short = match.group(1)
    try:
        datetime.strptime(short[:6], "%y%m%d")
    except ValueError as exc:
        raise ValueError(f"发布 tag 的日期部分无效: {tag!r}") from exc
    return f"{short}.0.0"


def replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"无法在 {label} 中唯一定位版本字段")
    return updated


def apply_version(root: pathlib.Path, tag: str) -> str:
    """更新 Tauri、Cargo manifest 与主/Win7 lockfile，返回内部 SemVer。"""
    version = release_version(tag)
    updates: dict[pathlib.Path, str] = {}

    tauri = root / "tauri.conf.json"
    updates[tauri] = replace_once(
        tauri.read_text(encoding="utf-8"),
        r'^(  "version": ")[^"]+(",)$',
        rf"\g<1>{version}\g<2>",
        str(tauri),
    )

    manifest = root / "Cargo.toml"
    updates[manifest] = replace_once(
        manifest.read_text(encoding="utf-8"),
        r'^(version = ")[^"]+("$)',
        rf"\g<1>{version}\g<2>",
        str(manifest),
    )

    package_pattern = r'(^name = "monkeycode-desktop"\nversion = ")[^"]+("$)'
    for name in ("Cargo.lock", "Cargo.lock.win7"):
        lock = root / name
        updates[lock] = replace_once(
            lock.read_text(encoding="utf-8"),
            package_pattern,
            rf"\g<1>{version}\g<2>",
            str(lock),
        )

    # 所有文件都能精确定位后再落盘，避免中途失败留下半套版本。
    for path, text in updates.items():
        path.write_text(text, encoding="utf-8")
    return version


def main() -> int:
    configure_utf8_output()
    if len(sys.argv) != 2:
        print(f"用法: {pathlib.Path(sys.argv[0]).name} vYYMMDDNN", file=sys.stderr)
        return 2
    try:
        version = apply_version(pathlib.Path(__file__).resolve().parent.parent, sys.argv[1])
    except (OSError, ValueError) as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1
    print(f"desktop 发布版本: tag={sys.argv[1]} semver={version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
