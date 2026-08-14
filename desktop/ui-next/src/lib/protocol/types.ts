// 引擎帧协议 → 聊天视图的类型层:放宽版 Frame + ChatState/ChatItem 状态模型。
//
// 帧的权威 wire 形状 = gen/Frame.ts(ts-rs 从壳侧 driver/frame.rs 生成:
// data 恒为内联 JSON 对象,seq/timestamp 必有)。本层只放宽、不发明:
// ① 存量 journal(events.jsonl)与云端任务流的帧可缺 seq/timestamp;
// ② data 还可能是 base64(JSON) 字符串/裸 JSON 字符串等历史形态。
// 因此 data 一律经 codec.ts::frameData 收口解码,任何地方不得直接摸。
import type { Frame as WireFrame } from "@/gen/Frame";
import type { PermOutcome } from "@/gen/PermOutcome";
import type { MessageKey } from "@/lib/i18n";

export type { PermOutcome, WireFrame };

/** UI 视角的下行帧(壳产帧形状之上的放宽,缘由见文件头)。 */
export type Frame = { type: string; data?: unknown } & Partial<Omit<WireFrame, "type" | "data">>;

// ==================== task-running 帧内的 ACP 词汇 ====================

/** task-running/acp_event 帧内的 ACP 风格 sessionUpdate。
 * 字段全部可缺:词汇由引擎与云端两个上游共同贡献,归约按需取用。 */
export interface AcpUpdate {
  sessionUpdate: string;
  /** 文本分片通常是 {text};云端工具结果也会用 content block 数组 */
  content?: unknown;
  toolCallId?: string;
  title?: string;
  kind?: string;
  /** 该条消息的 token 用量(壳侧 usage 事件挂到 agent_message 帧上) */
  usage?: { input_tokens?: number; output_tokens?: number };
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  /** 云端 ACP 工具可能附带命中的文件位置 */
  locations?: unknown;
  /** ask_user_question 的兜底载荷位置(部分 CLI 把问题放在 _meta 里) */
  _meta?: unknown;
  entries?: PlanEntry[];
  /** llm_call_retry(仅云端流):第几次重试 */
  attempt?: number;
  message?: string;
  /** task_notification(后台子代理完成 📌 系统行)的通知文本 */
  text?: string;
  used?: number;
  size?: number;
  progress?: ToolProgress;
  model?: string;
  /** think_update:会话思考档位("" = 跟随模型默认) */
  think?: string;
  mode?: string;
  /** 工具产出的图片(截图/读图)在工作区的相对路径 */
  images?: string[];
  /** available_commands_update:Agent 上报的可用斜杠指令(全量重发) */
  availableCommands?: SlashCommand[];
}

/** Agent 上报的斜杠指令(/compact、/review 等;input.hint 是参数提示)。 */
export interface SlashCommand {
  name: string;
  description?: string;
  input?: { hint?: string | null } | null;
}

/** tool_call_update{status:in_progress} 的执行期进度载荷。 */
export interface ToolProgress {
  kind: string; // subagent_tool | subagent_text | output | child_session
  id?: string;
  title?: string;
  /** subagent_tool 的完整结构化入参,避免从截断标题反推目标 */
  rawInput?: unknown;
  status?: string; // run | ok | fail
  line?: string;
  childSessionId?: string;
}

/** 实时任务清单(plan 帧)的一条。 */
export interface PlanEntry {
  content: string;
  status: string;
  /** 任务 id(上游 todo_update 携带时,依赖引用用) */
  id?: string;
  depends_on?: string[];
  /** 被未完成依赖阻塞(上游携带;缺省时按 depends_on 本地推导) */
  blocked?: boolean;
}

/** AI 提问(ask_user_question)的一道题(结构对齐 mobile messages/handler.ts)。 */
export interface AskQuestion {
  question: string;
  /** 简短标签(chip 展示) */
  header?: string;
  multiSelect: boolean;
  /** 允许自定义答案(选项之外自由输入) */
  custom: boolean;
  options: { label: string; description?: string }[];
  /** 已答内容(reply-question 回显/回放后填充) */
  answer?: string | string[];
}

