// 后台会话提醒的判定(D3):session-event → 是否值得打断用户。
// 纯函数与渲染分离——"哪些事件出提示"是产品语义(说错一次就是白等或漏看),
// 单测钉在这里,App 只管画 toast 与跳转。
//
// 规则(与旧工程 sessionNotice.ts 的行为契约对齐,收敛到新事件词汇):
// - 当前正看着的会话不提醒(用户就在现场);
// - session-ask open=true → 等待审批(warning);open=false 是别处已答,不提醒;
// - session-status 转终态 idle/error/interrupted → 已回复/出错/已中断;
//   running 等中间态不提醒;
// - session-summary 是模型异步吐的摘要,与用户的等待无关,不提醒。
//
// 与壳事件词汇的对表(driver/):interrupted 是**顶层会话真会收到**的终态,
// 来源有二——引擎 turn/stopped 的 stop_reason=="interrupted"(normalize.rs),
// 以及引擎进程死亡后的 reconcile-all 收尾(session.rs)。此前这里漏了它,
// 于是"引擎崩了、后台几个任务全被打断"这件事在每个会话上都是零信号
// (侧栏也不出点——已停止属静默态)。旧 UI sessionNotice.ts 给的是
// 「已中断」+ warning,照搬。
// 反过来 finished 确实不该进:新壳顶层会话正常收尾回 idle,finished 只留给
// 子任务,而子任务没有列表行也没人跳得过去。
import type { SessionEvent } from "@/lib/ipc/sessions";

export type NoticeKind = "ask" | "done" | "error" | "interrupted" | "queued";

export interface SessionNotice {
  sessionId: string;
  title: string;
  kind: NoticeKind;
}

/** 后台补投成功的提示(stash::deliverQueued 回调):title = 消息摘录。 */
export function noticeForQueuedDelivery(sessionId: string, text: string): SessionNotice {
  const excerpt = text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return { sessionId, title: excerpt, kind: "queued" };
}

export function noticeForSessionEvent(
  e: SessionEvent,
  currentId: string | null,
  /** 分屏沉浸时的"在场"口径:在任何可见格 = 用户就在现场,不提醒
   *  (设计「屏外任务路由」);普通视图缺省仍按"当前会话"判。 */
  visibleIds?: ReadonlySet<string>,
): SessionNotice | null {
  if (visibleIds ? visibleIds.has(e.id) : e.id === currentId) return null;
  if (e.type === "session-ask") {
    return e.open ? { sessionId: e.id, title: e.title, kind: "ask" } : null;
  }
  if (e.type !== "session-status") return null;
  if (e.status === "idle") return { sessionId: e.id, title: e.title, kind: "done" };
  if (e.status === "error") return { sessionId: e.id, title: e.title, kind: "error" };
  if (e.status === "interrupted") return { sessionId: e.id, title: e.title, kind: "interrupted" };
  return null;
}
