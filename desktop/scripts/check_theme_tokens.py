#!/usr/bin/env python3
"""主题契约守卫(daisyUI 版,盯 ui-next —— 即 tauri.conf.json 实际打包的那套)。

配色由 daisyUI 提供:内置 35 套经 `@plugin "daisyui"` 的 themes 清单启用,
品牌两套(monkeycode / monkeycode-dark)由 `@plugin "daisyui/theme"` 块声明。
这里盯几条仍然会静默烂掉的契约:

1. index.html 的首帧防闪底色 ↔ app.css 里对应主题块的 --color-base-100。
   那两个 hex 是全仓唯一走不了 var() 的颜色:app.css 由 main.tsx 引入,
   首帧时还没到,只能写死在 index.html 的 <style> 里。漂了不报错,只是启动
   闪一帧另一个颜色,没人会注意到。
   **值从 app.css 现取,不再另设常量**——旧版把同一个颜色抄在 index.html、
   脚本常量、daisyUI 主题源三个地方,改一处忘两处是迟早的事。
2. 深色规则的选择器必须覆盖 prefersdark 那套主题名,否则系统深色首启走的是
   浅色底。规则同时也匹配内置 `dark`(刻意共用一条),故再核一遍内置 dark 的
   base-100 与我们的值没有差太远——共用是近似,不是可以无限漂。
3. 同步内联脚本必须在,且读 mc.theme + mc.themeBg:带 type="module" 的脚本是
   defer 的,赶不上首帧;35 套主题不可能像 light/dark 那样把底色写死进 <style>,
   非品牌主题的首帧底色全靠 mc.themeBg 缓存。
4. @theme 块内不许重复声明同一令牌(后写的静默盖掉先写的)。

放在 scripts/ 而不是 vitest:检查对象是静态文件契约,与
check_command_contract.py / check_bundle_configs.py 同类。
"""

from __future__ import annotations

import math
import pathlib
import re
import sys


ROOT = pathlib.Path(__file__).resolve().parents[1]
# 出货的那套(tauri.conf.json 的 beforeBuildCommand.cwd)。旧 desktop/ui 已冻结、
# 待 P9 删除,不再守——**守错工程等于没有守卫**。
UI = ROOT / "ui-next"
STYLES = UI / "src/styles/app.css"
INDEX_HTML = UI / "index.html"
DAISYUI_THEME_DIR = UI / "node_modules/daisyui/theme"

# 内置 dark 与品牌 monkeycode-dark 共用同一条防闪规则(见模块注释第 2 条),
# 允许的最大单通道差值。取 24/255:肉眼在启动瞬间分辨不出,再大就是可见闪色。
SHARED_DARK_TOLERANCE = 24


