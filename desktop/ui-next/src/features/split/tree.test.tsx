// 布局树纯逻辑(tmux 同构;.tsx 只因 features 测试归 dom 工程)。
import { describe, expect, it } from "vitest";

import {
  leaves,
  paneCount,
  PRESETS,
  removeLeaf,
  sameShape,
  setRatio,
  splitLeaf,
  swapLeaves,
  validateTree,
} from "./tree";

describe("布局树", () => {
  it("模板叶序 = 视觉阅读序(四格:左上0 右上1 左下2 右下3 → 中序 0,2,1,3)", () => {
    expect(leaves(PRESETS["1"])).toEqual([0]);
    expect(leaves(PRESETS["2col"])).toEqual([0, 1]);
    expect(leaves(PRESETS["4"])).toEqual([0, 2, 1, 3]);
    expect(paneCount(PRESETS["4"])).toBe(4);
  });

  it("validateTree:坏方向/槽位越界/重复/超深整树作废;比例夹取 0.2–0.8", () => {
    expect(validateTree(PRESETS["4"])).toEqual(PRESETS["4"]);
    expect(validateTree({ dir: "diag", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } })).toBeNull();
    expect(validateTree({ leaf: 99 })).toBeNull();
    expect(validateTree({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 0 } })).toBeNull();
    expect(validateTree(null)).toBeNull();
    const clamped = validateTree({ dir: "col", ratio: 0.01, a: { leaf: 0 }, b: { leaf: 1 } });
    expect(clamped && "dir" in clamped && clamped.ratio).toBe(0.2);
  });

  it("setRatio 按路径寻址:只动那个节点(拖哪条线动哪条)", () => {
    const t = setRatio(PRESETS["4"], "a", 0.7);
    if ("leaf" in t || "leaf" in t.a || "leaf" in t.b) throw new Error("形状不该变");
    expect(t.a.ratio).toBe(0.7);
    expect(t.b.ratio).toBe(0.5); // 右列不牵动
    expect(t.ratio).toBe(0.5); // 贯通竖切不牵动
  });

  it("splitLeaf:新格取最小空槽号、原格在前;满员返回 null", () => {
    const res = splitLeaf(PRESETS["2col"], 0, "row");
    expect(res).not.toBeNull();
    expect(leaves(res!.tree)).toEqual([0, 2, 1]); // 槽 2 是最小空号,挂在 0 之下
    expect(res!.newSlot).toBe(2);
    // 连拆到上限(6):再拆返回 null
    let tree = PRESETS["1"];
    for (let i = 0; i < 5; i++) tree = splitLeaf(tree, 0, "col")!.tree;
    expect(paneCount(tree)).toBe(6);
    expect(splitLeaf(tree, 0, "col")).toBeNull();
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
