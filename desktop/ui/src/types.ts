// 与壳帧协议(driver/frame.rs)对齐的类型定义,以及壳 IPC 载荷的纯数据
// 类型(网络层与视图层共用,视图不必 import 网络层文件拿类型)。
//
// 壳↔UI 高频对表类型(Frame/SessionStatus/PermOutcome)不再手写:由
// driver/frame.rs 经 ts-rs 生成到 ./gen/(再生成:桌面壳目录下
// `cargo test export_bindings`;生成物勿手改),本文件从 gen/ 复用。
// ts-rs 覆盖不了的(字符串常量、UI 侧放宽形状)仍手写并注明缘由。

import type { Frame as WireFrame } from "./gen/Frame";
import type { PermOutcome } from "./gen/PermOutcome";
import type { SessionStatus } from "./gen/SessionStatus";

export type { PermOutcome, SessionStatus, WireFrame };

/** 百智云同步条目的 source 值。单一事实来源:内核侧赋值在
 * agent/internal/baizhi/sync.go(sourceBaizhi 常量),两侧改动需同步;
 * 字符串常量 ts-rs 覆盖不了,保留手写。 */
export const SOURCE_BAIZHI = "baizhi";

/** MonkeyCode 会员模型同步条目的 source 值(壳侧赋值在
 * desktop/src/baizhi/monkeycode.rs 的 SOURCE_MONKEYCODE,两侧改动需同步)。 */
export const SOURCE_MONKEYCODE = "monkeycode";

/** source → 分组展示名(未知来源兜底显示原值)。 */
export function modelSourceLabel(source?: string): string {
  if (!source) return "自定义";
  if (source === SOURCE_BAIZHI) return "百智云";
  if (source === SOURCE_MONKEYCODE) return "MonkeyCode 会员";
  return source;
}

/** GET /api/models 返回的可选模型 */
export interface ModelInfo {
  name: string;
  default: boolean;
  /** 条目来源("baizhi"=百智云同步);缺省=手工添加,UI 按它分组 */
  source?: string;
  /** 底层模型串。name 可能是 remark 别名,判会员档位(monkeycode-…)靠它 */
  model?: string;
  /** 超出会员档的展示专用条目:菜单灰态禁选(引擎 settings 里没有它) */
  locked?: boolean;
  /** 会员条目的服务端归属(public/private/team),会员 tab 按它分节 */
  owner?: string;
  /** 模型设置的思考深度默认档(low/medium/high;缺省/"" = 关闭)。
   * composer 未显式选档时按它显示生效档位 */
  think?: string;
}

/** 壳持有的应用配置里的一个模型条目(设置视图编辑,壳原样写盘、内核消费)。 */
export interface HostModel {
  name: string;
  provider: string; // anthropic | openai | openai_responses
  base_url: string;
  api_key: string;
  model: string;
  default?: boolean;
  /** 上下文窗口(token),高级项;缺省内核按 200k 处理 */
  context_window?: number;
  /** 最大输出(token),高级项;缺省时 openai 系请求不带上限(由服务端
   * 默认值决定),anthropic 用内核默认 16384 */
  max_output?: number;
  /** 思考深度,高级项;low|medium|high,缺省关闭。物化按协议分流:
   * openai 系 → reasoning effort;anthropic → budget_tokens 预设 */
  think?: string;
  /** 支持图片输入(视觉);未勾选时读图降级为文本占位,不发图片块 */
  vision?: boolean;
  /** 条目来源("baizhi"=百智云同步);缺省=手工添加。重同步时按它整组替换 */
  source?: string;
  /** 超出会员档的展示专用条目(会员同步打标):壳物化时跳过,UI 禁选 */
  locked?: boolean;
  /** 会员条目的服务端归属(public/private/team) */
  owner?: string;
}

