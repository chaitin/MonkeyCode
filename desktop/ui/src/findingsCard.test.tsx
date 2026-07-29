import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// DOMPurify 需要真实 DOM;node 测试环境下用直通替身,断言只关心结构与文案。
vi.mock("dompurify", () => ({ default: { sanitize: (html: string) => html } }));

import { ToolCard } from "./components";
import type { LogItem } from "./types";

const reportTool = (rawInput: unknown): Extract<LogItem, { kind: "tool" }> => ({
  kind: "tool",
  tcId: "tool-1",
  title: "ReportFindings",
  rawInput,
  status: "ok",
  out: "",
});

describe("审查发现卡", () => {
  it("每条发现一行:核验徽标、摘要、分类、文件定位与处置结果", () => {
    const html = renderToStaticMarkup(
      <ToolCard
        item={reportTool({
          level: "high",
          findings: [
            {
              file: "desktop/ui/src/reduce.ts",
              line: 77,
              summary: "流式 chunk 裸拼导致相邻加粗标题连体",
              short_summary: "chunk 裸拼连体标题",
              failure_scenario: "思考流出现 **A****B**,渲染露出星号",
              category: "correctness",
              verdict: "CONFIRMED",
              outcome: "fixed",
            },
            {
              file: "src/util.ts",
              summary: "疑似重复的工具函数",
              verdict: "PLAUSIBLE",
            },
          ],
        })}
      />,
    );

    expect(html).toContain("汇报审查发现");
    expect(html).toContain("2 项发现");
    expect(html).toContain("已证实");
    expect(html).toContain("疑似");
    expect(html).toContain("chunk 裸拼连体标题");
    expect(html).toContain("correctness");
    expect(html).toContain("reduce.ts:77");
    expect(html).toContain("已修复");
    // 无 line 的发现只显示文件名
    expect(html).toContain("util.ts");
  });

  it("空发现列表渲染完成态而非空白卡", () => {
    const html = renderToStaticMarkup(<ToolCard item={reportTool({ findings: [] })} />);

    expect(html).toContain("未发现问题");
    expect(html).toContain("本轮审查未发现需要处理的问题");
  });

  it("rawInput 未就绪(流式)时不渲染发现列表,也不误报未发现问题", () => {
    const html = renderToStaticMarkup(<ToolCard item={{ ...reportTool(undefined), status: "run" }} />);

    expect(html).toContain("汇报审查发现");
    expect(html).not.toContain("未发现");
  });
});
