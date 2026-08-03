import { describe, expect, it } from "vitest";

import { upwardMenuMaxHeight } from "./menuHeight";

describe("upwardMenuMaxHeight", () => {
  it("空间充裕时取 cap(不无限长)", () => {
    expect(upwardMenuMaxHeight(800, 52, 288)).toBe(288);
  });

  it("矮窗口:按锚点到边界的真实距离收窄——写死上限正是会顶出视口的那种", () => {
    // 锚点 200、边界(标题栏+视图头)88 → 200-88-16 = 96
    expect(upwardMenuMaxHeight(200, 88, 288)).toBe(96);
  });

  it("边界高过锚点(窗口被压到极矮)不给负值,收到 0", () => {
    expect(upwardMenuMaxHeight(60, 88, 288)).toBe(0);
  });

  it("留出的视觉间距计入:恰好等于间距时可用高度为 0", () => {
    expect(upwardMenuMaxHeight(104, 88, 288)).toBe(0);
  });
});
