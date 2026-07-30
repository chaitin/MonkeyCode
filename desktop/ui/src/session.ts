// 本地会话域:会话 CRUD、全局会话事件、引擎能力/崩溃/重启、本地会话流
// (connect)。IPC 原语在 ipc.ts,载荷纯数据类型在 types.ts。
import { invoke, listen, listenAsync } from "./ipc";
import type { EngineCaps, EngineStatus, Frame, ModelInfo, SessionEvent, SessionMeta } from "./types";

// ==================== 会话管理 ====================

export const listSessions = () => invoke<SessionMeta[]>("sessions_list");

export const listModels = () => invoke<ModelInfo[]>("models_list");

export const createSession = (
  workdir: string,
  model: string,
  createDir = false,
  kind: "local" | "chat" = "local",
  think = "",
) => invoke<SessionMeta>("session_create", { workdir, model, createDir, kind, think });

/** 删除会话(级联子会话,不可恢复);运行中壳/内核拒绝。 */
export const deleteSession = (id: string) =>
  invoke<{ ok: boolean }>("session_delete", { id });

/** 重命名会话(标题非空,内核截断到 80 字符)。 */
export const setSessionTitle = (id: string, title: string) =>
  invoke<{ ok: boolean }>("session_patch", { id, patch: { title } });

/** 归档/取消归档会话。 */
export const setSessionArchived = (id: string, archived: boolean) =>
  invoke<{ ok: boolean }>("session_patch", { id, patch: { archived } });

/** 订阅全局会话事件流(session-status / session-ask / session-summary);
 * 返回取消订阅函数。 */
export function subscribeEvents(onEvent: (e: SessionEvent) => void): () => void {
  return listen("session-event", (p) => onEvent(p as SessionEvent));
}

export const engineCaps = () => invoke<EngineCaps>("engine_caps");

/** 订阅引擎生命周期状态。异步版:调用方必须等注册完成再补拉快照
 *  (契约 3「监听先于命令」),否则两者之间到达的状态会静默丢失。 */
export function onEngineStatus(cb: (s: EngineStatus) => void): Promise<() => void> {
  return listenAsync("engine-status", (p) => cb(p as EngineStatus));
}

/** 引擎生命周期状态快照。事件在窗口建起来之前就可能发过(冷启动失败、
 *  启动期崩溃),只靠监听必然错过,UI 挂载后必须补拉一次。 */
export const engineStatus = () => invoke<EngineStatus>("engine_status");

/** 按当前配置重启引擎(崩溃/熔断恢复;成功后调用方整页刷新复位状态)。 */
export const engineRestart = () => invoke<void>("engine_restart");

// ==================== 本地会话流 ====================

export interface Conn {
  /** 上行一帧;resolve(false) = 发送失败(内容应保留供重试),并已经
   * onStatus 外显原因。 */
  send(type: string, payload: unknown): Promise<boolean>;
  call<T>(kind: string, payload?: unknown): Promise<T>;
  close(): void;
}

/** 一段历史:折叠后的帧 + 往前翻的游标(hasMore 为假即已到会话开头) */
export interface HistoryPage {
  frames: Frame[];
  cursor: number;
  hasMore: boolean;
}

export interface ConnHandlers {
  onFrames(batch: Frame[]): void;
  /** 打开会话拿到的尾部窗口(命令返回值,不走事件) */
  onHistory(page: HistoryPage): void;
  onStatus(text: string, connected: boolean): void;
}

/** 免连接上行:给后台会话(本客户端未开连接)补投排队消息用。内核按 id
 * 寻址会话,不依赖 opened;成败返回布尔,失败不外显(调用方按排队语义
 * 回栈重试),不能像 Conn.send 那样把失败喊到当前会话的状态行上。 */
export async function sessionSend(id: string, ftype: string, payload: unknown): Promise<boolean> {
  try {
    await invoke("session_send", { id, ftype, payload });
    return true;
  } catch {
    return false;
  }
}

/** 往前翻页:cursor 之前的最多 limit 轮(形状与云端 mcTaskRounds 一致) */
export const sessionHistory = (id: string, cursor: number, limit = 1) =>
  invoke<{ frames?: Frame[]; next_cursor?: number; has_more?: boolean }>("session_history", {
    id,
    cursor,
    limit,
  });

/** 回读单帧原文:物化时被截断的工具大字段,展开卡片时按 seq 取全文 */
export const sessionFrame = (id: string, seq: number) =>
  invoke<Frame>("session_frame", { id, seq });

/** 提问大纲:全量 user-input 条目(content 为 base64,offset 是翻页锚点) */
export const sessionOutline = (id: string) =>
  invoke<{ seq: number; offset: number; content: string; timestamp?: number }[]>("session_outline", {
    id,
  });

/**
 * 打开会话流:壳侧接引擎并按 ~30ms 批量推 frames:{sid} 事件;历史走
 * session_open 的**返回值**(尾部窗口,更早的按 cursor 翻)。断线由壳自动
 * 重连,状态经 conn-status:{sid} 事件透传。
 */
export function connect(sessionId: string, h: ConnHandlers): Conn {
  let closed = false;
  h.onStatus("连接中…", false);

  // 监听注册落地后才 session_open:壳在命令内同步推送连接状态,监听未注册
  // 前的事件会被丢(不排队),表现为卡在"连接中"。历史帧自身已改走返回值,
  // 不再受这条时序约束——实时帧仍要靠它。
  const unFramesP = listenAsync(`frames:${sessionId}`, (p) => {
    if (!closed) h.onFrames(p as Frame[]);
  });
  const unStatusP = listenAsync(`conn-status:${sessionId}`, (p) => {
    if (closed) return;
    const s = p as { text: string; connected: boolean };
    h.onStatus(s.text, s.connected);
  });
  Promise.all([unFramesP, unStatusP])
    .then(() =>
      invoke<{ frames?: Frame[]; cursor?: number; has_more?: boolean } | null>("session_open", {
        id: sessionId,
      }),
    )
    .then((w) => {
      if (closed) return;
      h.onHistory({ frames: w?.frames ?? [], cursor: w?.cursor ?? 0, hasMore: !!w?.has_more });
    })
    .catch((e) => {
      if (!closed) h.onStatus("⚠ 打开会话失败: " + String(e), false);
    });
  const unlisten = () => {
    unFramesP.then((f) => f()).catch(() => {});
    unStatusP.then((f) => f()).catch(() => {});
  };

  return {
    async send(type, payload) {
      try {
        await invoke("session_send", { id: sessionId, ftype: type, payload });
        return true;
      } catch (e) {
        // close 之后状态行已归新连接所有:旧连接的失败回执不再回喊,
        // 否则会把新会话打成「⚠ …/未连接」
        if (!closed) h.onStatus("⚠ " + String(e), false);
        return false;
      }
    },
    call<T>(kind: string, payload: unknown = {}): Promise<T> {
      // 统一入口:repo_* 由壳命令层分派到原生实现,UI 不感知执行方
      return invoke<T>("session_call", { id: sessionId, kind, payload });
    },
    close() {
      closed = true;
      unlisten();
      void invoke("session_close", { id: sessionId }).catch(() => {});
    },
  };
}
