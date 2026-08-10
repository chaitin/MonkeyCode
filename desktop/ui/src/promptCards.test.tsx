import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_PREVIEW_DESKTOP,
  DESIGN_PREVIEW_FALLBACK_SCALE,
  designPreviewLayout,
  DesignTemplateSelectionCard,
  loadDesignPreviewSource,
  loadDesignPreviewSourceWithRetry,
  visibleDesignPreviewLayout,
} from "./promptCards";
import type { LogItem } from "./types";

const openItem: Extract<LogItem, { kind: "design-template-selection" }> = {
  kind: "design-template-selection",
  requestId: "req-1",
  title: "视觉方向",
  description: "选择一个视觉方向",
  items: [
    { id: "clean", title: "简洁", image: "uploads/clean.png", recommended: true },
    { id: "bold", title: "醒目", image: "uploads/bold.png", description: "高对比" },
    { id: "motion", title: "动态", preview: { type: "html", path: ".monkeycode/design/template-previews/motion/index.html" } },
  ],
  refinement: { enabled: true, placeholder: "补充设计条件" },
  allowedActions: { select: true, next: true, direct: true, cancel: true },
  state: "open",
};

describe("DesignTemplateSelectionCard", () => {
  it("按固定桌面画布等比缩放并在响应式卡片中居中", () => {
    expect(DESIGN_PREVIEW_DESKTOP).toEqual({ width: 1440, height: 900 });
    expect(designPreviewLayout(288, 180)).toEqual({ scale: 0.2, left: 0, top: 0 });
    expect(designPreviewLayout(300, 150)).toEqual({ scale: 1 / 6, left: 30, top: 0 });
    expect(designPreviewLayout(0, 150)).toEqual({ scale: 0, left: 0, top: 0 });
  });

  it("WebView 首次测量为零时仍使用可见的安全缩放", () => {
    expect(visibleDesignPreviewLayout({ scale: 0, left: 0, top: 0 })).toEqual({
      scale: DESIGN_PREVIEW_FALLBACK_SCALE,
      left: 0,
      top: 0,
    });
    expect(visibleDesignPreviewLayout({ scale: 0.2, left: 5, top: 3 })).toEqual({ scale: 0.2, left: 5, top: 3 });
  });

  it("为预览卡输出确定的初始加载态，且不在卡片尺寸下挂载 iframe", () => {
    const html = renderToStaticMarkup(
      <DesignTemplateSelectionCard item={openItem} loadHtml={async () => "<main>styled</main>"} onRespond={vi.fn(async () => true)} />,
    );
    expect(html).toContain("data-preview-state=\"idle\"");
    expect(html).toContain("aspect-ratio:16 / 10");
    expect(html).not.toContain("<iframe");
  });

  it("动态 HTML 使用逐文件放行的 asset URL，不使用 srcDoc/blob/data", () => {
    const source = "asset://localhost/rendered-template-previews/preview.html";
    const html = renderToStaticMarkup(
      <iframe sandbox="allow-scripts" referrerPolicy="no-referrer" src={source} width={DESIGN_PREVIEW_DESKTOP.width} height={DESIGN_PREVIEW_DESKTOP.height} />,
    );
    expect(html).toContain("src=\"asset://localhost/rendered-template-previews/preview.html\"");
    expect(html).toContain("sandbox=\"allow-scripts\"");
    expect(html).toContain("referrerPolicy=\"no-referrer\"");
    expect(html).not.toContain("srcDoc=");
    expect(html).not.toContain("src=\"blob:");
    expect(html).not.toContain("src=\"data:");
    expect(html).not.toContain("allow-same-origin");
  });

  it("把读取失败和空 HTML 统一判为不可用", async () => {
    await expect(loadDesignPreviewSource(async () => { throw new Error("missing"); }, "stale/index.html", "html")).rejects.toThrow("missing");
    await expect(loadDesignPreviewSource(async () => "  \n", "empty/index.html", "html")).rejects.toThrow("preview unavailable");
    await expect(loadDesignPreviewSource(async () => "<main>styled</main>", "ok/index.html", "html")).resolves.toContain("styled");
  });

  it("预览文件短暂不可见时重试读取", async () => {
    let calls = 0;
    const loader = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("missing");
      return "<main>ready</main>";
    });
    const sleep = vi.fn(async () => {});
    await expect(loadDesignPreviewSourceWithRetry(loader, "late/index.html", "html", 3, 0, sleep)).resolves.toContain("ready");
    expect(loader).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("持续缺失时在有限次数后失败", async () => {
    const loader = vi.fn(async () => { throw new Error("missing"); });
    await expect(loadDesignPreviewSourceWithRetry(loader, "missing/index.html", "html", 3, 0, async () => {})).rejects.toThrow("missing");
    expect(loader).toHaveBeenCalledTimes(3);
  });

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
    expect(html).toContain("data-preview-type=\"image\"");
    expect(html).toContain("data-preview-type=\"html\"");
    expect(html).toContain("display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start");
    expect(html).toContain("appearance:none");
    // 服务端渲染时仍是占位，进入视口后才会挂 iframe。
    expect(html).not.toContain("<iframe");
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
