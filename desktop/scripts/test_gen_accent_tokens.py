#!/usr/bin/env python3

import math
import unittest

from gen_accent_tokens import (
    BEGIN,
    ACCENT_TOKENS,
    BASE,
    HUES,
    SLUGS,
    contrast,
    hue_of,
    main,
    parse_hex,
    read_base_tokens,
    read_mobile_accents,
    rotate_hue,
    rotate_value,
    srgb_to_oklab,
    to_hex,
    STYLES,
)


class ColorMathTest(unittest.TestCase):
    def test_short_hex_is_expanded(self) -> None:
        # --onAcc 写作 #fff;按 6 位读会得到 (0,15,255) 那个蓝色,
        # 标注的对比度会整片错掉——踩过一次,钉住。
        self.assertEqual(parse_hex("#fff"), (255, 255, 255))
        self.assertEqual(parse_hex("#16b364"), (22, 179, 100))

    def test_unknown_literal_raises(self) -> None:
        with self.assertRaises(ValueError):
            parse_hex("#ff")

    def test_zero_rotation_is_identity(self) -> None:
        """样板色旋转 0° 必须逐字节回到自己:整套生成的正确性建立在这条上
        (默认绿不该因为引入主题色而变一个像素)。"""
        for hex_value in ("#16b364", "#0b8f4d", "#24523d", "#66786e", "#e9f2ec", "#153127"):
            self.assertEqual(to_hex(rotate_hue(parse_hex(hex_value), 0.0)), hex_value)

    def test_rotation_preserves_lightness_and_never_boosts_chroma(self) -> None:
        """亮度是硬约束(对比度靠它),彩度是软的:目标色相出了 sRGB 色域就得
        压彩度保亮度,所以只能断言"不超过原值",不能断言相等。"""
        base = parse_hex("#16b364")
        ll0, a0, b0 = srgb_to_oklab(base)
        c0 = math.hypot(a0, b0)
        for delta in (0.5, 1.5, -2.0, 3.0):
            ll1, a1, b1 = srgb_to_oklab(rotate_hue(base, delta))
            self.assertAlmostEqual(ll0, ll1, places=2)
            self.assertLessEqual(math.hypot(a1, b1), c0 + 0.005)

    def test_palette_hues_keep_full_chroma(self) -> None:
        """选定的四个色相都该在色域内拿到满彩度——被压说明该换个色相
        (HUES 的注释里记了每个色相的挑选理由)。"""
        base = parse_hex("#16b364")
        ll0, a0, b0 = srgb_to_oklab(base)
        c0 = math.hypot(a0, b0)
        for slug, deg in HUES.items():
            _, a1, b1 = srgb_to_oklab(rotate_hue(base, math.radians(deg) - math.atan2(b0, a0)))
            self.assertGreater(math.hypot(a1, b1), c0 * 0.98, f"{slug} 被色域压了彩度")

    def test_neutral_colors_have_no_hue_to_rotate(self) -> None:
        for neutral in ((255, 255, 255), (0, 0, 0), (128, 128, 128)):
            self.assertEqual(rotate_hue(neutral, 1.2), neutral)

    def test_rotate_value_keeps_alpha_and_non_color_parts(self) -> None:
        out = rotate_value("0 2px 8px rgba(22, 179, 100, 0.25)", 1.0)
        self.assertTrue(out.startswith("0 2px 8px rgba("))
        self.assertTrue(out.endswith(", 0.25)"))
        self.assertNotIn("22, 179, 100", out)

    def test_contrast_matches_known_pairs(self) -> None:
        self.assertAlmostEqual(contrast((255, 255, 255), (0, 0, 0)), 21.0, places=2)
        # 白字压在品牌绿上——styles.css 头部那条 ⚠️ 引的就是这个数
        self.assertAlmostEqual(contrast((255, 255, 255), parse_hex("#16b364")), 2.74, places=2)


class GeneratedOutputTest(unittest.TestCase):
    def test_repo_is_regenerated(self) -> None:
        """styles.css 与 gen/accents.ts 必须是当前脚本的产物。"""
        self.assertEqual(main(["gen_accent_tokens.py", "--check"]), 0)

    def test_mobile_accents_are_the_source(self) -> None:
        accents = read_mobile_accents()
        self.assertEqual(set(accents), set(SLUGS))
        self.assertEqual(accents[BASE], "#16b364")

    def test_every_accent_block_declares_the_full_token_set(self) -> None:
        css = STYLES.read_text(encoding="utf-8")
        for slug in SLUGS.values():
            if slug == SLUGS[BASE]:
                continue  # 默认色就是 :root/深色块本身,不出生成块
            for selector in (f'[data-accent="{slug}"]', f'[data-theme="dark"][data-accent="{slug}"]'):
                block = css.split(selector + " {")[1].split("\n}")[0]
                for token in ACCENT_TOKENS:
                    self.assertIn(f"{token}:", block, f"{selector} 缺 {token}")

    def test_generated_accents_are_not_worse_than_the_template(self) -> None:
        """等 L 不等于等对比度(WCAG 与 OKLab 加权不同)。这条守的是结论:
        白字压在任一主题色上,都不比默认绿更难读。"""
        css = STYLES.read_text(encoding="utf-8")
        base = read_base_tokens(css)
        floor = contrast((255, 255, 255), parse_hex(base["light"]["--acc"]))
        for slug in SLUGS.values():
            if slug == SLUGS[BASE]:
                continue
            block = css.split(f'[data-accent="{slug}"] {{')[1].split("\n}")[0]
            acc = block.split("--acc:")[1].split(";")[0].strip()
            self.assertGreaterEqual(contrast((255, 255, 255), parse_hex(acc)), floor - 0.01, slug)

    def test_generated_block_sits_after_the_dark_block(self) -> None:
        """浅色的 [data-accent=x] 与 [data-theme=dark] 权重相同(都是 (0,1,0)),
        靠位置在后才压得住。块被挪到深色块之前 = 深色+非默认色会串成浅色值,
        而 --check 只比内容、比不出位置。"""
        css = STYLES.read_text(encoding="utf-8")
        self.assertLess(css.index('[data-theme="dark"] {'), css.index(BEGIN))

    def test_hues_stay_distinct(self) -> None:
        """四个色板要一眼能分清:两两色相至少差 55°(移动端原色相里蓝紫只差 31°,
        统一到同一个 L/C 后会糊成两块蓝紫,这条就是拦它的)。"""
        css = STYLES.read_text(encoding="utf-8")
        hues = [hue_of(parse_hex(read_base_tokens(css)["light"]["--acc"]))]
        for slug in SLUGS.values():
            if slug == SLUGS[BASE]:
                continue
            block = css.split(f'[data-accent="{slug}"] {{')[1].split("\n}")[0]
            hues.append(hue_of(parse_hex(block.split("--acc:")[1].split(";")[0].strip())))
        for i, a in enumerate(hues):
            for b in hues[i + 1 :]:
                gap = abs(math.degrees(a - b)) % 360
                self.assertGreater(min(gap, 360 - gap), 55)


if __name__ == "__main__":
    unittest.main()
