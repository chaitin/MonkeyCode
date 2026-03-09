import { b64encode, base64ToUint8Array, deepMerge } from "@/utils/common"
import type { MessageType } from "./message"
import WsWorker from './ws-worker?worker'

interface DecodedMessage {
  type: string
  kind?: string
  data?: any
  timestamp: number
}


export interface AvailableCommand {
  name: string
  description: string
  input: {
    hint: string | null
  } | null
}

export interface PlanEntry {
  content: string
  status: string
}

export interface TaskPlan {
  entries: PlanEntry[]
  version: number
}

export interface AvailableCommands {
  commands: AvailableCommand[]
  version: number
}

export enum TaskFileChangeType {
  Created = 'REPO_FILE_CHANGE_TYPE_CREATED',
  Modified = 'REPO_FILE_CHANGE_TYPE_MODIFIED',
  Delete = 'REPO_FILE_CHANGE_TYPE_DELETED',
  Renamed = 'REPO_FILE_CHANGE_TYPE_RENAMED',
}

export interface TaskFileChange {
  path: string
  type: TaskFileChangeType
}

export interface TaskFileChanges {
  changes: TaskFileChange[]
  version: number
}

export interface TaskWebSocketState {
  status: TaskStreamStatus
  thinkingMessage: string
  messages: MessageType[]
  plan: TaskPlan
  fileChanges: TaskFileChanges
  availableCommands: AvailableCommands
  sending: boolean
  queueSize: number
  sendUserInput: (content: string) => void
  sendCancelCommand: () => void
  sendResetSession: () => void
  sendReloadSession: () => void
}

export type TaskStreamStatus = 'inited' | 'executing' | 'waiting' | 'finished' | 'error'

interface CallEvent {
  callId: string
  kind: string
  req: any
  resp: any
  finished: boolean
  resolve?: (value: any) => void
  reject?: (reason?: any) => void
}

export enum RepoFileEntryMode {
  RepoEntryModeUnspecified = 0,
  RepoEntryModeFile = 1,
  RepoEntryModeExecutable = 2,
  RepoEntryModeSymlink = 3,
  RepoEntryModeTree = 4,
  RepoEntryModeSubmodule = 5,
}

export interface RepoFileStatus {
  entry_mode: RepoFileEntryMode
  mode: number
  modified_at: number
  name: string
  path: string
  size: number
}

export interface RepoFileChange {
  additions?: number
  deletions?: number
  old_path?: string
  path: string
  status: 'M' | 'RM' | 'A' | 'D' | 'R' | '??'
}

export class TaskWebSocketManager {
  private taskId: string
  private onUpdate?: (state: TaskWebSocketState) => void
  private worker: Worker | null = null
  private playmode: boolean = false
  private publicTask: boolean = false
  private callEvents: Map<string, CallEvent> = new Map()
  private hasSendMyIP: boolean = false

  state: TaskWebSocketState = {
    status: 'inited',
    thinkingMessage: '',
    messages: [],
    plan: {
      entries: [],
      version: 0
    },
      fileChanges: {
        changes: [],
        version: 0
      },
    availableCommands: {
      commands: [],
      version: 0
    },
    sending: false,
    queueSize: 0,
    sendUserInput: () => {},
    sendCancelCommand: () => {},
    sendResetSession: () => {},
    sendReloadSession: () => {}
  }

  constructor(taskId: string, onUpdate?: (state: TaskWebSocketState) => void, playmode: boolean = false, publicTask: boolean = false) {
    this.taskId = taskId
    this.onUpdate = onUpdate
    this.state.sendUserInput = this.sendUserInput.bind(this)
    this.state.sendCancelCommand = this.sendCancelCommand.bind(this)
    this.state.sendResetSession = this.sendResetSession.bind(this)
    this.state.sendReloadSession = this.sendReloadSession.bind(this)
    this.playmode = playmode
    this.publicTask = publicTask
  }

