// 拖动手势本身要 pointer 事件，现有测试基建是 renderToStaticMarkup(无 DOM)，
// 装不了;这里守住接线面:哪些行挂了拖动锚点、顺序有没有真的应用上。
// 落点与顺序计算的逻辑覆盖在 projectOrder.test.ts。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";
import type { SessionMeta } from "./types";

let stored: Record<string, string>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const session = (id: string, workdir: string, updated: string): SessionMeta => ({
  id,
  title: id,
  workdir,
  kind: "local",
  model: "m",
  turns: 1,
  status: "idle",
  updated_at: updated,
});

const render = (sessions: SessionMeta[], archivedProjects = new Set<string>()) =>
  renderToStaticMarkup(
    <Sidebar
      sessions={sessions}
      archivedProjects={archivedProjects}
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

/** 项目行在 DOM 里的先后 = 侧栏可见顺序。 */
const dragDirs = (html: string) => [...html.matchAll(/data-project-dir="([^"]*)"/g)].map((m) => m[1]);

describe("侧栏项目拖动排序接线", () => {
  it("多个活跃项目时每行都带拖动锚点，顺序为最近活跃优先", () => {
    const html = render([
      session("s1", "/work/a", "2026-07-20T10:00:00Z"),
      session("s2", "/work/b", "2026-07-26T10:00:00Z"),
    ]);
    expect(dragDirs(html)).toEqual(["/work/b", "/work/a"]);
  });

  it("只有一个项目时不挂拖动锚点", () => {
    const html = render([session("s1", "/work/a", "2026-07-20T10:00:00Z")]);
    expect(dragDirs(html)).toEqual([]);
  });

  it("已存的手动顺序覆盖活跃度排序", () => {
    stored["mc.projectOrder"] = JSON.stringify(["/work/a", "/work/b"]);
    const html = render([
      session("s1", "/work/a", "2026-07-20T10:00:00Z"),
      session("s2", "/work/b", "2026-07-26T10:00:00Z"),
    ]);
    expect(dragDirs(html)).toEqual(["/work/a", "/work/b"]);
  });

  it("手动顺序之外的新项目排在最前", () => {
    stored["mc.projectOrder"] = JSON.stringify(["/work/a", "/work/b"]);
    const html = render([
      session("s1", "/work/a", "2026-07-20T10:00:00Z"),
      session("s2", "/work/b", "2026-07-26T10:00:00Z"),
      session("s3", "/work/fresh", "2026-01-01T10:00:00Z"),
    ]);
    expect(dragDirs(html)).toEqual(["/work/fresh", "/work/a", "/work/b"]);
  });

  it("归档项目不参与拖动排序", () => {
    const html = render(
      [
        session("s1", "/work/a", "2026-07-20T10:00:00Z"),
        session("s2", "/work/b", "2026-07-26T10:00:00Z"),
        session("s3", "/work/old", "2026-07-25T10:00:00Z"),
      ],
      new Set(["/work/old"]),
    );
    expect(dragDirs(html)).toEqual(["/work/b", "/work/a"]);
  });

  it("普通对话不进项目树，也就没有拖动锚点", () => {
    const html = render([
      { ...session("c1", "/hidden/chat", "2026-07-26T10:00:00Z"), kind: "chat" },
      session("s1", "/work/a", "2026-07-20T10:00:00Z"),
    ]);
    expect(dragDirs(html)).toEqual([]);
  });

  // 别把这条当冗余删掉:WebKitGTK 2.52.3 实测只认带前缀的写法,无前缀声明
  // 会被整条丢弃(computed 值仍是 text),表现是拖项目时项目名被选中。
  it("项目行同时写两种 user-select，少了前缀那条在 WebKit 上等于没写", () => {
    const html = render([
      session("s1", "/work/a", "2026-07-20T10:00:00Z"),
      session("s2", "/work/b", "2026-07-26T10:00:00Z"),
    ]);
    const rowTag = html.match(/<div[^>]*data-project-dir="[^"]*"[^>]*>/)?.[0] ?? "";
    expect(rowTag).toContain("user-select:none");
    expect(rowTag).toContain("-webkit-user-select:none");
  });
});
