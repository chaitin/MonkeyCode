// 帧 → 对话流渲染项的归约:流式文本聚合、工具状态回写、审批卡片终态、
// AI 提问卡(ask_user_question)等。纯函数,不触 DOM。
import { b64decode, frameData } from "./codec";
import { stripSourceSuffix, stripTierPrefix } from "./modelMenu";
import { toolContentText, toolResultText } from "./toolDetails";
import type { AcpUpdate, AskQuestion, Frame, LogItem, PermOutcome, PlanEntry, SlashCommand, SubEntry, ToolProgress, Usage } from "./types";

export interface ChatState {
  items: LogItem[];
  running: boolean;
  usage: Usage | null;
  /** 实时任务清单(todo_update 全量重发;钉在 composer 上方的面板,不进对话流) */
  plan: PlanEntry[];
  /** 流式聚合目标:'agent' | 'thought' | ''(断流) */
  streamKind: string;
  /** 本轮结束时需要刷新改动计数 */
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
   * 同一条,ToolCard/ThoughtView 的展开态串位、整列重挂载(markdown 全部
   * 重解析)。 */
  keyBase: number;
}

export const initialChat: ChatState = {
  items: [],
  running: false,
  usage: null,
  plan: [],
  streamKind: "",
  turnEnded: false,
  model: "",
  think: "",
  permMode: "",
  commands: [],
  keyBase: 0,
};

/** 思考档位展示名(""=跟随模型默认;与 composer 的 ThinkPicker 同源) */
export const THINK_LABELS: Record<string, string> = {
  "": "默认",
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
};

const PERM_OUTCOME: Record<PermOutcome, string> = {
  approved: "已允许",
  denied: "已拒绝",
  timeout: "已超时(按拒绝处理)",
  cancelled: "已取消",
};

export function permStateLabel(state: string): string {
  switch (state) {
    case "allowed":
      return "已允许";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "(已过期)";
    default:
      return PERM_OUTCOME[state as PermOutcome] ?? state;
  }
}

/** 追加流式文本:与上一项同 kind 则合并,否则新开一项 */
function appendStream(s: ChatState, kind: "agent" | "thought", text: string, timestamp?: number): ChatState {
  const items = s.items.slice();
  const last = items[items.length - 1];
  if (s.streamKind === kind && last && last.kind === kind) {
    items[items.length - 1] = { ...last, text: last.text + text };
  } else {
    items.push({ kind, text, ...(kind === "agent" && timestamp !== undefined ? { timestamp } : {}) });
  }
  return { ...s, items, streamKind: kind };
}

function push(s: ChatState, item: LogItem): ChatState {
  return { ...s, items: [...s.items, item], streamKind: "" };
}

/** 轮次结束:未答复的审批卡片与提问卡片过期 */
function expirePerms(items: LogItem[]): LogItem[] {
  return items.map((it) =>
    (it.kind === "perm" || it.kind === "ask") && it.state === "open" ? { ...it, state: "expired" } : it,
  );
}

type ToolItem = Extract<LogItem, { kind: "tool" }>;
type UnknownRecord = Record<string, unknown>;

function unknownRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

/** 云端 _meta 会分多帧补齐，递归合并，避免后一个状态帧擦掉前面的 diff 信息。 */
function mergeUnknown(previous: unknown, next: unknown): unknown {
  if (next === undefined) return previous;
  const left = unknownRecord(previous);
  const right = unknownRecord(next);
  if (!left || !right) return next;
  const merged: UnknownRecord = { ...left };
  for (const [key, value] of Object.entries(right)) merged[key] = mergeUnknown(left[key], value);
  return merged;
}

function mergeToolUpdate(item: ToolItem, update: AcpUpdate): ToolItem {
  return {
    ...item,
    ...(update.title ? { title: update.title } : {}),
    ...(update.kind !== undefined ? { toolKind: update.kind } : {}),
    ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
    ...(update.content !== undefined ? { content: update.content } : {}),
    ...(update.locations !== undefined ? { locations: update.locations } : {}),
    ...(update._meta !== undefined ? { _meta: mergeUnknown(item._meta, update._meta) } : {}),
    ...(Array.isArray(update.images) ? { images: update.images } : {}),
  };
}

