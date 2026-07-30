import { describe, expect, it } from "vitest";
import { upwardMenuMaxHeight } from "./menuPosition";

describe("向上弹出菜单高度", () => {
  it("空间充足时使用组件上限", () => {
    expect(upwardMenuMaxHeight(600, 94, 360)).toBe(360);
  });

  it("矮窗口按 header 下方的真实空间收缩", () => {
    expect(upwardMenuMaxHeight(360, 94, 360)).toBe(250);
  });

  it("极窄空间也不会越过 header", () => {
    expect(upwardMenuMaxHeight(130, 94, 360)).toBe(20);
  });
});
