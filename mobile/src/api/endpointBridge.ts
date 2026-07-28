import { getBaseUrl, openWebSocket, request } from './client';
import { randomUUID } from 'react-native-quick-crypto';

export const ENDPOINT_PROTOCOL_VERSION = 1;
export const ENDPOINT_MAX_FILE_BYTES = 5 * 1024 * 1024;

const DEFAULT_FRAME_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16_000, 30_000];
const METHOD_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type JsonObject = Record<string, unknown>;
export type EndpointPlatform = 'macos' | 'windows' | 'linux' | 'ios' | 'android';
export type EndpointConnectionState = 'idle' | 'connecting' | 'handshaking' | 'ready' | 'backoff' | 'stopped';

export interface EndpointProfile {
  device_name: string;
  platform: EndpointPlatform;
  os_version: string;
  arch: string;
  client_version: string;
}

export interface EndpointView {
  machine_id: string;
  device_name?: string;
  alias?: string | null;
  display_name: string;
  platform?: EndpointPlatform;
  os_version?: string;
  arch?: string;
  client_version?: string;
  protocol_version?: number;
  online?: boolean;
  last_seen_at?: number | null;
  status?: 'active' | 'revoked';
  created_at?: number;
  updated_at?: number;
}

export interface InboundAgentMessage {
  type: 'event' | 'request';
  message_id: string;
  source: string;
  target: string;
  method: string;
  routed_at: number;
  payload: JsonObject;
}

interface InboundResponse {
  type: 'response';
  message_id: string;
  source: string;
  target: string;
  reply_to: string;
  routed_at: number;
  payload: JsonObject;
}

interface ProtocolErrorMessage {
  type: 'error';
  reply_to?: string | null;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retry_after_ms?: number;
  };
}

interface PendingRequest {
  target: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (payload: JsonObject) => void;
  reject: (error: EndpointBridgeError) => void;
}

interface EndpointBridgeOptions {
  machineId: string;
  profile: EndpointProfile;
  onDirectory?: (endpoints: EndpointView[]) => void;
  onEvent?: (message: InboundAgentMessage) => void;
  onRequest?: (message: InboundAgentMessage) => void;
  onState?: (state: EndpointConnectionState) => void;
  onProtocolError?: (error: ProtocolErrorMessage['error']) => void;
  idFactory?: () => string;
}

export interface EndpointAgentHandlers {
  onEvent?: (message: InboundAgentMessage) => void;
  onRequest?: (message: InboundAgentMessage) => void;
}

export class EndpointBridgeError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EndpointBridgeError';
  }
}

export class EndpointBridgeClient {
  private readonly machineId: string;
  private readonly profile: EndpointProfile;
  private readonly options: EndpointBridgeOptions;
  private readonly idFactory: () => string;
  private socket: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectionGeneration = 0;
  private manuallyStopped = false;
  private maxFrameBytes = DEFAULT_FRAME_BYTES;
  private stableSince = 0;
  private state: EndpointConnectionState = 'idle';
  private directory: EndpointView[] = [];
  private handledResponseIds = new Set<string>();
  private handledResponseOrder: string[] = [];

  constructor(options: EndpointBridgeOptions) {
    if (!UUID_V4_PATTERN.test(options.machineId)) {
      throw new EndpointBridgeError('invalid_machine_id', 'machine_id 必须是 UUIDv4');
    }
    this.machineId = options.machineId;
    this.profile = options.profile;
    this.options = options;
    this.idFactory = options.idFactory ?? createUUID;
  }

  get connectionState(): EndpointConnectionState {
    return this.state;
  }

  get endpoints(): EndpointView[] {
    return [...this.directory];
  }

  connect(): void {
    this.manuallyStopped = false;
    this.clearReconnectTimer();
    this.open();
  }

