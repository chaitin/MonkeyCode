// 本机 UI 偏好(mc.* 命名空间,键名与取值格式 = 旧 UI 契约)。
// 模块顶层不碰 localStorage,只用 getItem/setItem。

export type Space = "local" | "cloud" | "chat" | "stats";

/** 启动落点恒为本地任务(用户定案 2026-08-09:「应用打开后默认选本地项目,
 *  不要选云端项目」)。所以**没有 readSpace** ——上次停在哪儿不再决定这次开在
 *  哪儿:云端是可能未登录/断网的空间,拿它当开机首屏,每次启动都是一个坏屏幕。
 *  writeSpace 仍然写:mc.sidebarSpace 是与旧 UI 共用的契约键(ui/src/sidebar.tsx
 *  仍会读它),并行期不能单方面停写。 */
export function writeSpace(space: Space): void {
  try {
    localStorage.setItem("mc.sidebarSpace", space);
  } catch {
    // 只丢持久化
  }
}

export function readLastSession(): string | null {
  try {
    return localStorage.getItem("mc.lastSession");
  } catch {
    return null;
  }
}

export function writeLastSession(id: string): void {
  try {
    localStorage.setItem("mc.lastSession", id);
  } catch {
    // 只丢持久化
  }
}

export function readLastTaskModel(): string | null {
  try {
    return localStorage.getItem("mc.lastTaskModel");
  } catch {
    return null;
  }
}

export function rememberLastTaskModel(model: string): void {
  try {
    localStorage.setItem("mc.lastTaskModel", model);
  } catch {
    // 只丢持久化
  }
}

/** 侧栏折叠段开合态("1"/"0" 取值 = 旧 UI 契约):归档会话 / 归档项目 / 云端历史。 */
export type FoldKey = "mc.archivedOpen" | "mc.projectArchiveOpen" | "mc.cloudHistoryOpen";

export function readFold(key: FoldKey): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeFold(key: FoldKey, open: boolean): void {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // 只丢持久化
  }
}
