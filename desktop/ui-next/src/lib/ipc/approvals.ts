// 审批/提问的上行发送面。载荷形状 = 壳侧 driver/session.rs::session_send 的
// 接收端契约(以 Rust 侧为准,不按旧 UI 反推):
// - permission-resp:{ id, approved, remember, persist }。壳把 remember/persist
//   两档在新引擎(permissionRemember cap)下统一映射为引擎 respond.remember,
//   旧引擎回落壳侧工具名记忆集——UI 只负责如实上报动作档位;
// - reply-question:{ request_id, answers_json, cancelled }。answers_json 是
//   {问题: 答案} 的 JSON 字符串(多选为数组),壳回推 reply-question 回显帧。
import { inDesktopShell, invoke } from "./ipc";
import { sessionSend } from "./sessions";

/** 上行发送面:一次答复 = 一帧 (ftype, payload)。本地会话走壳侧
 * session_send,云端任务走 stream WS 上行——帧词汇与载荷两边同构,
 * 差异只在管道,故三个答复函数只对 sender 编程(*Via 版),便捷封装
 * 保留 sessionId 形参供本地调用点零改动。reject = 未送达(调用方回滚)。 */
export type FrameSender = (ftype: string, payload: Record<string, unknown>) => Promise<void>;

/** sessionId 的本地发送器(壳侧 session_send 命令;本地会话缺省管道)。 */
export function localFrameSender(sessionId: string): FrameSender {
  return (ftype, payload) => sessionSend(sessionId, ftype, payload);
}

/** 审批四动作:allow 仅本次;always 本会话始终;persist 此项目永久;deny 拒绝。 */
export type PermAction = "allow" | "always" | "persist" | "deny";

export function sendPermAnswerVia(send: FrameSender, permId: string, action: PermAction): Promise<void> {
  return send("permission-resp", {
    id: permId,
    approved: action !== "deny",
    remember: action === "always" || action === "persist",
    persist: action === "persist",
  });
}

export function sendPermAnswer(sessionId: string, permId: string, action: PermAction): Promise<void> {
  return sendPermAnswerVia(localFrameSender(sessionId), permId, action);
}

export function sendAskAnswersVia(
  send: FrameSender,
  askId: string,
  answers: Record<string, string | string[]>,
): Promise<void> {
  return send("reply-question", {
    request_id: askId,
    answers_json: JSON.stringify(answers),
    cancelled: false,
  });
}

export function sendAskAnswers(
  sessionId: string,
  askId: string,
  answers: Record<string, string | string[]>,
): Promise<void> {
  return sendAskAnswersVia(localFrameSender(sessionId), askId, answers);
}

/** 跳过回答(cancelled=true):引擎收到取消,提问卡按无答案收口。 */
export function sendAskCancelVia(send: FrameSender, askId: string): Promise<void> {
  return send("reply-question", {
    request_id: askId,
    answers_json: "{}",
    cancelled: true,
  });
}

export function sendAskCancel(sessionId: string, askId: string): Promise<void> {
  return sendAskCancelVia(localFrameSender(sessionId), askId);
}

/** 引擎能力表(对表壳侧 driver/mod.rs::Caps 的 serde 形状)。 */
export interface EngineCaps {
  browser_ext: boolean;
  usage_update: boolean;
  /** 审批记忆归引擎:false 时审批卡隐藏两个"始终"档 */
  perm_remember: boolean;
  attachments: boolean;
  /** 运行中可将补充指令插入当前任务。 */
  steering: boolean;
}

/** 能力快照的严格读取面；浏览器模式返回 null，桌面壳 invoke 失败向上抛。 */
export function engineCapsRequired(): Promise<EngineCaps | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<EngineCaps>("engine_caps");
}

/** 能力快照;浏览器模式/引擎未起返回 null(调用方按默认档降级)。 */
export function engineCaps(): Promise<EngineCaps | null> {
  return engineCapsRequired().catch(() => null);
}
