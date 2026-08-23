import { describe, expect, it } from "vitest";

import { boundedMenuInlineLayout, upwardMenuMaxHeight } from "./menuHeight";

describe("boundedMenuInlineLayout", () => {
  it("宽 panel 中保留末端对齐和菜单宽度", () => {
    expect(boundedMenuInlineLayout(500, 560, 100, 800, 256, "end")).toEqual({ left: 304, width: 256 });
  });

  it("窄 panel 中收窄并夹在两侧安全间距内", () => {
    expect(boundedMenuInlineLayout(120, 180, 100, 300, 256, "end")).toEqual({ left: 108, width: 184 });
  });

  it("首端对齐靠近 panel 右缘时向左平移", () => {
    expect(boundedMenuInlineLayout(450, 490, 100, 500, 256, "start")).toEqual({ left: 236, width: 256 });
  });
});

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
