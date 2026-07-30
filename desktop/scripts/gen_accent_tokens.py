#!/usr/bin/env python3
"""Generate the per-accent token blocks in ui/src/styles.css.

主题色(强调色)切换的设计:绿色那一套令牌是**样板**,其余主题色 = 把样板里
每个颜色在 OKLCH 里绕色相轴转到目标色相,亮度 L 与彩度 C 原样保留。

为什么是"整套旋转"而不是各挑一组好看的颜色:
1. 绿色现值(含设计师手调的 --accSelT / --linkH / --accSelDim / --userBg)
   一个字节都不用动,换色相不改默认观感;旋转 0° 就是恒等变换,可断言。
2. L 不变 ⇒ 感知轻重不变,不会出现"某个色特别扎眼或特别糊"。移动端的
   蜜橘橙 #f29a35 配白字只有 2.2:1,比默认绿(2.74:1)还差一档,照抄就是
   把坑一起搬过来;旋转出来的橙是 3.06:1,反而过了 3:1 的图形底线。
   注意 WCAG 相对亮度与 OKLab 的 L 加权不同,等 L 不等于等对比度,实测
   比值由本脚本算出后写进每个块的注释,别凭规则想当然。
3. 规则一句话说得完,新增主题色只要给一个色相。

色名与默认绿仍以移动端 ACCENTS(mobile/src/theme.tsx)为准并逐次校验——防的
正是浅色 --acc 曾经漂成 #1f8a5b 那类事故;**色相则按可辨识度重排**,见 HUES。

Chromium 109 红线(见 styles.css 头部):不能用 color-mix()/相对颜色语法在
运行时算色,所以颜色在**这里**算完,落成静态 CSS 块。

用法:
    python3 scripts/gen_accent_tokens.py           # 写回 styles.css 与 gen/accents.ts
    python3 scripts/gen_accent_tokens.py --check   # 只校验,漂移则非零退出(CI 用)
"""

from __future__ import annotations

import math
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
STYLES = ROOT / "ui/src/styles.css"
ACCENTS_TS = ROOT / "ui/src/gen/accents.ts"
MOBILE_THEME = ROOT.parent / "mobile/src/theme.tsx"

LIGHT_SELECTOR = ":root"
DARK_SELECTOR = '[data-theme="dark"]'
BEGIN = "/* BEGIN generated accents — scripts/gen_accent_tokens.py 生成,勿手改 */"
END = "/* END generated accents */"

# 随主题色变的令牌。其余令牌(面色/文字/语义色)与主题色无关:--ok / --addT
# 是"新增"的语义绿,橙色主题下 diff 的加行也该是绿的,移动端同样只让 ac* 跟着走。
# --onAcc 恒为白(彩度 0,旋转是恒等),不进生成块。
ACCENT_TOKENS = (
    "--acc",
    "--accH",
    "--accTx",
    "--accBg",
    "--accBd",
    "--accBg2",
    "--accBd2",
    "--accBgSoft",
    "--accSel",
    "--accSelT",
    "--accSelDim",
    "--accSh",
    "--linkH",
    "--userBg",
)

# 移动端的 ACCENTS 键是中文,DOM 属性与 localStorage 用 ASCII slug。
# 缺 slug 直接报错:移动端加了主题色而桌面没跟上时要吵,不能默默漏掉一个。
SLUGS = {"清新绿": "green", "天空蓝": "blue", "葡萄紫": "purple", "蜜橘橙": "orange"}
BASE = "清新绿"  # 样板色:它的令牌就是 :root / 深色块里的现值

# 各主题色的 OKLab 色相(度)。移动端的三个 fill 直接换算过来是 260/291/65,
# 蓝与紫只差 31°——统一到同一个 L/C 之后,这两枚色板几乎分不出来(移动端各自
# 的明度不同才勉强拉开)。这里按"两两尽量分得开"重排,并顺手避开色域瓶颈:
#   blue   245°(移动端 260°):这个亮度上再往蓝走会被色域压彩度(240° 掉 7%,
#          235° 掉 14%);245° 满彩度,而且更像"天空蓝"而非蓝紫。
#   purple 307°(移动端 291°):往品红推 16°,与蓝拉开到 62°,仍是紫不是玫红。
#   orange 55°(移动端 65°):65° 会被压 9% 彩度,55° 满彩度且更接近"蜜橘"。
# 相邻间隔因此是 91/62/108/99°,最小 62°,比移动端的 31° 好认得多。
HUES = {"blue": 245.0, "purple": 307.0, "orange": 55.0}


