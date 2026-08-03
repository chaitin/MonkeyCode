// 云端任务域 REST(壳命令代理 mc_task_* / mc_upload / mc_file_* /
// mc_terminal_list)。类型字段名 = 壳侧(monkeycode.rs)响应实形;云端任务
// 数据对壳不透明(Value 直通),故全部可缺省。命令名保持字面量(契约守卫
// 正则);浏览器模式 invoke 直接 reject,由视图 err 外显。
import type { Frame } from "@/lib/protocol/types";
import { invoke, tauri } from "./ipc";

/** 云端任务(backend ProjectTask 的侧栏子集)。实测线上 title 常为空、
 * 任务文案落在 summary,展示优先 title → summary → content。 */
export interface CloudTask {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  status?: "pending" | "processing" | "error" | "finished";
  created_at?: number;
  completed_at?: number;
  updated_at?: number;
  extra?: { project_id?: string; [key: string]: unknown };
}

export interface CloudTasksResp {
  tasks?: CloudTask[];
  page_info?: { total?: number; total_count?: number };
}

/** 云端项目(mc_projects 响应条目;与 Web 侧栏同一接口)。列表接口每个
 * 项目只捎带 ≤3 条**运行中**任务(后端按 pending/processing 过滤),历史
 * 任务一条都没有——"tasks 为空"多半只是"此刻没有在跑的"。 */
export interface CloudProject {
  id?: string;
  name?: string;
  description?: string;
  full_name?: string;
  repo_url?: string;
  created_at?: number;
  updated_at?: number;
  tasks?: CloudTask[];
}

export interface CloudProjectsResp {
  projects?: CloudProject[];
  page?: { cursor?: string; has_more?: boolean };
}

/** 云端任务详情(ProjectTask 子集;VM 准备进度在 virtualmachine.conditions)。 */
export interface CloudTaskDetail extends CloudTask {
  model?: { id?: string; model?: string; remark?: string };
  branch?: string;
  repo_url?: string;
  full_name?: string;
  stats?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; llm_requests?: number };
  virtualmachine?: {
    id?: string;
    status?: string;
    conditions?: VmCondition[];
  };
}

/** VM 准备阶段条目(启动时间线数据源)。status:0 未知/1 进行中/2 完成/3 失败。 */
export interface VmCondition {
  type?: string;
  status?: number;
  message?: string;
  progress?: number;
}

/** 提问索引条目(大纲数据源;content 已解码明文,timestamp 纳秒)。 */
export interface CloudUserInputItem {
  id?: string;
  content?: string;
  timestamp?: number;
  seq?: number;
  truncated?: boolean;
}

export interface CloudUserInputsResp {
  items?: CloudUserInputItem[];
  next_cursor?: string;
  has_more?: boolean;
}

// ---- 建任务选项(mc_task_options 响应实形) ----

export interface McCloudModel {
  id?: string;
  model?: string;
  remark?: string;
  weight?: number;
  is_default?: boolean;
  is_hidden?: boolean;
  owner?: { type?: "private" | "public" | "team"; id?: string; name?: string };
  /** 超会员档:展示但禁选(派生字段,见 lib/cloud/options.ts,非服务端下发) */
  locked?: boolean;
}

export interface McCloudImage {
  id?: string;
  name?: string;
  remark?: string;
  is_default?: boolean;
  owner?: { type?: string };
}

export interface McCloudHost {
  id?: string;
  name?: string;
  remark?: string;
  external_ip?: string;
  status?: string;
  is_default?: boolean;
  owner?: { type?: string };
}

export interface McTaskOptions {
  models: McCloudModel[];
  images: McCloudImage[];
  hosts: McCloudHost[];
  /** 可关联的云端项目(建任务时选它 = 复用已克隆的仓库) */
  projects: CloudProject[];
  plan: string; // basic | pro | ultra | flagship | ""
  /** 服务端下发的建任务档位(host_id/cli_name/resource/skill_ids);当前
   * 真实云端无此字段,壳内常量兜底(mc_task_create 侧取用)。 */
  task_defaults?: { host_id?: string; [key: string]: unknown };
}

// ==================== REST 封装 ====================

export const mcTasks = (
  page = 1,
  size = 20,
  status = "",
  options: { projectId?: string; quickStart?: boolean } = {},
) =>
  invoke<CloudTasksResp>("mc_tasks", {
    page,
    size,
    status,
    projectId: options.projectId ?? null,
    quickStart: options.quickStart ?? null,
  });