def oklch_to_hex(ll: float, c: float, h_deg: float) -> str:
    """OKLCH → sRGB hex(标准矩阵;超色域按 clamp 处理,与浏览器一致)。"""
    h = math.radians(h_deg)
    a, b = c * math.cos(h), c * math.sin(h)
    l_ = (ll + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (ll - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (ll - 0.0894841775 * a - 1.2914855480 * b) ** 3
    rgb = (
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_,
    )

    def gamma(x: float) -> float:
        x = min(1.0, max(0.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055

    return "#%02x%02x%02x" % tuple(round(gamma(v) * 255) for v in rgb)


def parse_oklch(value: str) -> tuple[float, float, float] | None:
    """"oklch(25.33% .016 252.42)" → (0.2533, 0.016, 252.42)。"""
    found = re.match(r"oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)", value.strip())
    if not found:
        return None
    return float(found.group(1)) / 100, float(found.group(2)), float(found.group(3))


def rgb_of(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def theme_blocks(css: str) -> list[dict[str, str]]:
    """取所有 `@plugin "daisyui/theme" { ... }` 块,解析成 键→值 字典
    (name/default/prefersdark 与各 --color-* 令牌同处一块)。"""
    blocks: list[dict[str, str]] = []
    for body in re.findall(r'@plugin\s+"daisyui/theme"\s*\{([^}]*)\}', css):
        decls: dict[str, str] = {}
        for key, value in re.findall(r"^\s*([\w-]+)\s*:\s*([^;]+);", body, re.M):
            decls[key.strip()] = value.strip()
        blocks.append(decls)
    return blocks


def brand_backgrounds(css: str) -> tuple[dict[str, str], list[str]]:
    """→ ({"light": hex, "dark": hex}, errors)。light = default:true 那套,
    dark = prefersdark:true 那套(名字也一并带出,供选择器覆盖检查)。"""
    errors: list[str] = []
    out: dict[str, str] = {}
    names: dict[str, str] = {}
    for flag, slot in (("default", "light"), ("prefersdark", "dark")):
        found = [b for b in theme_blocks(css) if b.get(flag) == "true"]
        if len(found) != 1:
            errors.append(f"app.css 里 {flag}: true 的主题块有 {len(found)} 个,应恰好 1 个")
            continue
        block = found[0]
        bg = block.get("--color-base-100", "")
        names[slot] = block.get("name", "").strip('"')
        if not re.fullmatch(r"#[0-9a-fA-F]{3,6}", bg):
            errors.append(
                f'主题 {names[slot]!r} 的 --color-base-100 是 {bg!r},不是 hex:'
                f"首帧防闪底色只能写字面量进 index.html,请在 app.css 里用 hex 声明"
            )
            continue
        out[slot] = bg.lower()
    return out, errors + ([] if len(out) == 2 else [])


def prefersdark_name(css: str) -> str:
    for block in theme_blocks(css):
        if block.get("prefersdark") == "true":
            return block.get("name", "").strip('"')
    return ""


def check_theme_block_dupes(css: str) -> list[str]:
    """@theme 与各主题块内重复声明同一令牌:后写的静默盖掉先写的。"""
    labelled: list[tuple[str, str]] = [
        ("@theme", body) for body in re.findall(r"@theme\s*\{([^}]*)\}", css)
    ]
    for body in re.findall(r'@plugin\s+"daisyui/theme"\s*\{([^}]*)\}', css):
        name = re.search(r"^\s*name\s*:\s*(.+);", body, re.M)
        labelled.append((f"主题块 {name.group(1).strip() if name else '?'}", body))

    errors: list[str] = []
    for label, body in labelled:
        seq = re.findall(r"^\s*(--[\w-]+)\s*:", body, re.M)
        if dupes := sorted({t for t in seq if seq.count(t) > 1}):
            errors.append(f"{label} 内重复声明: {', '.join(dupes)}")
    return errors


def check_boot_background(
    index_html: pathlib.Path = INDEX_HTML, styles: pathlib.Path = STYLES
) -> list[str]:
    """index.html 首帧防闪底色 ↔ app.css 主题块的 base-100,逐字一致。"""
    css = styles.read_text(encoding="utf-8")
    boot, errors = brand_backgrounds(css)
    html = index_html.read_text(encoding="utf-8")

    for key, rule in (
        ("light", r"^\s*html, body \{ background: (#[0-9a-fA-F]{3,6}); \}"),
        ("dark", r'^\s*html\[data-theme="dark"\][^{]*\{ background: (#[0-9a-fA-F]{3,6}); \}'),
    ):
        found = re.search(rule, html, re.M)
        if not found:
            errors.append(f"index.html 缺首帧防闪底色规则({key} 档)")
            continue
        if key not in boot:
            continue
        if found.group(1).lower() != boot[key]:
            errors.append(
                f"index.html 的首帧底色 {found.group(1)} 与 app.css 中该档主题的"
                f" base-100({boot[key]})不一致:启动会闪一帧另一个颜色"
            )

    # 深色规则必须覆盖 prefersdark 那套主题名,否则系统深色首启走浅色底
    dark_rule = re.search(r'^\s*html\[data-theme="dark"\][^{]*\{[^}]*\}', html, re.M)
    name = prefersdark_name(css)
    if dark_rule and name and f'data-theme="{name}"' not in dark_rule.group(0):
        errors.append(
            f"index.html 的深色防闪规则没有覆盖 prefersdark 主题 {name!r}:"
            f"系统深色下首启会闪一帧浅色底"
        )

    if "<script>" not in html or "mc.theme" not in html:
        errors.append("index.html 缺同步内联脚本(按 mc.theme 在首帧前落 data-theme)")
    if "mc.themeBg" not in html:
        errors.append(
            "index.html 的首帧脚本没有读 mc.themeBg:内置 35 套主题的底色写不进 "
            "<style>,只能靠这份缓存,漏了就是换过主题的用户每次启动闪一帧品牌色"
        )
    return errors


def check_daisyui_source(
    theme_dir: pathlib.Path = DAISYUI_THEME_DIR, styles: pathlib.Path = STYLES
) -> list[str]:
    """内置 dark 与品牌深色共用一条防闪规则(模块注释第 2 条):共用是刻意的
    近似,但不能无限漂。没装 node_modules 时跳过(CI 的 npm ci 之后必在)。"""
    if not theme_dir.is_dir():
        return []
    source = theme_dir / "dark.css"
    if not source.is_file():
        return [f"daisyUI 主题文件缺失: {source}"]
    found = re.search(r"--color-base-100:\s*([^;]+);", source.read_text(encoding="utf-8"))
    if not found:
        return [f"{source} 里找不到 --color-base-100"]
    parsed = parse_oklch(found.group(1))
    if parsed is None:
        return [f"{source} 的 --color-base-100 不是可解析的 oklch: {found.group(1)}"]
    builtin = oklch_to_hex(*parsed)
    boot, errors = brand_backgrounds(styles.read_text(encoding="utf-8"))
    if errors or "dark" not in boot:
        return []  # 上游已报,不重复
    delta = max(abs(a - b) for a, b in zip(rgb_of(builtin), rgb_of(boot["dark"])))
    if delta > SHARED_DARK_TOLERANCE:
        return [
            f"内置 dark 主题的 base-100({builtin})与品牌深色({boot['dark']})"
            f"相差 {delta}/255,超出共用防闪规则的容差 {SHARED_DARK_TOLERANCE}:"
            f"index.html 该给 [data-theme=\"dark\"] 单列一条规则了"
        ]
    return []


def check(styles: pathlib.Path = STYLES) -> list[str]:
    css = styles.read_text(encoding="utf-8")
    return check_theme_block_dupes(css) + check_boot_background(styles=styles) + check_daisyui_source(styles=styles)


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