  disconnect(): void {
    this.manuallyStopped = true;
    this.clearReconnectTimer();
    this.finishPendingAsUnknown();
    const socket = this.socket;
    this.socket = null;
    this.connectionGeneration++;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, 'manual disconnect');
    }
    this.setState('stopped');
  }

  event(target: string, method: string, payload: JsonObject): string {
    const messageId = this.nextMessageId();
    this.sendAgentMessage({
      type: 'event',
      message_id: messageId,
      target,
      method,
      payload,
    });
    return messageId;
  }

  request(
    target: string,
    method: string,
    payload: JsonObject,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<JsonObject> {
    const messageId = this.nextMessageId();
    return new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new EndpointBridgeError('outcome_unknown', '请求结果未知'));
      }, Math.max(1, timeoutMs));
      this.pending.set(messageId, { target, timer, resolve, reject });
      try {
        this.sendAgentMessage({
          type: 'request',
          message_id: messageId,
          target,
          method,
          payload,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(messageId);
        reject(error);
      }
    });
  }

  respond(target: string, replyTo: string, payload: JsonObject): string {
    if (!UUID_V4_PATTERN.test(replyTo)) {
      throw new EndpointBridgeError('invalid_message', 'reply_to 必须是 UUIDv4');
    }
    const messageId = this.nextMessageId();
    this.sendFrame({
      type: 'response',
      message_id: messageId,
      target,
      reply_to: replyTo,
      payload,
    });
    return messageId;
  }

  setAgentHandlers(handlers: EndpointAgentHandlers): void {
    this.options.onEvent = handlers.onEvent;
    this.options.onRequest = handlers.onRequest;
  }

  private open(): void {
    const generation = ++this.connectionGeneration;
    this.cleanupSocket();
    this.setState('connecting');
    const socket = openWebSocket(endpointWebSocketURL());
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.connectionGeneration) return;
      this.setState('handshaking');
      socket.send(JSON.stringify({
        type: 'hello',
        protocol_versions: [ENDPOINT_PROTOCOL_VERSION],
        machine_id: this.machineId,
        profile: this.profile,
      }));
    };
    socket.onmessage = (event) => {
      if (generation !== this.connectionGeneration || typeof event.data !== 'string') return;
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      if (generation !== this.connectionGeneration) return;
    };
    socket.onclose = (event) => {
      if (generation !== this.connectionGeneration) return;
      this.socket = null;
      this.finishPendingAsUnknown();
      if (this.manuallyStopped || !shouldReconnect(event.code)) {
        this.setState('stopped');
        return;
      }
      if (this.stableSince > 0 && Date.now() - this.stableSince >= 60_000) {
        this.reconnectAttempt = 0;
      }
      this.scheduleReconnect();
    };
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(message) || typeof message.type !== 'string') return;
    switch (message.type) {
      case 'welcome': {
        if (this.state !== 'handshaking' || message.protocol_version !== ENDPOINT_PROTOCOL_VERSION) {
          this.socket?.close(1002, 'unsupported protocol');
          return;
        }
        const limits = isObject(message.limits) ? message.limits : null;
        if (limits && typeof limits.max_frame_bytes === 'number' && limits.max_frame_bytes > 0) {
          this.maxFrameBytes = limits.max_frame_bytes;
        }
        this.stableSince = Date.now();
        this.setState('ready');
        return;
      }
      case 'directory.snapshot': {
        if (this.state !== 'ready' || !Array.isArray(message.endpoints)) return;
        this.directory = message.endpoints.filter(isEndpointView);
        this.options.onDirectory?.([...this.directory]);
        return;
      }
      case 'response':
        this.handleResponse(message);
        return;
      case 'error':
        this.handleProtocolError(message);
        return;
      case 'event':
      case 'request':
        this.handleInboundAgentMessage(message);
        return;
      default:
        return;
    }
  }

  private handleResponse(message: JsonObject): void {
    if (!isInboundResponse(message)) return;
    if (this.handledResponseIds.has(message.message_id)) return;
    const pending = this.pending.get(message.reply_to);
    if (!pending || message.source !== pending.target || message.target !== this.machineId) return;
    this.rememberResponse(message.message_id);
    this.pending.delete(message.reply_to);
    clearTimeout(pending.timer);
    pending.resolve(message.payload);
  }

  private handleProtocolError(message: JsonObject): void {
    if (!isObject(message.error) || typeof message.error.code !== 'string') return;
    const error = new EndpointBridgeError(
      message.error.code,
      typeof message.error.message === 'string' ? message.error.message : message.error.code,
      message.error.retryable === true,
      typeof message.error.retry_after_ms === 'number' ? message.error.retry_after_ms : undefined,
    );
    if (typeof message.reply_to === 'string') {
      const pending = this.pending.get(message.reply_to);
      if (pending) {
        this.pending.delete(message.reply_to);
        clearTimeout(pending.timer);
        pending.reject(error);
        return;
      }
    }
    this.options.onProtocolError?.({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      retry_after_ms: error.retryAfterMs,
    });
  }

  private handleInboundAgentMessage(message: JsonObject): void {
    if (!isInboundAgentMessage(message) || message.target !== this.machineId) return;
    if (message.type === 'event') {
      this.options.onEvent?.(message);
    } else {
      this.options.onRequest?.(message);
    }
  }

  private sendAgentMessage(message: {
    type: 'event' | 'request';
    message_id: string;
    target: string;
    method: string;
    payload: JsonObject;
  }): void {
    if (!METHOD_PATTERN.test(message.method)) {
      throw new EndpointBridgeError('invalid_method', 'Agent method 格式无效');
    }
    this.sendFrame(message);
  }

  private sendFrame(message: JsonObject): void {
    if (this.state !== 'ready' || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new EndpointBridgeError('not_connected', '端点桥接连接尚未就绪');
    }
    const raw = JSON.stringify(message);
    if (utf8Bytes(raw) > this.maxFrameBytes) {
      throw new EndpointBridgeError('payload_too_large', '消息超过单帧上限');
    }
    this.socket.send(raw);
  }

  private nextMessageId(): string {
    const value = this.idFactory();
    if (!UUID_V4_PATTERN.test(value)) {
      throw new EndpointBridgeError('invalid_message_id', '消息标识生成器必须返回 UUIDv4');
    }
    return value;
  }

  private rememberResponse(messageId: string): void {
    this.handledResponseIds.add(messageId);
    this.handledResponseOrder.push(messageId);
    if (this.handledResponseOrder.length <= 2048) return;
    const removed = this.handledResponseOrder.shift();
    if (removed) this.handledResponseIds.delete(removed);
  }

  private scheduleReconnect(): void {
    this.setState('backoff');
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyStopped) this.open();
    }, delay);
  }

  private finishPendingAsUnknown(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new EndpointBridgeError('outcome_unknown', '请求结果未知'));
    }
    this.pending.clear();
  }

  private cleanupSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    socket.close(1000, 'connection replaced');
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setState(state: EndpointConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }
}

