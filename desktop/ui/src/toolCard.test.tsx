import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LogList, ToolCard } from "./components";
import type { LogItem } from "./types";

const tool = (overrides: Partial<Extract<LogItem, { kind: "tool" }>> = {}): Extract<LogItem, { kind: "tool" }> => ({
  kind: "tool",
  tcId: "tool-1",
  title: "Read /repo/src/main.ts",
  rawInput: { file_path: "/repo/src/main.ts" },
  status: "ok",
  out: "不应展示的原始结果",
  durationMs: 1_200,
  ...overrides,
});

describe("ToolCard", () => {
  it("单行展示工具名称、调用目标和悬浮耗时，不展示成功结果摘要", () => {
    const html = renderToStaticMarkup(<ToolCard item={tool()} workdir="/repo" />);

    expect(html).toContain("读取文件");
    expect(html).toContain("src/main.ts");
    expect(html).toContain("1.2s");
    expect(html).toContain('class="card tool-card"');
    expect(html).toContain('class="tool-duration"');
    expect(html).toContain("font-weight:500");
    expect(html).not.toContain("不应展示的原始结果");
  });

  it("失败结果在标题行下方保留为错误提示", () => {
    const html = renderToStaticMarkup(<ToolCard item={tool({ status: "fail", out: "permission denied", result: "permission denied\nstack" })} />);

    expect(html).toContain('role="alert"');
    expect(html).toContain("permission denied");
    expect(html).toContain("var(--err)");
  });

  it("云端结构化工具使用同一张卡并提供可展开详情", () => {
    const html = renderToStaticMarkup(<ToolCard item={tool({
      title: "opencode_read",
      toolKind: "read",
      rawInput: { filePath: "/workspace/src/app.ts" },
      rawOutput: { output: "export const app = true" },
      result: "export const app = true",
    })} workdir="/workspace" />);

    expect(html).toContain("读取文件");
    expect(html).toContain("src/app.ts");
    expect(html).toContain('aria-label="展开工具详情"');
    expect(html).toContain('class="hv-t1 tool-detail-toggle"');
    expect(html).not.toContain("export const app = true");
  });

  it("相邻工具调用共享一个外框并去掉间距", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[tool(), tool({ tcId: "tool-2", title: "Edit /repo/src/main.ts" })]}
        onPermAnswer={vi.fn()}
      />,
    );

    expect(html).toContain('class="card tool-stack"');
    expect(html.match(/class="tool-card tool-card-grouped"/g)).toHaveLength(2);
    expect(html).toContain("gap:0");
    expect(html).not.toContain('class="card tool-card"');
  });
});
