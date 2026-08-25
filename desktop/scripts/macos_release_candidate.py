#!/usr/bin/env python3
"""记录并校验 macOS unsigned 发布候选，防止 release 签到旧产物。"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
RELEASE = ROOT / "target/universal-apple-darwin/release"
APP = RELEASE / "bundle/macos/MonkeyCode.app"
MANIFEST = RELEASE / "macos-release-candidate.json"
INPUTS = (
    RELEASE / "monkeycode-desktop",
    APP,
    ROOT / "binaries/ohmyagent-aarch64-apple-darwin",
    ROOT / "binaries/ohmyagent-x86_64-apple-darwin",
    ROOT / "binaries/ohmyagent-universal-apple-darwin",
    ROOT / "uidist",
    ROOT.parent / "browser-extension/dist",
    ROOT.parent / "plugins/skills",
    ROOT / "icons/icon.icns",
    ROOT / "icons/icon.png",
    ROOT / "tauri.conf.json",
    ROOT / "bundle.macos.conf.json",
    ROOT / "tauri.release.conf.json",
)


def relative(path: pathlib.Path) -> str:
    return os.path.relpath(path, ROOT)


def digest_path(root: pathlib.Path) -> str:
    if not root.exists() and not root.is_symlink():
        raise ValueError(f"候选输入不存在: {relative(root)}")

    digest = hashlib.sha256()
    entries = [root]
    if root.is_dir() and not root.is_symlink():
        entries.extend(sorted(root.rglob("*"), key=lambda path: path.as_posix()))

    for path in entries:
        rel = "." if path == root else path.relative_to(root).as_posix()
        mode = stat.S_IMODE(path.lstat().st_mode)
        if path.is_symlink():
            kind = "link"
            payload = os.readlink(path).encode()
        elif path.is_dir():
            kind = "dir"
            payload = b""
        elif path.is_file():
            kind = "file"
            payload = path.read_bytes()
        else:
            raise ValueError(f"不支持的候选输入类型: {relative(path)}")
        digest.update(f"{kind}\0{rel}\0{mode:o}\0".encode())
        digest.update(hashlib.sha256(payload).digest())
    return digest.hexdigest()


def ensure_unsigned() -> None:
    result = subprocess.run(
        ["codesign", "-d", "--verbose=4", str(APP)],
        capture_output=True,
        text=True,
        check=False,
    )
    details = result.stdout + result.stderr
    if "Authority=" in details or "TeamIdentifier=8Z56KX83T3" in details:
        raise ValueError("待发布 .app 已有 Developer ID 签名，请重新运行 make macos-release-build")


def git_commit() -> str:
    return subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()


def snapshot() -> dict[str, str]:
    return {relative(path): digest_path(path) for path in INPUTS}


def record() -> None:
    ensure_unsigned()
    data = {"version": 1, "git_commit": git_commit(), "inputs": snapshot()}
    MANIFEST.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print(f"unsigned 发布候选指纹已记录: {relative(MANIFEST)}")


def verify() -> None:
    if not MANIFEST.exists():
        raise ValueError("缺少发布候选指纹，请先运行 make macos-release-build")
    ensure_unsigned()
    expected = json.loads(MANIFEST.read_text(encoding="utf-8"))
    if expected.get("git_commit") != git_commit():
        raise ValueError("发布候选不是当前提交构建的，请重新运行 make macos-release-build")
    actual = snapshot()
    if expected.get("inputs") != actual:
        changed = sorted(
            key
            for key in set(expected.get("inputs", {})) | set(actual)
            if expected.get("inputs", {}).get(key) != actual.get(key)
        )
        raise ValueError(
            "发布候选或 bundle 输入在测试后发生变化，请重新构建并测试: "
            + ", ".join(changed)
        )
    print("unsigned 发布候选指纹校验通过")


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in {"record", "verify"}:
        print(f"用法: {pathlib.Path(sys.argv[0]).name} record|verify", file=sys.stderr)
        return 2
    try:
        record() if sys.argv[1] == "record" else verify()
    except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
