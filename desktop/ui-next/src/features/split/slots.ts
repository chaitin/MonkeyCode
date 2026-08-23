// 分屏槽位纯逻辑:按需增长的 (sid | null)[]。哪些槽位可见由布局树
// (tree.ts)的叶集决定；启动恢复会把树叶与槽位一并压密，运行期关闭格
// 则显式清掉内容。设计定案见
// docs/superpowers/specs/2026-08-16-desktop-split-view-design.md。
// 判定与变换全是纯函数,useSplitState 只做接线,产品语义单测钉在这里。
export type Slots = readonly (string | null)[];

/** 槽位条目 = 「带记号的 id」:本地任务/会话 = 裸 sid;云端任务 =
 *  "c:" + taskId(工作台升主界面后云端也入格,2026-08-18 用户定案)。
 *  槽位机(判重/换位/持久化/place)对记号透明,只有渲染与打开路径分流;
 *  云端 taskId 与壳 sid 分属两个命名空间,前缀防撞。 */
export const CLOUD_PREFIX = "c:";
export const cloudSlotId = (taskId: string): string => CLOUD_PREFIX + taskId;
export const isCloudSlotId = (v: string): boolean => v.startsWith(CLOUD_PREFIX);
export const cloudTaskIdOf = (v: string): string => v.slice(CLOUD_PREFIX.length);

export const emptySlots = (): Slots => [];

/** 装载(move 语义):**同一会话禁止双格并存**——session_close 无引用
 *  计数,先卸载的那个实例会把另一格的实时流掐断(壳侧 session.rs 把
 *  opened 置 false 是按会话不是按订阅方)。装载前先把该会话从其他槽摘掉,
 *  判重收口在此单点,调用方不必各自防。 */
export function assign(slots: Slots, index: number, id: string): Slots {
  if (!Number.isSafeInteger(index) || index < 0) return slots;
  const length = Math.max(slots.length, index + 1);
  return Array.from({ length }, (_, i) => (i === index ? id : slots[i] === id ? null : (slots[i] ?? null)));
}

export function eject(slots: Slots, index: number): Slots {
  if (!slots[index]) return slots;
  return slots.map((s, i) => (i === index ? null : s));
}

/** MonkeyCode transport 切换后清掉全部云端槽位。task id 只在当前服务/
 * 账号命名空间内有意义，持久化到下一代 transport 会把旧账号任务误装进
 * 新账号。无云端槽时保留引用，避免白落盘。 */
export function ejectCloud(slots: Slots): Slots {
  if (slots.every((s) => !s || !isCloudSlotId(s))) return slots;
  return slots.map((s) => (s && isCloudSlotId(s) ? null : s));
}

/** 会话表剪枝:被删会话的槽退回空槽。只许用**成功加载**的全表调用——
 *  失败时拿空表来剪等于把所有槽清空(与 App「失败不能用空结果覆盖列表」
 *  同一条铁律,守卫在调用方 refresh 的成功分支)。**云端槽位不剪**:
 *  alive 是壳的本地会话表,云端 feed 只有第一页,拿它剪历史云端任务
 *  必误伤。无变化返回原引用。 */
export function prune(slots: Slots, alive: ReadonlySet<string>): Slots {
  if (slots.every((s) => !s || isCloudSlotId(s) || alive.has(s))) return slots;
  return slots.map((s) => (s && (isCloudSlotId(s) || alive.has(s)) ? s : null));
}

/** 可见槽位序(布局树的叶集,阅读序)里第一个空槽(toast 路由的首选
 *  落点);无空槽返回 null。 */
export function firstEmptyIn(slots: Slots, indices: readonly number[]): number | null {
  for (const i of indices) if (slots[i] == null) return i;
  return null;
}

/** 首开播种(设计「初始态」):槽位全空且有当前会话 → 首叶带入——
 *  从哪来先看哪,不出现"点开全是空白"的断裂;有存档则原样恢复。 */
export function seed(slots: Slots, currentId: string | null, target = 0): Slots {
  if (!currentId || slots.some(Boolean)) return slots;
  return assign(slots, target, currentId);
}

/** 工作台 dnd 协议(私有 MIME;住此纯模块防 cloud↔split 循环依赖):
 *  SWAP = 按住格头标题换位;LOAD = 任务列/云端列表行拖进格定点装载。 */
export const SWAP_MIME = "application/x-mc-split-slot";
export const LOAD_MIME = "application/x-mc-split-load";
