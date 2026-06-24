import { b64decode, deepMerge } from "@/utils/common"
import type { MessageType } from "./message"
import type {
  AvailableCommands,
  TaskPlan,
} from "./task-shared"
import { parseTaskUserInputPayload, type TaskUserInputPayload } from "./task-shared"
import { taskDetailT } from "./task-i18n"

export type TaskMessageHandlerStatus = "inited" | "connected" | "finished" | "error"

// Normalize timestamps to nanoseconds, then snap them to a 10 ms boundary.
// REST returns nanoseconds while WebSocket chunks return milliseconds. Nanosecond
// timestamps exceed Number.MAX_SAFE_INTEGER, so snapping keeps IDs stable.
function normalizeTimestampToNs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  let ns: number
  if (ts >= 1e17) ns = ts
  else if (ts >= 1e14) ns = ts * 1_000
  else if (ts >= 1e11) ns = ts * 1_000_000
  else ns = ts * 1_000_000_000
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
      data: { content: taskDetailT("system.userCanceled") },
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

  private normalizeAskUserQuestions(rawQuestions: any, defaultMultiple = false) {
    if (!Array.isArray(rawQuestions)) {
      return null
    }

    return rawQuestions.map((question: any) => {
      const multiple = question?.multiple ?? question?.multiSelect ?? defaultMultiple

      return {
        custom: !!question?.custom,
        header: question?.header,
        multiSelect: !!multiple,
        question: question?.question,
        options: (Array.isArray(question?.options) ? question.options : []).map((option: any) => ({
          label: option?.label,
          description: option?.description,
        })),
      }
    })
  }

  private getAskUserQuestionRawQuestions(toolCall: any) {
    return Array.isArray(toolCall?.rawInput?.questions)
      ? toolCall.rawInput.questions
      : toolCall?._meta?.askUserQuestion?.questions
  }

  private getAskUserQuestionDefaultMultiple(toolCall: any) {
    return !!(toolCall?.rawInput?.multiple ?? toolCall?._meta?.askUserQuestion?.multiple ?? false)
  }

  private isUserQuestionToolCall(data: any) {
    const questions = this.normalizeAskUserQuestions(
      this.getAskUserQuestionRawQuestions(data),
      this.getAskUserQuestionDefaultMultiple(data),
    )
    if (!questions) {
      return false
    }

    const title = typeof data?.title === "string" ? data.title : ""
    const kind = typeof data?.kind === "string" ? data.kind : ""
    const normalizedTitle = title.toLowerCase().trim().replace(/[_\s]+/g, "-")
    const normalizedKind = kind.toLowerCase().trim().replace(/[_\s]+/g, "-")

    return (
      normalizedTitle === "question"
      || normalizedTitle === "user-question"
      || normalizedTitle.endsWith("-user-question")
      || normalizedTitle.includes("ask-user-question")
      || normalizedKind === "user-question"
      || normalizedKind === "ask-user-question"
      || (title === "" && kind === "")
    )
  }

  private upsertAskUserQuestionFromToolCall(toolCall: any, timestamp: number) {
    const askId = toolCall?.toolCallId
    const questions = this.normalizeAskUserQuestions(
      this.getAskUserQuestionRawQuestions(toolCall),
      this.getAskUserQuestionDefaultMultiple(toolCall),
    )

    if (!askId || !questions) {
      return false
    }

    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "ask_user_question" && message.data.askId === askId,
    )
    const toolcallIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "tool_call" && message.data.toolCallId === askId,
    )
    const nextMessage: MessageType = {
      id: this.createMessageId(),
      time: timestamp,
      type: "ask_user_question",
      role: "agent",
      data: {
        askId,
        status: toolCall?.status || "pending",
        questions,
      },
    }

    if (askQuestionIndex !== -1) {
      const existingMessage = this.state.messages[askQuestionIndex]
      const existingAnswers = new Map(
        (existingMessage.data.questions ?? [])
          .filter((question: any) => question.answer !== undefined)
          .map((question: any) => [question.question, question.answer]),
      )
      const mergedQuestions = questions.map((question: any) => (
        existingAnswers.has(question.question)
          ? {
            ...question,
            answer: existingAnswers.get(question.question),
          }
          : question
      ))

      this.state.messages[askQuestionIndex] = {
        ...existingMessage,
        data: {
          ...existingMessage.data,
          status: existingMessage.data.status === "completed"
            ? "completed"
            : toolCall?.status || existingMessage.data.status || "pending",
          questions: mergedQuestions,
        },
      }
      return true
    }

    if (toolcallIndex !== -1) {
      this.state.messages[toolcallIndex] = nextMessage
      return true
    }

    this.state.messages.push(nextMessage)
    return true
  }

  private applyAskUserQuestion(data: any, timestamp: number) {
    this.upsertAskUserQuestionFromToolCall({
      ...data?.toolCall,
      status: "pending",
    }, timestamp)
  }

  applyOptimisticReplyQuestion(requestId: string, answers: unknown) {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return false
    }

    return this.applyReplyQuestionAnswers(requestId, answers as Record<string, unknown>)
  }

  private applyReplyQuestionAnswers(requestId: string, answers: Record<string, unknown>, status?: string) {
    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === "ask_user_question" && message.data.askId === requestId,
    )
    if (askQuestionIndex === -1) {
      return false
    }

    const existingMessage = this.state.messages[askQuestionIndex]
    this.state.messages[askQuestionIndex] = {
      ...existingMessage,
      data: {
        ...existingMessage.data,
        questions: existingMessage.data.questions?.map((question: any) => ({
          ...question,
          answer: answers[question.question],
        })),
        askId: requestId,
        ...(status && { status }),
      },
    }

    return true
  }

  private applyReplyQuestion(data: any) {
    const answers = JSON.parse(data.answers_json)
    this.applyReplyQuestionAnswers(data.request_id, answers, "completed")
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
    if (this.isUserQuestionToolCall(data)) {
      this.upsertAskUserQuestionFromToolCall(data, timestamp)
      return
    }

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
    const errorMessage = update.message || taskDetailT("alert.unknownError")
    const text = typeof update.attempt === "number"
      ? taskDetailT("alert.llmRetryAttempt", { attempt: update.attempt, message: errorMessage })
      : taskDetailT("alert.llmRetry", { message: errorMessage })

    this.applyAlertMessage(text, "warning", timestamp)
  }

  private applyCompactStatus(data: any, timestamp: number) {
    const status = data.update?.status

    if (status === "started") {
      this.applyAlertMessage(taskDetailT("alert.compactStarted"), "info", timestamp)
    } else if (status === "ended") {
      this.applyAlertMessage(taskDetailT("alert.compactEnded"), "info", timestamp)
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