function mergeToolInState(s: ChatState, tcId: string, update: AcpUpdate): ChatState {
  const items = s.items.slice();
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "tool" || item.tcId !== tcId) continue;
    items[i] = mergeToolUpdate(item, update);
    return { ...s, items };
  }
  return s;
}

// ==================== AI 提问(ask_user_question,对齐 mobile handler.ts) ====================

/** 问题结构归一:multiple/multiSelect 兼容,options 只留 label/description */
function normalizeAskQuestions(raw: unknown, defaultMultiple: boolean): AskQuestion[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((q) => {
    const o = q as {
      question?: string;
      header?: string;
      multiple?: boolean;
      multiSelect?: boolean;
      custom?: boolean;
      options?: { label?: string; description?: string }[];
    };
    return {
      question: o?.question ?? "",
      header: o?.header,
      multiSelect: !!(o?.multiple ?? o?.multiSelect ?? defaultMultiple),
      // 自定义答案默认开启:引擎(ohmyagent)对答复零校验,任意文本都接受,
      // 且 UserQuestion schema 根本没有 custom 字段(它只是 UserAnswer 的
      // 回传标记)——按 !!custom 判定入口永远不亮;显式 false 才关闭
      custom: o?.custom !== false,
      options: (Array.isArray(o?.options) ? o.options : []).map((x) => ({
        label: x?.label ?? "",
        description: x?.description,
      })),
    };
  });
}

/** 从 tool_call/acp_ask_user_question 载荷里提取问题清单(rawInput 优先,_meta 兜底) */
function askQuestionsFrom(tc: AcpUpdate | Record<string, unknown>): AskQuestion[] | null {
  const t = tc as { rawInput?: { questions?: unknown; multiple?: boolean }; _meta?: { askUserQuestion?: { questions?: unknown; multiple?: boolean } } };
  const meta = t._meta?.askUserQuestion;
  const raw = Array.isArray(t.rawInput?.questions) ? t.rawInput.questions : meta?.questions;
  const defMulti = !!(t.rawInput?.multiple ?? meta?.multiple ?? false);
  return normalizeAskQuestions(raw, defMulti);
}

/** 该 tool_call 是否是"向用户提问"(title/kind 词汇 + 载荷里确有问题清单) */
function isAskToolCall(u: AcpUpdate): AskQuestion[] | null {
  const questions = askQuestionsFrom(u);
  if (!questions) return null;
  const norm = (v?: string) => (v ?? "").toLowerCase().trim().replace(/[_\s]+/g, "-");
  const title = norm(u.title);
  const kind = norm(u.kind);
  const hit =
    title === "question" ||
    title === "user-question" ||
    title.endsWith("-user-question") ||
    title.includes("ask-user-question") ||
    kind === "user-question" ||
    kind === "ask-user-question" ||
    (title === "" && kind === "");
  return hit ? questions : null;
}

/** 新建/更新提问卡:同 askId 原地更新(保留已答内容);占位工具卡原地替换 */
function upsertAsk(s: ChatState, askId: string, questions: AskQuestion[], completed: boolean): ChatState {
  const items = s.items.slice();
  const askIdx = items.findIndex((it) => it.kind === "ask" && it.askId === askId);
  if (askIdx >= 0) {
    const ask = items[askIdx] as Extract<LogItem, { kind: "ask" }>;
    const answered = new Map(
      ask.questions.filter((q) => q.answer !== undefined).map((q) => [q.question, q.answer] as const),
    );
    items[askIdx] = {
      ...ask,
      state: ask.state === "done" ? "done" : completed ? "done" : ask.state,
      questions: questions.map((q) => (answered.has(q.question) ? { ...q, answer: answered.get(q.question) } : q)),
    };
    return { ...s, items, streamKind: "" };
  }
  const next: LogItem = { kind: "ask", askId, state: completed ? "done" : "open", questions };
  const toolIdx = items.findIndex((it) => it.kind === "tool" && it.tcId === askId);
  if (toolIdx >= 0) {
    items[toolIdx] = next;
    return { ...s, items, streamKind: "" };
  }
  items.push(next);
  return { ...s, items, streamKind: "" };
}

/** 进度窗口在内存里保留的条数上限(渲染只取尾部几条,完整过程在子会话)。 */
const MAX_FEED = 200;

