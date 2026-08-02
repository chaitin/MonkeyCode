// App 壳层的纯判定:主区视图选择、窗口上下文文案、模型菜单兜底、全局
// 快捷键路由。全部是无副作用函数(不触 React/DOM),供 App.tsx 与单测共用
// ——快捷键这一块尤其吃亏于"藏在 860 行组件里的 40 行 if 链":⏎ 允许 /
// esc 拒绝都是不可逆动作,守卫改错没有任何东西会拦住(见 appView.test.ts)。
import { sameModelName } from "./modelMenu";
import type { CloudTask, ModelInfo, SessionMeta } from "./types";

export type AppMainView = "new" | "session" | "settings" | "cloud";

/** 关闭浮层视图(设置/云端任务/删除当前会话)后回落到哪一屏:有打开的
 * 本地会话就回会话,否则回新建任务。四处收口在此,免得漏改一处。 */
export function fallbackView(sessionId: string | null): AppMainView {
  return sessionId ? "session" : "new";
}

/** 主区是否渲染新建任务页:显式选了 new,或压根没有打开的会话
 * (审批快捷键的守卫之一——没有会话就没有可应答的审批) */
export function isNewTaskView(view: AppMainView, sessionId: string | null): boolean {
  return view === "new" || sessionId === null;
}

/** 原生窗口标题的上下文文案(视图 → 当前对象逐级回退;经 setWindowTitle
 * 写给系统,Alt-Tab/任务栏/Mission Control 可见——窗口内不再复述) */
export function windowContextLabel(
  view: AppMainView,
  cloudTask: Pick<CloudTask, "title" | "summary" | "content"> | null,
  currentMeta: Pick<SessionMeta, "title" | "kind"> | undefined,
): string {
  if (view === "settings") return "设置";
  if (view === "cloud") return cloudTask?.title || cloudTask?.summary || cloudTask?.content || "云端任务";
  if (view === "session" && currentMeta) return currentMeta.title || (currentMeta.kind === "chat" ? "会话" : "本地任务");
  return "新建任务";
}

/** 模型菜单清单:会话在用的模型已从配置里下线时补一条兜底项,
 * 否则下拉里选不中当前模型(无 source 归「自定义」组) */
export function modelMenuList(models: ModelInfo[], sessionModel: string): ModelInfo[] {
  // 宽松比较:老会话记的是加来源后缀之前的裸名,那不算"模型已下线"
  return sessionModel && !models.some((m) => m.name === sessionModel || sameModelName(m.name, sessionModel))
    ? [...models, { name: sessionModel, default: false }]
    : models;
}

// ==================== 全局快捷键 ====================

/** 按键事件里判定所需的一切(DOM 读取在 App 侧做完再传进来) */
export interface KeyContext {
  key: string;
  shiftKey?: boolean;
  /** 输入法组合中:⏎/esc 属于候选词交互,不能当审批应答 */
  isComposing?: boolean;
  /** 事件目标的标签名(输入态判定;无目标传 undefined) */
  targetTag?: string;
  /** 目标落在 xterm 容器内(云端 shell 的 esc 要透传给 vim 等) */
  inTerminal?: boolean;
  view: AppMainView;
  sessionId: string | null;
  /** 子代理回放浮层已打开 */
  childOpen: boolean;
  /** 文件抽屉已打开 */
  drawerOpen: boolean;
  /** 待应答的审批卡 id(无则 null) */
  openPermId: string | null;
  /** composer 里已输入的内容(⏎ 不抢正在写的消息) */
  inputText: string;
}

/** preventDefault 提到交集里:调用方一句 `if (action.preventDefault)` 收口,
 * 不用按 type 逐个记哪些要拦默认行为 */
export type KeyAction = { preventDefault?: true } & (
  | { type: "none" }
  | { type: "toggle-yolo" }
  | { type: "close-child" }
  /** 抽屉的 esc 分两级:调用方先让文件查看器自己收 esc,没收才关抽屉 */
  | { type: "close-drawer" }
  /** 输入态 esc 只收敛焦点(尤其不能当审批拒绝——deny 不可逆) */
  | { type: "blur" }
  | { type: "close-settings" }
  | { type: "close-cloud" }
  | { type: "answer-perm"; id: string; action: "allow" | "deny" }
);

const NONE: KeyAction = { type: "none" };

/** esc 的输入态含 SELECT(下拉展开时 esc 归下拉),⏎ 不含
 * (原生 select 不吃 ⏎,把它算输入态会吞掉审批快捷键) */
const isTyping = (tag: string | undefined, withSelect: boolean) =>
  tag === "TEXTAREA" || tag === "INPUT" || (withSelect && tag === "SELECT");

/**
 * 全局快捷键路由:⇧⇥ 权限模式、⏎/esc 应答审批、esc 关闭浮层。
 * 顺序即优先级——浮层(子会话 → 抽屉)先吃 esc,其次是输入态收敛焦点,
 * 最后才是视图级动作与审批应答。
 */
export function resolveKeyAction(ctx: KeyContext): KeyAction {
  if (ctx.key === "Tab" && ctx.shiftKey && ctx.view === "session" && ctx.sessionId) {
    return { preventDefault: true, type: "toggle-yolo" };
  }
  if (ctx.key === "Escape") {
    if (ctx.childOpen) return { type: "close-child" };
    if (ctx.drawerOpen) return { type: "close-drawer" };
    const typing = isTyping(ctx.targetTag, true);
    if (ctx.view === "settings") return typing ? { type: "blur" } : { type: "close-settings" };
    if (ctx.view === "cloud") {
      // xterm 的隐藏 textarea:Esc 要透传给云端 shell(vim 等),不 blur 不关视图
      if (ctx.inTerminal) return NONE;
      return typing ? { type: "blur" } : { type: "close-cloud" };
    }
    if (typing) return { type: "blur" };
    // 仅会话视图响应审批快捷键:新任务/云端视图不误拒背景会话的审批(Enter 同守卫)
    if (ctx.openPermId && ctx.view === "session" && !isNewTaskView(ctx.view, ctx.sessionId) && !ctx.isComposing) {
      return { type: "answer-perm", id: ctx.openPermId, action: "deny" };
    }
    return NONE;
  }
  if (
    ctx.key === "Enter" &&
    !ctx.isComposing &&
    ctx.openPermId &&
    ctx.view === "session" &&
    !isNewTaskView(ctx.view, ctx.sessionId)
  ) {
    if (isTyping(ctx.targetTag, false) && ctx.inputText.trim()) return NONE; // 正在输入内容,不当作审批
    return { preventDefault: true, type: "answer-perm", id: ctx.openPermId, action: "allow" };
  }
  return NONE;
}
