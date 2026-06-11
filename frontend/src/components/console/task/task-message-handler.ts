import { b64decode, deepMerge } from "@/utils/common"
import type { MessageType } from "./message"
import type {
  AvailableCommands,
  TaskPlan,
} from "./task-shared"
import { parseTaskUserInputPayload, type TaskUserInputPayload } from "./task-shared"

export type TaskMessageHandlerStatus = "inited" | "connected" | "finished" | "error"

// 统一时间戳到纳秒：后端 REST 给纳秒、WebSocket 给毫秒，根据数量级判断单位。
// 最后截到 10ms 边界——纳秒时间戳（~1.7e18）超出 Number.MAX_SAFE_INTEGER，不同 API
// 返回的同一条消息经 JSON 解析后浮点精度损失（~256ns）可能不同，截到 1ms 偶发跨界，
// 截到 10ms 彻底避免此问题，同时兼容 WS 已丢失 sub-ms 精度的场景。
function normalizeTimestampToNs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  let ns: number
  if (ts >= 1e17) ns = ts                    // 已经是纳秒
  else if (ts >= 1e14) ns = ts * 1_000       // 微秒 → 纳秒
  else if (ts >= 1e11) ns = ts * 1_000_000   // 毫秒 → 纳秒
  else ns = ts * 1_000_000_000               // 秒 → 纳秒
  return Math.floor(ns / 10_000_000) * 10_000_000
}

interface TaskMessageHandlerOptions {
  captureCursor?: boolean
}

interface TaskHistoryCursorState {
  cursor: string | null
  hasMore: boolean
  ready: boolean
}

export interface TaskMessageRawChunk {
  event?: string
  kind?: string
  data?: unknown
  timestamp?: number
}

export interface TaskMessageHandlerState {
  status: TaskMessageHandlerStatus
  messages: MessageType[]
  plan: TaskPlan
  availableCommands: AvailableCommands
  contextUsage: {
    size: number | null
    used: number | null
  }
  historyCursor: TaskHistoryCursorState
}

export class TaskMessageHandler {
  private readonly captureCursor: boolean

  state: TaskMessageHandlerState = {
    status: "inited",
    messages: [],
    plan: {
      entries: [],
      version: 0,
    },
    availableCommands: {
      commands: [],
      version: 0,
    },
    contextUsage: {
      size: null,
      used: null,
    },
    historyCursor: {
      cursor: null,
      hasMore: false,
      ready: false,
    },
  }

  constructor(options: TaskMessageHandlerOptions = {}) {
    this.captureCursor = !!options.captureCursor
  }

  reset() {
    this.state = {
      status: "inited",
      messages: [],
      plan: {
        entries: [],
        version: 0,
      },
      availableCommands: {
        commands: [],
        version: 0,
      },
      contextUsage: {
        size: null,
        used: null,
      },
      historyCursor: {
        cursor: null,
        hasMore: false,
        ready: false,
      },
    }
  }

  setConnected() {
    this.state.status = "connected"
    return this.getState()
  }

  setError() {
    this.failPendingToolCalls()
    this.state.status = "error"
    return this.getState()
  }

  finalizeCycle() {
    this.failPendingToolCalls()
    return this.getState()
  }

  pushChunk(chunk: TaskMessageRawChunk) {
    this.processMessage(chunk)
    return this.getState()
  }

  pushChunks(chunks: Iterable<TaskMessageRawChunk>) {
    for (const chunk of chunks) {
      this.processMessage(chunk)
    }
    return this.getState()
  }

  getState(): TaskMessageHandlerState {
    return {
      ...this.state,
      messages: [...this.state.messages],
      plan: {
        ...this.state.plan,
        entries: [...this.state.plan.entries],
      },
      availableCommands: {
        ...this.state.availableCommands,
        commands: [...this.state.availableCommands.commands],
      },
      contextUsage: {
        ...this.state.contextUsage,
      },
      historyCursor: {
        ...this.state.historyCursor,
      },
    }
  }

  getMessages() {
    return [...this.state.messages]
  }

  private createMessageId() {
    return `${Date.now()}-${Math.random()}`
  }

  private decodeChunkPayloadJSON(data: unknown) {
    if (typeof data !== "string") return null
    return JSON.parse(b64decode(data))
  }

  private applyUserInput(data: TaskUserInputPayload, timestamp: number) {
    // chunk.timestamp 不同来源单位不一致：
    //   - REST /rounds 是纳秒（ClickHouse UnixNano）
    //   - WebSocket 推送是毫秒（task.go: chunk.Timestamp / 1e6）
    // 这里统一归一化到纳秒，保证 user-input 的 id 跨来源稳定（同一条消息只产生一条 React item）
    // 且与后端 /user-inputs 返回的 id 严格对齐，方便侧边栏点击跳转。
    const tsNs = normalizeTimestampToNs(timestamp)
    const userInputId = tsNs > 0 ? `user-input-${tsNs}` : this.createMessageId()

    if (tsNs > 0) {
      const dup = this.state.messages.some(
        (m) => m.type === "user_input" && m.id === userInputId,
      )
      if (dup) return
    }

    const newMessage: MessageType = {
      id: userInputId,
      time: tsNs > 0 ? tsNs : timestamp,
      role: "user",
      data: {
        content: data.content,
        attachments: data.attachments,
      },
      type: "user_input",
    }
    this.state.messages.push(newMessage)
  }

