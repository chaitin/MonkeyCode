import { describe, expect, it } from "vitest";

import { thoughtMarkdown, thoughtSummary } from "./thoughtMarkdown";

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

  it("截断切开 ** 时补齐:否则 marked 会把整行连同前导 ** 原样吐出", () => {
    // 上限内闭合不了 → 末尾补一个 **,强调仍成对
    expect(thoughtSummary("**" + "长".repeat(100) + "**", 10)).toBe("**" + "长".repeat(8) + "**");
    // 截断点落在完整的一对之后 → 不该多补
    expect(thoughtSummary("**abc** 余下正文", 7)).toBe("**abc**");
  });

  it("空输入与无内容行给空串", () => {
    expect(thoughtSummary("")).toBe("");
    expect(thoughtSummary("\n  \n")).toBe("");
  });
});
