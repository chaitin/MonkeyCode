import { b64encode } from "@/utils/common"
import {
  TaskMessageHandler,
  type TaskMessageHandlerState,
  type TaskMessageRawChunk,
} from "./task-message-handler"

const normalizeTimestampToMilliseconds = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return timestamp
  if (timestamp >= 1e17) return Math.floor(timestamp / 1e6)
  if (timestamp >= 1e14) return Math.floor(timestamp / 1e3)
  if (timestamp >= 1e11) return Math.floor(timestamp)
  return Math.floor(timestamp * 1000)
}

export interface TaskStreamClientState extends TaskMessageHandlerState {
  executionTimeMs: number
}

interface TaskStreamClientBaseOptions {
  taskId: string
  onStateChange?: (state: TaskStreamClientState) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
  captureCursor?: boolean
  mode?: TaskStreamClientMode
}

export type TaskStreamClientAttachOptions = TaskStreamClientBaseOptions

export interface TaskStreamClientNewOptions extends TaskStreamClientBaseOptions {
  userInput: string
}

interface TaskStreamServerChunk {
  type?: string
  kind?: string
  data?: unknown
  timestamp?: number
}

type TaskStreamClientMode = "attach" | "new"

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
const MAX_TRACKED_CHUNKS = 2000

export class TaskStreamClient {
  private readonly taskId: string
  private readonly initialMode: TaskStreamClientMode
  private readonly onStateChange?: (state: TaskStreamClientState) => void
  private readonly onOpen?: () => void
  private readonly onClose?: (event: CloseEvent) => void
  private readonly captureCursor: boolean

  private mode: TaskStreamClientMode
  private messageHandler: TaskMessageHandler
  private socket: WebSocket | null = null
  private initialUserInput: string | null = null
  private manuallyDisconnected = false
  private executionStartedAt: number | null = null
  private executionTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private hasReceivedTaskEnded = false
  private processedChunkKeys = new Set<string>()
  private processedChunkOrder: string[] = []

  private constructor({
    taskId,
    onStateChange,
    onOpen,
    onClose,
    captureCursor = false,
    mode,
  }: TaskStreamClientBaseOptions) {
    this.taskId = taskId
    this.initialMode = mode ?? "attach"
    this.mode = this.initialMode
    this.onStateChange = onStateChange
    this.onOpen = onOpen
    this.onClose = onClose
    this.captureCursor = captureCursor
    this.messageHandler = new TaskMessageHandler({ captureCursor })
  }

  static attach(options: TaskStreamClientAttachOptions) {
    return new TaskStreamClient({ ...options, captureCursor: true, mode: "attach" })
  }

  static new({ userInput, ...options }: TaskStreamClientNewOptions) {
    const client = new TaskStreamClient({ ...options, mode: "new" })
    client.initialUserInput = userInput
    return client
  }

  connect() {
    this.disconnect()
    this.manuallyDisconnected = false
    this.mode = this.initialMode
    this.executionStartedAt = null
    this.hasReceivedTaskEnded = false
    this.reconnectAttempts = 0
    this.clearReconnectTimer()
    this.resetProcessedChunks()
    this.messageHandler = new TaskMessageHandler({ captureCursor: this.captureCursor })

    this.openSocket()
  }