/** 执行期进度:更新对应工具项的进度窗口/输出行/子会话引用 */
function applyProgress(s: ChatState, tcId: string, p: ToolProgress): ChatState {
  const items = s.items.slice();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== "tool" || it.tcId !== tcId) continue;
    switch (p.kind) {
      case "subagent_tool": {
        let feed = (it.feed ?? []).slice();
        const idx = feed.findIndex((x) => x.kind === "tool" && x.id === p.id);
        const entry: SubEntry = {
          kind: "tool",
          id: p.id ?? String(feed.length),
          title: p.title ?? "",
          ...(p.rawInput !== undefined ? { rawInput: p.rawInput } : {}),
          status: (p.status as "run" | "ok" | "fail") ?? "run",
        };
        if (idx >= 0) {
          const prev = feed[idx] as Extract<SubEntry, { kind: "tool" }>;
          feed[idx] = {
            ...entry,
            title: entry.title || prev.title,
            ...(entry.rawInput !== undefined || prev.rawInput === undefined ? {} : { rawInput: prev.rawInput }),
          };
        } else {
          feed.push(entry);
          if (feed.length > MAX_FEED) feed = feed.slice(-MAX_FEED);
        }
        items[i] = { ...it, feed };
        break;
      }
      case "subagent_text": {
        if (!p.line) break;
        let feed = (it.feed ?? []).slice();
        feed.push({ kind: "text", text: p.line });
        if (feed.length > MAX_FEED) feed = feed.slice(-MAX_FEED);
        items[i] = { ...it, feed };
        break;
      }
      case "output":
        items[i] = { ...it, lastLine: p.line };
        break;
      case "child_session":
        items[i] = { ...it, childSessionId: p.childSessionId };
        break;
    }
    return { ...s, items };
  }
  return s;
}

