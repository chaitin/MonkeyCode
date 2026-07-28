import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SessionNoticeBanner } from "./chat";

describe("SessionNoticeBanner", () => {
  it("完成提示使用成功色并提供会话跳转入口", () => {
    const html = renderToStaticMarkup(
      <SessionNoticeBanner
        notice={{ text: "「后台任务」已完成", tone: "success", targetSessionId: "session-2" }}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );

    expect(html).toContain("var(--ok)");
    expect(html).toContain('title="跳转查看"');
    expect(html).toContain("查看 ›");
  });

  it("普通操作错误保持红色且不可跳转", () => {
    const html = renderToStaticMarkup(
      <SessionNoticeBanner
        notice={{ text: "切换模型失败", tone: "error" }}
        onDismiss={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    );

    expect(html).toContain("var(--err)");
    expect(html).not.toContain('title="跳转查看"');
  });
});
