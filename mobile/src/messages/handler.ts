/**
 * 任务对话解码 —— 移植自 Web 端
 * `frontend/src/components/console/task/task-message-handler.ts`。
 *
 * 有状态处理器：既用于 rounds 历史（一次性 push 全部 chunk），
 * 也用于 WebSocket 实时流（逐条 push，增量累积 agent 文本）。
 *
 * 事件结构（event 即流里的 type）：
 *   - user-input        : data(base64) -> { content(base64文本), attachments }
 *   - task-running + acp_event             : data(base64) -> { update:{ sessionUpdate, ... } }
 *   - task-running + acp_ask_user_question : 提问
 *   - task-error / task-ended / user-cancel / cursor / reply-question
 */
import type { TaskChunkEntry } from '@/api/types';
import { base64DecodeToString } from './base64';

export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
  answer?: string | string[];
}

/** 用户消息里的图片附件（url 为对象存储可访问地址）。 */
export interface MessageAttachment {
  url: string;
  filename?: string;
}

export type ChatMessage =
  | { id: string; kind: 'user'; text: string; attachments?: MessageAttachment[]; time?: number }
  | { id: string; kind: 'agent'; text: string; time?: number }
  | { id: string; kind: 'thought'; text: string; time?: number }
  | {
      id: string;
      kind: 'tool';
      toolCallId?: string;
      title: string;
      status?: string;
      toolKind?: string;
      // ACP 工具调用的原始入参/产物/内容 —— 用于消息流里两行标题（动作 + 目标）与展开详情。
      rawInput?: any;
      rawOutput?: any;
      content?: any;
      time?: number;
    }
  | { id: string; kind: 'error'; text: string; time?: number }
  | { id: string; kind: 'system'; text: string; time?: number }
  | {
      id: string;
      kind: 'ask';
      askId: string;
      status: string;
      questions: AskQuestion[];
      time?: number;
    };

export type HandlerStatus = 'inited' | 'connected' | 'finished' | 'error';

export interface HistoryCursor {
  cursor: string | null;
  hasMore: boolean;
  ready: boolean;
}

export interface ContextUsage {
  size: number | null;
  used: number | null;
}

/** Agent 上报的可用斜杠指令（slash commands）。 */
export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string | null } | null;
}

export interface HandlerState {
  status: HandlerStatus;
  messages: ChatMessage[];
  plan: { content: string; status: string }[];
  historyCursor: HistoryCursor;
  contextUsage: ContextUsage;
  availableCommands: AvailableCommand[];
}

export interface RawChunk {
  event?: string;
  kind?: string;
  data?: unknown;
  timestamp?: number;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `m${seq}`;
}

function decodeJSON(data: unknown): any {
  if (typeof data !== 'string' || !data) return null;
  try {
    return JSON.parse(base64DecodeToString(data));
  } catch {
    return null;
  }
}

export class TaskMessageHandler {
  private captureCursor: boolean;
  status: HandlerStatus = 'inited';
  messages: ChatMessage[] = [];
  plan: { content: string; status: string }[] = [];
  historyCursor: HistoryCursor = { cursor: null, hasMore: false, ready: false };
  contextUsage: ContextUsage = { size: null, used: null };
  availableCommands: AvailableCommand[] = [];

  constructor(opts: { captureCursor?: boolean } = {}) {
    this.captureCursor = !!opts.captureCursor;
  }

  setConnected(): HandlerState {
    this.status = 'connected';
    return this.getState();
  }

  setError(): HandlerState {
    this.failPendingToolCalls();
    this.status = 'error';
    return this.getState();
  }

  finalizeCycle(): HandlerState {
    this.failPendingToolCalls();
    return this.getState();
  }

  pushChunk(chunk: RawChunk): HandlerState {
    this.processMessage(chunk);
    return this.getState();
  }

  pushChunks(chunks: Iterable<RawChunk>): HandlerState {
    for (const c of chunks) this.processMessage(c);
    return this.getState();
  }

  getState(): HandlerState {
    return {
      status: this.status,
      messages: [...this.messages],
      plan: [...this.plan],
      historyCursor: { ...this.historyCursor },
      contextUsage: { ...this.contextUsage },
      availableCommands: [...this.availableCommands],
    };
  }

