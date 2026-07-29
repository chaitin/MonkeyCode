import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// DOMPurify 需要真实 DOM;node 测试环境下用直通替身,断言只验证 marked 的解析结果。
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html } }));

import { LogList } from "./components";

describe("思考块布局", () => {
  it("与 assistant 正文使用相同的最大宽度", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[{ kind: "thought", text: "正在分析问题" }]}
        onPermAnswer={() => {}}
      />,
    );

    expect(html).toContain("max-width:92%");
    expect(html).toContain("思考");
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
