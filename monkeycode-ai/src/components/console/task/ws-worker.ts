// Web Worker for WebSocket message receiving and decoding
interface DecodedMessage {
  type: string
  kind?: string
  data?: any
  timestamp: number
}

interface WorkerMessage {
  type: 'connect' | 'send' | 'disconnect' | 'set-batch-size' | 'call' | 'reset-session' | 'reload-session'
  data?: any
}

let websocket: WebSocket | null = null
let lastMessageTime = 0
let buffer: DecodedMessage[] = []
let playmode = false
let batchSize = 10000

// b64decode in worker (no DOM dependency)
function b64decode(text: string): string {
  const binaryString = atob(text)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

function decodeMessage(rawData: any): DecodedMessage | null {
  switch (rawData.type) {
    case 'user-input':
      return {
        type: 'user-input',
        data: b64decode(rawData.data),
        timestamp: rawData.timestamp
      }
    case 'user-cancel':
      return {
        type: 'user-cancel',
        timestamp: rawData.timestamp
      }
    case 'task-started':
      return {
        type: 'task-started',
        timestamp: rawData.timestamp
      }
    case 'task-event':
      if (rawData.kind === 'repo_file_change') {
        return {
          type: 'task-event',
          kind: 'repo_file_change',
          data: JSON.parse(b64decode(rawData.data)),
          timestamp: rawData.timestamp
        }
      }
      return null
    case 'task-running':
      if (rawData.kind === 'acp_event') {
        return {
          type: 'task-running',
          kind: 'acp_event',
          data: JSON.parse(b64decode(rawData.data)),
          timestamp: rawData.timestamp
        }
      } else if (rawData.kind === 'acp_ask_user_question') {
        return {
          type: 'task-running',
          kind: 'acp_ask_user_question',
          data: JSON.parse(b64decode(rawData.data)),
          timestamp: rawData.timestamp
        }
      }
      return null
    case 'task-ended':
      return {
        type: 'task-ended',
        timestamp: rawData.timestamp
      }
    case 'task-error':
      return {
        type: 'task-error',
        data: JSON.parse(b64decode(rawData.data)),
        timestamp: rawData.timestamp
      }
    case 'reply-question':
      return {
        type: 'reply-question',
        data: JSON.parse(b64decode(rawData.data)),
        timestamp: rawData.timestamp
      }
    case 'stopped':
      return {
        type: 'stopped',
        timestamp: rawData.timestamp
      }
    case 'error':
      return {
        type: 'error',
        timestamp: rawData.timestamp
      }
    case 'ping':
      // 心跳包，忽略
      return null
    case 'file-change':
      // 文件变动事件，忽略
      return null
    case 'call':
      return {
        type: 'call',
        kind: rawData.kind,
        data: JSON.parse(b64decode(rawData.data)),
        timestamp: rawData.timestamp
      }
    case 'call-response':
      return {
        type: 'call-response-sync',
        kind: rawData.kind,
        data: JSON.parse(b64decode(rawData.data)),
        timestamp: rawData.timestamp
      }
    default:
      console.error('收到未知消息类型', rawData)
      return null
  }
}

function flushBuffer() {
  if (buffer.length > 0) {
    // 每次只发送 batchSize 条消息
    const toSend = buffer.slice(0, batchSize)
    buffer = buffer.slice(batchSize)
    self.postMessage({ type: 'messages', data: {
      messages: toSend,
      queueSize: buffer.length
    } })
  }
}

function startIdleCheck() {
  const check = () => {
    if (performance.now() - lastMessageTime >= 100) {
      flushBuffer()
      scheduleFlush()
    } else {
      setTimeout(check, 100)
    }
  }
  setTimeout(check, 2000)
}

function scheduleFlush() {
  setTimeout(() => {
    flushBuffer()
    scheduleFlush()
  }, 100)
}

// 尝试合并连续的 agent_thought_chunk 消息
function tryMergeThoughtChunk(decoded: DecodedMessage): boolean {
  if (decoded.type !== 'task-running' || 
      decoded.kind !== 'acp_event' || 
      decoded.data?.update?.sessionUpdate !== 'agent_thought_chunk') {
    return false
  }

  const lastMsg = buffer[buffer.length - 1]
  if (lastMsg &&
      lastMsg.type === 'task-running' &&
      lastMsg.kind === 'acp_event' &&
      lastMsg.data?.update?.sessionUpdate === 'agent_thought_chunk' &&
      lastMsg.data?.update?.content?.type === 'text' &&
      decoded.data?.update?.content?.type === 'text') {
    lastMsg.data.update.content.text =
      (lastMsg.data.update.content.text || '') +
      (decoded.data.update.content.text || '')
    lastMsg.timestamp = decoded.timestamp
    return true
  }

  buffer.push(decoded)
  return true
}

// 尝试合并连续的 agent_message_chunk 消息
function tryMergeMessageChunk(decoded: DecodedMessage): boolean {
  if (decoded.type !== 'task-running' || 
      decoded.kind !== 'acp_event' || 
      decoded.data?.update?.sessionUpdate !== 'agent_message_chunk') {
    return false
  }

  const lastMsg = buffer[buffer.length - 1]
  if (lastMsg &&
      lastMsg.type === 'task-running' &&
      lastMsg.kind === 'acp_event' &&
      lastMsg.data?.update?.sessionUpdate === 'agent_message_chunk' &&
      lastMsg.data?.update?.content?.type === 'text' &&
      decoded.data?.update?.content?.type === 'text') {
    lastMsg.data.update.content.text =
      (lastMsg.data.update.content.text || '') +
      (decoded.data.update.content.text || '')
    lastMsg.timestamp = decoded.timestamp
    return true
  }

  buffer.push(decoded)
  return true
}

// 将消息加入缓冲区，尝试合并连续的同类型消息
function pushToBuffer(decoded: DecodedMessage) {
  if (tryMergeThoughtChunk(decoded)) return
  if (tryMergeMessageChunk(decoded)) return
  buffer.push(decoded)
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, data } = event.data

  switch (type) {
    case 'connect':
      playmode = data.playmode
      batchSize = playmode ? 10 : 10000
      websocket = new WebSocket(data.url)

      websocket.onmessage = (e) => {
        try {
          const rawData = JSON.parse(e.data)

          if (rawData.type === 'call-response') {
            self.postMessage({ type: 'call-response-realtime', data: JSON.parse(b64decode(rawData.data)) })
          }
          
          const decoded = decodeMessage(rawData)
          if (decoded) {
            pushToBuffer(decoded)
          }
          if (playmode) {
            lastMessageTime = performance.now()
          }            

        } catch (err) {
          console.error('Worker: 解析消息失败', err)
        }
      }

      websocket.onerror = () => {
        buffer.push({ type: 'error', timestamp: 0 })
      }

      websocket.onclose = () => {
        console.log('Worker: WebSocket 已关闭')
        buffer.push({ type: 'stopped', timestamp: 0 })
      }

      if (playmode) {
        lastMessageTime = performance.now()
        startIdleCheck()
      } else {
        scheduleFlush()
      }
      break

    case 'send':
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(data))
      }
      break

    case 'call':
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify(data))
      }
      break

    case 'disconnect':
      if (websocket) {
        console.log('Worker: 准备关闭 WebSocket')
        websocket.close()
        websocket = null
      }
      break

    case 'set-batch-size':
      batchSize = data.batchSize
      break
  }
}