export async function listEndpoints(): Promise<EndpointView[]> {
  const response = await request<EndpointView[]>('/api/v1/endpoints');
  return response.data ?? [];
}

export async function getEndpoint(machineId: string): Promise<EndpointView> {
  const response = await request<EndpointView>(`/api/v1/endpoints/${machineId}`);
  if (!response.data) throw new EndpointBridgeError('invalid_response', '端点响应为空');
  return response.data;
}

export async function updateEndpointAlias(machineId: string, alias: string | null): Promise<EndpointView> {
  const response = await request<EndpointView>(`/api/v1/endpoints/${machineId}`, {
    method: 'PATCH',
    body: { alias },
  });
  if (!response.data) throw new EndpointBridgeError('invalid_response', '端点响应为空');
  return response.data;
}

export async function revokeEndpoint(machineId: string): Promise<void> {
  await request(`/api/v1/endpoints/${machineId}/revoke`, { method: 'POST' });
}

export async function restoreEndpoint(machineId: string): Promise<void> {
  await request(`/api/v1/endpoints/${machineId}/restore`, { method: 'POST' });
}

function endpointWebSocketURL(): string {
  const base = getBaseUrl().replace(/\/+$/, '');
  return `${base.replace(/^http/i, 'ws')}/api/v1/endpoints/connect`;
}

function createUUID(): string {
  return randomUUID();
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return encodeURIComponent(value).replace(/%[0-9A-F]{2}|./gi, 'x').length;
}

function shouldReconnect(code: number): boolean {
  return code === 0 || code === 1006 || code === 1011 || code === 1012 || code === 1013;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEndpointView(value: unknown): value is EndpointView {
  return isObject(value) && typeof value.machine_id === 'string' && typeof value.display_name === 'string';
}

function isInboundResponse(value: JsonObject): value is JsonObject & InboundResponse {
  return value.type === 'response' &&
    typeof value.message_id === 'string' &&
    UUID_V4_PATTERN.test(value.message_id) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.reply_to === 'string' &&
    isObject(value.payload);
}

function isInboundAgentMessage(value: JsonObject): value is JsonObject & InboundAgentMessage {
  return (value.type === 'event' || value.type === 'request') &&
    typeof value.message_id === 'string' &&
    UUID_V4_PATTERN.test(value.message_id) &&
    typeof value.source === 'string' &&
    typeof value.target === 'string' &&
    typeof value.method === 'string' &&
    METHOD_PATTERN.test(value.method) &&
    typeof value.routed_at === 'number' &&
    isObject(value.payload);
}
