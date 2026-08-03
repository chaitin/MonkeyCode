import { describe, expect, it } from "vitest";

import { hexToOklch, normalizeHex, oklchCss, oklchToHex } from "./oklch";

describe("normalizeHex", () => {
  it("#rgb 展开、大小写归一;非法值给 null", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#16A34A")).toBe("#16a34a");
    expect(normalizeHex("16a34a")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("hex ↔ OKLCH 往返", () => {
  it("往返回到原色(sRGB 内的色都应无损到 ±1/255)", () => {
    for (const hex of ["#16a34a", "#ffffff", "#000000", "#2563eb", "#fde047", "#7f1d1d", "#808080"]) {
      const back = oklchToHex(hexToOklch(hex)!);
      for (let i = 1; i < 7; i += 2) {
        const a = Number.parseInt(hex.slice(i, i + 2), 16);
        const b = Number.parseInt(back.slice(i, i + 2), 16);
        expect(Math.abs(a - b), `${hex} → ${back}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("黑白的亮度落在两端,灰的彩度≈0", () => {
    expect(hexToOklch("#ffffff")!.l).toBeCloseTo(1, 2);
    expect(hexToOklch("#000000")!.l).toBeCloseTo(0, 2);
    expect(hexToOklch("#808080")!.c).toBeLessThan(0.005);
  });

  it("感知亮度不是 HSL 的 L:纯黄比纯蓝亮得多(这正是要换到 OKLCH 的原因)", () => {
    // HSL 里两者 L 都是 50%,配色时会得到一亮一暗的"同档"色
    expect(hexToOklch("#ffff00")!.l).toBeGreaterThan(hexToOklch("#0000ff")!.l + 0.4);
  });

  it("超出 sRGB 色域的值截断而不溢出成怪色", () => {
    const hex = oklchToHex({ l: 0.6, c: 0.4, h: 150 }); // 远超绿色可显示彩度
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("oklchCss 输出 daisyUI 同款写法,色相归一到 0..360", () => {
    expect(oklchCss({ l: 0.65, c: 0.241, h: 354.308 })).toBe("oklch(65% 0.241 354.3)");
    expect(oklchCss({ l: 0.5, c: 0.1, h: -30 })).toBe("oklch(50% 0.1 330)");
  });
});
