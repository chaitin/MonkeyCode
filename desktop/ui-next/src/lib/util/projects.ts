// 侧栏项目分组的纯逻辑:key 归一化、手动排序与项目归档的持久化、分组计算。
// localStorage 键与取值格式 = 旧 UI 契约(mc.projectOrder / mc.archivedProjects
// 均为 JSON string[],key 做跨平台归一),换 UI 不丢用户的整理成果。
import type { SessionMeta } from "@/lib/ipc/sessions";

const ORDER_KEY = "mc.projectOrder";
const ARCHIVED_KEY = "mc.archivedProjects";

/** 项目 key:分隔符统一为 `/`、去尾斜杠("/" 本身除外)。
 *  Windows 写入的顺序在 macOS 读出来必须还认识,靠这套归一。 */
export function projectKey(workdir: string): string {
  const normalized = workdir.trim().replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

/** 项目展示名 = 目录末段。 */
export function projectName(workdir: string): string {
  const key = projectKey(workdir);
  return key.split("/").filter(Boolean).at(-1) ?? key;
}

function readStringArray(storageKey: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function dedupeKeys(dirs: readonly string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const key = projectKey(dir);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** 手动顺序是"全序快照":空数组 = 用户从未拖动,保持按活跃度排序。 */
export function readProjectOrder(): string[] {
  return dedupeKeys(readStringArray(ORDER_KEY));
}

export function writeProjectOrder(keys: readonly string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(dedupeKeys(keys)));
  } catch {
    // 只丢持久化
  }
}

export function readArchivedProjects(): Set<string> {
  return new Set(dedupeKeys(readStringArray(ARCHIVED_KEY)));
}

export function writeArchivedProjects(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(ARCHIVED_KEY, JSON.stringify([...keys]));
  } catch {
    // 只丢持久化
  }
}

/** 拖拽落点计算:把 dragged 移到 before 之前(before 为 null 即移到末尾)。 */
export function reorderKeys(keys: readonly string[], dragged: string, before: string | null): string[] {
  const rest = keys.filter((k) => k !== dragged);
  if (before === null || !rest.includes(before)) return [...rest, dragged];
  const at = rest.indexOf(before);
  return [...rest.slice(0, at), dragged, ...rest.slice(at)];
}

const COLLAPSED_KEY = "mc.collapsedGroups";

/** 读时归一:旧 UI 这一键写的是**裸 workdir**(sidebar.tsx `toggleGroup(group.dir)`),
 *  而本工程一律写 `projectKey`。Windows 上 `C:\work\demo` 与 `C:/work/demo` 永不
 *  相等,不归一就是「从旧版升上来,之前收起的项目组全变回展开」。同一文件里
 *  mc.archivedProjects 走的就是这条(旧 UI 自己也 `.map(projectArchiveKey)`),
 *  折叠态是漏的那一处。归一同时让残留的裸路径条目在下次写盘时自然收敛。 */
export function readCollapsedGroups(): Set<string> {
  return new Set(dedupeKeys(readStringArray(COLLAPSED_KEY)));
}

export function writeCollapsedGroups(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(dedupeKeys([...keys])));
  } catch {
    // 只丢持久化
  }
}

/** 各项目「已归档任务」小节的展开集(键 = 项目 key;JSON string[] = 旧 UI 契约)。
 *  与 collapsedGroups 同款归一:旧 UI 这一键走的是 projectArchiveKey(已归一),
 *  这里保持同口径,顺带兜住手写/迁移进来的裸路径。 */
const SESSION_ARCHIVES_KEY = "mc.sessionArchivesOpen";

export function readSessionArchivesOpen(): Set<string> {
  return new Set(dedupeKeys(readStringArray(SESSION_ARCHIVES_KEY)));
}

export function writeSessionArchivesOpen(keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SESSION_ARCHIVES_KEY, JSON.stringify(dedupeKeys([...keys])));
  } catch {
    // 只丢持久化
  }
}

export interface ProjectGroup {
  key: string;
  name: string;
  sessions: SessionMeta[];
  archivedSessions: SessionMeta[];
}

export interface GroupedSessions {
  projects: ProjectGroup[];
  archivedProjects: ProjectGroup[];
}

/** local 空间分组:按项目聚合 → 组内任务按最近活动(updated_at)倒序 →
 * 未入手动序的项目按组内最近活跃排在最前、其后按手动序 → 项目归档与会话
 * 归档各自折叠。传入前先按空间过滤(kind)。 */
export function groupSessions(
  sessions: readonly SessionMeta[],
  order: readonly string[],
  archivedProjects: ReadonlySet<string>,
): GroupedSessions {
  const byProject = new Map<string, ProjectGroup>();
  for (const meta of sessions) {
    const key = projectKey(meta.workdir);
    let group = byProject.get(key);
    if (!group) {
      group = { key, name: projectName(meta.workdir), sessions: [], archivedSessions: [] };
      byProject.set(key, group);
    }
    (meta.archived ? group.archivedSessions : group.sessions).push(meta);
  }

  // 项目内任务按最近活动(updated_at)倒序:壳侧 sessions_list 本就按
  // updated_at 倒序返回,但 App 的增量补丁只改时间戳不动数组位置
  // (App.tsx onSessionEvent),后台任务一收尾组内顺序就停在事件之前——
  // 项目组浮上去了,任务本身还埋在组里旧位置。RFC3339 同格式字符串可直比。
  const byActivity = (a: SessionMeta, b: SessionMeta) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  for (const group of byProject.values()) {
    group.sessions.sort(byActivity);
    group.archivedSessions.sort(byActivity);
  }

  const activity = (group: ProjectGroup): string =>
    [...group.sessions, ...group.archivedSessions].reduce((max, m) => {
      const at = m.updated_at ?? "";
      return at > max ? at : max;
    }, "");

  const all = [...byProject.values()].sort((a, b) => activity(b).localeCompare(activity(a)));
  const rank = new Map(order.map((key, i) => [key, i]));
  all.sort((a, b) => {
    const ra = rank.get(a.key);
    const rb = rank.get(b.key);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra === undefined && rb === undefined) return 0; // 都不在手动序里:保持活跃度序(sort 稳定)
    // **未入序的排在最前**(旧 UI projectOrder.ts::`[...fresh, ...known]`)。
    // mc.projectOrder 是全序快照:一次拖拽就把当时全部可见项目写进去,此后
    // 任何新目录(以及取消归档回来的项目——快照里只有当时可见的非归档 key)
    // 都 rank=undefined。若让它们追尾,「拖过一次顺序」之后新建的项目一律
    // 沉到列表最底、项目一多就掉出首屏,而它恰恰是此刻最该在眼前的那个。
    return ra === undefined ? -1 : 1;
  });

  const projects: ProjectGroup[] = [];
  const archived: ProjectGroup[] = [];
  for (const group of all) (archivedProjects.has(group.key) ? archived : projects).push(group);
  return { projects, archivedProjects: archived };
}
