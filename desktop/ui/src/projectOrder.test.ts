import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyProjectOrder, persistProjectOrder, readProjectOrder, reorderProjects } from "./projectOrder";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

/** 侧栏传进来的分组已按最近活跃降序，测试里只关心 dir。 */
const groups = (...dirs: string[]) => dirs.map((dir) => ({ dir }));
const dirs = (list: { dir: string }[]) => list.map((g) => g.dir);

describe("项目手动顺序", () => {
  it("从未拖动过时保持最近活跃排序", () => {
    expect(readProjectOrder()).toEqual([]);
    expect(dirs(applyProjectOrder(groups("/a", "/b", "/c"), []))).toEqual(["/a", "/b", "/c"]);
  });

  it("拖动后顺序固化，不再随会话活跃度浮动", () => {
    const order = reorderProjects(["/a", "/b", "/c", "/d"], "/c", 0);
    expect(order).toEqual(["/c", "/a", "/b", "/d"]);
    // 之后 /d 里发了消息，分组按活跃度重排成 d,a,b,c —— 手动序仍然生效
    expect(dirs(applyProjectOrder(groups("/d", "/a", "/b", "/c"), order))).toEqual(["/c", "/a", "/b", "/d"]);
  });

  it("新项目插到最前，已固化项目的相对序不变", () => {
    const order = reorderProjects(["/a", "/b", "/c"], "/c", 0);
    expect(dirs(applyProjectOrder(groups("/new", "/a", "/b", "/c"), order))).toEqual(["/new", "/c", "/a", "/b"]);
  });

  it("多个新项目之间保留各自的活跃度先后", () => {
    const order = reorderProjects(["/a", "/b"], "/b", 0);
    expect(dirs(applyProjectOrder(groups("/fresh2", "/fresh1", "/a", "/b"), order))).toEqual([
      "/fresh2",
      "/fresh1",
      "/b",
      "/a",
    ]);
  });

  it("落点是缝隙下标:可以拖到首位和末位", () => {
    expect(reorderProjects(["/a", "/b", "/c", "/d"], "/a", 4)).toEqual(["/b", "/c", "/d", "/a"]);
    expect(reorderProjects(["/a", "/b", "/c", "/d"], "/d", 0)).toEqual(["/d", "/a", "/b", "/c"]);
    // 中间插入:/b 落到 /c 与 /d 之间
    expect(reorderProjects(["/a", "/b", "/c", "/d"], "/b", 3)).toEqual(["/a", "/c", "/b", "/d"]);
  });

  it("落在自身两侧的缝隙视为原位", () => {
    expect(reorderProjects(["/a", "/b", "/c"], "/b", 1)).toEqual(["/a", "/b", "/c"]);
    expect(reorderProjects(["/a", "/b", "/c"], "/b", 2)).toEqual(["/a", "/b", "/c"]);
  });

  it("越界落点收敛到首尾，未知项目不改动顺序", () => {
    expect(reorderProjects(["/a", "/b", "/c"], "/c", -5)).toEqual(["/c", "/a", "/b"]);
    expect(reorderProjects(["/a", "/b", "/c"], "/a", 99)).toEqual(["/b", "/c", "/a"]);
    expect(reorderProjects(["/a", "/b"], "/gone", 0)).toEqual(["/a", "/b"]);
  });

  it("跨平台目录归一后是同一个项目", () => {
    const order = reorderProjects(["C:\\work\\a\\", "C:\\work\\b"], "C:\\work\\b", 0);
    expect(order).toEqual(["C:/work/b", "C:/work/a"]);
    expect(dirs(applyProjectOrder(groups("C:/work/a", "C:/work/b"), order))).toEqual(["C:/work/b", "C:/work/a"]);
  });

  it("提交写的是全序快照，消失的项目自动清出", () => {
    persistProjectOrder(reorderProjects(["/a", "/b", "/c"], "/c", 0));
    expect(readProjectOrder()).toEqual(["/c", "/a", "/b"]);
    // /b 被删除或归档后再拖一次，它的 key 不再残留
    const next = persistProjectOrder(reorderProjects(["/c", "/a"], "/a", 0));
    expect(next).toEqual(["/a", "/c"]);
    expect(readProjectOrder()).toEqual(["/a", "/c"]);
  });

  it("归档后恢复的项目按新项目处理，排到最前", () => {
    // 归档期间提交过一次顺序，/b 已被清出快照
    const order = reorderProjects(["/a", "/c"], "/c", 0);
    expect(dirs(applyProjectOrder(groups("/b", "/c", "/a"), order))).toEqual(["/b", "/c", "/a"]);
  });

  it("读取时容忍脏数据:非数组、非字符串项、重复 key", () => {
    localStorage.setItem("mc.projectOrder", "not json");
    expect(readProjectOrder()).toEqual([]);
    localStorage.setItem("mc.projectOrder", JSON.stringify({ a: 1 }));
    expect(readProjectOrder()).toEqual([]);
    localStorage.setItem("mc.projectOrder", JSON.stringify(["/a", 7, null, "/a/", "", "/b"]));
    expect(readProjectOrder()).toEqual(["/a", "/b"]);
  });

  it("存储不可写时本次拖动仍在内存生效", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    expect(persistProjectOrder(["/a", "/b"])).toEqual(["/a", "/b"]);
  });
});
