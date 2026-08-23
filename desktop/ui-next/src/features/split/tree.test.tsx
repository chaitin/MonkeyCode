// 布局树纯逻辑(tmux 同构;.tsx 只因 features 测试归 dom 工程)。
import { describe, expect, it } from "vitest";

import {
  equalizeAt,
  insertRootLeaf,
  leaves,
  moveLeafToRoot,
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
    expect(paneCount(insertRootLeaf(restored!, "top").tree)).toBe(20_002);
    expect(paneCount(moveLeafToRoot(restored!, 10_000, "right"))).toBe(20_001);
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

  it("根边缘插入:上方/右侧包住整棵旧树且取最小空槽", () => {
    const top = insertRootLeaf(PRESETS["2col"], "top");
    expect(top.newSlot).toBe(2);
    expect(top.tree).toEqual({ dir: "row", ratio: 0.5, a: { leaf: 2 }, b: PRESETS["2col"] });

    const right = insertRootLeaf(PRESETS["2row"], "right");
    expect(right.newSlot).toBe(2);
    expect(right.tree).toEqual({ dir: "col", ratio: 0.5, a: PRESETS["2row"], b: { leaf: 2 } });
  });

  it("已有叶搬到根边缘:原位置收拢、槽只出现一次且单格不动", () => {
    const right = moveLeafToRoot(PRESETS["4"], 2, "right");
    expect(leaves(right)).toEqual([0, 1, 3, 2]);
    expect(paneCount(right)).toBe(4);
    expect(moveLeafToRoot(right, 2, "right")).toBe(right);
    expect(right).toEqual({
      dir: "col",
      ratio: 0.5,
      a: {
        dir: "col",
        ratio: 0.5,
        a: { leaf: 0 },
        b: { dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 3 } },
      },
      b: { leaf: 2 },
    });

    const top = moveLeafToRoot(PRESETS["4"], 3, "top");
    expect(leaves(top)).toEqual([3, 0, 2, 1]);
    expect(moveLeafToRoot({ leaf: 0 }, 0, "right")).toEqual({ leaf: 0 });
    expect(moveLeafToRoot(PRESETS["2col"], 9, "top")).toBe(PRESETS["2col"]);
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