  private failPendingToolCalls() {
    for (const m of this.messages) {
      if (m.kind === 'tool' && (m.status === 'in_progress' || m.status === 'pending')) {
        m.status = 'failed';
      }
    }
  }

  private processMessage(chunk: RawChunk) {
    const time = chunk.timestamp ?? 0;
    switch (chunk.event) {
      case 'user-input': {
        const payload = decodeJSON(chunk.data);
        if (!payload) break;
        let content = typeof payload.content === 'string' ? payload.content : '';
        try {
          content = base64DecodeToString(content);
        } catch {
          /* keep */
        }
        const attachments: MessageAttachment[] = Array.isArray(payload.attachments)
          ? payload.attachments
              .map((a: any) => ({
                url: typeof a?.url === 'string' ? a.url : '',
                filename: typeof a?.filename === 'string' ? a.filename : undefined,
              }))
              .filter((a: MessageAttachment) => !!a.url)
          : [];
        if (content.trim().length > 0 || attachments.length > 0) {
          this.messages.push({
            id: nextId(),
            kind: 'user',
            text: content,
            attachments: attachments.length ? attachments : undefined,
            time,
          });
        }
        break;
      }
      case 'user-cancel':
        this.messages.push({ id: nextId(), kind: 'system', text: '已请求取消当前执行', time });
        break;
      case 'task-started':
      case 'ping':
      case 'task-event':
        break;
      case 'task-running':
        if (chunk.kind === 'acp_event') {
          this.applyAcpEvent(decodeJSON(chunk.data), time);
        } else if (chunk.kind === 'acp_ask_user_question') {
          this.applyAskUserQuestion(decodeJSON(chunk.data), time);
        }
        break;
      case 'task-ended':
        this.failPendingToolCalls();
        this.status = 'finished';
        break;
      case 'task-error': {
        const data = decodeJSON(chunk.data);
        // 完整错误在 details（web 端 message-error 渲染的就是 data.details）；message/error 往往只是
        // “task execution failed” 这类泛化分类，故优先取 details。
        const text = data?.details || data?.message || data?.error || '任务出错';
        this.failPendingToolCalls();
        this.messages.push({ id: nextId(), kind: 'error', text: String(text), time });
        break;
      }
      case 'reply-question':
        this.applyReplyQuestion(decodeJSON(chunk.data));
        break;
      case 'cursor':
        if (this.captureCursor) {
          const data = decodeJSON(chunk.data) ?? (typeof chunk.data === 'object' ? chunk.data : null);
          this.historyCursor = {
            cursor: (data as any)?.cursor ?? null,
            hasMore: !!(data as any)?.has_more,
            ready: true,
          };
        }
        break;
      default:
        break;
    }
  }