/** 壳持有的应用配置(经 Tauri IPC get_config/save_config 读写)。 */
export interface HostConfig {
  models: HostModel[];
  /** MCP 服务器(name → 配置,与内核 mcp.json 的 mcpServers 同构) */
  mcp_servers: Record<string, unknown>;
  /** 内核运行环境:空/缺省 = 本机;"wsl:<发行版>" = 在 WSL 中运行(仅 Windows) */
  kernel_env?: string;
  /** MonkeyCode 服务地址(自建/私有化部署;空/缺省 = 官方云)。环境变量
   * MC_DESKTOP_MONKEYCODE_URL 优先;保存后立即生效 */
  mc_base_url?: string;
  /** MonkeyCode 测试环境反向代理的 HTTP Basic Auth("user:pass",空 = 无;
   * 对齐 mobile 的 mc.basicAuth)。仅 MonkeyCode 域的请求附头;保存后立即生效 */
  mc_basic_auth?: string;
  /** 模型请求地址(llmproxy,会员模型的 LLM 调用打这里)。空/缺省 =
   * {服务地址}/v1;拆分部署时单独指定 */
  mc_llm_base_url?: string;
}

// SessionStatus:见文件头——gen/SessionStatus.ts(ts-rs 生成)复用,
// 桌宠/侧栏/横幅按此渲染,勿散落裸字符串比较之外的新词。

/** GET /api/sessions 返回的会话元信息 */
export interface SessionMeta {
  id: string;
  title: string;
  /** 引擎每轮异步生成的会话摘要(顶栏副标题展示;不参与命名,旧 sidecar 缺省) */
  summary?: string;
  workdir: string;
  /** 会话空间；旧 sidecar 缺省为 local。chat 仍有隐藏 cwd，但界面不绑定项目。 */
  kind?: "local" | "chat";
  model: string;
  /** 会话思考档位(off/low/medium/high;缺省/"" = 跟随模型设置的默认档) */
  think?: string;
  /** 权限模式("yolo" 全放行;缺省 = default) */
  mode?: string;
  turns: number;
  status: SessionStatus | string;
  /** 有待答复的审批请求(运行时状态,不落盘;侧栏显示"等待审批") */
  waiting_ask?: boolean;
  updated_at?: string;
  /** 归档标记:移出常规列表,折叠到「已归档」组 */
  archived?: boolean;
}

/** WS 下行帧(UI 视角)。壳产帧的权威形状 = gen/Frame.ts(ts-rs 生成,
 * data 为内联 JSON 对象、seq/timestamp 必有);UI 在其上放宽:
 * ① 云端流/存量 journal 的帧可缺 seq/timestamp;
 * ② data 还有 base64(JSON) 字符串等旧/云端形态——一律经
 *    codec.ts::frameData 收口解码,禁止直接摸 data。 */
export type Frame = { type: string; data?: unknown } & Partial<Omit<WireFrame, "type" | "data">>;