# ── OKLab / OKLCH ──────────────────────────────────────────────────────────
# Björn Ottosson 的 oklab 矩阵。选 OKLab 而非 HSL:HSL 的 L 不是感知亮度,
# 同一个 L 下蓝色看着比绿色沉得多,"只换色相"会变成"顺便改了轻重"。


def _srgb_to_linear(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _linear_to_srgb(c: float) -> float:
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def srgb_to_oklab(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = (_srgb_to_linear(v / 255) for v in rgb)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def oklab_to_linear(lab: tuple[float, float, float]) -> tuple[float, float, float]:
    ll, a, b = lab
    l_ = ll + 0.3963377774 * a + 0.2158037573 * b
    m_ = ll - 0.1055613458 * a - 0.0638541728 * b
    s_ = ll - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = (v**3 for v in (l_, m_, s_))
    return (
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def _in_gamut(lin: tuple[float, float, float]) -> bool:
    return all(-1e-4 <= c <= 1 + 1e-4 for c in lin)


def oklch_to_srgb(ll: float, c: float, h: float) -> tuple[int, int, int]:
    """OKLCH → sRGB 8bit。超出 sRGB 色域时按住 L 与色相、二分压低彩度——
    保亮度是这里的重点:亮度一旦被裁,对比度就跟着变,四色一致的前提就没了。"""
    def lab(chroma: float) -> tuple[float, float, float]:
        return (ll, chroma * math.cos(h), chroma * math.sin(h))

    if not _in_gamut(oklab_to_linear(lab(c))):
        lo, hi = 0.0, c
        for _ in range(64):
            mid = (lo + hi) / 2
            if _in_gamut(oklab_to_linear(lab(mid))):
                lo = mid
            else:
                hi = mid
        c = lo
    lin = oklab_to_linear(lab(c))
    return tuple(min(255, max(0, round(_linear_to_srgb(min(1.0, max(0.0, v))) * 255))) for v in lin)  # type: ignore[return-value]


def rotate_hue(rgb: tuple[int, int, int], delta: float) -> tuple[int, int, int]:
    """把颜色的色相转过 delta(弧度),保持 OKLab 的 L 与 C。"""
    ll, a, b = srgb_to_oklab(rgb)
    c = math.hypot(a, b)
    if c < 1e-6:  # 中性色(白/灰)没有色相可转,原样返回
        return rgb
    return oklch_to_srgb(ll, c, math.atan2(b, a) + delta)


def hue_of(rgb: tuple[int, int, int]) -> float:
    _, a, b = srgb_to_oklab(rgb)
    return math.atan2(b, a)


def contrast(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    """WCAG 对比度。跟 OKLab 无关,是另一套加权——所以等 L 的两个色相
    算出来的比值并不相等,生成时实测写进注释。"""
    def lum(rgb: tuple[int, int, int]) -> float:
        r, g, b = (_srgb_to_linear(v / 255) for v in rgb)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    a, b = sorted((lum(fg), lum(bg)), reverse=True)
    return (a + 0.05) / (b + 0.05)


# ── 颜色字面量的解析与改写 ─────────────────────────────────────────────────
HEX = re.compile(r"#([0-9a-fA-F]{6})\b")
RGBA = re.compile(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)")


def parse_hex(text: str) -> tuple[int, int, int]:
    """兼容 #rgb 简写:styles.css 里 --onAcc 就写作 #fff,按 6 位读会得到一个
    蓝色,标注的对比度会整片错掉(这里踩过)。"""
    digits = text.lstrip("#").strip()
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    if len(digits) != 6:
        raise ValueError(f"不认识的颜色字面量:{text}")
    n = int(digits, 16)
    return ((n >> 16) & 255, (n >> 8) & 255, n & 255)


def to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def rotate_value(value: str, delta: float) -> str:
    """把一条声明值里所有颜色字面量转过 delta;非颜色部分(投影的偏移/模糊等)原样保留。"""
    value = RGBA.sub(
        lambda m: "rgba(%d, %d, %d, %s)"
        % (*rotate_hue((int(m[1]), int(m[2]), int(m[3])), delta), m[4]),
        value,
    )
    return HEX.sub(lambda m: to_hex(rotate_hue(parse_hex(m[1]), delta)), value)


# ── 输入 ───────────────────────────────────────────────────────────────────
def read_mobile_accents() -> dict[str, str]:
    """从移动端 theme.tsx 解析 ACCENTS 的 label → fill(唯一真源,禁止手抄)。"""
    src = MOBILE_THEME.read_text(encoding="utf-8")
    block = re.search(r"export const ACCENTS = \{(.*?)\n\} as const", src, re.S)
    if not block:
        raise ValueError(f"{MOBILE_THEME} 里找不到 ACCENTS 定义")
    found = re.findall(r"'([^']+)':\s*\{[^}]*?fill:\s*'(#[0-9a-fA-F]{6})'", block.group(1))
    if not found:
        raise ValueError(f"{MOBILE_THEME} 的 ACCENTS 解析不出 fill")
    if missing := [k for k, _ in found if k not in SLUGS]:
        raise ValueError(
            f"移动端新增了主题色 {missing},桌面侧 SLUGS 未跟进(加 slug 后重新生成)"
        )
    return dict(found)


def read_base_tokens(css: str) -> dict[str, dict[str, str]]:
    """取 :root 与深色块的令牌值(样板色 + 标注对比度要用的 --bg / --onAcc)。
    只读生成块之前的正文,避免把自己生成的东西当输入(自举成环)。"""
    head = css.split(BEGIN)[0]
    needed = (*ACCENT_TOKENS, "--bg", "--onAcc")
    out: dict[str, dict[str, str]] = {}
    for theme, selector in (("light", LIGHT_SELECTOR), ("dark", DARK_SELECTOR)):
        block = re.search(re.escape(selector) + r"\s*\{(.*?)\n\}", head, re.S)
        if not block:
            raise ValueError(f"styles.css 里找不到选择器块:{selector}")
        decls = dict(re.findall(r"^\s*(--[\w-]+)\s*:\s*([^;]+);", block.group(1), re.M))
        if missing := [t for t in needed if t not in decls]:
            raise ValueError(f"{selector} 缺令牌: {', '.join(missing)}")
        out[theme] = {t: decls[t].split("/*")[0].strip() for t in needed}
    return out


# ── 输出 ───────────────────────────────────────────────────────────────────
def render_css(base: dict[str, dict[str, str]], accents: dict[str, str]) -> str:
    # 样板色必须仍是移动端那个品牌绿。浅色 --acc 曾经被本地压深成 #1f8a5b、
    # 谁也没发现,这条断言就是钉死那次事故的复发路径。
    if parse_hex(base["light"]["--acc"]) != parse_hex(accents[BASE]):
        raise ValueError(
            f"styles.css 的 --acc({base['light']['--acc']})与移动端 "
            f"ACCENTS['{BASE}'].fill({accents[BASE]})不一致:"
            "要么同步过去,要么改 BASE——别让两边各自漂"
        )
    if missing := [SLUGS[k] for k in accents if k != BASE and SLUGS[k] not in HUES]:
        raise ValueError(f"HUES 缺色相: {', '.join(missing)}")
    base_hue = hue_of(parse_hex(accents[BASE]))
    base_ratios = {
        theme: (
            contrast(parse_hex(base[theme]["--onAcc"]), parse_hex(base[theme]["--acc"])),
            contrast(parse_hex(base[theme]["--accTx"]), parse_hex(base[theme]["--bg"])),
        )
        for theme in ("light", "dark")
    }
    lines = [
        BEGIN,
        "/* 主题色 = 样板(绿)的整套令牌在 OKLCH 里绕色相轴旋转到目标色相:OKLab 的",
        " * L 与 C 不动,只换色相,所以四个色感知上一样轻重,派生关系(hover/文字/",
        " * 选中/投影/气泡)自动跟着走,默认绿一个字节都不用改(旋转 0° 是恒等)。",
        " * 色相取自移动端 ACCENTS 的 fill。默认绿不在这里——它就是 :root/深色块本身,",
        " * 对应 data-accent 属性缺省(见 ui/src/theme.ts)。",
        " * 权重说明:[data-theme=dark][data-accent=x] 是 (0,2,0),压得住 (0,1,0) 的",
        " * 深色块;浅色块 [data-accent=x] 与深色块同权重,靠位置在后取胜。",
        " * 括号里的比值是生成时实测的 WCAG 对比度(等 L 不等于等对比度,两套加权",
        f" * 不同)。样板绿是 白字/--acc {base_ratios['light'][0]:.2f}:1、"
        f"--accTx/--bg {base_ratios['light'][1]:.2f}:1(浅),"
        f"{base_ratios['dark'][0]:.2f}:1、{base_ratios['dark'][1]:.2f}:1(深);",
        " * 生成色不应比它更差,更差就说明该色相在这个 L 上被色域压过了彩度。 */",
    ]
    for label, fill in accents.items():
        if label == BASE:
            continue
        slug = SLUGS[label]
        delta = math.radians(HUES[slug]) - base_hue
        for theme, selector in (
            ("light", f'[data-accent="{slug}"]'),
            ("dark", f'[data-theme="dark"][data-accent="{slug}"]'),
        ):
            values = {t: rotate_value(base[theme][t], delta) for t in ACCENT_TOKENS}
            on_acc = contrast(parse_hex(base[theme]["--onAcc"]), parse_hex(values["--acc"]))
            tx_bg = contrast(parse_hex(values["--accTx"]), parse_hex(base[theme]["--bg"]))
            lines.append("")
            lines.append(
                f"{selector} {{"
                f"   /* {label} · {'浅色' if theme == 'light' else '深色'}"
                f"(白字/--acc {on_acc:.2f}:1,--accTx/--bg {tx_bg:.2f}:1) */"
            )
            for token in ACCENT_TOKENS:
                lines.append(f"  {token}: {values[token]};")
            lines.append("}")
    lines.append(END)
    return "\n".join(lines)


def render_ts(accents: dict[str, str], css: str) -> str:
    """供设置页渲染色板。swatch 用各色最终的 --acc(浅色档),与 CSS 同源生成。"""
    base_hue = hue_of(parse_hex(accents[BASE]))
    base_acc = parse_hex(re.search(r"^\s*--acc:\s*(#[0-9a-fA-F]{6})", css.split(BEGIN)[0], re.M).group(1))
    rows = []
    for label, fill in accents.items():
        slug = SLUGS[label]
        delta = 0.0 if label == BASE else math.radians(HUES[slug]) - base_hue
        swatch = to_hex(rotate_hue(base_acc, delta))
        rows.append(f'  {{ key: "{slug}", label: "{label}", swatch: "{swatch}" }},')
    return (
        "// 本文件由 desktop/scripts/gen_accent_tokens.py 生成,勿手改。\n"
        "// 主题色的色相取自移动端 ACCENTS(mobile/src/theme.tsx),色值与\n"
        "// ui/src/styles.css 的生成块同源;改主题色请改脚本后重新生成。\n"
        "\n"
        "/** 主题色:key 落到根节点 data-accent(默认色缺省不写属性),label 给设置页,\n"
        " *  swatch 是该色的 --acc(浅色档),用于色板圆点。 */\n"
        "export const ACCENTS = [\n"
        + "\n".join(rows)
        + "\n] as const;\n"
        "\n"
        "export type AccentKey = (typeof ACCENTS)[number][\"key\"];\n"
        f'export const DEFAULT_ACCENT: AccentKey = "{SLUGS[BASE]}";\n'
    )


def build() -> tuple[str, str]:
    css = STYLES.read_text(encoding="utf-8")
    accents = read_mobile_accents()
    generated = render_css(read_base_tokens(css), accents)
    if BEGIN in css:
        new_css = re.sub(
            re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: generated, css, flags=re.S
        )
    else:  # 首次生成:接在深色块之后
        anchor = css.index("\n}\n", css.index(DARK_SELECTOR)) + len("\n}\n")
        new_css = css[:anchor] + "\n" + generated + "\n" + css[anchor:]
    return new_css, render_ts(accents, css)


def main(argv: list[str]) -> int:
    check = "--check" in argv[1:]
    new_css, new_ts = build()
    stale = []
    if STYLES.read_text(encoding="utf-8") != new_css:
        stale.append(STYLES)
    if not ACCENTS_TS.exists() or ACCENTS_TS.read_text(encoding="utf-8") != new_ts:
        stale.append(ACCENTS_TS)
    if check:
        if stale:
            print("主题色令牌已漂移,请重新生成:python3 scripts/gen_accent_tokens.py")
            for path in stale:
                print(f"  - {path.relative_to(ROOT)}")
            return 1
        print("主题色令牌 OK")
        return 0
    STYLES.write_text(new_css, encoding="utf-8")
    ACCENTS_TS.parent.mkdir(parents=True, exist_ok=True)
    ACCENTS_TS.write_text(new_ts, encoding="utf-8")
    print(f"已生成:{', '.join(str(p.relative_to(ROOT)) for p in (STYLES, ACCENTS_TS))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
