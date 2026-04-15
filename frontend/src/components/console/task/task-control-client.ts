import { b64decode, b64encode } from "@/utils/common"
import type { RepoFileChange, RepoFileStatus, TaskRepositoryClient } from "./task-shared"

export type TaskControlClientStatus = "inited" | "connected" | "error"

export interface TaskControlClientState {
  status: TaskControlClientStatus
}

export interface PortForwardInfo {
  port: number
  status: string
  process: string
  forward_id?: string | null
  access_url?: string | null
  label?: string | null
  error_message?: string | null
  whitelist_ips?: string[] | null
}

function decodeRepoFileContent(content: string): Uint8Array {
  if (content === "") {
    return new Uint8Array(0)
  }

  try {
    const binary = atob(content)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  } catch {
    return new TextEncoder().encode(content)
  }
}

interface TaskControlCallMessage {
  type: "call"
  kind: string
  data: string
}

interface TaskControlPendingCall<T> {
  requestId: string
  resolve: (value: T | null | unknown) => void
  timeoutId: ReturnType<typeof setTimeout>
}

export interface TaskControlClientOptions {
  taskId: string
  onStateChange?: (state: TaskControlClientState) => void
  onRepoFileChange?: () => void
  onPortChange?: (opened: boolean) => void
}

interface TaskControlStreamMessage {
  type?: string
  kind?: string
  data?: unknown
  timestamp?: number
}

interface TaskControlCallResponse {
  request_id?: string
  success?: boolean
  error?: string | null
}

interface RestartTaskResponse extends TaskControlCallResponse {
  id?: string
  message?: string
  session_id?: string
}

export class TaskControlClient implements TaskRepositoryClient {
  private static readonly CONNECT_TIMEOUT_MS = 10000
  private static readonly DEFAULT_CALL_TIMEOUT_MS = 5000
  private static readonly RESTART_TIMEOUT_MS = 15000

  private readonly taskId: string
  private readonly onStateChange?: (state: TaskControlClientState) => void
  private readonly onRepoFileChange?: () => void
  private readonly onPortChange?: (opened: boolean) => void

  private socket: WebSocket | null = null
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private connectionId = 0
  private state: TaskControlClientState = {
    status: "inited",
  }
  private pendingCalls = new Map<string, TaskControlPendingCall<unknown>>()

  constructor({
    taskId,
    onStateChange,
    onRepoFileChange,
    onPortChange,
  }: TaskControlClientOptions) {
    this.taskId = taskId
    this.onStateChange = onStateChange
    this.onRepoFileChange = onRepoFileChange
    this.onPortChange = onPortChange
  }

  connect() {
    this.disposed = false
    this.clearConnectTimeout()
    this.clearReconnectTimer()
    const connectionId = this.connectionId + 1
    this.connectionId = connectionId
    this.closeSocket()

    const socket = new WebSocket(this.buildControlUrl())
    this.socket = socket
    this.connectTimeoutTimer = setTimeout(() => {
      if (this.socket !== socket || this.connectionId !== connectionId || this.disposed) {
        return
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        this.setStatus("error")
        socket.close()
      }
    }, TaskControlClient.CONNECT_TIMEOUT_MS)

    socket.onopen = () => {
      if (this.socket !== socket || this.connectionId !== connectionId) {
        socket.close()
        return
      }
      this.clearConnectTimeout()
      this.setStatus("connected")
    }

    socket.onmessage = (event) => {
      if (this.socket !== socket || this.connectionId !== connectionId) {
        return
      }
      this.handleSocketMessage(event.data)
    }

    socket.onerror = () => {
      if (this.socket !== socket || this.connectionId !== connectionId) {
        return
      }
      this.setStatus("error")
    }

    socket.onclose = () => {
      this.clearConnectTimeout()
      if (this.socket === socket) {
        this.socket = null
      }
      if (this.connectionId !== connectionId) {
        return
      }

      this.failPendingCalls()
      if (this.disposed) {
        this.setStatus("inited")
      } else {
        this.setStatus("error")
        this.scheduleReconnect()
      }
    }
  }

  dispose() {
    this.disposed = true
    this.clearConnectTimeout()
    this.clearReconnectTimer()
    this.connectionId += 1
    this.failPendingCalls()
    this.closeSocket()
    this.setStatus("inited")
  }

  getState() {
    return { ...this.state }
  }