  connect() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }

    // 创建 Worker
    this.worker = new WsWorker()

    // 监听 Worker 消息
    this.worker.onmessage = (event) => {
      const { type, data } = event.data
      if (type === 'messages') {
        // 批量处理已解码的消息
        for (const msg of data.messages as DecodedMessage[]) {
          this.processMessage(msg)
        }
        this.state.queueSize = data?.queueSize || 0
        this.notify()
      } else if (type === 'call-response-realtime') {
        this.applyCallRealtimeResponse(data)
      }
    }
    // 构建完整的 WebSocket URL
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

    let url = ''

    if (this.publicTask) {
    url = `${protocol}//${location.host}/api/v1/users/tasks/public-stream?id=${this.taskId}`
    } else {
      url = `${protocol}//${location.host}/api/v1/users/tasks/stream?id=${this.taskId}`
    }
    
    // 发送连接命令给 Worker
    this.worker.postMessage({
      type: 'connect',
      data: { url, playmode: this.playmode }
    })
  }

  private async sendMyIP() {
    try {
      const resp = await fetch('https://monkeycode-ai.online/get-my-ip', {
        method: 'GET',
        mode: 'cors',
      })
      if (!resp.ok) {
        return
      }
      const data = await resp.json()
      if (data.ip) {
        this.worker?.postMessage({
          type: 'send',
          data: {
            type: 'sync-my-ip',
            data: b64encode(JSON.stringify({ client_ip: data.ip }))
          }
        })
        this.hasSendMyIP = true
      }
    } catch (e) {
      console.error('获取客户端 IP 失败', e)
    }
  }

  disconnect() {
    if (this.worker) {
      this.worker.postMessage({ type: 'disconnect' })
      this.worker.terminate()
      this.worker = null
    }
  }

  // 发送问题回复
  sendAskUserQuestion(askId: string, answers: any) {
    this.worker?.postMessage({
      type: 'send',
      data: {
        type: 'reply-question',
        data: b64encode(JSON.stringify({
          request_id: askId,
          answers_json: JSON.stringify(answers),
          cancelled: false
        }))
      }
    })
  }

  // 发送用户输入
  sendUserInput(content: string) {
    this.state.sending = true
    this.worker?.postMessage({
      type: 'send',
      data: {
        type: 'user-input',
        data: b64encode(content)
      }
    })
    // 用户发送消息后，设置 batchSize=1 让响应更快
    this.worker?.postMessage({
      type: 'set-batch-size',
      data: { batchSize: 10 }
    })
    this.notify()
  }

  call<T = any>(kind: string, data: any, timeout: number = 5000): Promise<T | null> {
    return new Promise((resolve) => {
      const callId = `${Math.random()}`
      
      const timeoutId = setTimeout(() => {
        const callEvent = this.callEvents.get(callId)
        if (callEvent && !callEvent.finished) {
          this.callEvents.delete(callId)
          resolve(null)
        }
      }, timeout)
      
      this.callEvents.set(callId, {
        callId: callId,
        kind: kind,
        req: data,
        resp: null,
        finished: false,
        resolve: (value: T) => {
          clearTimeout(timeoutId)
          resolve(value)
        },
        reject: () => {
          clearTimeout(timeoutId)
          resolve(null)
        }
      })
      this.worker?.postMessage({
        type: 'call',
        kind: kind,
        data: {
          type: 'call',
          kind: kind,
          data: b64encode(JSON.stringify({
            request_id: callId,
            ...data,
          })),
        }
      })
    })
  }

  async getFileList(path: string): Promise<RepoFileStatus[] | null> {
    const result = await this.call('repo_file_list', {
      path: path,
      glob_pattern: '*',
      include_hidden: true,
    })
    if (result) {
      return result.files
    }
    return null
  }

  async getFileDiff(path: string): Promise<string | null> {
    const result = await this.call('repo_file_diff', {
      path: path,
      unified: true,
      context_lines: 20
    })
    if (result) {
      return result.diff
    }
    return null
  }

  async getFileChanges(): Promise<RepoFileChange[] | null> {
    const result = await this.call('repo_file_changes', {})
    if (result) {
      return result.changes || []
    }
    return null
  }


  async getFileContent(path: string): Promise<Uint8Array | null> {
    const result = await this.call('repo_read_file', {
      path: path,
      offset: 0,
      length: 1024 * 1024 * 1024
    })
    if (result) {
      return base64ToUint8Array(result.content)
    }
    return null
  }


  // 发送取消命令
  sendCancelCommand() {
    this.worker?.postMessage({
      type: 'send',
      data: { type: 'user-cancel' }
    })
    // 用户取消后，设置 batchSize=1 让响应更快
    this.worker?.postMessage({
      type: 'set-batch-size',
      data: { batchSize: 10 }
    })
  }

  async sendResetSession() {
    this.state.sending = true
    const result = await this.call('restart', {
      load_session: false
    })
    this.state.sending = false
    if (result) {
      return result.success
    }
    return null
  }

  async sendReloadSession() {
    this.state.sending = true
    const result = await this.call('restart', {
      load_session: true
    })
    this.state.sending = false
    if (result) {
      return result.success
    }
    return null
  }

  private applyCallRealtimeResponse(data: any) {
    const callEvent = this.callEvents.get(data?.request_id || '')
    if (callEvent) {
      callEvent.resp = data
      callEvent.finished = true
      callEvent.resolve?.(data)
      this.callEvents.delete(data.request_id)
    }
  }

  private applyUserInput(data: any, timestamp: number) {
    const messageId = `${Date.now()}-${Math.random()}`
    const newMessage: MessageType = {
      id: messageId,
      time: timestamp,
      role: 'user' as const,
      data: { content: data },
      type: 'user_input' as const
    }
    this.state.sending = false
    this.state.messages.push(newMessage)
  }

  private applyUserCancel(timestamp: number) {
    const newMessage: MessageType = {
      id: `${Date.now()}-${Math.random()}`,
      time: timestamp,
      role: 'system' as const,
      data: { content: '用户取消当前任务' },
      type: 'system_message' as const
    }
    this.state.sending = false
    this.state.messages.push(newMessage)
  }

  private applyErrorMessage(data: any, timestamp: number) {
    const newMessage: MessageType = {
      id: `${Date.now()}-${Math.random()}`,
      time: timestamp,
      type: 'error_message',
      role: 'agent' as const,
      data: data,
      onReloadSession: this.sendReloadSession.bind(this),
      onUserInput: this.sendUserInput.bind(this)
    }
    this.state.messages.push(newMessage)
  }

  private applyAskUserQuestion(data: any, timestamp: number) {
    const newMessage: MessageType = {
      id: `${Date.now()}-${Math.random()}`,
      time: timestamp,
      type: 'ask_user_question',
      role: 'agent' as const,
      data: {
        askId: data.toolCall.toolCallId,
        status: 'pending',
        questions: data.toolCall.rawInput.questions.map((question: any) => ({
          custom: !!question.custom,
          header: question.header,
          multiSelect: !!question.multiSelect,
          question: question.question,
          options: question.options.map((option: any) => ({
            label: option.label,
            description: option.description
          }))
        }))
      },
      onResponseAskUserQuestion: this.sendAskUserQuestion.bind(this)
    }
    this.state.messages.push(newMessage)
  }


  private applyReplyQuestion(data: any) {
    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === 'ask_user_question' && message.data.askId === data.request_id
    )
    if (askQuestionIndex !== -1) {
      const answers = JSON.parse(data.answers_json)
      const existingMessage = this.state.messages[askQuestionIndex]
      this.state.messages[askQuestionIndex] = {
        ...existingMessage,
        data: {
          questions: existingMessage.data.questions?.map((question: any) => ({
            ...question,
            answer: answers[question.question]
          })),
          askId: data.request_id,
          status: 'completed',
        }
      }
    }
  }

  private applyAgentMessageChunk(data: any, timestamp: number) {
    if (data.content.type !== 'text') {
      console.error('收到非文本消息', data)
      return
    }

    const lastMsg = this.state.messages[this.state.messages.length - 1]

    if (lastMsg?.type === 'agent_message_chunk') {
      // 追加到最后一条
      lastMsg.data.content = (lastMsg.data.content || '') + (data.content.text || '')
    } else if (data.content.text?.trim().length > 0) {
      // 创建新消息
      const newMessage: MessageType = {
        id: `${Date.now()}-${Math.random()}`,
        time: timestamp,
        role: 'agent' as const,
        type: 'agent_message_chunk',
        data: { content: data.content.text || '' }
      }
      this.state.messages.push(newMessage)
    }
  }

  private applyAgentThoughtChunk(data: any, timestamp: number) {
    if (data.content.type !== 'text') {
      console.error('收到非文本思考', data)
      return
    }

    const lastMsg = this.state.messages[this.state.messages.length - 1]

    if (lastMsg?.type === 'agent_thought_chunk') {
      this.state.thinkingMessage += data.content.text || ''
    } else {
      this.state.thinkingMessage += (this.state.thinkingMessage ? '\n\n----\n\n' : '') + (data.content.text || '')
      const newMessage: MessageType = {
        id: `${Date.now()}-${Math.random()}`,
        time: timestamp,
        role: 'agent' as const,
        type: 'agent_thought_chunk',
        data: {}
      }
      this.state.messages.push(newMessage)
    }
  }


  private applyToolCall(data: any, timestamp: number) {
    const toolcallIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === 'tool_call' && message.data.toolCallId === data.toolCallId
    )

    const askQuestionIndex = this.state.messages.findIndex(
      (message: MessageType) => message.type === 'ask_user_question' && message.data.askId === data.toolCallId
    )

    if (toolcallIndex === -1 && askQuestionIndex === -1 && data.sessionUpdate === 'tool_call') {
      // 不存在，创建新消息
      const newMessage: MessageType = {
        id: `${Date.now()}-${Math.random()}`,
        time: timestamp,
        role: 'agent' as const,
        type: 'tool_call' as const,
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
    } else if (toolcallIndex !== -1 && data.sessionUpdate === 'tool_call_update') {
      // 已存在相同 toolCallId 的消息，走更新逻辑
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
        }
      }

    } else if (askQuestionIndex !== -1 && data.status && data.sessionUpdate === 'tool_call_update') {
      const existingMessage = this.state.messages[askQuestionIndex]
      this.state.messages[askQuestionIndex] = {
        ...existingMessage,
        data: {
          ...existingMessage.data,
          status: data.status,
        }
      }
    }
  }

  private applyACPEvent(data: any, timestamp: number) {
    const messageType = data.update.sessionUpdate
    switch (messageType) {
      case 'agent_message_chunk':
        this.applyAgentMessageChunk(data.update, timestamp)
        break
      case 'agent_thought_chunk':
        this.applyAgentThoughtChunk(data.update, timestamp)
        break
      case 'tool_call':
      case 'tool_call_update':
        this.applyToolCall(data.update, timestamp)
        break
      case 'available_commands_update':
        this.state.availableCommands = {
          commands: data.update.availableCommands,
          version: this.state.availableCommands.version + 1
        } as AvailableCommands
        break
      case 'plan':
        if (Array.isArray(data.update.entries)) {
          this.state.plan = {
            entries: data.update.entries,
            version: this.state.plan.version + 1
          } as TaskPlan
        }
        break
      default:
        console.error('收到未知 ACP 事件', data)
        break
    }
  }

  private applyRepoFileChange(data: any) {
    this.state.fileChanges = {
      changes: data,
      version: this.state.fileChanges.version + 1
    } as TaskFileChanges
  }

  private applyTaskEnded() {
    // 检查历史的 tool_call，将 in_progress 和 pending 状态设置为 failed
    for (let i = 0; i < this.state.messages.length; i++) {
      const message = this.state.messages[i]
      if (message.type === 'tool_call' && 
          (message.data.status === 'in_progress' || message.data.status === 'pending')) {
        this.state.messages[i] = {
          ...message,
          data: {
            ...message.data,
            status: 'failed'
          }
        }
      }
    }
    this.state.status = 'waiting'
  }

  private applyCall(kind: string | undefined, data: any, timestamp: number) {
    if (kind === 'restart') {
      const newMessage: MessageType = {
        id: `${Date.now()}-${Math.random()}`,
        time: timestamp,
        role: 'system' as const,
        data: {
          requestId: data.request_id,
          kind: data.load_session ? 'reload' : 'reset',
          status: 'pending'
        },
        type: 'restart_session' as const
      }
      this.state.messages.push(newMessage)
    }
  }

  private applyCallResponseSync(kind: string | undefined, data: any) {
    if (!data) {
      return
    }
    
    const callIndex = this.state.messages.findIndex(
      (message: MessageType) => message.data.requestId === data.request_id
    )

    if (kind === 'restart') {
      this.state.sending = false
      const existingMessage = this.state.messages[callIndex]
      this.state.messages[callIndex] = {
        ...existingMessage,
        data: {
          ...existingMessage.data,
          status: data.success ? 'completed' : 'failed',
        }
      }
    }
  }

  private processMessage(msg: DecodedMessage) {
    switch (msg.type) {
      case 'user-input':
        this.applyUserInput(msg.data, msg.timestamp)
        break
      case 'user-cancel':
        this.applyUserCancel(msg.timestamp)
        break
      case 'task-started':
        this.state.status = 'executing'
        if (!this.hasSendMyIP) {
          this.sendMyIP()
        }
        break
      case 'task-running':
        if (msg.kind === 'acp_event') {
          this.applyACPEvent(msg.data, msg.timestamp)
        } else if (msg.kind === 'acp_ask_user_question') {
          this.applyAskUserQuestion(msg.data, msg.timestamp)
        } 
        break
      case 'task-event':
        if (msg.kind === 'repo_file_change') {
          this.applyRepoFileChange(msg.data)
        }
        break
      case 'task-ended':
        this.applyTaskEnded()
        break
      case 'task-error':
        this.applyErrorMessage(msg.data, msg.timestamp)
        break
      case 'reply-question':
        this.applyReplyQuestion(msg.data)
        break
      case 'stopped':
        this.state.status = 'finished'
        break
      case 'error':
        this.state.status = 'error'
        break
      case 'call':
        this.applyCall(msg.kind, msg.data, msg.timestamp)
        break
      case 'call-response-sync':
        this.applyCallResponseSync(msg.kind, msg.data)
        break
      default:
        console.error('收到未知消息类型', msg)
        break
    }
  }

  // 通知所有监听者
  private notify() {
    this.onUpdate?.(this.state)
  }
}
