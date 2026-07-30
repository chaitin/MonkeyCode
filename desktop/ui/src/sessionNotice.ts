import type { SessionEvent, SessionNotice } from "./types";

/** 把其他本地会话的全局事件转换为 Composer 上方的可跳转提示。 */
export function noticeForSessionEvent(event: SessionEvent): SessionNotice | null {
  const title = event.title || "任务";
  if (event.type === "session-ask") {
    return event.open
      ? { text: `「${title}」等待权限审批`, tone: "warning", targetSessionId: event.id }
      : null;
  }
  if (event.type !== "session-status") return null;

  switch (event.status) {
    case "idle":
      return { text: `「${title}」已回复`, tone: "success", targetSessionId: event.id };
    case "finished":
      return { text: `「${title}」已完成`, tone: "success", targetSessionId: event.id };
    case "error":
      return { text: `「${title}」出错了`, tone: "error", targetSessionId: event.id };
    case "interrupted":
      return { text: `「${title}」已中断`, tone: "warning", targetSessionId: event.id };
    default:
      return null;
  }
}
