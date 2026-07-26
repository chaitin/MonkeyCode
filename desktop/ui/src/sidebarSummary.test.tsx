// 侧栏会话行的摘要展示:引擎每轮生成的会话摘要作第二行(暗色、可省略),
// 摘要缺席不长行——单行密度与云端任务行保持一致。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";
import type { SessionMeta } from "./types";

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

const session = (extra: Partial<SessionMeta>): SessionMeta => ({
  id: "s1",
  title: "帮我看下这个报错",
  workdir: "/work/a",
  kind: "local",
  model: "m",
  turns: 3,
  status: "idle",
  updated_at: "2026-07-26T10:00:00Z",
  ...extra,
});

const render = (sessions: SessionMeta[]) =>
  renderToStaticMarkup(
    <Sidebar
      sessions={sessions}
      archivedProjects={new Set()}
      currentId={null}
      attention={new Set()}
      sessionActive={false}
      connected
      status="已连接"
      mcConnection={{ phase: "connected", host: "monkeycode-ai.com" }}
      cloudTasks={[]}
      onConnectCloud={() => {}}
      onNewCloudTask={() => {}}
      onOpenCloudTask={() => {}}
      onSelect={() => {}}
      onNewTask={() => {}}
      onProjectArchive={() => {}}
      onNewChat={() => {}}
      onOpenSettings={() => {}}
      onArchive={() => {}}
      onDelete={() => {}}
      onRename={() => {}}
    />,
  );

describe("侧栏会话行的摘要", () => {
  it("有摘要长出第二行,悬停提示也带上(行内会被省略号切掉)", () => {
    const html = render([session({ summary: "定位并修复解析器崩溃" })]);
    expect(html).toContain("定位并修复解析器崩溃");
    // 标题行与摘要行都在:标题不被摘要顶掉
    expect(html).toContain("帮我看下这个报错");
    // 悬停提示含摘要全文(title 属性里以换行分隔)
    expect(html).toMatch(/title="帮我看下这个报错\n定位并修复解析器崩溃\n/);
  });

  it("摘要缺席(旧会话/首轮未回/引擎过旧)不渲染第二行", () => {
    const html = render([session({})]);
    expect(html).toContain("帮我看下这个报错");
    expect(html).not.toContain("定位并修复解析器崩溃");
    // 悬停提示回到两段式:标题 + 工作区路径
    expect(html).toMatch(/title="帮我看下这个报错\n\/work\/a\n/);
  });
});
