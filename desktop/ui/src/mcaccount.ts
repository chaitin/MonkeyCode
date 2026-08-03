// MonkeyCode 账号探测只读取既有会话和任务,刻意不接收登录函数。
// 因此启动、聚焦和定时刷新都不可能隐式用百智云账号创建 MonkeyCode 会话。
// 账号权益(额度/签到/邀请)不在这里:它只在设置页可见,挂进这条 30 秒
// 轮询等于为一块看不见的面板长期空跑请求,改由设置页挂载时自取。
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

/** 快速任务与 Web 侧栏一致只保留最近 5 条(顶层平铺,多了是噪音);
 * 历史任务在可折叠分组里,一页(50 条)全展示——切 5 条会让更早的任务
 * 从桌面上彻底消失,连搜索都搜不到。 */
function recentTasks(response: CloudTasksResp, cap?: number): CloudTask[] {
  const sorted = [...(response.tasks ?? [])].sort(
    (a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0),
  );
  return cap === undefined ? sorted : sorted.slice(0, cap);
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
    ...(active.status === "fulfilled" ? { tasks: recentTasks(active.value, 5) } : {}),
    ...(historical.status === "fulfilled" ? { historicalTasks: recentTasks(historical.value) } : {}),
    ...(projects.status === "fulfilled" ? { projects: projects.value.projects ?? [] } : {}),
    ...(errors.length ? { taskError: errors.join("；") } : {}),
  };
}
