import { describe, expect, it } from "vitest";

import type { SlashCommand } from "@/lib/protocol/types";
import { commandText, createImeGuard, cycleIndex, filterCommands, slashQuery } from "./slash";

describe("slashQuery:只认整条消息开头的 /,空格后停止补全", () => {
  const cases: Array<[string, string | null]> = [
    ["/", ""],
    ["/co", "co"],
    ["/compact", "compact"],
    ["/compact ", null], // 空格 = 进入填参数阶段
    ["/compact args", null],
    ["hello /path", null], // 句中的 / 是路径,不弹菜单
    ["", null],
    [" /x", null],
    ["/中文", "中文"],
  ];
  it.each(cases)("%j → %j", (input, want) => {
    expect(slashQuery(input)).toBe(want);
  });
});

describe("filterCommands:前缀优先于子串,描述子串垫底", () => {
  const cmds: SlashCommand[] = [
    { name: "add-context", description: "补充上下文" },
    { name: "compact", description: "压缩上下文" },
    { name: "review", description: "代码审查" },
  ];
  it("空查询返回全量(浅拷贝,不共享引用)", () => {
    const out = filterCommands(cmds, "");
    expect(out).toEqual(cmds);
    expect(out).not.toBe(cmds);
  });
  it("co:前缀命中 compact 排在子串命中 add-context 之前", () => {
    expect(filterCommands(cmds, "co").map((c) => c.name)).toEqual(["compact", "add-context"]);
  });
  it("描述子串也可命中(审查 → review)", () => {
    expect(filterCommands(cmds, "审查").map((c) => c.name)).toEqual(["review"]);
  });
  it("无命中回空", () => {
    expect(filterCommands(cmds, "zzz")).toEqual([]);
  });
});

describe("commandText / cycleIndex", () => {
  it("回填一律带尾随空格", () => {
    expect(commandText({ name: "compact" })).toBe("/compact ");
  });
  const cycles: Array<[number, number, number, number]> = [
    [0, 1, 3, 1],
    [2, 1, 3, 0], // 底部回绕
    [0, -1, 3, 2], // 顶部回绕
    [0, 1, 0, 0], // 空列表恒 0
    [5, 1, 3, 0], // 越界下标也收敛
  ];
  it.each(cycles)("active=%i delta=%i len=%i → %i", (a, d, l, want) => {
    expect(cycleIndex(a, d, l)).toBe(want);
  });
});

describe("ImeGuard:组合中或 compositionend 100ms 窗口内的 Enter 都是选字", () => {
  it("isComposing=true 直接拦截", () => {
    expect(createImeGuard().isImeEnter(1000, true)).toBe(true);
  });
  it("从未组合过:不拦截", () => {
    expect(createImeGuard().isImeEnter(1000, false)).toBe(false);
  });
  it("WebKit 时序:compositionend 后 <100ms 的 Enter 拦截,≥100ms 放行", () => {
    const g = createImeGuard();
    g.markEnd(1000);
    expect(g.isImeEnter(1050, false)).toBe(true);
    expect(g.isImeEnter(1099.9, false)).toBe(true);
    expect(g.isImeEnter(1100, false)).toBe(false);
  });
  it("实例隔离:一个输入框的组合不影响另一个", () => {
    const a = createImeGuard();
    const b = createImeGuard();
    a.markEnd(1000);
    expect(b.isImeEnter(1010, false)).toBe(false);
  });
});
