// 会话域 API:sessions_* / session_* / models_list 命令与 session-event 订阅。
// 类型字段名 = 壳侧 serde 序列化的线上形状(契约,别改名)。
//
// 错误约定(读/写一视同仁,2026-08-09 收敛):
// - **浏览器模式**是静态事实,不是故障:列表类返回空、变更类抛错;
// - **壳内失败一律抛**,读类也不例外。降级值只能表达"这个环境没有此能力",
//   不能用来表达"这一次没拉到"——两者混成同一个空数组,调用方就再也分不清
//   「用户真没有会话/模型」与「引擎正在重启」,只能按前者处理(清空列表、
//   弹首启向导)。见 sessionsList/modelsList 各自的头注。
import type { Frame } from "@/gen/Frame";
import { inDesktopShell, invoke, listen, listenAsync } from "./ipc";

export type SessionKind = "local" | "chat";

export interface SessionMeta {
  id: string;
  title: string;
  /** 用户改过名(session_patch title):头部标题优先级
   * (用户改名 > summary > 首句自动标题)靠它区分改名与自动标题 */
  title_custom?: boolean;
  /** 引擎每轮异步生成的会话摘要(chat 空间列表的主行展示) */
  summary?: string;
  workdir: string;
  /** 会话空间;旧数据缺省为 local */
  kind?: SessionKind;
  model: string;
  /** 思考档位(off/low/medium/high;缺省 = 跟随模型默认) */
  think?: string;
  /** 权限模式("yolo" 全放行;缺省 = default) */
  mode?: string;
  /** 技能启用集(名字数组;null/缺省 = 缺省集,规则见
   * lib/ipc/skills.ts::defaultEnabledSkills,与壳侧物化一致) */
  skills?: string[] | null;
  turns: number;
  status: string;
  /** 有待答复的审批请求(运行时状态,不落盘) */
  waiting_ask?: boolean;
  updated_at?: string;
  archived?: boolean;
}

export interface ModelInfo {
  name: string;
  default: boolean;
  /** 条目来源("baizhi"=百智云同步);缺省=手工添加 */
  source?: string;
  model?: string;
  locked?: boolean;
  owner?: string;
  think?: string;
}

/** 全局 session-event 载荷:session-status / session-ask / session-summary。 */
export interface SessionEvent {
  type: string;
  id: string;
  title: string;
  status?: string;
  open?: boolean;
  summary?: string;
  /** session-usage:该会话最近一次模型调用的 token 用量 */
  input?: number;
  output?: number;
}

/** ⚠️ 壳内失败要**抛**给调用方。
 *
 *  壳持着 EngineApply 闸门时这条命令直接回 Err「引擎配置正在应用,请稍后
 *  重试」(driver/mod.rs::DriverHost::get),而 `restart_engine_locked` 在
 *  `adopt_engine` 里就 emit 了 engine-status: ready、调用方(save_config /
 *  浏览器配对刷新)却仍持着锁——UI 一收到 Ready 就发的这一拉必然落在窗口里
 *  被拒。lib/ipc/engine.ts::afterEngineReady 正是为这段窗口写的退避重试。
 *
 *  此前这里 `.catch(() => [])` 把拒绝吞成空数组,后果有两层:退避重试永远
 *  看不到拒绝,成了死代码;而一次瞬时故障被翻译成「这个用户一条会话都没有」
 *  ——侧栏清空、current 变 null、开着的对话卸载回欢迎页,而且要等下一条
 *  session-event 才可能恢复。旧 UI 的注释写得很直白:「任一项拉取失败都保留
 *  现有状态,不能用空结果覆盖……清空会话列表会被误判为'会话已删'」。 */
export function sessionsList(): Promise<SessionMeta[]> {
  if (!inDesktopShell()) return Promise.resolve([]);
  return invoke<SessionMeta[]>("sessions_list");
}

/** ⚠️ 同 sessionsList:壳内失败要抛。
 *  models_list 撞的是同一道 apply 闸门,而它的空结果在 App 里是**首启向导**
 *  的触发条件(models.length === 0 → 自动打开设置页)。吞成 [] 的话,一次
 *  拉取失败就把设置页糊到一个模型配得好好的用户脸上。 */
export function modelsList(): Promise<ModelInfo[]> {
  if (!inDesktopShell()) return Promise.resolve([]);
  return invoke<ModelInfo[]>("models_list");
}

export function sessionCreate(args: {
  workdir: string;
  model: string;
  createDir: boolean;
  kind?: SessionKind;
  think?: string;
}): Promise<SessionMeta> {
  return invoke<SessionMeta>("session_create", args);
}

export function sessionDelete(id: string): Promise<void> {
  return invoke<{ ok: boolean }>("session_delete", { id }).then(() => {});
}

/** patch 支持 {title} 与 {archived}(壳侧白名单)。 */
export function sessionPatch(id: string, patch: { title?: string; archived?: boolean }): Promise<void> {
  return invoke<{ ok: boolean }>("session_patch", { id, patch }).then(() => {});
}

/** 后台会话状态/摘要/审批等待的全局事件(不轮询)。 */
export function onSessionEvent(cb: (e: SessionEvent) => void): () => void {
  return listen<SessionEvent>("session-event", cb);
}

/* ---- 会话打开/回放/收发(聊天视图数据面) ---- */


export interface SessionWindow {
  frames: Frame[];
  cursor: number;
  has_more: boolean;
}

/** ⚠️ session_history 的返回形状与 session_open **不同**:游标叫
 *  `next_cursor`(壳 session.rs 两处 json! 字面量),按 `cursor` 取会拿到
 *  undefined,首次翻页后游标即坏死——两个形状必须分开建型。 */
export interface HistoryPage {
  frames: Frame[];
  next_cursor: number;
  has_more: boolean;
}

/** ⚠️ 铁律「监听先于命令」:壳在 session_open 处理中同步 emit 首批实时帧,
 *  调用方必须先 `await onFrames(id, cb)` 再调本函数,否则丢帧。 */
export function sessionOpen(id: string): Promise<SessionWindow> {
  return invoke<SessionWindow>("session_open", { id });
}

/** 往更早翻页(前插历史);cursor 来自 session_open 的 cursor 或上一页的
 *  next_cursor(replay.jsonl 字节偏移,与 session_outline 的 offset 同坐标系)。 */
export function sessionHistory(id: string, cursor: number, limit: number): Promise<HistoryPage> {
  return invoke<HistoryPage>("session_history", { id, cursor, limit });
}

/** 回读单帧原文(工具卡被截断的大字段按需取)。 */
export function sessionFrame(id: string, seq: number): Promise<Frame> {
  return invoke<Frame>("session_frame", { id, seq });
}

export function sessionClose(id: string): Promise<void> {
  return invoke<void>("session_close", { id }).catch(() => {});
}

/** 发帧(ftype="user-input" 等;payload 形状由帧词汇决定)。 */
export function sessionSend(id: string, ftype: string, payload: Record<string, unknown>): Promise<void> {
  return invoke<void>("session_send", { id, ftype, payload });
}

/** 实时帧通道(壳侧 ~30ms 批量聚合)。返回注册完成的退订。 */
export function onFrames(id: string, cb: (frames: Frame[]) => void): Promise<() => void> {
  return listenAsync<Frame[]>(`frames:${id}`, cb);
}

export interface ConnStatus {
  text: string;
  connected: boolean;
}

export function onConnStatus(id: string, cb: (s: ConnStatus) => void): Promise<() => void> {
  return listenAsync<ConnStatus>(`conn-status:${id}`, cb);
}
