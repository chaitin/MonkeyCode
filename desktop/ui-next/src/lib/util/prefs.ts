// 本机 UI 偏好(mc.* 命名空间,键名与取值格式 = 旧 UI 契约)。
// 模块顶层不碰 localStorage,只用 getItem/setItem。

export type Space = "local" | "cloud" | "chat";

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

/** 分屏(features/split;ui-next 新增,无旧 UI 契约):
 *  - mc.splitTree = 布局树 JSON(叶=槽位、内部节点=切分,词汇与校验的
 *    权威在 features/split/tree.ts——prefs 只做原始存取,不复刻树形状;
 *    2026-08-16 用户终案「让用户自定义,随便他搞」,固定档位模型退役);
 *  - mc.splitSlots = JSON (string|null)[](按需增长;启动时只恢复当前树引用
 *    的槽，异常稀疏编号压密；关闭格已显式清档,不保留无入口的离树长尾)。
 *  分屏开关本身刻意不持久化(启动恒常规视图,对齐「启动恒落本地任务」
 *  定案)。 */
export function readSplitTreeRaw(): unknown {
  try {
    return JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
  } catch {
    return null;
  }
}

export function writeSplitTree(tree: unknown): void {
  try {
    localStorage.setItem("mc.splitTree", JSON.stringify(tree));
  } catch {
    // 只丢持久化
  }
}

export function readSplitSlots(indices?: readonly number[]): (string | null)[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]");
    const arr = Array.isArray(parsed) ? parsed : [];
    const valid = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
    // 启动恢复已知树叶时只取树实际引用的槽：旧档的离树尾巴不再让每次渲染
    // 都扫描整份数组；无 indices 的纯存取调用仍逐位校验完整旧格式。
    return indices ? indices.map((index) => valid(arr[index])) : arr.map(valid);
  } catch {
    return [];
  }
}

export function writeSplitSlots(slots: readonly (string | null)[]): void {
  try {
    localStorage.setItem("mc.splitSlots", JSON.stringify(slots));
  } catch {
    // 只丢持久化
  }
}

/** 侧栏折叠段开合态("1"/"0" 取值 = 旧 UI 契约):归档会话 / 归档项目 /
 * 云端历史 / 待办组内「已完成」小节(ui-next 新增,默认收起)。
 * mc.workbenchListHidden(ui-next 新增):工作台任务列的收起态——**语义取
 * 反**(记"隐藏"不记"展开"),readFold 缺省 false 恰好落在「默认展开」
 * (2026-08-17 用户定案加列治「光秃秃」,首见就该看到它)。 */
export type FoldKey =
  | "mc.archivedOpen"
  | "mc.projectArchiveOpen"
  | "mc.cloudHistoryOpen"
  | "mc.todoDoneOpen"
  | "mc.workbenchListHidden";

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
