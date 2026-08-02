// 侧栏「项目」组里的云端项目行。项目列表接口每项只捎带 ≤3 条**运行中**的任务
// (后端按 pending/processing 过滤),历史任务一条不带:所以"没任务"多半只是
// "此刻没在跑"。有在跑的默认展开,其余默认收起、点开再按 project_id 拉。
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";
import type { CloudProject, CloudProjectTasks } from "./types";

beforeEach(() => {
  // 云端内容只在「云端」空间渲染:让侧栏从持久化里恢复到该空间
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k === "mc.sidebarSpace" ? "cloud" : null),
    setItem: vi.fn(),
  });
});

afterEach(() => vi.unstubAllGlobals());

const render = (cloudProjects: CloudProject[], cloudProjectTasks: Record<string, CloudProjectTasks> = {}) =>
  renderToStaticMarkup(
    <Sidebar
      sessions={[]}
      archivedProjects={new Set()}
      currentId={null}
      attention={new Set()}
      sessionActive={false}
      connected
      status="已连接"
      mcConnection={{ phase: "connected", host: "monkeycode-ai.com" }}
      cloudTasks={[]}
      cloudProjects={cloudProjects}
      cloudProjectTasks={cloudProjectTasks}
      onLoadCloudProjectTasks={() => {}}
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

const idle: CloudProject = { id: "p-idle", name: "闲置项目", repo_url: "git@x:o/idle.git", tasks: [] };
const busy: CloudProject = {
  id: "p-busy",
  name: "在跑的项目",
  repo_url: "git@x:o/busy.git",
  tasks: [{ id: "t-run", title: "重做启动页", status: "processing" }],
};

describe("云端项目行的默认展开", () => {
  it("没有在跑任务的项目默认收起:不摊开、不占位", () => {
    const html = render([idle]);
    expect(html).toContain("闲置项目");
    expect(html).not.toContain("暂无任务");
    expect(html).toContain('aria-expanded="false"');
    // 新建入口留着:侧栏仍能直接在这个项目里起任务
    expect(html).toContain("在 闲置项目 中新建任务");
    // 悬停提示交代它是可以点开的
    expect(html).toContain("展开查看任务");
  });

  it("有在跑任务的项目照常默认展开,任务行渲染出来", () => {
    const html = render([busy]);
    expect(html).toContain("重做启动页");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("1 个进行中");
  });

  it("拉到过任务的项目按拉取结果显示条数(含已完成的历史任务)", () => {
    const html = render([busy], {
      "p-busy": {
        tasks: [
          { id: "t-run", title: "重做启动页", status: "processing" },
          { id: "t-done", title: "修复登录跳转", status: "finished" },
        ],
      },
    });
    expect(html).toContain("重做启动页");
    expect(html).toContain("修复登录跳转");
    expect(html).toContain("2 个任务");
  });
});