  private applyUserCancel(timestamp: number) {
    const newMessage: MessageType = {
      id: this.createMessageId(),
      time: timestamp,
      role: "system",
      data: { content: "用户取消当前任务" },
      type: "system_message",
    }
    this.state.messages.push(newMessage)
  }

  private applyErrorMessage(data: any, timestamp: number) {
    const newMessage: MessageType = {
      id: this.createMessageId(),
      time: timestamp,
      type: "error_message",
      role: "agent",
      data,
    }
    this.state.messages.push(newMessage)
  }

  private applyAskUserQuestion(data: any, timestamp: number) {
    const newMessage: MessageType = {
      id: this.createMessageId(),
      time: timestamp,
      type: "ask_user_question",
      role: "agent",
      data: {
        askId: data.toolCall.toolCallId,
        status: "pending",
        questions: data.toolCall.rawInput.questions.map((question: any) => ({
          custom: !!question.custom,
          header: question.header,
          multiSelect: !!question.multiSelect,
          question: question.question,
          options: question.options.map((option: any) => ({
            label: option.label,
            description: option.description,
          })),
        })),
      },
    }
    this.state.messages.push(newMessage)
  }

  private applyReplyQuestion(data: any) {
    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "ask_user_question" && message.data.askId === data.request_id,
    )
    if (askQuestionIndex === -1) {
      return
    }