  private openSocket() {
    this.socket = new WebSocket(this.buildStreamUrl())
    this.socket.onopen = () => {
      this.reconnectAttempts = 0
      this.clearReconnectTimer()
      this.emitState(this.messageHandler.setConnected())

      if (this.initialUserInput) {
        this.sendInitialUserInput(this.initialUserInput)
        this.initialUserInput = null
      }

      this.onOpen?.()
    }

    this.socket.onmessage = (event) => {
      try {
        const chunk = JSON.parse(event.data) as TaskStreamServerChunk
        this.handleServerChunk(chunk)
      } catch (error) {
        console.error("TaskStreamClient: failed to parse message", error)
      }
    }

    this.socket.onerror = (_event) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        return
      }
    }

    this.socket.onclose = (event) => {
      this.socket = null
      if (!this.manuallyDisconnected && !this.hasReceivedTaskEnded) {
        this.scheduleReconnect()
        return
      }
      this.onClose?.(event)
    }
  }

  disconnect() {
    this.stopExecutionTimer()
    this.clearReconnectTimer()
    if (!this.socket) return this.getState()

    const currentState = this.messageHandler.getState()
    if (currentState.status !== "finished" && !this.hasReceivedTaskEnded) {
      this.emitState(this.messageHandler.finalizeCycle())
    }

    this.manuallyDisconnected = true
    this.socket.close()
    this.socket = null
    return this.getState()
  }

  getState() {
    return this.buildState(this.messageHandler.getState())
  }

  sendCancel() {
    this.sendMessage({
      type: "user-cancel",
    })
  }

  sendReplyQuestion(requestId: string, answers: unknown) {
    this.sendMessage({
      type: "reply-question",
      data: b64encode(JSON.stringify({
        request_id: requestId,
        answers_json: JSON.stringify(answers),
        cancelled: false,
      })),
    })
  }

  private sendMessage(type: { type: string; data?: string }) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(type))
  }

  private sendInitialUserInput(content: string) {
    this.sendMessage({
      type: "user-input",
      data: b64encode(content),
    })
  }

  private handleServerChunk(chunk: TaskStreamServerChunk) {
    if (chunk.type === "task-ended") {
      this.hasReceivedTaskEnded = true
    }

    if (!this.shouldProcessChunk(chunk)) {
      return
    }

    const nextState = this.messageHandler.pushChunk(this.toRawChunk(chunk))
    this.syncExecutionStartedAt(nextState)
    this.syncExecutionTimer(nextState)
    this.emitState(nextState)

    if (nextState.status === "finished") {
      this.disconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      return false
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts += 1
    this.mode = this.initialUserInput ? this.initialMode : "attach"
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.manuallyDisconnected || this.hasReceivedTaskEnded || this.socket) {
        return
      }
      this.openSocket()
    }, delay)

    return true
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private shouldProcessChunk(chunk: TaskStreamServerChunk) {
    const key = JSON.stringify([
      chunk.type ?? "",
      chunk.kind ?? "",
      chunk.timestamp ?? 0,
      typeof chunk.data === "string" ? chunk.data : chunk.data == null ? "" : JSON.stringify(chunk.data),
    ])

    if (this.processedChunkKeys.has(key)) {
      return false
    }

    this.processedChunkKeys.add(key)
    this.processedChunkOrder.push(key)

    if (this.processedChunkOrder.length > MAX_TRACKED_CHUNKS) {
      const oldestKey = this.processedChunkOrder.shift()
      if (oldestKey) {
        this.processedChunkKeys.delete(oldestKey)
      }
    }

    return true
  }

  private resetProcessedChunks() {
    this.processedChunkKeys.clear()
    this.processedChunkOrder = []
  }

  private emitState(state: TaskMessageHandlerState) {
    this.onStateChange?.(this.buildState(state))
  }

  private buildState(state: TaskMessageHandlerState): TaskStreamClientState {
    return {
      ...state,
      executionTimeMs: this.getExecutionTimeMs(state.status),
    }
  }

  private getExecutionTimeMs(status: TaskMessageHandlerState["status"]) {
    if (status !== "connected" || this.executionStartedAt === null) {
      return 0
    }
    return Math.max(0, Date.now() - this.executionStartedAt)
  }

  private syncExecutionStartedAt(state: TaskMessageHandlerState) {
    if (this.executionStartedAt !== null) return

    const firstUserInput = state.messages.find((message) => message.type === "user_input")
    if (!firstUserInput) return

    this.executionStartedAt = normalizeTimestampToMilliseconds(firstUserInput.time)
  }

  private syncExecutionTimer(state: TaskMessageHandlerState) {
    if (state.status !== "connected" || this.executionStartedAt === null) {
      this.stopExecutionTimer()
      return
    }
    if (this.executionTimer) return

    this.executionTimer = setInterval(() => {
      const nextState = this.messageHandler.getState()
      if (nextState.status !== "connected" || this.executionStartedAt === null) {
        this.stopExecutionTimer()
        return
      }
      this.emitState(nextState)
    }, 100)
  }

  private stopExecutionTimer() {
    if (!this.executionTimer) return
    clearInterval(this.executionTimer)
    this.executionTimer = null
  }

  private toRawChunk(chunk: TaskStreamServerChunk): TaskMessageRawChunk {
    return {
      event: chunk.type,
      kind: chunk.kind,
      data: chunk.data,
      timestamp: chunk.timestamp,
    }
  }

  private buildStreamUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${location.host}/api/v1/users/tasks/stream?id=${this.taskId}&mode=${this.mode}`
  }
}
