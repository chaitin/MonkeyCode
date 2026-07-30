const ARCHIVED_PROJECTS_KEY = "mc.archivedProjects";

/**
 * 项目归档是侧栏组织状态，不改动项目目录，也不覆盖目录内各会话自己的
 * archived 标记。路径只做分隔符和尾斜杠归一，保证 Windows / macOS /
 * Linux 写入的 key 与侧栏分组使用同一套语义。
 */
export function projectArchiveKey(workdir: string): string {
  const normalized = workdir.trim().replace(/\\/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

export function readArchivedProjects(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(ARCHIVED_PROJECTS_KEY) || "[]");
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map(projectArchiveKey)
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export function isProjectArchived(projects: ReadonlySet<string>, workdir: string): boolean {
  return projects.has(projectArchiveKey(workdir));
}

/** 返回新 Set，方便 React 可靠触发派生列表更新；写盘失败不阻断当前操作。 */
export function updateArchivedProjects(
  current: ReadonlySet<string>,
  workdir: string,
  archived: boolean,
): Set<string> {
  const next = new Set(current);
  const key = projectArchiveKey(workdir);
  if (!key) return next;
  if (archived) next.add(key);
  else next.delete(key);
  try {
    localStorage.setItem(ARCHIVED_PROJECTS_KEY, JSON.stringify([...next]));
  } catch {
    // WebView 存储不可写时仍保留本次内存状态，避免点击无反馈。
  }
  return next;
}
