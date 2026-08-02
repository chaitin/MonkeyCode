import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// DOMPurify 需要真实 DOM;node 测试环境下用直通替身,断言只验证 marked 的解析结果。
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html } }));

// 块级 Markdown 走 document.createElement,node 环境跑不动;这里只验行宽几何,
// 换成直通替身即可。行内 MarkdownInline 保持真实实现——下方加粗用例依赖它。
vi.mock("./markdown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./markdown")>()),
  Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>,
}));

import { LogList } from "./components";

describe("思考块布局", () => {
  // 思考块与 assistant 正文同宽,且都不自缩:行长已由 COL_MAX 封顶,
  // 消息层再设上限会让模型侧产出比 composer 右缘短一截。
  it("与 assistant 正文一样占满内容轨,不再自设宽度上限", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[
          { kind: "thought", text: "正在分析问题" },
          { kind: "agent", text: "分析完成" },
        ]}
        onPermAnswer={() => {}}
      />,
    );

    expect(html).not.toContain("max-width");
    // 两侧都真的渲染了,否则上面的"无上限"是空断言。
    expect(html).toContain("思考");
    expect(html).toContain("分析完成");
  });

  it("折叠摘要按内联 markdown 渲染加粗,不露原始星号", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[{ kind: "thought", text: "**审计范围确认**" }]}
        onPermAnswer={() => {}}
      />,
    );

    expect(html).toContain("<strong>审计范围确认</strong>");
    expect(html).not.toContain("**");
  });

  it("chunk 裸拼的连体加粗标题拆成独立 strong", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[{ kind: "thought", text: "**识别技能不匹配****规划安全审计任务**" }]}
        onPermAnswer={() => {}}
      />,
    );

    expect(html).toContain("<strong>识别技能不匹配</strong>");
    expect(html).toContain("<strong>规划安全审计任务</strong>");
    expect(html).not.toContain("**");
  });
});
