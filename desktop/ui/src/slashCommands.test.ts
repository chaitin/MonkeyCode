// 斜杠指令补全的纯逻辑单测:什么算"正在敲指令"、过滤排序、回填文本。
import { describe, expect, it } from "vitest";
import { commandText, filterCommands, nextActive, slashQuery } from "./slashCommands";
import type { SlashCommand } from "./types";

const cmd = (name: string, description?: string, hint?: string): SlashCommand => ({
  name,
  ...(description ? { description } : {}),
  ...(hint ? { input: { hint } } : {}),
});

describe("slashQuery", () => {
  it("整段输入以 / 开头且未敲空格时给出查询词", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/com")).toBe("com");
  });

  it("敲了空格即进入填参数阶段,不再补全", () => {
    expect(slashQuery("/review src/a.ts")).toBeNull();
    expect(slashQuery("/compact ")).toBeNull();
  });

  it("句中的 / 是路径或日期,不弹菜单", () => {
    expect(slashQuery("看下 src/main.ts")).toBeNull();
    expect(slashQuery("2026/08/02 的记录")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });
});

describe("filterCommands", () => {
  const all = [cmd("add-context"), cmd("compact", "压缩上下文"), cmd("review", "代码审查")];

  it("空查询给全量", () => {
    expect(filterCommands(all, "")).toEqual(all);
  });

  it("前缀匹配排在子串匹配之前", () => {
    expect(filterCommands(all, "co").map((c) => c.name)).toEqual(["compact", "add-context"]);
  });

  it("描述命中也算匹配", () => {
    expect(filterCommands(all, "审查").map((c) => c.name)).toEqual(["review"]);
  });

  it("大小写不敏感;无匹配给空列表", () => {
    expect(filterCommands(all, "REV").map((c) => c.name)).toEqual(["review"]);
    expect(filterCommands(all, "zzz")).toEqual([]);
  });
});

describe("commandText", () => {
  it("带参数提示的补一个空格,等着填参数", () => {
    expect(commandText(cmd("review", "", "<file>"))).toBe("/review ");
  });

  it("无参数的原样填入,按 ↩ 可直接发出", () => {
    expect(commandText(cmd("compact"))).toBe("/compact");
  });
});

describe("nextActive", () => {
  it("上下越界回绕", () => {
    expect(nextActive(0, 1, 3)).toBe(1);
    expect(nextActive(2, 1, 3)).toBe(0);
    expect(nextActive(0, -1, 3)).toBe(2);
  });

  it("空列表恒为 0(不产生 NaN 下标)", () => {
    expect(nextActive(0, 1, 0)).toBe(0);
    expect(nextActive(3, -1, 0)).toBe(0);
  });
});
