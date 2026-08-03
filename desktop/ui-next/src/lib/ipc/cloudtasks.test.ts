// 云端任务域 REST 封装:命令名与参数按壳侧契约透传(camelCase 由 Tauri 映射)。
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mcFileUpload,
  mcProjects,
  mcTaskCreate,
  mcTaskDelete,
  mcTaskInfo,
  mcTaskOptions,
  mcTaskRounds,
  mcTasks,
  mcTaskStop,
  mcTaskUserInputs,
  mcTerminalList,
  mcUpload,
} from "./cloudtasks";

afterEach(() => vi.unstubAllGlobals());

function stubInvoke() {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return Promise.resolve({});
        },
      },
    },
  });
  return calls;
}

describe("mc_task_* 封装", () => {
  it("命令名与参数透传(mc_tasks 默认页参;可选筛选补 null)", async () => {
    const calls = stubInvoke();
    await mcTasks();
    await mcTasks(2, 50, "finished", { projectId: "p1", quickStart: true });
    await mcTaskInfo("t1");
    await mcTaskRounds("t1", "cur", 10);
    await mcTaskRounds("t1");
    await mcTaskUserInputs("t1");
    await mcTaskStop("t1");
    await mcTaskDelete("t1");
    await mcProjects();
    await mcTerminalList("vm1");
    expect(calls).toEqual([
      { cmd: "mc_tasks", args: { page: 1, size: 20, status: "", projectId: null, quickStart: null } },
      { cmd: "mc_tasks", args: { page: 2, size: 50, status: "finished", projectId: "p1", quickStart: true } },
      { cmd: "mc_task_info", args: { id: "t1" } },
      { cmd: "mc_task_rounds", args: { id: "t1", cursor: "cur", limit: 10 } },
      { cmd: "mc_task_rounds", args: { id: "t1", cursor: "", limit: 1 } },
      { cmd: "mc_task_user_inputs", args: { id: "t1", cursor: "", limit: 100 } },
      { cmd: "mc_task_stop", args: { id: "t1" } },
      { cmd: "mc_task_delete", args: { id: "t1" } },
      { cmd: "mc_projects", args: undefined },
      { cmd: "mc_terminal_list", args: { vmId: "vm1" } },
    ]);
  });

  it("mc_task_create 包 req;上传命令带 base64 数据", async () => {
    const calls = stubInvoke();
    await mcTaskCreate({ content: "做点事", model_id: "m1", host_id: "public_host", image_id: "i1" });
    await mcTaskOptions();
    await mcUpload("a.png", "QUJD");
    await mcFileUpload("vm1", "/workspace/a.txt", "QUJD");
    expect(calls).toEqual([
      {
        cmd: "mc_task_create",
        args: { req: { content: "做点事", model_id: "m1", host_id: "public_host", image_id: "i1" } },
      },
      { cmd: "mc_task_options", args: undefined },
      { cmd: "mc_upload", args: { filename: "a.png", data: "QUJD" } },
      { cmd: "mc_file_upload", args: { vmId: "vm1", path: "/workspace/a.txt", data: "QUJD" } },
    ]);
  });

  it("浏览器模式:invoke reject(视图 err 外显,不静默)", async () => {
    vi.stubGlobal("window", {});
    await expect(mcTaskInfo("t1")).rejects.toThrow();
  });
});
