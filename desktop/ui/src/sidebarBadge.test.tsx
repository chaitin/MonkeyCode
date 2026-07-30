import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "./sidebar";

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});

afterEach(() => vi.unstubAllGlobals());

describe("Sidebar rail badges", () => {
  it("云端存在运行任务时也不展示数字角标", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        sessions={[]}
        archivedProjects={new Set()}
        currentId={null}
        attention={new Set()}
        sessionActive={false}
        connected={false}
        status="未连接"
        mcConnection={{ phase: "connected", host: "monkeycode-ai.com" }}
        cloudTasks={[{ id: "cloud-running", status: "processing" }]}
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

    const cloudRailButton = html.match(/<button[^>]*title="切换到云端"[\s\S]*?<\/button>/)?.[0];
    expect(cloudRailButton).toBeDefined();
    expect(cloudRailButton).not.toContain("position:absolute");
  });
});
