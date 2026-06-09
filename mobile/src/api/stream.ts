/**
 * 任务实时数据流客户端（WebSocket）—— 移植自 Web 端 TaskStreamClient。
 *
 * 端点：wss://<host>/api/v1/users/tasks/stream?id=<taskId>&mode=attach|new
 *  - attach：仅订阅当前轮次（回放 + 实时），用于打开运行中任务
 *  - new   ：开启新一轮，连接建立后立即上行 user-input
 *
 * 上行（client -> server）JSON：
 *  - { type:"user-input", data: b64(JSON.stringify({ content: b64(text), attachments:[{url,filename}] })) }
 *    attachments 为图片附件（已上传到对象存储，url 即 presign 的 access_url）。
 *  - { type:"user-cancel" }
 *  - { type:"reply-question", data: b64(JSON.stringify({ request_id, answers_json, cancelled:false })) }
 *
 * 下行（server -> client）JSON：{ type, kind, data, timestamp }，喂给 TaskMessageHandler。
 *
 * 鉴权：复用会话 Cookie。Android 的 RN WebSocket（OkHttp）会带上共享 Cookie；
 * iOS 多数情况下也会随 NSURLSession 携带。
 */
import { getBaseUrl, openWebSocket } from './client';
import { base64Encode } from '@/messages/base64';
import {
  TaskMessageHandler,
  type HandlerState,
} from '@/messages/handler';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type CloseReason = 'manual' | 'task_ended' | 'unknown' | null;
export type SendReplyResult = 'sent' | 'queued' | 'rejected';

/** 用户消息携带的图片附件（已上传，url 为对象存储可访问地址）。 */
export interface UserAttachment {
  url: string;
  filename: string;
}

export interface StreamState extends HandlerState {
  connectionState: ConnectionState;
  closeReason: CloseReason;
}

interface Callbacks {
  onState?: (state: StreamState) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
}

type Mode = 'attach' | 'new';

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

export class TaskStreamClient {
  private taskId: string;
  private mode: Mode;
  private initialMode: Mode;
  private captureCursor: boolean;
  private cb: Callbacks;
  private handler: TaskMessageHandler;
  private socket: WebSocket | null = null;
  private initialUserInput: string | null = null;
  private initialAttachments: UserAttachment[] = [];
  private manuallyDisconnected = false;
  private hasReceivedTaskEnded = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private connectionState: ConnectionState = 'closed';
  private closeReason: CloseReason = null;
  private seenKeys = new Set<string>();
  private queuedReplies = new Map<string, string>();

  private constructor(taskId: string, mode: Mode, captureCursor: boolean, cb: Callbacks) {
    this.taskId = taskId;
    this.mode = mode;
    this.initialMode = mode;
    this.captureCursor = captureCursor;
    this.cb = cb;
    this.handler = new TaskMessageHandler({ captureCursor });
  }

  static attach(taskId: string, cb: Callbacks) {
    return new TaskStreamClient(taskId, 'attach', true, cb);
  }

  static newRound(taskId: string, userInput: string, attachments: UserAttachment[], cb: Callbacks) {
    const c = new TaskStreamClient(taskId, 'new', false, cb);
    c.initialUserInput = userInput;
    c.initialAttachments = attachments;
    return c;
  }

  connect() {
    this.cleanupSocket();
    this.manuallyDisconnected = false;
    this.mode = this.initialMode;
    this.hasReceivedTaskEnded = false;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.seenKeys.clear();
    this.handler = new TaskMessageHandler({ captureCursor: this.captureCursor });
    this.connectionState = 'connecting';
    this.closeReason = null;
    this.emit();
    this.openSocket();
  }

  disconnect(): StreamState {
    this.clearReconnectTimer();
    this.manuallyDisconnected = true;
    if (this.socket) {
      const s = this.handler.getState();
      if (s.status !== 'finished' && !this.hasReceivedTaskEnded) {
        this.handler.finalizeCycle();
      }
      this.cleanupSocket();
    }
    this.connectionState = 'closed';
    return this.buildState();
  }

  sendCancel() {
    this.send({ type: 'user-cancel' });
  }

  sendReplyQuestion(requestId: string, answers: unknown): SendReplyResult {
    const payload = {
      type: 'reply-question',
      data: base64Encode(
        JSON.stringify({
          request_id: requestId,
          answers_json: JSON.stringify(answers),
          cancelled: false,
        }),
      ),
    };
    if (this.send(payload)) return 'sent';
    if (this.connectionState === 'connecting' || this.connectionState === 'reconnecting') {
      this.queuedReplies.set(requestId, JSON.stringify(payload));
      return 'queued';
    }
    return 'rejected';
  }