function reduceAcp(s: ChatState, u: AcpUpdate, timestamp?: number): ChatState {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return appendStream(s, "agent", toolContentText(u.content), timestamp);
    case "agent_thought_chunk":
      return appendStream(s, "thought", toolContentText(u.content));
    case "tool_call": {
      // 云端 CLI 的"向用户提问"以 tool_call 形态出现,渲染为提问卡而非工具卡
      const askQs = isAskToolCall(u);
      if (askQs && u.toolCallId) return upsertAsk(s, u.toolCallId, askQs, u.status === "completed");
      const next = push(s, {
        kind: "tool",
        tcId: u.toolCallId ?? "",
        title: u.title || u.kind || "工具调用",
        ...(u.rawInput !== undefined ? { rawInput: u.rawInput } : {}),
        ...(u.kind !== undefined ? { toolKind: u.kind } : {}),
        ...(u.rawOutput !== undefined ? { rawOutput: u.rawOutput } : {}),
        ...(u.content !== undefined ? { content: u.content } : {}),
        ...(u.locations !== undefined ? { locations: u.locations } : {}),
        ...(u._meta !== undefined ? { _meta: u._meta } : {}),
        ...(Array.isArray(u.images) ? { images: u.images } : {}),
        ...(timestamp !== undefined ? { startedAt: timestamp } : {}),
        status: "run",
        out: "",
      });
      // 部分云端历史把完整终态直接放在 tool_call，而不再单独补 update。
      return u.status === "completed" || u.status === "failed" || u.status === "error" || u.status === "cancelled"
        ? reduceAcp(next, { ...u, sessionUpdate: "tool_call_update" })
        : u.progress ? applyProgress(next, u.toolCallId ?? "", u.progress) : next;
    }
    case "tool_call_update": {
      const askQs = isAskToolCall(u);
      if (askQs && u.toolCallId) return upsertAsk(s, u.toolCallId, askQs, u.status === "completed");
      // 已是提问卡的 toolCallId 只回写终态(completed → done)
      if (u.toolCallId && s.items.some((it) => it.kind === "ask" && it.askId === u.toolCallId)) {
        if (u.status !== "completed") return s;
        return {
          ...s,
          items: s.items.map((it) =>
            it.kind === "ask" && it.askId === u.toolCallId && it.state === "open" ? { ...it, state: "done" } : it,
          ),
        };
      }
      const terminal = u.status === "completed" || u.status === "failed" || u.status === "error" || u.status === "cancelled";
      if (!terminal) {
        // 注:已闭合卡也接受 progress——显式转后台的 Agent 卡先以
        // "已转入后台"文案 completed,后台代理继续流式,进度窗照常直播
        const merged = mergeToolInState(s, u.toolCallId ?? "", u);
        return u.progress ? applyProgress(merged, u.toolCallId ?? "", u.progress) : merged;
      }
      // 终态可重复回写:后台 Agent 卡的真实结果随 task_notification 迟到,
      // 驱动补发终态帧回填——后到者权威,直接覆写
      const items = s.items.slice();
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === "tool" && it.tcId === u.toolCallId) {
          const merged = mergeToolUpdate(it, u);
          const raw = toolResultText(merged.rawOutput, merged.content);
          const out = raw.split("\n")[0].slice(0, 160);
          const images = merged.images;
          const durationMs = it.durationMs ?? (
            timestamp !== undefined && it.startedAt !== undefined && timestamp >= it.startedAt
              ? timestamp - it.startedAt
              : undefined
          );
          const timing = durationMs !== undefined ? { durationMs } : {};
          const backgroundLaunch = raw.includes("子代理已转入后台继续执行");
          if (backgroundLaunch) {
            // Agent 工具调用虽已返回 completed,子代理仍在后台执行:卡片视觉
            // 上保持运行态,最终正文到达时再作为独立对话项展示。
            items[i] = { ...merged, status: "run", out: "后台运行中", result: undefined, images, lastLine: undefined, background: true };
            break;
          }
          if (it.background) {
            const error = u.status !== "completed";
            items[i] = {
              ...merged,
              status: error ? "fail" : "ok",
              out: error ? "后台执行失败" : "后台执行完成",
              result: raw,
              images,
              ...timing,
              lastLine: undefined,
              backgroundNoticePending: true,
            };
            return { ...s, items, streamKind: "" };
          }
          // 完整结果一并保留:子代理卡把最终产出按 markdown 展示,
          // 普通工具卡仅在失败时外显首行摘要
          items[i] = { ...merged, status: u.status === "completed" ? "ok" : "fail", out, result: raw, images, ...timing, lastLine: undefined };
          break;
        }
      }
      return { ...s, items };
    }
    case "plan":
      // 实时任务清单不进对话流:钉在 composer 上方的面板整卡更新
      // (引擎每次 Task*/TodoWrite 后全量重发;流内呈现无论追加还是
      // 原地更新都别扭——追加刷屏、固定没人看、跟随会跳)
      return { ...s, plan: u.entries ?? [] };
    case "llm_call_retry":
      return push(s, { kind: "sys", text: `模型调用重试 #${u.attempt ?? "?"}: ${u.message ?? ""}` });
    case "task_notification": {
      // 后台子代理完成通知(📌):独立系统行。不能走 agent_text——
      // appendStream 会把它并进正在流式的模型正文气泡。已回填后台卡时
      // 通知信息重复,消费卡上的 pending 标记但不再往对话流追加任何项。
      const items = s.items.slice();
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind !== "tool" || !it.backgroundNoticePending) continue;
        items[i] = { ...it, backgroundNoticePending: false };
        return { ...s, items, streamKind: "" };
      }
      return u.text ? push(s, { kind: "sys", text: u.text }) : s;
    }
    case "available_commands_update":
      // 斜杠指令清单是"此刻"的会话状态(全量重发,不是对话内容):只回写
      // 状态字段,不进对话流
      return { ...s, commands: (u.availableCommands ?? []).filter((c) => !!c?.name) };
    case "usage_update":
      return { ...s, usage: { used: u.used ?? 0, size: u.size ?? 0 } };
    case "compact_status": {
      const text =
        u.status === "started"
          ? "⟳ 上下文接近上限,正在压缩…"
          : u.status === "failed"
            ? "✗ 上下文压缩失败"
            : u.status === "cancelled"
              ? "⟳ 上下文压缩已取消"
              : "⟳ 上下文压缩完成";
      return push(s, {
        kind: "sys",
        text,
        ...(u.status === "failed" ? { error: true } : {}),
      });
    }
    case "model_update": {
      // 系统行外显短名(先剥 @来源#配置id 的寻址后缀,再剥会员档位前缀,
      // 与 modelMenu.modelDisplay 同序);状态 model 保持原始名——它是
      // 按 name 回查模型/think 档的键
      const name = u.model ?? "";
      const shown = stripTierPrefix(stripSourceSuffix(name));
      return { ...push(s, { kind: "sys", text: `模型已切换为 ${shown}` }), model: name };
    }
    case "think_update": {
      const level = u.think ?? "";
      const label = THINK_LABELS[level] ?? "默认";
      return { ...push(s, { kind: "sys", text: `思考深度已调整为「${label}」` }), think: level };
    }
    case "permission_mode_update": {
      const mode = u.mode ?? "default";
      const text =
        mode === "yolo" ? "⚡ 已开启 YOLO 模式:所有操作不再询问,直接执行" : "已恢复默认权限模式";
      return { ...push(s, { kind: "sys", text }), permMode: mode };
    }
    default:
      return s;
  }
}

