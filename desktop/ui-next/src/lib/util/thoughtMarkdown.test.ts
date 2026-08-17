import { describe, expect, it } from "vitest";

import { thoughtLiveSummary, thoughtMarkdown, thoughtSummary } from "./thoughtMarkdown";

describe("thoughtMarkdown(流式 **** 连拼修复)", () => {
  it("相邻加粗标题的 **** 拆成段落边界", () => {
    expect(thoughtMarkdown("**先看日志****再改代码**")).toBe("**先看日志**\n\n**再改代码**");
  });

  it("多处连拼逐一拆开", () => {
    expect(thoughtMarkdown("**A****B****C**")).toBe("**A**\n\n**B**\n\n**C**");
  });

  it("无连拼原样返回(正常加粗不受影响)", () => {
    expect(thoughtMarkdown("普通 **加粗** 文本")).toBe("普通 **加粗** 文本");
    expect(thoughtMarkdown("")).toBe("");
  });
});

describe("thoughtSummary(折叠态摘要行源文)", () => {
  it("取首个非空行,跳过前导空行", () => {
    expect(thoughtSummary("\n\n**看日志**\n\n然后改代码")).toBe("**看日志**");
  });

  it("成对的 ** 原样保留(渲染成 strong,不再是字面量星号)", () => {
    expect(thoughtSummary("**看日志**")).toBe("**看日志**");
  });

  it("不按字符数截断，交给卡片实际宽度的 CSS；上游孤立 ** 仍补齐", () => {
    const long = "**" + "长".repeat(100) + "**";
    expect(thoughtSummary(long)).toBe(long);
    expect(thoughtSummary("**尚未闭合")).toBe("**尚未闭合**");
  });

  it("空输入与无内容行给空串", () => {
    expect(thoughtSummary("")).toBe("");
    expect(thoughtSummary("\n  \n")).toBe("");
  });
});

describe("thoughtLiveSummary(流式折叠态跟随尾部)", () => {
  it("取最新非空行而不是首行", () => {
    expect(thoughtLiveSummary("第一步:读取文件\n第二步:核对调用链\n\n")).toBe("第二步:核对调用链");
  });

  it("整段无换行且持续增长时截取移动尾窗并标省略", () => {
    expect(thoughtLiveSummary(`开头${"甲".repeat(20)}最新进度`, 8)).toBe("…甲甲甲甲最新进度");
    expect(thoughtLiveSummary(`开头${"甲".repeat(20)}最新进度完成`, 8)).toBe("…甲甲最新进度完成");
  });

  it("短的最新加粗标题保留 markdown，截进孤立闭合标记时补齐", () => {
    expect(thoughtLiveSummary("旧内容\n**正在验证**")).toBe("**正在验证**");
    expect(thoughtLiveSummary(`**${"长".repeat(20)}完成**`, 6)).toBe("…**长长完成**");
  });

  it("尾窗不切开 emoji surrogate pair", () => {
    expect(thoughtLiveSummary("很长的分析过程🐛完成", 4)).toBe("…🐛完成");
  });
});
