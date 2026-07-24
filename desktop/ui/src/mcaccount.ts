// MonkeyCode 账号探测只读取既有会话和任务,刻意不接收登录函数。
// 因此启动、聚焦和定时刷新都不可能隐式用百智云账号创建 MonkeyCode 会话。
import { mcProjects, mcStatus, mcTasks } from "./cloudapi";
import type { CloudProject, CloudProjectsResp, CloudTask, CloudTasksResp, McStatus } from "./types";

export interface McAccountSnapshot {
  status: McStatus;
  /** 未关联项目的运行中快速任务。失败时缺省，调用方保留上次结果。 */
  tasks?: CloudTask[];
  historicalTasks?: CloudTask[];
  projects?: CloudProject[];
  /** 账号仍已关联、但任务列表本次刷新失败。 */
  taskError?: string;
}

/** 与 Web 侧栏一致：快速任务和历史任务只保留最近 5 条。 */
function recentTasks(response: CloudTasksResp): CloudTask[] {
  return [...(response.tasks ?? [])]
    .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
    .slice(0, 5);
}

export async function inspectMcAccount(
  getStatus: () => Promise<McStatus> = mcStatus,
  getTasks: () => Promise<CloudTasksResp> = () => mcTasks(1, 50, "pending,processing", { quickStart: true }),
  getHistoricalTasks: () => Promise<CloudTasksResp> = () => mcTasks(1, 50, "error,finished"),
  getProjects: () => Promise<CloudProjectsResp> = mcProjects,
): Promise<McAccountSnapshot> {
  const status = await getStatus();
  if (!status.logged_in) return { status, tasks: [], historicalTasks: [], projects: [] };

  const [active, historical, projects] = await Promise.allSettled([
    getTasks(),
    getHistoricalTasks(),
    getProjects(),
  ]);
  const errors = [active, historical, projects]
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
  return {
    status,
    ...(active.status === "fulfilled" ? { tasks: recentTasks(active.value) } : {}),
    ...(historical.status === "fulfilled" ? { historicalTasks: recentTasks(historical.value) } : {}),
    ...(projects.status === "fulfilled" ? { projects: projects.value.projects ?? [] } : {}),
    ...(errors.length ? { taskError: errors.join("；") } : {}),
  };
}
