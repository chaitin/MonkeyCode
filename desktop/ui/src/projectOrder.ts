// 项目目录 key 与归档共用一套归一化语义(跨平台分隔符 + 尾斜杠),
// 不是归档专属;两处偏好指向同一个"项目"概念时必须同 key，否则
// Windows 写入的顺序在 macOS 读出来会全部落空。
import { projectArchiveKey } from "./projectArchive";

const PROJECT_ORDER_KEY = "mc.projectOrder";

/** 顺序数组里出现重复 key 会让 rank 表和落点下标对不上，入口处统一去重。 */
function normalizeKeys(dirs: readonly string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const key = projectArchiveKey(dir);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * 手动顺序是"全序快照":第一次拖动把当时可见的项目顺序整体固化，之后列表
 * 不再随会话活跃度浮动。空数组表示用户从未拖动过，此时保持按最近活跃排序。
 */
export function readProjectOrder(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_ORDER_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return normalizeKeys(value.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}

/** 写盘失败仍返回内存顺序，避免拖动看起来没生效。 */
export function persistProjectOrder(order: readonly string[]): string[] {
  const next = [...order];
  try {
    localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(next));
  } catch {
    // WebView 存储不可写时本次拖动仍在内存里生效，只是重启后回到活跃度排序。
  }
  return next;
}

/**
 * 把手动顺序覆盖到按最近活跃排好的分组上。order 里没有的项目是新项目——
 * 它们保持入参的活跃度相对序并排在最前，这样"刚开的项目"不会沉到列表底部。
 */
export function applyProjectOrder<T extends { dir: string }>(
  groups: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...groups];
  const rank = new Map(order.map((key, index) => [key, index]));
  const known: T[] = [];
  const fresh: T[] = [];
  for (const group of groups) {
    if (rank.has(projectArchiveKey(group.dir))) known.push(group);
    else fresh.push(group);
  }
  known.sort(
    (a, b) => (rank.get(projectArchiveKey(a.dir)) ?? 0) - (rank.get(projectArchiveKey(b.dir)) ?? 0),
  );
  return [...fresh, ...known];
}

/**
 * 提交一次拖动:用当前可见顺序重写整个快照。因为写的是全序，消失的项目
 * (已删除 / 已归档)自然被清出，不需要额外的过期清理。
 * toIndex 是"插到第几项之前"的缝隙下标(0..length，length 表示排到末尾)，
 * 越界值收敛到首尾;落在被拖项自身两侧的缝隙视为原位，不产生改动。
 */
export function reorderProjects(
  visibleDirs: readonly string[],
  fromDir: string,
  toIndex: number,
): string[] {
  const keys = normalizeKeys(visibleDirs);
  const fromKey = projectArchiveKey(fromDir);
  const from = keys.indexOf(fromKey);
  if (from < 0) return keys;
  const target = Math.max(0, Math.min(Math.trunc(toIndex), keys.length));
  if (target === from || target === from + 1) return keys;
  keys.splice(from, 1);
  // 被拖项移除后，落在它之后的目标位要左移一格才是用户看到的那条缝。
  keys.splice(target > from ? target - 1 : target, 0, fromKey);
  return keys;
}
