import { describe, expect, it, vi } from "vitest";
import { inspectMcAccount } from "./mcaccount";

describe("inspectMcAccount", () => {
  it("未关联时只读取状态,不拉任务也不隐式登录", async () => {
    const tasks = vi.fn();
    const result = await inspectMcAccount(
      async () => ({ logged_in: false, host: "monkeycode-ai.com" }),
      tasks,
    );
    expect(result.tasks).toEqual([]);
    expect(tasks).not.toHaveBeenCalled();
  });

  it("已关联时拉取任务列表", async () => {
    const tasks = vi.fn(async () => ({ tasks: [{ id: "task-1", status: "processing" as const }] }));
    const historical = vi.fn(async () => ({ tasks: [{ id: "task-0", status: "finished" as const }] }));
    const projects = vi.fn(async () => ({ projects: [{ id: "project-1", name: "MonkeyCode" }] }));
    const result = await inspectMcAccount(
      async () => ({ logged_in: true, host: "monkeycode-ai.com", user: { name: "tester" } }),
      tasks,
      historical,
      projects,
    );
    expect(tasks).toHaveBeenCalledOnce();
    expect(result.tasks).toEqual([{ id: "task-1", status: "processing" }]);
    expect(result.historicalTasks).toEqual([{ id: "task-0", status: "finished" }]);
    expect(result.projects).toEqual([{ id: "project-1", name: "MonkeyCode" }]);
  });

  it("任务刷新失败不抹掉已关联账号状态", async () => {
    const result = await inspectMcAccount(
      async () => ({ logged_in: true, host: "monkeycode-ai.com" }),
      async () => {
        throw new Error("network down");
      },
      async () => ({ tasks: [] }),
      async () => ({ projects: [] }),
    );
    expect(result.status.logged_in).toBe(true);
    expect(result.taskError).toBe("network down");
    expect(result.tasks).toBeUndefined();
    expect(result.historicalTasks).toEqual([]);
  });

  it("快速任务倒序截 5 条,历史任务倒序全保留(不再切 5 条)", async () => {
    const source = Array.from({ length: 7 }, (_, index) => ({
      id: `task-${index}`,
      status: "finished" as const,
      created_at: index,
    }));
    const result = await inspectMcAccount(
      async () => ({ logged_in: true, host: "monkeycode-ai.com" }),
      async () => ({ tasks: source }),
      async () => ({ tasks: source }),
      async () => ({ projects: [] }),
    );

    expect(result.tasks?.map((task) => task.id)).toEqual(["task-6", "task-5", "task-4", "task-3", "task-2"]);
    expect(result.historicalTasks?.map((task) => task.id)).toEqual([
      "task-6", "task-5", "task-4", "task-3", "task-2", "task-1", "task-0",
    ]);
  });
});