export function reduceFrame(s: ChatState, f: Frame): ChatState {
  switch (f.type) {
    case "task-started":
      // plan/todo 是轮次级状态:上一轮的最终清单可在结束后保留供回顾,
      // 新一轮开始时只清掉已全部完成的清单;还有未完成项则跨轮保留,
      // 直到本轮 plan 帧继续更新它。
      return { ...s, running: true, plan: s.plan.length > 0 && s.plan.every((e) => e.status === "completed") ? [] : s.plan };
    case "task-ended":
      return {
        ...s,
        running: false,
        streamKind: "",
        turnEnded: true,
        items: [...expirePerms(s.items), { kind: "sys", text: "— 本轮结束 —" }],
      };
    case "task-error": {
      const data = frameData<{ error?: string; terminal?: boolean }>(f);
      const terminal = data?.terminal !== false;
      return {
        ...s,
        running: terminal ? false : s.running,
        streamKind: "",
        items: [
          ...(terminal ? expirePerms(s.items) : s.items),
          { kind: "sys", text: "✗ " + (data?.error || "未知错误"), error: true },
        ],
      };
    }
    case "user-input": {
      const data = frameData<{ content?: string; attachments?: { url?: string; filename?: string }[] }>(f);
      let text = "";
      try {
        text = data?.content ? b64decode(data.content) : "";
      } catch {
        text = data?.content ?? "";
      }
      // 云端附件({url, filename},与 web/mobile 契约一致):缺 filename 的
      // 旧帧用 URL 末段兜底;本地会话帧无此字段,不受影响
      const atts = (data?.attachments ?? [])
        .filter((a) => !!a?.url)
        .map((a) => ({ url: a.url!, filename: a.filename || a.url!.split("/").pop() || "附件" }));
      return push(s, {
        kind: "user",
        text,
        ...(f.timestamp !== undefined ? { timestamp: f.timestamp } : {}),
        // 大纲跳转的锚:壳的 session_outline 条目按同一 seq 对表
        ...(f.seq !== undefined ? { seq: f.seq } : {}),
        // 有才写:undefined/空数组键会污染测试的全等比较,语义上也该缺席
        ...(atts.length ? { attachments: atts } : {}),
      });
    }
    case "permission-req": {
      const data = frameData<{ id?: string; title?: string; tool?: string; tool_call_id?: string }>(f);
      if (!data?.id) return s;
      return push(s, {
        kind: "perm",
        id: data.id,
        title: data.title ?? "",
        tool: data.tool ?? "",
        state: "open",
        // 有才写:undefined 键会污染测试的 toEqual 全等比较,且语义上
        // "没有锚点"就该是字段缺席而非空值
        ...(data.tool_call_id ? { toolCallId: data.tool_call_id } : {}),
      });
    }
    case "permission-resolved": {
      const data = frameData<{ id?: string; outcome?: string }>(f);
      if (!data?.id) return s;
      return {
        ...s,
        items: s.items.map((it) =>
          it.kind === "perm" && it.id === data.id && it.state === "open"
            ? { ...it, state: (data.outcome as PermOutcome) ?? "expired" }
            : it,
        ),
      };
    }
    case "task-running":
      if (f.kind === "acp_event") {
        const data = frameData<{ update?: AcpUpdate }>(f);
        if (data?.update) return reduceAcp(s, data.update, f.timestamp);
        return s;
      }
      if (f.kind === "acp_ask_user_question") {
        // 云端专用帧:{toolCall:{toolCallId, rawInput.questions, ...}}
        const data = frameData<{ toolCall?: AcpUpdate & Record<string, unknown> }>(f);
        const tc = data?.toolCall;
        const id = tc?.toolCallId;
        const qs = tc ? askQuestionsFrom(tc) : null;
        if (id && qs) return upsertAsk(s, id, qs, tc?.status === "completed");
        return s;
      }
      return s;
    case "reply-question": {
      // 答案回显/回放:request_id 即 askId,answers_json = {问题: 答案}
      const data = frameData<{ request_id?: string; answers_json?: string; cancelled?: boolean }>(f);
      if (!data?.request_id) return s;
      let answers: Record<string, string | string[]> = {};
      try {
        answers = JSON.parse(data.answers_json ?? "{}") as Record<string, string | string[]>;
      } catch {
        /* 坏载荷按无答案处理 */
      }
      return {
        ...s,
        items: s.items.map((it) =>
          it.kind === "ask" && it.askId === data.request_id
            ? { ...it, state: "done", questions: it.questions.map((q) => ({ ...q, answer: answers[q.question] })) }
            : it,
        ),
      };
    }
    default:
      return s;
  }
}

