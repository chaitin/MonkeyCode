#!/usr/bin/env python3
"""Fail when the dark theme drifts from the light token set.

深色主题的设计是"只填令牌值、组件零改动"(ui/src/styles.css 头部注释):
`:root` 定义全部令牌,`[data-theme="dark"]` 逐个覆盖同名令牌。这条不变量破了
不会有编译错误——深色下某个颜色悄悄回落成浅色值,而开发几乎总在浅色下写
代码,肉眼永远看不见。"加新令牌只改 :root"是最容易漏的一步。

放在 scripts/ 而不是 vitest:检查对象是 CSS 源文本这一静态文件契约,与
check_command_contract.py / check_bundle_configs.py 同类;而 vitest 默认把
CSS 导入 stub 成空串(`?raw` 拿不到内容),浏览器工程也不该为读文件引
@types/node。
"""

from __future__ import annotations

import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
STYLES = ROOT / "ui/src/styles.css"
LIGHT_SELECTOR = ":root"
DARK_SELECTOR = '[data-theme="dark"]'
# 深色块曾经只有一行 TODO 注释(切换是 no-op)。给个下限,防它被清空后
# "集合一致"因为两边都空而假成立。
MIN_TOKENS = 50


def tokens_of(css: str, selector: str) -> list[str]:
    """按出现顺序取某选择器块内声明的令牌名。自定义属性块不嵌套,取到首个
    `}` 即整块。"""
    block = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    if not block:
        raise ValueError(f"{STYLES.name} 中找不到选择器块:{selector}")
    return re.findall(r"^\s*(--[\w-]+)\s*:", block.group(1), re.M)


def check(styles: pathlib.Path = STYLES) -> list[str]:
    css = styles.read_text(encoding="utf-8")
    light = tokens_of(css, LIGHT_SELECTOR)
    dark = tokens_of(css, DARK_SELECTOR)
    errors: list[str] = []

    if missing := sorted(set(light) - set(dark)):
        errors.append(
            f"深色块缺令牌(深色下会回落成浅色值): {', '.join(missing)}"
        )
    if extra := sorted(set(dark) - set(light)):
        errors.append(f"深色块多出 :root 没有的令牌: {', '.join(extra)}")
    for name, seq in (("’:root’", light), ("深色块", dark)):
        if dupes := sorted({t for t in seq if seq.count(t) > 1}):
            errors.append(f"{name} 重复声明同一令牌: {', '.join(dupes)}")
    if len(dark) < MIN_TOKENS:
        errors.append(
            f"深色块只有 {len(dark)} 个令牌(下限 {MIN_TOKENS}):"
            f"主题切换很可能又退化成 no-op"
        )
    return errors


def main() -> int:
    errors = check()
    if errors:
        print("主题令牌契约破裂:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("主题令牌契约 OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
