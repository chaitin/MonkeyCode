// 会话控制面的补充命令封装(sessions.ts 已冻结,新命令进本文件):
// - session_call:切模型/思考档/权限模式/手动压缩,接收端 = 壳侧
//   driver/session.rs::session_call(session_set_model {model:展示名} /
//   session_set_think {think:off|low|medium|high} / session_set_mode
//   {mode:default|yolo} / session_compact {});
//   应答 {result}/{error} 同构,error 转 reject 让调用方外显。
//   注:模型/思考档运行中壳会拒绝(引擎限制),权限模式可热切。
// - session_outline:提问大纲全量目录(user-input 帧投影),条目 content
//   保持 base64(与帧内一致),本层解码;offset 是该轮在 replay.jsonl 的
//   字节偏移(跳到未加载区间时的翻页锚)。
import { b64decode } from "@/lib/protocol/codec";
import { invoke } from "./ipc";

interface CallReply {
  result?: Record<string, unknown>;
  error?: string;
}

async function sessionCall(id: string, kind: string, payload: Record<string, unknown>): Promise<void> {
  const r = await invoke<CallReply | null>("session_call", { id, kind, payload });
  if (r?.error) throw new Error(r.error);
}

export function sessionSetModel(id: string, model: string): Promise<void> {
  return sessionCall(id, "session_set_model", { model });
}

export function sessionSetThink(id: string, think: string): Promise<void> {
  return sessionCall(id, "session_set_think", { think });
}

export function sessionSetMode(id: string, mode: string): Promise<void> {
  return sessionCall(id, "session_set_mode", { mode });
}

/** 会话技能启用集(全量声明,空数组 = 全部停用)。壳侧 destroy+resume
 * 重建引擎会话让技能目录重扫,所以仅空闲可调,resolve 在重建完成后。 */
export function sessionSetSkills(id: string, skills: string[]): Promise<void> {
  return sessionCall(id, "session_set_skills", { skills });
}

/** 手动压缩上下文(session_compact)。resolve 在压缩完成后(引擎同步
 * 应答);进度与结果经帧外显(task_started + compact_status(started) →
 * task_ended,失败走 task-error 帧)。reject 仅当压缩没起来(忙碌/旧
 * 引擎无能力/会话未打开),调用方外显。 */
export function sessionCompact(id: string): Promise<void> {
  return sessionCall(id, "session_compact", {});
}

/** 提问大纲的一条(壳投影 + 本层解码;seq 与 UserItem.seq / DOM 的
 * data-user-seq 对表)。 */
export interface OutlineItem {
  seq: number;
  /** 该轮在 replay.jsonl 的字节偏移(0 = 已在打开窗口内,无需翻页)。 */
  offset: number;
  text: string;
  timestamp?: number;
}

interface RawOutlineEntry {
  seq?: number;
  offset?: number;
  content?: string;
  timestamp?: number | null;
}

/** 全量提问大纲;失败/浏览器模式回空(大纲拿不到不影响会话本身)。 */
export async function sessionOutline(id: string): Promise<OutlineItem[]> {
  const raw = await invoke<RawOutlineEntry[] | null>("session_outline", { id }).catch(() => null);
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    let text = "";
    try {
      text = b64decode(e.content ?? "");
    } catch {
      // 坏载荷按空条目处理,不吞掉整份大纲
    }
    return {
      seq: e.seq ?? 0,
      offset: e.offset ?? 0,
      text,
      ...(typeof e.timestamp === "number" ? { timestamp: e.timestamp } : {}),
    };
  });
}
