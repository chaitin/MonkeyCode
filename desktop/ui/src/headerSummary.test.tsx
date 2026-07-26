import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HeaderSummary, ViewHeader } from "./viewChrome";

describe("HeaderSummary", () => {
  it("有摘要就渲染,并给出完整文本的悬停提示(行内会被省略号切掉)", () => {
    const html = renderToStaticMarkup(<HeaderSummary summary="修复登录流程的重定向死循环" />);
    expect(html).toContain("修复登录流程的重定向死循环");
    expect(html).toContain('title="修复登录流程的重定向死循环"');
  });

  it("摘要缺席(旧会话/首轮未回/引擎过旧)时整段不渲染,连分隔点都不留", () => {
    expect(renderToStaticMarkup(<HeaderSummary summary="" />)).toBe("");
    expect(renderToStaticMarkup(<HeaderSummary />)).toBe("");
  });

  it("不带窗口拖拽属性:副标题多这一段,标题栏的拖拽行为不受影响", () => {
    const html = renderToStaticMarkup(
      <ViewHeader title="会话" subtitle={<HeaderSummary summary="修复登录流程" />} />,
    );
    // 拖拽区仍只有标题栏根节点与右侧留白两处
    expect(html.match(/data-tauri-drag-region/g)?.length).toBe(2);
  });
});