// ==================== 对话流渲染项(ChatItem 判别联合) ====================

/** 云端任务聊天附件(user-input 帧 attachments 条目;url 为对象存储
 * access_url,与 web/mobile 同一契约)。本地会话走文本附件行约定,无此字段。 */
export interface ChatAttachment {
  url: string;
  filename: string;
}

/** 审批卡状态:open 待答复;allowed/rejected 是本地乐观回写的词,
 * PermOutcome 是引擎 permission-resolved 的权威词;expired = 轮次结束未答。 */
export type PermState = "open" | "allowed" | "rejected" | PermOutcome | "expired";

export type ToolStatus = "run" | "ok" | "fail";

/** 子代理进度窗口的一条:工具步骤或回复文本行(时间序混排,挂在 task 工具卡下)。 */
export type SubEntry =
  | { kind: "tool"; id: string; title: string; rawInput?: unknown; status: ToolStatus }
  | { kind: "text"; text: string };

/** 用户消息。 */
export interface UserItem {
  kind: "user";
  text: string;
  /** 消息帧产生时间(Unix ms;旧记录可缺省) */
  timestamp?: number;
  /** 产生它的 user-input 帧 seq:提问大纲 ↔ 渲染项 ↔ DOM 的稳定锚
   * (下标会因"加载更早"整体平移,seq 不会;旧记录可缺省) */
  seq?: number;
  /** 云端任务附件(url 直链渲染);无附件时字段缺席 */
  attachments?: ChatAttachment[];
}

