import { describe, expect, it } from "vitest";

import { HeightIndex } from "./heightIndex";

describe("HeightIndex", () => {
  it("维护可变高度前缀和并按像素定位", () => {
    const rows = ["a", "b", "c", "d"].map((key) => ({ key }));
    const index = new HeightIndex(rows, (_, i) => [10, 20, 30, 40][i]!);
    expect(index.total()).toBe(100);
    expect([0, 9, 10, 29, 30, 99].map((n) => index.indexAt(n))).toEqual([0, 0, 1, 1, 2, 3]);
    expect(index.offsetAt(3)).toBe(60);
    expect(index.update(1, 50)).toBe(30);
    expect(index.total()).toBe(130);
    expect(index.offsetAt(2)).toBe(60);
    expect(index.indexAt(59)).toBe(1);
  });
});
