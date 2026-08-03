#!/usr/bin/env python3

import pathlib
import tempfile
import unittest

from check_theme_tokens import (
    brand_backgrounds,
    check_boot_background,
    check_daisyui_source,
    check_theme_block_dupes,
    oklch_to_hex,
    parse_oklch,
    prefersdark_name,
    theme_blocks,
)


LIGHT_BG = "#fcfdfc"
DARK_BG = "#171e2b"


def app_css(light: str = LIGHT_BG, dark: str = DARK_BG, extra: str = "") -> str:
    return f"""@plugin "daisyui" {{
  themes: light, dark;
}}
@plugin "daisyui/theme" {{
  name: "monkeycode";
  default: true;
  --color-base-100: {light};
  --color-primary: #2f6f4e;
}}
@plugin "daisyui/theme" {{
  name: "monkeycode-dark";
  prefersdark: true;
  --color-base-100: {dark};
  --color-primary: #6fe0a5;
}}
@theme {{
  --spacing-rail: 52px;{extra}
}}
"""


def index_html(light: str = LIGHT_BG, dark: str = DARK_BG, dark_selector: str | None = None) -> str:
    selector = dark_selector if dark_selector is not None else (
        'html[data-theme="dark"], html[data-theme="dark"] body,\n'
        '      html[data-theme="monkeycode-dark"], html[data-theme="monkeycode-dark"] body'
    )
    return f"""<!DOCTYPE html>
<html>
  <head>
    <style>
      html, body {{ background: {light}; }}
      {selector} {{ background: {dark}; }}
    </style>
    <script>
      try {{
        document.documentElement.dataset.theme = localStorage.getItem("mc.theme") || "monkeycode";
        var bg = localStorage.getItem("mc.themeBg");
        if (bg) document.documentElement.style.background = bg;
      }} catch (e) {{}}
    </script>
  </head>
  <body><script type="module" src="/src/main.tsx"></script></body>
</html>
"""


def write(name: str, text: str) -> pathlib.Path:
    p = pathlib.Path(tempfile.mkdtemp()) / name
    p.write_text(text, encoding="utf-8")
    return p


class OklchConversionTest(unittest.TestCase):
    def test_daisyui_light_base_100(self) -> None:
        self.assertEqual(oklch_to_hex(*parse_oklch("oklch(100% 0 0)")), "#ffffff")

    def test_daisyui_dark_base_100(self) -> None:
        self.assertEqual(oklch_to_hex(*parse_oklch("oklch(25.33% .016 252.42)")), "#1d232a")

    def test_unparseable_value_returns_none(self) -> None:
        self.assertIsNone(parse_oklch("light-dark(#fff, #000)"))


class ThemeBlockParsingTest(unittest.TestCase):
    """防闪色现取自 app.css —— 旧版把同一个颜色抄在三处,改一处忘两处。"""

    def test_blocks_and_flags(self) -> None:
        blocks = theme_blocks(app_css())
        self.assertEqual([b["name"] for b in blocks], ['"monkeycode"', '"monkeycode-dark"'])
        self.assertEqual(prefersdark_name(app_css()), "monkeycode-dark")

    def test_backgrounds_follow_the_flags_not_the_names(self) -> None:
        bg, errors = brand_backgrounds(app_css(light="#abcdef"))
        self.assertEqual(errors, [])
        self.assertEqual(bg, {"light": "#abcdef", "dark": DARK_BG})

    def test_non_hex_base_100_is_reported(self) -> None:
        _, errors = brand_backgrounds(app_css(light="oklch(100% 0 0)"))
        self.assertTrue(any("不是 hex" in e for e in errors), errors)

    def test_two_default_themes_is_reported(self) -> None:
        css = app_css().replace('prefersdark: true;', 'default: true;')
        _, errors = brand_backgrounds(css)
        self.assertTrue(any("应恰好 1 个" in e for e in errors), errors)