/** 模型正文(流式聚合成一项)。 */
export interface AgentItem {
  kind: "agent";
  text: string;
  /** 首个流式分片时间(Unix ms;旧记录可缺省) */
  timestamp?: number;
  /** 本条消息的 token 用量(壳侧 usage 事件挂帧,回放/重启后可见) */
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** 思考块(流式聚合成一项)。 */
export interface ThoughtItem {
  kind: "thought";
  text: string;
  /** 首个分片的帧时间(块级时间显影;流式续片不覆盖)。 */
  timestamp?: number;
}

/** 工具调用卡。结构化字段(rawInput/rawOutput/content/locations/_meta)
 * 原样透传给展示层,归约只负责跨帧合并与状态流转。 */
export interface ToolItem {
  kind: "tool";
  tcId: string;
  title: string;
  status: ToolStatus;
  /** 开卡帧时间(块级时间显影;durationMs 另记耗时)。 */
  timestamp?: number;
  /** 结果首行摘要(截 160 字符;失败时卡片外显)。上游原文,不放归约自造的句子 */
  out: string;
  /** out 的文案键(归约自造的状态词走这条,渲染时才求值;优先于 out)。
   *  同 SysItem.key 的理由:归约一次、留存长期,烘死文案就烘死了语言。 */
  outKey?: MessageKey;
  /** 工具的完整结构化入参;卡片优先用它展示路径/命令/查询 */
  rawInput?: unknown;
  /** ACP kind 以及完整结构化结果;本地和云端共用详情解析 */
  toolKind?: string;
  rawOutput?: unknown;
  content?: unknown;
  locations?: unknown;
  /** 云端分帧补齐的元数据(递归合并;含大字段护栏的 mcSrc 回读凭据) */
  _meta?: unknown;
  /** 工具开始帧时间;与结束帧时间共同计算耗时,旧记录可缺省 */
  startedAt?: number;
  /** 工具最终耗时(毫秒);仅在起止帧都有可靠时间时写入 */
  durationMs?: number;
  /** 完整结果文本(子代理卡按 markdown 展示最终产出;普通卡不消费) */
  result?: string;
  /** 工具产出的图片(截图/读图)工作区相对路径,卡片渲染缩略图 */
  images?: string[];
  /** 子代理进度窗口(工具步骤 + 回复文本行,时间序) */
  feed?: SubEntry[];
  /** 最新输出行(kind=output 进度,如 bash 长命令) */
  lastLine?: string;
  /** 子代理子会话 ID(可打开完整回放) */
  childSessionId?: string;
  /** Agent 工具已转后台,但子代理本身仍在运行 */
  background?: boolean;
  /** 后台终态已回填,等待吞掉紧随其后的重复 task_notification */
  backgroundNoticePending?: boolean;
}

/** 系统行(轮次分隔/错误/模型切换等)。 */
export interface SysItem {
  kind: "sys";
  /** 上游原文(引擎/云端产的自由文本:notify 通知正文等)。归约自己造的
   *  句子**不进这里**——它们走 key+params 在渲染时按当前 locale 求值。 */
  text: string;
  error?: boolean;
  /** 行种类(reduce 各产出点打标):渲染层按 tag 分流呈现(turn-end 收敛
   * 为呼吸位、连续 model 行合并等),不再嗅探 text 文案。 */
  tag?: "turn-end" | "model" | "think" | "mode" | "retry" | "notify" | "compact" | "error";
  /** 文案键:**归约层不产成品中文**。归约发生一次、结果长期留在 state 里,
   *  在这儿把句子烘死就等于把语言也烘死——切到英文界面后,已有的对话流里
   *  仍是「模型已切换为…」「思考深度已调整为「低」」,而审批卡上「Allow /
   *  Deny」与答复后的「已允许」还会同框出现。key 缺席则渲染 text。 */
  key?: MessageKey;
  /** key 的插值参数(原始值,非成品文案:think 的 level 要在渲染时再过一次
   *  词表才拿得到当前语言的档位名)。 */
  params?: Record<string, string>;
}

/** 审批卡。 */
export interface PermItem {
  kind: "perm";
  id: string;
  title: string;
  tool: string;
  state: PermState;
  /** 引擎透传的 provider 工具调用 id(permission-req.tool_call_id):
   * 流里存在同 id 工具卡时审批按钮嵌进那张卡,独立审批卡不渲染;
   * 缺省(旧引擎/云端任务流)回退独立卡 */
  toolCallId?: string;
}

/** AI 提问卡(ask_user_question;askId 即回传 reply 的 request_id)。 */
export interface AskItem {
  kind: "ask";
  askId: string;
  state: "open" | "done" | "expired";
  questions: AskQuestion[];
}

/** 对话流里的一条渲染项。 */
export type ChatItem = UserItem | AgentItem | ThoughtItem | ToolItem | SysItem | PermItem | AskItem;

// ==================== 会话状态(reduceBatch 的输入/输出) ====================

export interface Usage {
  used: number;
  size: number;
}

/** 流式聚合目标:agent/thought 分片各归各的气泡,"" = 断流(下个分片新开一项)。 */
export type StreamKind = "" | "agent" | "thought";

export interface ChatState {
  items: ChatItem[];
  running: boolean;
  usage: Usage | null;
  /** 实时任务清单(plan 帧全量重发;钉在 composer 上方的面板,不进对话流) */
  plan: PlanEntry[];
  streamKind: StreamKind;
  /** 本轮结束时需要刷新改动计数(视图消费后自行复位) */
  turnEnded: boolean;
  /** 会话当前模型(model_update 帧回写;空 = 以会话 meta 为准) */
  model: string;
  /** 会话思考档位(think_update 帧回写;"" = 跟随模型设置的默认档) */
  think: string;
  /** 会话权限模式(permission_mode_update 帧回写;空 = 以会话 meta 为准) */
  permMode: string;
  /** Agent 上报的可用斜杠指令(available_commands_update 全量重发) */
  commands: SlashCommand[];
  /** 渲染 key 的基准:key = keyBase + 下标。"加载更早"往前插 N 条时减 N,
   * 既有条目的 key 因此保持不变——否则下标 key 整体平移,React 认不出
   * 同一条,工具卡/思考块的展开态串位、整列重挂载(markdown 全部重解析)。 */
  keyBase: number;
  /** seq 去重水位:已归约帧的最大 seq(0 = 还没见过带 seq 的帧)。
   * 云端重连会重放重叠帧,靠它跨批次丢弃;详见 reduceBatch 的去重口径。 */
  lastSeq: number;
}