  getState() {
    return this.buildState();
  }

  /* ----------------------------- 内部 ----------------------------- */

  private openSocket() {
    let socket: WebSocket;
    try {
      socket = openWebSocket(this.buildUrl());
    } catch {
      this.connectionState = 'closed';
      this.closeReason = 'unknown';
      this.emit();
      this.cb.onError?.();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.clearReconnectTimer();
      this.connectionState = 'connected';
      this.closeReason = null;
      this.handler.setConnected();
      this.emit();
      this.flushQueuedReplies();
      if (this.initialUserInput != null) {
        this.sendUserInput(this.initialUserInput, this.initialAttachments);
        this.initialUserInput = null;
        this.initialAttachments = [];
      }
      this.cb.onOpen?.();
    };

    socket.onmessage = (event: { data: any }) => {
      try {
        const chunk = JSON.parse(event.data);
        this.handleServerChunk(chunk);
      } catch {
        /* ignore malformed frame */
      }
    };

    socket.onerror = () => {
      /* onclose 里统一处理重连 */
    };

    socket.onclose = () => {
      this.socket = null;
      if (!this.manuallyDisconnected && !this.hasReceivedTaskEnded) {
        this.connectionState = 'reconnecting';
        this.closeReason = null;
        this.emit();
        this.scheduleReconnect();
        return;
      }
      this.connectionState = 'closed';
      this.closeReason = this.hasReceivedTaskEnded
        ? 'task_ended'
        : this.manuallyDisconnected
          ? 'manual'
          : 'unknown';
      this.emit();
      this.cb.onClose?.();
    };
  }

  private handleServerChunk(chunk: { type?: string; kind?: string; data?: unknown; timestamp?: number }) {
    if (chunk.type === 'task-ended') this.hasReceivedTaskEnded = true;

    if (!this.shouldProcess(chunk)) return;

    this.handler.pushChunk({
      event: chunk.type,
      kind: chunk.kind,
      data: chunk.data,
      timestamp: chunk.timestamp,
    });
    this.emit();

    if (this.handler.status === 'finished') {
      this.disconnect();
    }
  }

  private shouldProcess(chunk: { type?: string; kind?: string; data?: unknown; timestamp?: number }) {
    // reply-question 始终处理（不参与去重）
    if (chunk.type === 'reply-question') return true;
    const key = JSON.stringify([
      chunk.type ?? '',
      chunk.kind ?? '',
      chunk.timestamp ?? 0,
      typeof chunk.data === 'string' ? chunk.data : chunk.data == null ? '' : JSON.stringify(chunk.data),
    ]);
    if (this.seenKeys.has(key)) return false;
    this.seenKeys.add(key);
    return true;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts += 1;
    this.mode = this.initialUserInput ? this.initialMode : 'attach';
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manuallyDisconnected || this.hasReceivedTaskEnded || this.socket) return;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private flushQueuedReplies() {
    if (this.socket?.readyState !== WebSocket.OPEN || this.queuedReplies.size === 0) return;
    for (const [id, payload] of [...this.queuedReplies.entries()]) {
      if (this.socket?.readyState !== WebSocket.OPEN) break;
      this.socket.send(payload);
      this.queuedReplies.delete(id);
    }
  }

  private sendUserInput(text: string, attachments: UserAttachment[] = []) {
    this.send({
      type: 'user-input',
      data: base64Encode(JSON.stringify({ content: base64Encode(text), attachments })),
    });
  }

  private send(msg: { type: string; data?: string }) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  private cleanupSocket() {
    if (this.socket) {
      this.socket.onopen = null as any;
      this.socket.onmessage = null as any;
      this.socket.onerror = null as any;
      this.socket.onclose = null as any;
      try {
        this.socket.close();
      } catch {
        /* ignore */
      }
      this.socket = null;
    }
  }

  private emit() {
    this.cb.onState?.(this.buildState());
  }

  private buildState(): StreamState {
    return {
      ...this.handler.getState(),
      connectionState: this.connectionState,
      closeReason: this.closeReason,
    };
  }

  private buildUrl() {
    const base = getBaseUrl();
    const ws = base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${ws}/api/v1/users/tasks/stream?id=${encodeURIComponent(this.taskId)}&mode=${this.mode}`;
  }
}
