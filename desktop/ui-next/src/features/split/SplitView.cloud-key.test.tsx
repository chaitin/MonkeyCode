import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CloudTasksFeed } from "@/features/cloud/CloudTaskList";
import type { CloudTask } from "@/lib/ipc/cloudtasks";
import type { SessionMeta } from "@/lib/ipc/sessions";
import { cloudSlotId } from "./slots";
import { SplitView } from "./SplitView";
import { useSplitState } from "./useSplitState";

const lifecycle = vi.hoisted(() => ({ mounts: [] as string[], unmounts: [] as string[] }));

// 这里只测 SplitView 给子视图的 React identity；云任务本身的数据面已有独立
// 测试。空依赖 effect 能精确观察 task id 是否真的触发了卸载/重挂。
vi.mock("@/features/cloud/CloudTaskView", async () => {
  const React = await import("react");
  return {
    CloudTaskView: ({ task }: { task: { id: string } }) => {
      React.useEffect(() => {
        lifecycle.mounts.push(task.id);
        return () => {
          lifecycle.unmounts.push(task.id);
        };
      }, []);
      return React.createElement("div", { "data-cloud-probe": task.id }, task.id);
    },
  };
});

const tasks: CloudTask[] = [
  { id: "cloud-a", title: "云任务 A", status: "pending" },
  { id: "cloud-b", title: "云任务 B", status: "pending" },
];

const feed: CloudTasksFeed = {
  tasks,
  active: tasks,
  history: [],
  loading: false,
  error: "",
  unauthorized: false,
  total: 2,
  hasMore: false,
  loadMore: () => {},
  refresh: () => {},
};

function Harness() {
  const split = useSplitState();
  return (
    <>
      <button type="button" onClick={() => split.assignTo(0, cloudSlotId("cloud-b"))}>
        切到 B
      </button>
      <SplitView
        sessions={[] as SessionMeta[]}
        split={split}
        epoch={0}
        focusRequest={0}
        onFocusRequestHandled={() => {}}
        onAssign={(slot, id) => split.assignTo(slot, id)}
        onLoadSession={(id) => split.place(id)}
        onCreatedInSlot={(slot, created) => split.assignTo(slot, created.id)}
        onCloudCreatedInSlot={() => {}}
        onOpenSettings={() => {}}
        recentDirs={[]}
        cloud={{ feed, projects: [], reloadKey: 0, onDeleted: () => {}, onChanged: () => {} }}
      />
    </>
  );
}

beforeEach(() => {
  lifecycle.mounts.length = 0;
  lifecycle.unmounts.length = 0;
  localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: 0 }));
  localStorage.setItem("mc.splitSlots", JSON.stringify([cloudSlotId("cloud-a"), null, null, null, null, null]));
});

afterEach(() => localStorage.clear());

describe("云 pane React identity", () => {
  it("同一槽从任务 A 换成 B 时按 task id 卸载重挂", async () => {
    render(<Harness />);
    await waitFor(() => expect(lifecycle.mounts).toEqual(["cloud-a"]));
    await userEvent.click(screen.getByRole("button", { name: "切到 B" }));
    await waitFor(() => expect(lifecycle.mounts).toEqual(["cloud-a", "cloud-b"]));
    expect(lifecycle.unmounts).toContain("cloud-a");
  });
});
