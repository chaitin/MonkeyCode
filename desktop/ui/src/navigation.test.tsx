import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NewTaskView } from "./newtask";
import { relativeTime, Sidebar, turnCountLabel } from "./sidebar";

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("侧栏新建任务入口", () => {
  it("云端任务标题栏提供新建按钮", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        sessions={[]}
        currentId={null}
        attention={new Set()}
        sessionActive={false}
        connected={false}
        status="未连接"
        mcConnection={{ phase: "connected", host: "monkeycode-ai.com" }}
        cloudTasks={[]}
        activeCloudId="active-cloud-task"
        onConnectCloud={() => {}}
        onRefreshCloud={() => {}}
        onNewCloudTask={() => {}}
        onOpenCloudTask={() => {}}
        onSelect={() => {}}
        onNewTask={() => {}}
        onNewChat={() => {}}
        onOpenSettings={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );

    expect(html).toContain('title="新建云端任务"');
  });

  it("云端入口的预填会直接打开云端模式", () => {
    const html = renderToStaticMarkup(
      <NewTaskView
        models={[]}
        lastDir=""
        recentDirs={[]}
        prefill={{ mode: "cloud" }}
        cloudReady={false}
        onCreated={() => {}}
        onCloudCreated={() => {}}
      />,
    );

    expect(html).toContain("不关联仓库(快速开始)");
    expect(html).toContain("云端任务需要先连接 MonkeyCode");
    expect(html).toContain('title="请先连接 MonkeyCode 后再创建云端任务"');
    expect(html).toContain("请先连接");
  });

  it("对话入口创建不绑定项目的独立会话", () => {
    const html = renderToStaticMarkup(
      <NewTaskView
        models={[]}
        lastDir="/workspace/project"
        recentDirs={["/workspace/project"]}
        prefill={{ mode: "chat" }}
        cloudReady={false}
        onCreated={() => {}}
        onCloudCreated={() => {}}
      />,
    );

    expect(html).toContain("开始一段新对话");
    expect(html).toContain("独立对话 · 不关联本地项目");
    expect(html).toContain("开始对话");
    expect(html).not.toContain("文件夹里工作");
  });
});

describe("会话辅助信息", () => {
  it("把更新时间压缩成便于扫读的相对时间", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));

    expect(relativeTime("2026-07-23T11:59:42Z")).toBe("刚刚");
    expect(relativeTime("2026-07-23T11:34:00Z")).toBe("26 分钟前");
    expect(relativeTime("2026-07-21T12:00:00Z")).toBe("2 天前");
  });

  it("同时展示可继续状态、轮次和稳定滚动槽，不再预留更多按钮", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        sessions={[{
          id: "chat-1",
          title: "继续优化侧边栏",
          workdir: "/app-data/chat-1",
          kind: "chat",
          model: "test",
          turns: 12,
          status: "idle",
          updated_at: "2026-07-23T11:34:00Z",
        }]}
        currentId="chat-1"
        attention={new Set()}
        sessionActive
        connected
        status="已连接"
        mcConnection={{ phase: "connected", host: "monkeycode-ai.com" }}
        cloudTasks={[]}
        onConnectCloud={() => {}}
        onNewCloudTask={() => {}}
        onOpenCloudTask={() => {}}
        onSelect={() => {}}
        onNewTask={() => {}}
        onNewChat={() => {}}
        onOpenSettings={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );

    expect(html).toContain("可继续");
    expect(html).toContain("12 轮");
    expect(html).toContain("右键管理");
    expect(html).toContain("scrollbar-gutter:stable");
    expect(html).not.toContain('title="更多操作"');
  });

  it("轮次文案会过滤空值和异常历史值", () => {
    expect(turnCountLabel(3)).toBe("3 轮");
    expect(turnCountLabel(0)).toBe("");
    expect(turnCountLabel(Number.NaN)).toBe("");
  });
});