  private applyAcpEvent(data: any, time: number) {
    const update = data?.update;
    if (!update) return;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content?.type !== 'text') return;
        const text = update.content.text || '';
        const last = this.messages[this.messages.length - 1];
        // 不可变更新：替换为新对象，否则 FlashList/React.memo 检测不到文本增长（流式更新会丢）。
        if (last?.kind === 'agent')
          this.messages[this.messages.length - 1] = { ...last, text: last.text + text };
        else if (text.trim().length > 0)
          this.messages.push({ id: nextId(), kind: 'agent', text, time });
        break;
      }
      case 'agent_thought_chunk': {
        if (update.content?.type !== 'text') return;
        const text = update.content.text || '';
        const last = this.messages[this.messages.length - 1];
        // 不可变更新（同 agent）：替换为新对象，保证思考块的后续流式文本能刷新。
        if (last?.kind === 'thought')
          this.messages[this.messages.length - 1] = { ...last, text: last.text + text };
        else this.messages.push({ id: nextId(), kind: 'thought', text, time });
        break;
      }
      case 'tool_call': {
        this.messages.push({
          id: nextId(),
          kind: 'tool',
          toolCallId: update.toolCallId,
          title: update.title || '工具调用',
          status: update.status,
          toolKind: update.kind,
          rawInput: update.rawInput,
          rawOutput: update.rawOutput,
          content: update.content,
          time,
        });
        break;
      }
      case 'tool_call_update': {
        // 优先按 toolCallId 匹配 tool；其次匹配 ask 的状态。
        // 不可变更新：定位下标后替换为新对象，保证状态/标题变化能触发重渲染。
        let toolIdx = -1;
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const m = this.messages[i];
          if (m.kind === 'tool' && m.toolCallId === update.toolCallId) { toolIdx = i; break; }
        }
        if (toolIdx >= 0) {
          const tool = this.messages[toolIdx];
          if (tool.kind === 'tool')
            this.messages[toolIdx] = {
              ...tool,
              status: update.status ?? tool.status,
              title: update.title ?? tool.title,
              toolKind: update.kind ?? tool.toolKind,
              rawInput: update.rawInput ?? tool.rawInput,
              rawOutput: update.rawOutput ?? tool.rawOutput,
              content: update.content ?? tool.content,
            };
          break;
        }
        const askIdx = this.messages.findIndex(
          (m) => m.kind === 'ask' && m.askId === update.toolCallId,
        );
        if (askIdx >= 0 && update.status) {
          const ask = this.messages[askIdx];
          if (ask.kind === 'ask') this.messages[askIdx] = { ...ask, status: update.status };
        }
        break;
      }
      case 'available_commands_update': {
        this.availableCommands = Array.isArray(update.availableCommands) ? update.availableCommands : [];
        break;
      }
      case 'plan': {
        if (Array.isArray(update.entries)) {
          this.plan = update.entries.map((e: any) => ({
            content: e.content ?? '',
            status: e.status ?? '',
          }));
        }
        break;
      }
      case 'usage_update': {
        this.contextUsage = {
          size: typeof update.size === 'number' ? update.size : this.contextUsage.size,
          used: typeof update.used === 'number' ? update.used : this.contextUsage.used,
        };
        break;
      }
      case 'compact_status': {
        const status = data?.update?.status;
        if (status === 'started')
          this.messages.push({ id: nextId(), kind: 'system', text: '启动上下文压缩', time });
        else if (status === 'ended')
          this.messages.push({ id: nextId(), kind: 'system', text: '上下文压缩完成', time });
        break;
      }
      case 'llm_call_retry': {
        const u = data?.update ?? {};
        const msg =
          typeof u.attempt === 'number'
            ? `模型调用失败，正在重试第 ${u.attempt} 次：${u.message || ''}`
            : `模型调用失败，正在重试：${u.message || ''}`;
        this.messages.push({ id: nextId(), kind: 'system', text: msg, time });
        break;
      }
      default:
        break;
    }
  }

  private applyAskUserQuestion(data: any, time: number) {
    const toolCall = data?.toolCall;
    if (!toolCall) return;
    const rawQuestions = toolCall.rawInput?.questions ?? [];
    this.messages.push({
      id: nextId(),
      kind: 'ask',
      askId: toolCall.toolCallId,
      status: 'pending',
      time,
      questions: rawQuestions.map((q: any) => ({
        question: q.question,
        header: q.header,
        multiSelect: !!q.multiSelect,
        options: (q.options ?? []).map((o: any) => ({
          label: o.label,
          description: o.description,
        })),
      })),
    });
  }

  private applyReplyQuestion(data: any) {
    if (!data?.request_id) return;
    const idx = this.messages.findIndex((m) => m.kind === 'ask' && m.askId === data.request_id);
    if (idx < 0) return;
    const ask = this.messages[idx];
    if (ask.kind !== 'ask') return;
    let answers: Record<string, string | string[]> = {};
    try {
      answers = JSON.parse(data.answers_json);
    } catch {
      /* ignore */
    }
    // 不可变更新：替换为新对象，保证「已回答」状态与选项能即时刷新。
    this.messages[idx] = {
      ...ask,
      status: 'completed',
      questions: ask.questions.map((q) => ({ ...q, answer: answers[q.question] })),
    };
  }
}

/** rounds 历史：一次性解码一批 chunk，返回消息与计划。 */
export function decodeChunks(chunks: TaskChunkEntry[]): {
  messages: ChatMessage[];
  plan: { content: string; status: string }[];
  status: HandlerStatus;
} {
  const handler = new TaskMessageHandler();
  handler.pushChunks(chunks as RawChunk[]);
  const s = handler.finalizeCycle();
  return { messages: s.messages, plan: s.plan, status: s.status };
}