/** 项目列表(壳侧固定 limit=50;每项目捎带 ≤3 条运行中任务,见 CloudProject)。 */
export const mcProjects = () => invoke<CloudProjectsResp>("mc_projects");

export const mcTaskInfo = (id: string) => invoke<CloudTaskDetail>("mc_task_info", { id });

/** 历史回放:壳已把云端 chunk 归一为 Frame 词汇(event→type,ns→ms)。
 * 一次一轮(对齐移动端);cursor 往更早翻,壳侧 limit 上限 10。 */
export const mcTaskRounds = (id: string, cursor = "", limit = 1) =>
  invoke<{ frames: Frame[]; next_cursor?: string; has_more?: boolean }>("mc_task_rounds", { id, cursor, limit });

/** 提问索引(倒序,cursor 向更早翻;大纲数据源,content 已解码明文)。 */
export const mcTaskUserInputs = (id: string, cursor = "", limit = 100) =>
  invoke<CloudUserInputsResp>("mc_task_user_inputs", { id, cursor, limit });

/** 终止云端任务(区别于流上行 user-cancel:那只中断当前执行)。 */
export const mcTaskStop = (id: string) => invoke<{ ok: boolean }>("mc_task_stop", { id });

export const mcTaskDelete = (id: string) => invoke<{ ok: boolean }>("mc_task_delete", { id });

/** 创建云端任务(壳补默认档位:公共宿主机/opencode/2核8G3小时/官方技能)。 */
export const mcTaskCreate = (req: {
  content: string;
  model_id: string;
  host_id: string;
  image_id: string;
  repo_url?: string;
  branch?: string;
  project_id?: string;
}) => invoke<CloudTaskDetail>("mc_task_create", { req });

export const mcTaskOptions = () => invoke<McTaskOptions>("mc_task_options");

/** 云端聊天附件上传(壳内 presign + 直传对象存储;data 为 base64 文件字节)。
 * 返回的 access_url 放进 user-input 的 attachments。 */
export const mcUpload = (filename: string, dataB64: string) =>
  invoke<{ access_url: string }>("mc_upload", { filename, data: dataB64 });

/** 上传文件到云端任务 VM 工作区(壳代理 multipart)。path 为 VM 内绝对
 * 路径(如 /workspace/dir/name.txt)。 */
export const mcFileUpload = (vmId: string, path: string, dataB64: string) =>
  invoke<{ ok: boolean }>("mc_file_upload", { vmId, path, data: dataB64 });

/** 虚拟机终端 session 列表(终端面板打开时复用已有会话,对齐 web 行为)。 */
export const mcTerminalList = (vmId: string) =>
  invoke<{ terminals?: { id?: string; title?: string; created_at?: number; connected_count?: number }[] }>(
    "mc_terminal_list",
    { vmId },
  );

// 注:mc_file_download / mc_file_download_cancel 不在此重复封装——下载統一
// 走 lib/ipc/downloads.startDownload(含 dl-progress 先监听后命令的铁律)。

// ==================== 视图侧小工具(云端文件页共用) ====================

/** 文件 → base64 字节串(FileReader dataURL 去头;mc_upload/mc_file_upload 的
 * data 参数形态)。 */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** 原生「另存为」对话框(下载落点);取消/浏览器模式返回 null。
 * 裸文件名作 defaultPath 会被解析成相对进程 CWD(Windows 上用户根本找不到):
 * 默认落系统「下载」目录,目录拿不到才退回裸文件名。 */
export async function pickSaveFile(defaultName: string): Promise<string | null> {
  const g = tauri();
  if (!g?.core?.invoke) return null;
  let defaultPath = defaultName;
  try {
    const path = (g as { path?: { downloadDir?: () => Promise<string>; join?: (...p: string[]) => Promise<string> } }).path;
    const dir = await path?.downloadDir?.();
    if (dir) defaultPath = (await path?.join?.(dir, defaultName)) ?? defaultPath;
  } catch {
    // 平台拿不到下载目录:保持裸文件名
  }
  try {
    const r = await invoke<unknown>("plugin:dialog|save", { options: { defaultPath } });
    return typeof r === "string" ? r : null;
  } catch {
    return null;
  }
}
