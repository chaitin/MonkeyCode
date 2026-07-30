#!/usr/bin/env python3
"""Fail when Tauri command registration, ACLs, or literal UI invokes drift."""

from __future__ import annotations

import json
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]


def build_commands(text: str) -> set[str]:
    match = re.search(r"\.commands\s*\(\s*&\[(.*?)\]\s*\)", text, re.S)
    if not match:
        raise ValueError("build.rs 中未找到 AppManifest::commands")
    return set(re.findall(r'"([a-z][a-z0-9_]*)"', match.group(1)))


def registered_commands(text: str) -> set[str]:
    match = re.search(r"tauri::generate_handler!\s*\[(.*?)\]", text, re.S)
    if not match:
        raise ValueError("main.rs 中未找到 tauri::generate_handler!")
    body = re.sub(r"//[^\n]*", "", match.group(1))
    entries = (entry.strip() for entry in body.split(","))
    return {entry.rsplit("::", 1)[-1] for entry in entries if entry}


def capability_commands(config: dict, identifier: str) -> set[str]:
    capabilities = config["app"]["security"]["capabilities"]
    capability = next((item for item in capabilities if item["identifier"] == identifier), None)
    if capability is None:
        raise ValueError(f"tauri.conf.json 缺 capability {identifier!r}")
    return {
        permission.removeprefix("allow-").replace("-", "_")
        for permission in capability["permissions"]
        if permission.startswith("allow-")
    }


INVOKE_RE = re.compile(
    r"\binvoke(?:<[^()]{0,500}>)?\s*\(\s*['\"]([^'\"]+)['\"]",
    re.S,
)


def literal_invokes(paths: list[pathlib.Path]) -> set[str]:
    commands: set[str] = set()
    for path in paths:
        commands.update(INVOKE_RE.findall(path.read_text(encoding="utf-8")))
    # plugin commands have their own generated ACL namespace.
    return {command for command in commands if ":" not in command}


def report_set_error(label: str, left: set[str], right: set[str]) -> list[str]:
    errors: list[str] = []
    if missing := sorted(left - right):
        errors.append(f"{label} 缺少: {', '.join(missing)}")
    if extra := sorted(right - left):
        errors.append(f"{label} 多出: {', '.join(extra)}")
    return errors


def check(root: pathlib.Path = ROOT) -> list[str]:
    build = build_commands((root / "build.rs").read_text(encoding="utf-8"))
    registered = registered_commands((root / "src/main.rs").read_text(encoding="utf-8"))
    config = json.loads((root / "tauri.conf.json").read_text(encoding="utf-8"))
    main_acl = capability_commands(config, "main-app")
    pet_acl = capability_commands(config, "pet-page")

    ui_paths = sorted((root / "ui/src").glob("**/*.ts")) + sorted(
        (root / "ui/src").glob("**/*.tsx")
    )
    main_invokes = literal_invokes(ui_paths)
    pet_invokes = literal_invokes([root / "ui/public/pet.html"])

    errors = report_set_error("build.rs 相对 generate_handler", registered, build)
    if missing := sorted(main_invokes - main_acl):
        errors.append(f"main-app ACL 未授权 UI invoke: {', '.join(missing)}")
    if missing := sorted(pet_invokes - pet_acl):
        errors.append(f"pet-page ACL 未授权 pet invoke: {', '.join(missing)}")
    if missing := sorted((main_invokes | pet_invokes) - registered):
        errors.append(f"UI invoke 未注册 Rust command: {', '.join(missing)}")
    if missing := sorted(registered - (main_acl | pet_acl)):
        errors.append(f"已注册 command 未进入任何 capability: {', '.join(missing)}")
    if stale := sorted((main_acl | pet_acl) - registered):
        errors.append(f"ACL 引用了未注册 command: {', '.join(stale)}")
    return errors


def main() -> int:
    errors = check()
    if errors:
        print("Tauri command contract drift:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Tauri command contract OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
