// 槽位纯逻辑与 prefs 档位回环。文件是 .tsx 只因工程划分:features 下的
// 测试归 dom 工程(vitest.config 的 unit 工程只收 lib/gen/app),且 prefs
// 回环要 jsdom 的 localStorage。
import { afterEach, describe, expect, it } from "vitest";

import { readSplitSlots, writeSplitSlots } from "@/lib/util/prefs";
import { assign, cloudSlotId, eject, ejectCloud, emptySlots, firstEmptyIn, prune, seed } from "./slots";

afterEach(() => localStorage.clear());

describe("分屏槽位纯逻辑", () => {
  it("assign 是 move 语义:同一会话装进新槽即从旧槽摘掉(双格并存会互掐 session_close)", () => {
    const s = assign(assign(emptySlots(), 0, "a"), 2, "a");
    expect(s[0]).toBeNull();
    expect(s[2]).toBe("a");
  });

  it("eject 只清本槽,其余不动;空槽 eject 保引用", () => {
    const s = assign(assign(emptySlots(), 0, "a"), 1, "b");
    expect(eject(s, 0)[1]).toBe("b");
    expect(eject(s, 0)[0]).toBeNull();
    expect(eject(s, 3)).toBe(s);
  });

  it("ejectCloud 只清旧 transport 的云槽,保留本地槽;无云槽保引用", () => {
    const localOnly = assign(emptySlots(), 0, "local-a");
    expect(ejectCloud(localOnly)).toBe(localOnly);
    const mixed = assign(assign(localOnly, 1, cloudSlotId("cloud-a")), 2, "local-b");
    expect(ejectCloud(mixed)).toEqual(["local-a", null, "local-b"]);
  });

  it("prune 按全表剪掉被删会话;无变化保引用(不触发白重渲/白落盘)", () => {
    const s = assign(assign(emptySlots(), 0, "a"), 1, "b");
    expect(prune(s, new Set(["a", "b"]))).toBe(s);
    const pruned = prune(s, new Set(["b"]));
    expect(pruned[0]).toBeNull();
    expect(pruned[1]).toBe("b");
  });

  it("firstEmptyIn 只看给定叶序(树上不在场的留档槽不算落点)", () => {
    const s = assign(assign(emptySlots(), 0, "a"), 2, "b");
    expect(firstEmptyIn(s, [0, 2])).toBeNull();
    expect(firstEmptyIn(s, [0, 2, 1])).toBe(1);
    expect(firstEmptyIn(emptySlots(), [3])).toBe(3);
  });

  it("assign/seed 会为高位槽按需扩容", () => {
    const assigned = assign(emptySlots(), 7, "high");
    expect(assigned).toHaveLength(8);
    expect(assigned.slice(0, 7)).toEqual(Array.from({ length: 7 }, () => null));
    expect(assigned[7]).toBe("high");
    expect(seed(emptySlots(), "a", 6)[6]).toBe("a");
  });

  it("seed 只在全空时把当前会话播进指定首叶;有存档原样恢复,无当前会话不动", () => {
    expect(seed(emptySlots(), "a", 2)[2]).toBe("a");
    const kept = assign(emptySlots(), 1, "b");
    expect(seed(kept, "a", 0)).toBe(kept);
    const empty = emptySlots();
    expect(seed(empty, null)).toBe(empty);
  });
});

describe("分屏 prefs 槽位档(mc.splitSlots)", () => {
  it("完整读取时坏档逐位兜底且不截断有效高位槽", () => {
    localStorage.setItem("mc.splitSlots", JSON.stringify(["a", 3, "", "b", null, "c", "第七格"]));
    expect(readSplitSlots()).toEqual(["a", null, null, "b", null, "c", "第七格"]);
    localStorage.setItem("mc.splitSlots", "not-json");
    expect(readSplitSlots()).toEqual([]);
  });

  it("按树叶读取时只恢复引用槽并压成稠密数组", () => {
    localStorage.setItem("mc.splitSlots", JSON.stringify(["a", "离树", null, "d", "尾巴"]));
    expect(readSplitSlots([0, 3, Number.MAX_SAFE_INTEGER])).toEqual(["a", "d", null]);
  });

  it("写回保留全部动态槽位", () => {
    const slots = assign(emptySlots(), 8, "第九格");
    writeSplitSlots(slots);
    expect(readSplitSlots()).toEqual(slots);
  });
});
