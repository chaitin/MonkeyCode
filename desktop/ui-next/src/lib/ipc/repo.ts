// 会话 repo_* 查询:工作区只读文件浏览与 diff(壳内 repo.rs 原生处理,
// 不经引擎)。通道是 invoke("session_call", { id, kind, payload })——命令名
// 是字面量(契约守卫按正则扫它),kind 只是参数值;壳侧见 driver/mod.rs::
// session_call(repo_ 前缀分派 repo::dispatch,阻塞池 + 15s 超时)。
// 应答与内核 call-response 同构:{ result } / { error }(repo_file_changes
// 额外带平级 is_git_repo)。命令层 reject(会话不存在/超时)与 {error} 在
// 这里统一成异常;浏览器模式查询类降级空值、动作类照常抛错。
import { inDesktopShell, invoke } from "./ipc";

/** repo_file_list 目录项(单层;壳侧已目录在前、按名排序,.git 已剔除)。 */
export interface RepoEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

/** repo_file_changes 条目:status 本地只有 A/M/D(git porcelain 归并,
 * 重命名折算成新路径的 M);类型放宽到 string 给云端超集(R/RM/??)留位。 */
export interface RepoChange {
  path: string;
  status: string;
}

export interface RepoChangeSet {
  changes: RepoChange[];
  isGitRepo: boolean;
}

/** 壳侧线上形状(snake_case 字段是 serde 契约,别改名)。 */
interface WireEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface Envelope<T> {
  result?: T;
  error?: string;
  is_git_repo?: boolean;
}

function call<T>(id: string, kind: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
  return invoke<Envelope<T>>("session_call", { id, kind, payload });
}

function unwrap<T>(r: Envelope<T>, fallback: T): T {
  if (r.error) throw new Error(r.error);
  return r.result ?? fallback;
}

/** 列目录(单层,dir "" = 工作区根)。 */
export async function repoListDir(id: string, dir: string): Promise<RepoEntry[]> {
  if (!inDesktopShell()) return [];
  const r = await call<WireEntry[]>(id, "repo_file_list", { path: dir });
  return unwrap(r, []).map((e) => ({ name: e.name, path: e.path, isDir: e.is_dir, size: e.size }));
}

/** 读文件全文(壳侧 1MB 上限,超限/目录以 {error} 拒绝)。 */
export async function repoReadFile(id: string, path: string): Promise<string> {
  if (!inDesktopShell()) return "";
  const r = await call<{ path?: string; content?: string }>(id, "repo_read_file", { path });
  return unwrap(r, {}).content ?? "";
}

/** 单文件相对 HEAD 的 unified diff("" = 无差异;未跟踪文件是全新增 diff)。 */
export async function repoFileDiff(id: string, path: string): Promise<string> {
  if (!inDesktopShell()) return "";
  const r = await call<{ path?: string; diff?: string }>(id, "repo_file_diff", { path });
  return unwrap(r, {}).diff ?? "";
}

/** 相对 HEAD 的变更列表(含未跟踪);非 git 工作区 changes 空且 isGitRepo=false。 */
export async function repoChanges(id: string): Promise<RepoChangeSet> {
  if (!inDesktopShell()) return { changes: [], isGitRepo: false };
  const r = await call<RepoChange[]>(id, "repo_file_changes", {});
  return { changes: unwrap(r, []), isGitRepo: r.is_git_repo ?? false };
}

/** 在系统文件管理器中定位路径(动作类:浏览器模式随 invoke 一起 reject)。 */
export async function repoReveal(id: string, path: string): Promise<void> {
  const r = await call<{ ok?: boolean }>(id, "repo_reveal", { path });
  if (r.error) throw new Error(r.error);
}
