import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesignTemplateSelectionCard } from "./promptCards";
import type { LogItem } from "./types";

const openItem: Extract<LogItem, { kind: "design-template-selection" }> = {
  kind: "design-template-selection",
  requestId: "req-1",
  title: "视觉方向",
  description: "选择一个视觉方向",
  items: [
    { id: "clean", title: "简洁", image: "uploads/clean.png", recommended: true },
    { id: "bold", title: "醒目", image: "uploads/bold.png", description: "高对比" },
  ],
  refinement: { enabled: true, placeholder: "补充设计条件" },
  allowedActions: { select: true, next: true, direct: true, cancel: true },
  state: "open",
};

describe("DesignTemplateSelectionCard", () => {
  it("独立渲染设计网格、推荐标记和全部业务动作", () => {
    const html = renderToStaticMarkup(
      <DesignTemplateSelectionCard item={openItem} uploadUrl={async (path) => path} onRespond={vi.fn(async () => true)} />,
    );
    expect(html).toContain("视觉方向");
    expect(html).toContain("推荐");
    expect(html).toContain("补充设计条件");
    expect(html).toContain("换一批");
    expect(html).toContain("直接开发");
    expect(html).toContain("取消");
    expect(html).toContain(">选择</button>");
  });

  it("只允许 select 时保留候选选择和选择按钮，隐藏其他动作与 refinement", () => {
    const html = renderToStaticMarkup(
      <DesignTemplateSelectionCard
        item={{ ...openItem, allowedActions: { select: true, next: false, direct: false, cancel: false } }}
        onRespond={vi.fn(async () => true)}
      />,
    );
    expect(html).toContain("aria-pressed=\"false\"");
    expect(html).toContain(">选择</button>");
    expect(html).not.toContain("补充设计条件");
    expect(html).not.toContain("换一批");
    expect(html).not.toContain("直接开发");
    expect(html).not.toContain(">取消</button>");
  });

  it("只允许 next/cancel 时仍展示不可选候选，但不显示选择提交", () => {
    const html = renderToStaticMarkup(
      <DesignTemplateSelectionCard
        item={{ ...openItem, title: undefined, allowedActions: { select: false, next: true, direct: false, cancel: true } }}
        onRespond={vi.fn(async () => true)}
      />,
    );
    expect(html).toContain("选择设计");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("简洁");
    expect(html).toContain("补充设计条件");
    expect(html).toContain("换一批");
    expect(html).toContain(">取消</button>");
    expect(html).not.toContain(">选择</button>");
    expect(html).not.toContain("直接开发");
  });

  it("终态收成紧凑结果，不再显示操作", () => {
    const html = renderToStaticMarkup(
      <DesignTemplateSelectionCard item={{ ...openItem, state: "responded", action: "select", selectedId: "clean" }} />,
    );
    expect(html).toContain("已选择 · 简洁");
    expect(html).not.toContain("换一批");
  });
});