    const answers = JSON.parse(data.answers_json)
    const existingMessage = this.state.messages[askQuestionIndex]
    this.state.messages[askQuestionIndex] = {
      ...existingMessage,
      data: {
        questions: existingMessage.data.questions?.map((question: any) => ({
          ...question,
          answer: answers[question.question],
        })),
        askId: data.request_id,
        status: "completed",
      },
    }
  }

  private applyAgentMessageChunk(data: any, timestamp: number) {
    if (data.content.type !== "text") {
      return
    }

    const lastMsg = this.state.messages[this.state.messages.length - 1]

    if (lastMsg?.type === "agent_message_chunk") {
      lastMsg.data.content = (lastMsg.data.content || "") + (data.content.text || "")
    } else if (data.content.text?.trim().length > 0) {
      const newMessage: MessageType = {
        id: this.createMessageId(),
        time: timestamp,
        role: "agent",
        type: "agent_message_chunk",
        data: { content: data.content.text || "" },
      }
      this.state.messages.push(newMessage)
    }
  }

  private applyAgentThoughtChunk(data: any, timestamp: number) {
    if (data.content.type !== "text") {
      return
    }

    const lastMsg = this.state.messages[this.state.messages.length - 1]
    const text = data.content.text || ""

    if (lastMsg?.type === "agent_thought_chunk") {
      lastMsg.data.content = (lastMsg.data.content || "") + text
    } else {
      const newMessage: MessageType = {
        id: this.createMessageId(),
        time: timestamp,
        role: "agent",
        type: "agent_thought_chunk",
        data: { content: text },
      }
      this.state.messages.push(newMessage)
    }
  }

  private applyToolCall(data: any, timestamp: number) {
    const toolcallIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "tool_call" && message.data.toolCallId === data.toolCallId,
    )

    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "ask_user_question" && message.data.askId === data.toolCallId,
    )

    if (toolcallIndex === -1 && askQuestionIndex === -1 && data.sessionUpdate === "tool_call") {
      const newMessage: MessageType = {
        id: this.createMessageId(),
        time: timestamp,
        role: "agent",
        type: "tool_call",
        data: {
          kind: data.kind,
          status: data.status,
          title: data.title,
          toolCallId: data.toolCallId,
          rawInput: data.rawInput,
          rawOutput: data.rawOutput,
          content: data.content,
          locations: data.locations,
          _meta: data._meta,
        },
      }
      this.state.messages.push(newMessage)
    } else if (toolcallIndex !== -1 && data.sessionUpdate === "tool_call_update") {
      const existingMessage = this.state.messages[toolcallIndex]

      this.state.messages[toolcallIndex] = {
        ...existingMessage,
        data: {
          ...existingMessage.data,
          ...(data.kind && { kind: data.kind }),
          ...(data.status && { status: data.status }),
          ...(data.title && { title: data.title }),
          ...(data.rawInput && { rawInput: data.rawInput }),
          ...(data.rawOutput && { rawOutput: data.rawOutput }),
          ...(data.content && { content: data.content }),
          ...(data.locations && { locations: data.locations }),
          ...(data._meta && { _meta: deepMerge(existingMessage.data._meta || {}, data._meta) }),
        },
      }
    } else if (askQuestionIndex !== -1 && data.status && data.sessionUpdate === "tool_call_update") {
      const existingMessage = this.state.messages[askQuestionIndex]
      this.state.messages[askQuestionIndex] = {
        ...existingMessage,
        data: {
          ...existingMessage.data,
          status: data.status,
        },
      }
    }
  }

  private applyAlertMessage(text: string, level: "info" | "warning", timestamp: number) {
    const newMessage: MessageType = {
      id: this.createMessageId(),
      time: timestamp,
      role: "agent",
      type: "alert_message",
      data: { text, level },
    }

    this.state.messages.push(newMessage)
  }

  private applyLLMCallRetry(data: any, timestamp: number) {
    const update = data.update ?? {}
    const errorMessage = update.message || "未知错误"
    const text = typeof update.attempt === "number"
      ? `模型调用失败，正在重试第 ${update.attempt} 次：${errorMessage}`
      : `模型调用失败，正在重试：${errorMessage}`

    this.applyAlertMessage(text, "warning", timestamp)
  }

  private applyCompactStatus(data: any, timestamp: number) {
    const status = data.update?.status

    if (status === "started") {
      this.applyAlertMessage("启动上下文压缩", "info", timestamp)
    } else if (status === "ended") {
      this.applyAlertMessage("上下文压缩完成", "info", timestamp)
    }
  }

  private applyACPEvent(data: any, timestamp: number) {
    const messageType = data.update.sessionUpdate
    switch (messageType) {
      case "agent_message_chunk":
        this.applyAgentMessageChunk(data.update, timestamp)
        break
      case "agent_thought_chunk":
        this.applyAgentThoughtChunk(data.update, timestamp)
        break
      case "tool_call":
      case "tool_call_update":
        this.applyToolCall(data.update, timestamp)
        break
      case "available_commands_update":
        this.state.availableCommands = {
          commands: data.update.availableCommands,
          version: this.state.availableCommands.version + 1,
        }
        break
      case "plan":
        if (Array.isArray(data.update.entries)) {
          this.state.plan = {
            entries: data.update.entries,
            version: this.state.plan.version + 1,
          }
        }
        break
      case "usage_update":
        this.state.contextUsage = {
          size: typeof data.update.size === "number" ? data.update.size : this.state.contextUsage.size,
          used: typeof data.update.used === "number" ? data.update.used : this.state.contextUsage.used,
        }
        break
      case "llm_call_retry":
        this.applyLLMCallRetry(data, timestamp)
        break
      case "compact_status":
        this.applyCompactStatus(data, timestamp)
        break
      default:
        console.warn("TaskMessageHandler: unknown ACP sessionUpdate", data)
        break
    }
  }

  private failPendingToolCalls() {
    for (let i = 0; i < this.state.messages.length; i += 1) {
      const message = this.state.messages[i]
      if (message.type === "tool_call" && (message.data.status === "in_progress" || message.data.status === "pending")) {
        this.state.messages[i] = {
          ...message,
          data: {
            ...message.data,
            status: "failed",
          },
        }
      }
    }
  }

  private applyTaskEnded() {
    this.failPendingToolCalls()
    this.state.status = "finished"
  }

  private applyCursor(data: any) {
    this.state.historyCursor = {
      cursor: data?.cursor ?? null,
      hasMore: !!data?.has_more,
      ready: true,
    }
  }

  private processMessage(chunk: TaskMessageRawChunk) {
    const timestamp = chunk.timestamp ?? 0

    switch (chunk.event) {
      case "user-input":
        if (typeof chunk.data !== "string") return
        try {
          this.applyUserInput(parseTaskUserInputPayload(b64decode(chunk.data)), timestamp)
        } catch (error) {
          console.error("TaskMessageHandler: invalid user-input payload", error)
        }
        break
      case "user-cancel":
        this.applyUserCancel(timestamp)
        break
      case "task-started":
      case "ping":
        break
      case "task-running":
        if (chunk.kind === "acp_event") {
          this.applyACPEvent(this.decodeChunkPayloadJSON(chunk.data), timestamp)
        } else if (chunk.kind === "acp_ask_user_question") {
          this.applyAskUserQuestion(this.decodeChunkPayloadJSON(chunk.data), timestamp)
        }
        break
      case "task-ended":
        this.applyTaskEnded()
        break
      case "task-error":
        this.applyErrorMessage(this.decodeChunkPayloadJSON(chunk.data), timestamp)
        break
      case "reply-question":
        this.applyReplyQuestion(this.decodeChunkPayloadJSON(chunk.data))
        break
      case "cursor":
        if (this.captureCursor) {
          this.applyCursor(this.decodeChunkPayloadJSON(chunk.data))
        }
        break
      default:
        console.warn("TaskMessageHandler: unknown event type", chunk)
        break
    }
  }
}