/** task-running 帧内的 ACP 风格 sessionUpdate */
export interface AcpUpdate {
  sessionUpdate: string;
  /** 文本分片通常是 {text};云端工具结果也会使用 content block 数组。 */
  content?: unknown;
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
  /** 云端 ACP 工具可能附带命中的文件位置。 */
  locations?: unknown;
  /** ask_user_question 的兜底载荷位置(部分 CLI 把问题放在 _meta 里) */
  _meta?: unknown;
  entries?: PlanEntry[];
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

/** Agent 上报的斜杠指令(/compact、/review 等技能;input.hint 是参数提示) */
export interface SlashCommand {
  name: string;
  description?: string;
  input?: { hint?: string | null } | null;
}

/** tool_call_update{status:in_progress} 的执行期进度载荷 */
export interface ToolProgress {
  kind: string; // subagent_tool | subagent_text | output | child_session
  id?: string;
  title?: string;
  /** subagent_tool 的完整结构化入参，避免从截断标题反推目标 */
  rawInput?: unknown;
  status?: string; // run | ok | fail
  line?: string;
  childSessionId?: string;
}

/** 子代理进度窗口的一条:工具步骤或回复文本行(按时间混排,挂在 task 工具行下) */
export type SubEntry =
  | { kind: "tool"; id: string; title: string; rawInput?: unknown; status: "run" | "ok" | "fail" }
  | { kind: "text"; text: string };

export interface PlanEntry {
  content: string;
  status: string;
  /** 任务 id(上游 todo_update 携带时,依赖引用用) */
  id?: string;
  /** 依赖的任务 id(上游携带时面板渲染依赖提示) */
  depends_on?: string[];
  /** 被未完成依赖阻塞(上游携带;缺省时按 depends_on 本地推导) */
  blocked?: boolean;
}

// PermOutcome:见文件头——gen/PermOutcome.ts(ts-rs 生成)复用。
export type PermState = "open" | "allowed" | "rejected" | PermOutcome | "expired";

/** AI 提问(ask_user_question)的一道题(结构对齐 mobile messages/handler.ts) */
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

/** 云端任务聊天附件(user-input 帧的 attachments 条目;url 为对象存储
 * access_url,与 web/mobile 同一契约,单条消息云端上限 10 个)。 */
export interface CloudAttachment {
  url: string;
  filename: string;
}

/** 对话流里的一条渲染项 */
export type LogItem =
  | {
      kind: "user";
      text: string;
      /** 消息帧产生时间(Unix ms;旧记录可缺省) */
      timestamp?: number;
      /** 产生它的 user-input 帧 seq:提问大纲 ↔ 渲染项 ↔ DOM 的稳定锚
       * (下标会因"加载更早"整体平移,seq 不会;旧记录可缺省) */
      seq?: number;
      /** 云端任务附件(url 直链渲染;本地会话走文本附件行约定,不用此字段) */
      attachments?: CloudAttachment[];
    }
  | { kind: "agent"; text: string; /** 首个流式分片时间(Unix ms;旧记录可缺省) */ timestamp?: number }
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      tcId: string;
      title: string;
      /** 工具的完整结构化入参；卡片优先用它展示路径/命令/查询 */
      rawInput?: unknown;
      /** ACP kind 以及完整结构化结果；本地和云端共用详情解析。 */
      toolKind?: string;
      rawOutput?: unknown;
      content?: unknown;
      locations?: unknown;
      _meta?: unknown;
      status: "run" | "ok" | "fail";
      out: string;
      /** 工具开始帧时间；与结束帧时间共同计算耗时，旧记录可缺省。 */
      startedAt?: number;
      /** 工具最终耗时（毫秒）；仅在起止帧都有可靠时间时写入。 */
      durationMs?: number;
      /** 完整结果文本(子代理卡按 markdown 展示最终产出;普通卡不消费) */
      result?: string;
      /** 工具产出的图片(截图/读图)工作区相对路径,工具卡渲染缩略图 */
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
  | { kind: "sys"; text: string; error?: boolean }
  | {
      kind: "perm";
      id: string;
      title: string;
      tool: string;
      state: PermState;
      /** 引擎透传的 provider 工具调用 id(permission-req.tool_call_id):
       * 流里存在同 id 工具卡时审批按钮嵌进那张卡,独立审批卡不渲染;
       * 缺省(旧引擎/云端任务流)回退独立卡,行为不变 */
      toolCallId?: string;
    }
  /** AI 提问卡片(云端 ask_user_question;askId 即回传 reply 的 request_id) */
  | { kind: "ask"; askId: string; state: "open" | "done" | "expired"; questions: AskQuestion[] };

export interface FileChange {
  status: "A" | "M" | "D";
  path: string;
}

/** repo_file_list 返回的目录项(单层,目录在前已排序) */
export interface FileEntry {
  name: string;
  /** 相对工作区路径(正斜杠) */
  path: string;
  is_dir: boolean;
  size: number;
}

/** 待发送附件(已上传到会话工作区) */
export interface Attachment {
  path: string;
  name: string;
  isImage: boolean;
  /** 图片的本地预览(dataURL);非图片无 */
  preview?: string;
}

export interface Usage {
  used: number;
  size: number;
}

// ==================== 壳 IPC 载荷(各域纯数据类型) ====================

/** 全局事件流(session-event)载荷:session-status(状态变更)/
 * session-ask(审批等待)/session-summary(摘要更新)。后台会话结束靠它
 * 感知(不轮询)。 */
export interface SessionEvent {
  type: string;
  id: string;
  title: string;
  /** session-status:新状态 */
  status?: string;
  /** session-ask:true 进入等待,false 解除 */
  open?: boolean;
  /** session-summary:引擎新生成的会话摘要 */
  summary?: string;
}

/** Composer 上方的短暂提示；targetSessionId 存在时可点击跳转。 */
export type NoticeTone = "info" | "success" | "warning" | "error";
export interface SessionNotice {
  text: string;
  tone: NoticeTone;
  targetSessionId?: string;
}

/** 引擎能力(UI 按此降级;引擎未运行时 reject)。 */
export interface EngineCaps {
  browser_ext: boolean;
  usage_update: boolean;
  perm_remember: boolean;
  attachments: boolean;
}

/** 设置页“关于”展示的宿主与内核版本。 */
export interface HostInfo {
  version: string;
  engine_version: string | null;
}

/** 引擎生命周期状态(契约 6;壳侧 driver::EngineStatus 的 ts-rs 产物)。 */
export type { EngineStatus } from "./gen/EngineStatus";

/** browser_status 应答:扩展桥监听/配对/连接状态(设置页展示)。 */
export interface BrowserExtStatus {
  enabled: boolean;
  addr?: string;
  error?: string;
  paired: boolean;
  connected: boolean;
  browser_name?: string;
  browser_version?: string;
  /** 未配对时的一次性配对码(用户填进扩展 options 完成配对) */
  pairing_code?: string;
}

export interface BaizhiStatus {
  logged_in: boolean;
  host: string;
  profile?: Record<string, unknown>;
}

export interface BaizhiSyncedModel {
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  context_window?: number;
  max_output?: number;
  /** 思考深度档;monkeycode 同步在服务端标注不支持思考时下发 "off"
   * (压掉产品默认「低」,免得首个请求带思考参数被上游拒) */
  think?: string;
  vision?: boolean;
  source: string; // "baizhi" | "monkeycode"
  /** monkeycode 同步:服务端模型配置 id。落盘名靠它区分同批重名的条目
   * (见 settingsConfig.syncedName),不进 HostModel、不落 config.json */
  id?: string;
  /** monkeycode 同步:超出会员档的条目(展示禁选,升级后重同步解锁) */
  locked?: boolean;
  /** monkeycode 同步:服务端归属(public/private/team) */
  owner?: string;
}

/** 同步条目并入设置表单后的结果(同步卡提示用):autoSaved=已触发自动
 * 保存(随后内核重启+整页刷新);blocked=未自动保存的原因(dirty=表单有
 * 未保存修改,busy=有任务在跑,不能隐式重启内核)。 */
export interface SyncApplyResult {
  skipped: string[];
  autoSaved: boolean;
  blocked?: "dirty" | "busy";
}

export interface BaizhiSyncResult {
  models: BaizhiSyncedModel[];
  mcp_servers: Record<string, Record<string, unknown>>;
  key_created: boolean; // 本次是否在网关新建了密钥(false=复用已有)
  key_name?: string; // 使用的密钥在网关里的名字(撞名时是 MonkeyCode-N)
  notes?: string[];
}

/** mc_models_sync 返回:会员内置模型 → 本地条目(已带 source="monkeycode",
 * 条目 model 字段是服务端模型名)。 */
export interface McModelsSyncResult {
  models: BaizhiSyncedModel[];
  /** 被跳过条目的原因(未知协议/重名等),同步提示里外显 */
  notes?: string[];
}

export interface McUser {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  avatar_url?: string;
}

export interface McStatus {
  logged_in: boolean;
  /** 云端主机名(拼任务详情外链用,如 monkeycode-ai.com) */
  host: string;
  user?: McUser;
}

/** 钱包(字段与移动端 /api/v1/users/wallet 一致)。 */
export interface McWallet {
  /** 积分余额(展示需 /1000,与移动端「积分」口径一致) */
  balance?: number;
  /** 每日免费模型剩余 tokens */
  daily_token_balance?: number;
  /** 每日免费模型 tokens 上限 */
  daily_token_limit?: number;
}

export interface McSubscription {
  /** "basic" | "pro" | "ultra" | "flagship" */
  plan?: string;
  expires_at?: string;
  auto_renew?: boolean;
  source?: string;
}

export interface McInvitation {
  id?: string;
  name?: string;
  /** 可能是相对路径,按 McUsage.base_url 补全 */
  avatar_url?: string;
  credits?: number;
  invited_at?: number;
}

export interface McInvitations {
  count?: number;
  items?: McInvitation[];
}

/** mc_usage 返回:各路各自可能为 null(私有化部署只有订阅端点)。 */
export interface McUsage {
  /** 云端服务完整基址(含协议/端口):邀请链接与相对头像地址的解析基准 */
  base_url?: string;
  wallet: McWallet | null;
  subscription: McSubscription | null;
  /** 当天是否已签到;null = 本次没取到(不等于"未签到") */
  checked_in: boolean | null;
  invitations: McInvitations | null;
}

/** MonkeyCode 云端账号在 UI 中的独立关联状态。
 * 百智云登录只提供桥接授权,不会再隐式把本状态推进到 connected。 */
export interface McConnectionState {
  phase: "checking" | "disconnected" | "connecting" | "connected" | "disconnecting" | "error";
  host: string;
  user?: McUser;
  error?: string;
}

/** 云端任务(backend ProjectTask 的侧栏子集,字段与云端 JSON 一致)。
 * 实测线上 title 常为空、任务文案落在 summary,展示优先 title → summary → content。 */
export interface CloudTask {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  status?: "pending" | "processing" | "error" | "finished";
  created_at?: number;
  completed_at?: number;
  updated_at?: number;
  extra?: { project_id?: string; [key: string]: unknown };
}

export interface CloudTasksResp {
  tasks?: CloudTask[];
  page_info?: { total?: number; total_count?: number };
}

/** 云端任务提问索引条目(GET users/tasks/user-inputs;大纲数据源)。
 * content 已是解码明文(超 500 字符截断);timestamp 纳秒,与 chunk.timestamp
 * 对齐——大纲靠时间戳与帧流对表(seq 仅 ClickHouse 存储有,不可依赖)。 */
export interface CloudUserInputItem {
  id?: string;
  content?: string;
  timestamp?: number;
  seq?: number;
  truncated?: boolean;
}

export interface CloudUserInputsResp {
  items?: CloudUserInputItem[];
  next_cursor?: string;
  has_more?: boolean;
}

/** 云端项目；列表接口与 Web 侧栏一致，会附带项目下的最近任务。 */
export interface CloudProject {
  id?: string;
  name?: string;
  description?: string;
  full_name?: string;
  repo_url?: string;
  created_at?: number;
  updated_at?: number;
  tasks?: CloudTask[];
}

/** 项目行展开时按需拉取的任务(App 持有缓存,侧栏只读):三态互斥,
 * 都缺省 = 还没拉过。 */
export interface CloudProjectTasks {
  loading?: boolean;
  tasks?: CloudTask[];
  error?: string;
}

export interface CloudProjectsResp {
  projects?: CloudProject[];
  page?: { cursor?: string; has_more?: boolean };
}

/** 云端任务详情(ProjectTask 子集;VM 准备进度在 virtualmachine.conditions)。 */
export interface CloudTaskDetail extends CloudTask {
  model?: { id?: string; model?: string; remark?: string };
  branch?: string;
  repo_url?: string;
  full_name?: string;
  stats?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; llm_requests?: number };
  virtualmachine?: {
    id?: string;
    status?: string;
    conditions?: { type?: string; status?: number; message?: string; progress?: number }[];
  };
}

/** ws-closed 事件载荷:服务端 Close 帧的 code/reason(壳透传);
 * 异常断开(无 Close 帧)或壳侧主动断为 null。 */
export interface WsCloseInfo {
  code?: number;
  reason?: string;
}

/** repo_file_list 条目;entry_mode 4=目录 5=子模块(对齐 web task-shared.ts) */
export interface CloudRepoFile {
  name: string;
  path: string;
  entry_mode: number;
  size?: number;
  modified_at?: number;
}

export interface CloudFileChange {
  path: string;
  status: string; // M/A/D/R/RM/??
  additions?: number;
  deletions?: number;
  old_path?: string;
}

export interface UpdateStatus {
  available: boolean;
  current?: string;
  latest?: string;
}