  async call<T>(
    kind: string,
    payload: Record<string, unknown>,
    timeout = TaskControlClient.DEFAULT_CALL_TIMEOUT_MS,
  ): Promise<T | null> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return null
    }

    const requestId = this.createRequestId()
    const message: TaskControlCallMessage = {
      type: "call",
      kind,
      data: b64encode(JSON.stringify({
        request_id: requestId,
        ...payload,
      })),
    }

    return new Promise<T | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingCalls.delete(requestId)
        resolve(null)
      }, timeout)

      this.pendingCalls.set(requestId, {
        requestId,
        resolve: (value) => resolve((value as T | null | PromiseLike<T | null>) ?? null),
        timeoutId,
      })

      this.socket?.send(JSON.stringify(message))
    })
  }

  getFileList(path: string) {
    return this.call<{ files?: RepoFileStatus[] }>("repo_file_list", {
      path,
      glob_pattern: "*",
      include_hidden: true,
    }).then((response) => response?.files ?? null)
  }

  getFileDiff(path: string) {
    return this.call<{ diff?: string }>("repo_file_diff", {
      path,
      unified: true,
      context_lines: 20,
    }).then((response) => response?.diff ?? null)
  }

  getFileChanges() {
    return this.call<{ changes?: RepoFileChange[] }>("repo_file_changes", {})
      .then((response) => {
        if (!response) {
          return null
        }
        return response.changes ?? []
      })
  }

  getFileContent(path: string) {
    return this.call<{ content?: string }>("repo_read_file", {
      path,
      offset: 0,
      length: 1024 * 1024,
    }).then((response) => {
      if (!response || typeof response.content !== "string") {
        return null
      }
      return decodeRepoFileContent(response.content)
    })
  }

  getPortForwardList() {
    return this.call<{ ports?: PortForwardInfo[] }>("port_forward_list", {})
      .then((response) => {
        if (!response) {
          return null
        }

        return (response.ports ?? []).map((port) => ({
          ...port,
          whitelist_ips: port.whitelist_ips ?? [],
        }))
      })
  }

  restart(loadSession: boolean) {
    return this.call<RestartTaskResponse>("restart", {
      load_session: loadSession,
    }, TaskControlClient.RESTART_TIMEOUT_MS).then((response) => !!response?.success)
  }

  private handleSocketMessage(rawData: string) {
    const message = JSON.parse(rawData) as TaskControlStreamMessage

    switch (message.type) {
      case "call-response":
        this.handleCallResponse(message)
        break
      case "task-event":
        this.handleTaskEvent(message)
        break
      case "ping":
        break
      default:
        console.warn("TaskControlClient: unknown event type", message)
        break
    }
  }

  private handleCallResponse(message: TaskControlStreamMessage) {
    const response = this.decodePayload<unknown>(message.data)
    const responseObject = response && typeof response === "object" && !Array.isArray(response)
      ? response as TaskControlCallResponse & Record<string, unknown>
      : null

    const requestId = responseObject?.request_id
    if (!requestId) {
      console.warn("TaskControlClient: call-response missing request_id", {
        kind: message.kind,
        data: response,
        timestamp: message.timestamp,
      })
      return
    }

    const pendingCall = this.pendingCalls.get(requestId)
    if (!pendingCall) {
      return
    }

    clearTimeout(pendingCall.timeoutId)
    this.pendingCalls.delete(pendingCall.requestId)

    if (responseObject?.success === false) {
      pendingCall.resolve(null)
      return
    }

    pendingCall.resolve(response)
  }

  private handleTaskEvent(message: TaskControlStreamMessage) {
    if (message.kind === "repo_file_change") {
      this.onRepoFileChange?.()
      return
    }

    if (message.kind === "port_change") {
      const payload = this.decodePayload<Record<string, unknown>>(message.data)
      this.onPortChange?.(payload?.change_type === "PORT_CHANGE_TYPE_OPENED")
      return
    }

    if (message.kind !== "repo_file_change") {
      console.log("TaskControlClient: task-event", {
        type: message.type,
        kind: message.kind,
        data: this.decodePayload(message.data),
        timestamp: message.timestamp,
      })
    }
  }

  private decodePayload<T = unknown>(data: unknown): T | null {
    if (typeof data !== "string") {
      return null
    }
    const text = b64decode(data)
    if (!text) {
      return null
    }
    return JSON.parse(text) as T
  }

  private setStatus(status: TaskControlClientStatus) {
    this.state = { status }
    this.onStateChange?.(this.getState())
  }

  private failPendingCalls() {
    const pendingCalls = [...this.pendingCalls.values()]
    this.pendingCalls.clear()

    for (const pendingCall of pendingCalls) {
      clearTimeout(pendingCall.timeoutId)
      pendingCall.resolve(null)
    }
  }

  private createRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random()}`
  }

  private buildControlUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    return `${protocol}//${location.host}/api/v1/users/tasks/control?id=${this.taskId}`
  }

  private closeSocket() {
    this.clearConnectTimeout()
    if (!this.socket) {
      return
    }
    this.socket.close()
    this.socket = null
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) {
      return
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.disposed) {
        return
      }
      this.connect()
    }, 0)
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) {
      return
    }
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private clearConnectTimeout() {
    if (!this.connectTimeoutTimer) {
      return
    }
    clearTimeout(this.connectTimeoutTimer)
    this.connectTimeoutTimer = null
  }
}
