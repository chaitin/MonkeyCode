// 布局树纯逻辑(tmux 同构;.tsx 只因 features 测试归 dom 工程)。
import { describe, expect, it } from "vitest";

import {
  equalizeAt,
  insertEdgeLeaf,
  leaves,
  moveLeafToEdge,
  paneCount,
  PRESETS,
  remapLeaves,
  removeLeaf,
  sameShape,
  setRatio,
  splitLeaf,
  swapLeaves,
  validateTree,
  type SplitNode,
} from "./tree";

describe("布局树", () => {
  it("模板叶序 = 视觉阅读序(四格:左上0 右上1 左下2 右下3 → 中序 0,2,1,3)", () => {
    expect(leaves(PRESETS["1"])).toEqual([0]);
    expect(leaves(PRESETS["2col"])).toEqual([0, 1]);
    expect(leaves(PRESETS["4"])).toEqual([0, 2, 1, 3]);
    expect(paneCount(PRESETS["4"])).toBe(4);
  });

  it("validateTree:坏方向/非法或重复槽位整树作废;高位槽和深树可恢复", () => {
    expect(validateTree(PRESETS["4"])).toEqual(PRESETS["4"]);
    expect(validateTree({ dir: "diag", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } })).toBeNull();
    expect(validateTree({ leaf: 99 })).toEqual({ leaf: 99 });
    expect(validateTree({ leaf: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(validateTree({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 0 } })).toBeNull();
    expect(validateTree(null)).toBeNull();
    const ratio = validateTree({ dir: "col", ratio: 0.01, a: { leaf: 0 }, b: { leaf: 1 } });
    expect(ratio && "dir" in ratio && ratio.ratio).toBeCloseTo(0.01);

    let deep: SplitNode = { leaf: 7 };
    for (let slot = 6; slot >= 0; slot--) deep = { dir: "col", ratio: 0.5, a: { leaf: slot }, b: deep };
    expect(validateTree(deep)).toEqual(deep);

    const cycle: Record<string, unknown> = { dir: "col", ratio: 0.5, a: { leaf: 0 } };
    cycle.b = cycle;
    expect(validateTree(cycle)).toBeNull();
  });

  it("恢复时可把稀疏和超大叶槽压密且不改变视觉顺序", () => {
    const tree: SplitNode = {
      dir: "col",
      ratio: 0.4,
      a: { leaf: Number.MAX_SAFE_INTEGER },
      b: { leaf: 7 },
    };
    const remapped = remapLeaves(tree, new Map([[7, 0], [Number.MAX_SAFE_INTEGER, 1]]));
    expect(remapped).toEqual({ dir: "col", ratio: 0.4, a: { leaf: 1 }, b: { leaf: 0 } });
    expect(leaves(remapped)).toEqual([1, 0]);
  });

  it("异常深存档与树操作不耗尽调用栈", () => {
    let deep: SplitNode = { leaf: 20_000 };
    for (let slot = 19_999; slot >= 0; slot--) deep = { dir: "col", ratio: 0.5, a: { leaf: slot }, b: deep };

    const restored = validateTree(deep);
    expect(restored).not.toBeNull();
    expect(paneCount(restored!)).toBe(20_001);
    expect(splitLeaf(restored!, 0, "row")?.newSlot).toBe(20_001);
    expect(paneCount(equalizeAt(restored!, ""))).toBe(20_001);
    expect(paneCount(removeLeaf(restored!, 20_000))).toBe(20_000);
    expect(paneCount(insertEdgeLeaf(restored!, 0, "top")!.tree)).toBe(20_002);
    expect(paneCount(moveLeafToEdge(restored!, 10_000, 0, "right"))).toBe(20_001);
    expect(leaves(swapLeaves(restored!, 0, 20_000)).slice(0, 2)).toEqual([20_000, 1]);
    expect(sameShape(restored!, restored!)).toBe(true);
  });

  it("setRatio 按路径寻址:只动那个节点(拖哪条线动哪条)", () => {
    const t = setRatio(PRESETS["4"], "a", 0.7);
    if ("leaf" in t || "leaf" in t.a || "leaf" in t.b) throw new Error("形状不该变");
    expect(t.a.ratio).toBe(0.7);
    expect(t.b.ratio).toBe(0.5); // 右列不牵动
    expect(t.ratio).toBe(0.5); // 贯通竖切不牵动
  });

  it("equalizeAt 按辖下叶数递归均分面积,路径外比例不动", () => {
    const three: SplitNode = {
      dir: "col",
      ratio: 0.4,
      a: { dir: "row", ratio: 0.7, a: { leaf: 0 }, b: { leaf: 2 } },
      b: { leaf: 1 },
    };
    const all = equalizeAt(three, "");
    if ("leaf" in all || "leaf" in all.a) throw new Error("形状不该变");
    expect(all.ratio).toBeCloseTo(2 / 3);
    expect(all.a.ratio).toBe(0.5);

    const local = equalizeAt(three, "a");
    if ("leaf" in local || "leaf" in local.a) throw new Error("形状不该变");
    expect(local.ratio).toBe(0.4);
    expect(local.a.ratio).toBe(0.5);

    let seven: SplitNode = { leaf: 6 };
    for (let slot = 5; slot >= 1; slot--) seven = { dir: "col", ratio: 0.5, a: { leaf: slot }, b: seven };
    seven = { dir: "col", ratio: 0.5, a: { leaf: 0 }, b: seven };
    const allSeven = equalizeAt(seven, "");
    if ("leaf" in allSeven) throw new Error("形状不该变");
    expect(allSeven.ratio).toBeCloseTo(1 / 7);
    expect(validateTree(allSeven)).toEqual(allSeven); // 1:6 落盘重载后比例不反弹
  });

  it("splitLeaf:新格取最小空槽号、原格在前且可持续超过六格", () => {
    const res = splitLeaf(PRESETS["2col"], 0, "row");
    expect(res).not.toBeNull();
    expect(leaves(res!.tree)).toEqual([0, 2, 1]); // 槽 2 是最小空号,挂在 0 之下
    expect(res!.newSlot).toBe(2);
    let tree = PRESETS["1"];
    for (let i = 0; i < 7; i++) tree = splitLeaf(tree, 0, "col")!.tree;
    expect(paneCount(tree)).toBe(8);
    expect(leaves(tree)).toContain(7);
    expect(validateTree(tree)).toEqual(tree);
  });

  it("左/右插入全局列:旧列相对宽度不变,新列等于缩放后的最窄旧列", () => {
    const uneven: SplitNode = { dir: "col", ratio: 0.375, a: { leaf: 0 }, b: { leaf: 1 } };
    const right = insertEdgeLeaf(uneven, 0, "right")!;
    expect(right.newSlot).toBe(2);
    if ("leaf" in right.tree) throw new Error("应该新增全局列");
    expect(right.tree.dir).toBe("col");
    expect(right.tree.ratio).toBeCloseTo(8 / 11);
    expect(right.tree.a).toBe(uneven);
    expect(right.tree.b).toEqual({ leaf: 2 });
    // 旧列最终宽度 3/11、5/11，新列 3/11：旧 3:5 不变且新列不宽于旧列。
    expect(right.tree.ratio * uneven.ratio).toBeCloseTo(3 / 11);
    expect(1 - right.tree.ratio).toBeCloseTo(3 / 11);

    const left = insertEdgeLeaf(PRESETS["2col"], 1, "left")!;
    if ("leaf" in left.tree) throw new Error("应该新增全局列");
    expect(left.tree.ratio).toBeCloseTo(1 / 3);
    expect(leaves(left.tree)).toEqual([2, 0, 1]);

    const mixed: SplitNode = {
      dir: "row",
      ratio: 0.5,
      a: PRESETS["2col"],
      b: { leaf: 2 },
    };
    const mixedRight = insertEdgeLeaf(mixed, 2, "right")!;
    if ("leaf" in mixedRight.tree) throw new Error("应该新增全局列");
    // 最窄现有 Panel 是上方两个半宽格；同比缩窄后旧半宽格与新列均为 1/3。
    expect(mixedRight.tree.ratio).toBeCloseTo(2 / 3);
  });

  it("上/下只插入目标所在纵向组并把该组行等高", () => {
    const top = insertEdgeLeaf(PRESETS["4"], 0, "top")!;
    expect(top.newSlot).toBe(4);
    expect(leaves(top.tree)).toEqual([4, 0, 2, 1, 3]);
    if ("leaf" in top.tree || "leaf" in top.tree.a || "leaf" in top.tree.a.b) throw new Error("左列应有三行");
    expect(top.tree.ratio).toBe(0.5); // 全局列宽不动
    expect(top.tree.a.ratio).toBeCloseTo(1 / 3);
    expect(top.tree.a.b.ratio).toBe(0.5);
    if ("leaf" in PRESETS["4"]) throw new Error("四格模板应有左右列");
    expect(top.tree.b).toEqual(PRESETS["4"].b); // 右列几何不动

    const bottom = insertEdgeLeaf(PRESETS["4"], 0, "bottom")!;
    expect(leaves(bottom.tree)).toEqual([0, 4, 2, 1, 3]);
  });

  it("等价 2×2 树也按视觉纵列归组，而不是受切分先后影响", () => {
    const rowsFirst: SplitNode = {
      dir: "row",
      ratio: 0.5,
      a: { dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } },
      b: { dir: "col", ratio: 0.5, a: { leaf: 2 }, b: { leaf: 3 } },
    };
    const top = insertEdgeLeaf(rowsFirst, 0, "top")!;
    expect(leaves(top.tree)).toEqual([4, 0, 2, 1, 3]);
    if ("leaf" in top.tree || top.tree.dir !== "col" || "leaf" in top.tree.a) throw new Error("应归一成左右纵列");
    expect(top.tree.a.ratio).toBeCloseTo(1 / 3);
    expect(top.tree.b).toEqual({ dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 3 } });

    const moved = moveLeafToEdge(rowsFirst, 1, 0, "bottom");
    expect(leaves(moved)).toEqual([0, 1, 2, 3]);
    if ("leaf" in moved || moved.dir !== "col" || "leaf" in moved.a) throw new Error("应保留左右纵列");
    expect(moved.a.ratio).toBeCloseTo(1 / 3);
    expect(moved.b).toEqual({ leaf: 3 }); // 源位置收拢，但不卷入左列三行均分
  });

  it("已有叶搬到四边:原位置收拢、槽只出现一次且单格不动", () => {
    const right = moveLeafToEdge(PRESETS["4"], 2, 0, "right");
    expect(leaves(right)).toEqual([0, 1, 3, 2]);
    expect(paneCount(right)).toBe(4);
    expect(moveLeafToEdge(right, 2, 0, "right")).toBe(right);
    if ("leaf" in right) throw new Error("应该搬到全局右列");
    expect(right.ratio).toBeCloseTo(2 / 3);
    expect(right.b).toEqual({ leaf: 2 });

    const top = moveLeafToEdge(PRESETS["4"], 3, 0, "top");
    expect(leaves(top)).toEqual([3, 0, 2, 1]);
    expect(moveLeafToEdge({ leaf: 0 }, 0, 0, "right")).toEqual({ leaf: 0 });
    expect(moveLeafToEdge(PRESETS["2col"], 9, 0, "top")).toBe(PRESETS["2col"]);
  });

  it("removeLeaf:兄弟上位(tmux 收格);最后一格不许关", () => {
    expect(removeLeaf(PRESETS["2col"], 1)).toEqual({ leaf: 0 });
    // 四格关掉右上(槽1):右列只剩右下,整列由它上位
    const t = removeLeaf(PRESETS["4"], 1);
    expect(leaves(t)).toEqual([0, 2, 3]);
    expect(removeLeaf({ leaf: 0 }, 0)).toEqual({ leaf: 0 });
  });

  it("swapLeaves 交换两叶槽位;sameShape 忽略比例(拖过比例的四格仍算四格)", () => {
    expect(leaves(swapLeaves(PRESETS["2col"], 0, 1))).toEqual([1, 0]);
    expect(sameShape(setRatio(PRESETS["4"], "a", 0.7), PRESETS["4"])).toBe(true);
    expect(sameShape(PRESETS["2col"], PRESETS["2row"])).toBe(false);
  });
});