class BootBackgroundTest(unittest.TestCase):
    """首帧底色是全仓唯一走不了 var() 的颜色:漂了不报错,只是启动闪一帧。"""

    def test_real_files_pass(self) -> None:
        self.assertEqual(check_boot_background(), [])

    def test_matching_pair_passes(self) -> None:
        self.assertEqual(
            check_boot_background(write("index.html", index_html()), write("app.css", app_css())),
            [],
        )

    def test_drifted_light_background_is_reported(self) -> None:
        errors = check_boot_background(
            write("index.html", index_html(light="#ffffff")), write("app.css", app_css())
        )
        self.assertTrue(any("闪一帧" in e for e in errors), errors)

    def test_drifted_dark_background_is_reported(self) -> None:
        errors = check_boot_background(
            write("index.html", index_html(dark="#000000")), write("app.css", app_css())
        )
        self.assertTrue(any("闪一帧" in e for e in errors), errors)

    def test_dark_rule_missing_prefersdark_theme_is_reported(self) -> None:
        # 只覆盖内置 dark、漏了品牌深色:系统深色首启闪一帧浅色底
        html = index_html(dark_selector='html[data-theme="dark"], html[data-theme="dark"] body')
        errors = check_boot_background(write("index.html", html), write("app.css", app_css()))
        self.assertTrue(any("prefersdark" in e for e in errors), errors)

    def test_missing_dark_rule_is_reported(self) -> None:
        html = index_html().replace(
            'html[data-theme="dark"], html[data-theme="dark"] body,\n'
            '      html[data-theme="monkeycode-dark"], html[data-theme="monkeycode-dark"] body '
            f"{{ background: {DARK_BG}; }}",
            "",
        )
        errors = check_boot_background(write("index.html", html), write("app.css", app_css()))
        self.assertTrue(any("缺首帧防闪底色规则" in e for e in errors), errors)

    def test_deferred_only_script_is_reported(self) -> None:
        # 只剩 <script type="module">:属性落得比首帧晚,防闪规则命不中
        html = index_html().replace("<script>", '<script type="module">')
        errors = check_boot_background(write("index.html", html), write("app.css", app_css()))
        self.assertTrue(any("同步内联脚本" in e for e in errors), errors)

    def test_missing_theme_bg_cache_is_reported(self) -> None:
        # 35 套主题的底色写不进 <style>,漏了 mc.themeBg 就是换过主题的用户每次闪
        html = index_html().replace("mc.themeBg", "mc.nope")
        errors = check_boot_background(write("index.html", html), write("app.css", app_css()))
        self.assertTrue(any("mc.themeBg" in e for e in errors), errors)


class ThemeBlockDupeTest(unittest.TestCase):
    def test_real_stylesheet_has_no_dupes(self) -> None:
        css = (pathlib.Path(__file__).resolve().parents[1] / "ui-next/src/styles/app.css").read_text(
            encoding="utf-8"
        )
        self.assertEqual(check_theme_block_dupes(css), [])

    def test_duplicate_in_theme_block_is_reported(self) -> None:
        css = app_css().replace(
            f"  --color-base-100: {LIGHT_BG};\n", f"  --color-base-100: {LIGHT_BG};\n  --color-base-100: #fff;\n", 1
        )
        errors = check_theme_block_dupes(css)
        self.assertTrue(any("重复声明" in e for e in errors), errors)

    def test_duplicate_in_at_theme_is_reported(self) -> None:
        errors = check_theme_block_dupes(app_css(extra="\n  --spacing-rail: 60px;"))
        self.assertTrue(any("@theme" in e and "重复声明" in e for e in errors), errors)


class SharedDarkRuleTest(unittest.TestCase):
    """内置 dark 与品牌深色共用一条防闪规则:近似是刻意的,漂太远就该分家。"""

    def theme_dir(self, dark: str) -> pathlib.Path:
        tmp = pathlib.Path(tempfile.mkdtemp())
        (tmp / "dark.css").write_text(f":root {{\n--color-base-100: {dark};\n}}\n", encoding="utf-8")
        return tmp

    def test_close_enough_passes(self) -> None:
        # daisyUI dark = #1d232a vs 品牌 #171e2b:单通道最大差 6
        d = self.theme_dir("oklch(25.33% .016 252.42)")
        self.assertEqual(check_daisyui_source(d, write("app.css", app_css())), [])

    def test_far_drift_is_reported(self) -> None:
        d = self.theme_dir("oklch(70% .02 250)")
        errors = check_daisyui_source(d, write("app.css", app_css()))
        self.assertTrue(any("容差" in e for e in errors), errors)

    def test_missing_node_modules_is_skipped(self) -> None:
        self.assertEqual(
            check_daisyui_source(pathlib.Path(tempfile.mkdtemp()) / "nope", write("app.css", app_css())),
            [],
        )


if __name__ == "__main__":
    unittest.main()
