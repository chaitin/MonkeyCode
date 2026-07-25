#!/usr/bin/env python3

import pathlib
import tempfile
import unittest

from check_theme_tokens import check, check_boot_background, tokens_of


def css_of(light: dict[str, str], dark: dict[str, str]) -> str:
    def block(selector: str, decls: dict[str, str]) -> str:
        body = "".join(f"  {k}: {v};\n" for k, v in decls.items())
        return f"{selector} {{\n{body}}}\n"

    return block(":root", light) + "\n" + block('[data-theme="dark"]', dark)


def write(css: str) -> pathlib.Path:
    tmp = pathlib.Path(tempfile.mkdtemp()) / "styles.css"
    tmp.write_text(css, encoding="utf-8")
    return tmp


# 50 个填充令牌用于跨过 MIN_TOKENS 下限
FILLER = {f"--f{i}": "#000" for i in range(50)}


class ThemeTokenContractTest(unittest.TestCase):
    def test_real_stylesheet_satisfies_the_contract(self) -> None:
        self.assertEqual(check(), [])

    def test_token_only_in_light_is_reported(self) -> None:
        light = {**FILLER, "--onlyLight": "#fff"}
        errors = check(write(css_of(light, FILLER)))
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("--onlyLight", errors[0])
        self.assertIn("深色块缺令牌", errors[0])

    def test_token_only_in_dark_is_reported(self) -> None:
        dark = {**FILLER, "--onlyDark": "#000"}
        errors = check(write(css_of(FILLER, dark)))
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("--onlyDark", errors[0])

    def test_duplicate_declaration_is_reported(self) -> None:
        css = css_of(FILLER, FILLER).replace(
            "  --f0: #000;\n", "  --f0: #000;\n  --f0: #111;\n", 1
        )
        errors = check(write(css))
        self.assertTrue(any("重复声明" in e for e in errors), errors)

    def test_emptied_dark_block_is_reported_even_though_sets_would_match(self) -> None:
        # 深色块曾经只剩一行 TODO;此时"集合一致"因两边都空而假成立,
        # 下限断言是唯一能挡住这种退化的东西。
        css = ":root {\n}\n\n[data-theme=\"dark\"] {\n  /* TODO */\n}\n"
        errors = check(write(css))
        self.assertTrue(any("no-op" in e for e in errors), errors)

    def test_tokens_are_returned_in_source_order(self) -> None:
        css = css_of({"--a": "1", "--b": "2", "--c": "3"}, {})
        self.assertEqual(tokens_of(css, ":root"), ["--a", "--b", "--c"])

    def test_missing_selector_block_raises(self) -> None:
        with self.assertRaises(ValueError):
            tokens_of(":root { --a: 1; }", '[data-theme="dark"]')


GOOD_HTML = """<!DOCTYPE html>
<html>
  <head>
    <style>
      html, body { background: #fcfdfc; }
      html[data-theme="dark"], html[data-theme="dark"] body { background: #15161a; }
    </style>
    <script>
      try { if (localStorage.getItem("mc.theme") === "dark") document.documentElement.dataset.theme = "dark"; } catch (e) {}
    </script>
  </head>
  <body><script type="module" src="/src/main.tsx"></script></body>
</html>
"""

BG_CSS = ':root {\n  --bg: #fcfdfc;\n}\n\n[data-theme="dark"] {\n  --bg: #15161a;\n}\n'


def write_html(html: str) -> pathlib.Path:
    tmp = pathlib.Path(tempfile.mkdtemp()) / "index.html"
    tmp.write_text(html, encoding="utf-8")
    return tmp


class BootBackgroundTest(unittest.TestCase):
    """index.html 的首帧底色是唯一走不了 var() 的颜色,只能靠检查器盯着它
    别与 --bg 漂开——漂了不报错,只是深色启动闪一帧浅色,没人会注意到。"""

    def test_matching_pair_passes(self) -> None:
        self.assertEqual(check_boot_background(BG_CSS, write_html(GOOD_HTML)), [])

    def test_drifted_light_background_is_reported(self) -> None:
        errors = check_boot_background(BG_CSS, write_html(GOOD_HTML.replace("#fcfdfc", "#ffffff")))
        self.assertTrue(any("闪一帧" in e for e in errors), errors)

    def test_missing_dark_rule_is_reported(self) -> None:
        html = "\n".join(l for l in GOOD_HTML.split("\n") if "data-theme" not in l or "localStorage" in l)
        errors = check_boot_background(BG_CSS, write_html(html))
        self.assertTrue(any("缺首帧防闪底色规则" in e for e in errors), errors)

    def test_deferred_only_script_is_reported(self) -> None:
        # 只剩 <script type="module">:属性落得比首帧晚,两档规则都命不中
        html = GOOD_HTML.replace("<script>", '<script type="module">')
        errors = check_boot_background(BG_CSS, write_html(html))
        self.assertTrue(any("同步内联脚本" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