/** 本地答复提问卡(提交后立即回写 UI,不等 reply-question 回显) */
export function answerAsk(s: ChatState, askId: string, answers: Record<string, string | string[]>): ChatState {
  return {
    ...s,
    items: s.items.map((it) =>
      it.kind === "ask" && it.askId === askId && it.state === "open"
        ? { ...it, state: "done", questions: it.questions.map((q) => ({ ...q, answer: answers[q.question] })) }
        : it,
    ),
  };
}

export function reduceBatch(s: ChatState, batch: Frame[]): ChatState {
  let next = s;
  for (const f of batch) next = reduceFrame(next, f);
  return next;
}

/** 「加载更早」:把更早的一段历史帧归约后插到最前。
 *
 * 更早那段单独归约(不是接着当前状态跑):它只贡献 items——running/usage/
 * plan 都是"此刻"的状态,让过去的帧回写会把现状覆盖成历史值。keyBase 同步
 * 左移,既有条目的渲染 key 不变。 */
export function prependBatch(s: ChatState, batch: Frame[]): ChatState {
  const older = reduceBatch(initialChat, batch);
  if (older.items.length === 0) return s;
  return {
    ...s,
    items: [...older.items, ...s.items],
    keyBase: s.keyBase - older.items.length,
  };
}

/** 待决审批 → 工具卡锚定(tcId → perm 项)。审批 UX 终态:perm 带
 * toolCallId 且流里存在同 id 的工具卡(引擎保证 tool_call 帧先于
 * permission-req 到达)时,审批按钮嵌进那张工具卡内部,独立审批大卡
 * 不再渲染;已决(state 非 open)即解除锚定,按钮行消失、卡片回归
 * 正常 run/ok/fail 流转。纯函数放归约层而非组件:锚定是状态推导,
 * LogList 与测试共用同一份判定。 */
export function permAnchors(items: LogItem[]): Map<string, Extract<LogItem, { kind: "perm" }>> {
  const tools = new Set<string>();
  for (const it of items) if (it.kind === "tool" && it.tcId) tools.add(it.tcId);
  const map = new Map<string, Extract<LogItem, { kind: "perm" }>>();
  for (const it of items) {
    if (it.kind === "perm" && it.state === "open" && it.toolCallId && tools.has(it.toolCallId)) {
      map.set(it.toolCallId, it);
    }
  }
  return map;
}

/** 本地答复审批卡片(点击按钮后立即回写 UI,不等 resolved 帧) */
export function answerPerm(s: ChatState, id: string, approved: boolean): ChatState {
  return {
    ...s,
    items: s.items.map((it) =>
      it.kind === "perm" && it.id === id && it.state === "open"
        ? { ...it, state: approved ? "allowed" : "rejected" }
        : it,
    ),
  };
}
