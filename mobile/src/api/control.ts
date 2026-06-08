/**
 * 任务控制通道（WebSocket）—— 移植自 Web 端 TaskControlClient 的精简版，
 * 目前仅用于「运行中任务切换模型」。
 *
 * 端点：wss://<host>/api/v1/users/tasks/control?id=<taskId>
 * 调用：client -> { type:"call", kind, data: b64(JSON{ request_id, ...payload }) }
 *       server -> { type:"call-response", data: b64(JSON{ request_id, success, error?, ... }) }
 * 按 request_id 配对。
 */
import { getBaseUrl, openWebSocket } from './client';
import { base64DecodeToString, base64Encode } from '@/messages/base64';

export interface SwitchModelResponse {
  request_id?: string;
  success?: boolean;
  error?: string | null;
  message?: string;
  model?: unknown;
}

/** 开发环境监听端口（对齐 web PortForwardInfo）；access_url 可直接在浏览器打开预览。 */
export interface PortForwardInfo {
  port?: number;
  status?: string;
  process?: string;
  forward_id?: string | null;
  access_url?: string | null;
  label?: string | null;
  error_message?: string | null;
}

/** 文件条目模式：4=目录(Tree)，其余为文件/链接等。 */
export const RepoEntryMode = { File: 1, Executable: 2, Symlink: 3, Tree: 4, Submodule: 5 } as const;

/** 目录条目（对齐 web RepoFileStatus）。 */
export interface RepoFileStatus {
  entry_mode?: number;
  mode?: number | null;
  modified_at?: number;
  name: string;
  path: string;
  size?: number;
  symlink_target?: string | null;
}

/** 文件改动（对齐 web RepoFileChange）。status: M/A/D/R/RM/?? */
export interface RepoFileChange {
  additions?: number;
  deletions?: number;
  old_path?: string;
  path: string;
  status?: string;
}

interface Pending {
  resolve: (v: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const CALL_TIMEOUT_MS = 15000;

export class TaskControlClient {
  private taskId: string;
  private socket: WebSocket | null = null;
  private disposed = false;
  private connectionId = 0;
  private pending = new Map<string, Pending>();
  private reqSeq = 0;
  private onStatus?: (connected: boolean) => void;
  private onPortChange?: (opened: boolean) => void;
  private onRepoFileChange?: () => void;

  constructor(taskId: string, opts: { onStatus?: (connected: boolean) => void; onPortChange?: (opened: boolean) => void; onRepoFileChange?: () => void } = {}) {
    this.taskId = taskId;
    this.onStatus = opts.onStatus;
    this.onPortChange = opts.onPortChange;
    this.onRepoFileChange = opts.onRepoFileChange;
  }

  connect() {
    this.disposed = false;
    const connectionId = ++this.connectionId;
    this.closeSocket();
    let socket: WebSocket;
    try {
      socket = openWebSocket(this.buildUrl());
    } catch {
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket || this.connectionId !== connectionId) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this.onStatus?.(true);
    };
    socket.onmessage = (event: any) => {
      if (this.socket !== socket || this.connectionId !== connectionId) return;
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      /* onclose 处理 */
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      if (this.connectionId !== connectionId) return;
      this.failPending();
      this.onStatus?.(false);
      if (!this.disposed) {
        // 简单重连
        setTimeout(() => {
          if (!this.disposed && this.connectionId === connectionId) this.connect();
        }, 1000);
      }
    };
  }

  dispose() {
    this.disposed = true;
    this.connectionId += 1;
    this.failPending();
    this.closeSocket();
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** 切换模型；返回 null 表示连接不可用或超时。 */
  switchModel(modelId: string, loadSession = true): Promise<SwitchModelResponse | null> {
    return this.call<SwitchModelResponse>('switch_model', {
      model_id: modelId,
      load_session: loadSession,
    });
  }

  /** 重启 Agent。loadSession=true 保留上下文（重启），false 清空上下文（重置）。 */
  restart(loadSession: boolean): Promise<SwitchModelResponse | null> {
    return this.call<SwitchModelResponse>('restart', { load_session: loadSession });
  }

  /** 列出开发环境监听端口（含可预览的 access_url）。返回 null 表示连接不可用/超时。 */
  async getPortForwardList(): Promise<PortForwardInfo[] | null> {
    const resp = await this.call<{ ports?: PortForwardInfo[] }>('port_forward_list', {});
    if (!resp) return null;
    return resp.ports ?? [];
  }

  /** 列出某目录下的文件/子目录（entry_mode===4 为目录）。path='' 为仓库根。 */
  async getFileList(path: string): Promise<RepoFileStatus[] | null> {
    const r = await this.call<{ files?: RepoFileStatus[] }>('repo_file_list', { path, glob_pattern: '*', include_hidden: true });
    return r ? (r.files ?? []) : null;
  }

  /** 当前任务的文件改动列表。 */
  async getFileChanges(): Promise<RepoFileChange[] | null> {
    const r = await this.call<{ changes?: RepoFileChange[] }>('repo_file_changes', {});
    return r ? (r.changes ?? []) : null;
  }

  /** 某文件的 unified diff 文本。 */
  async getFileDiff(path: string): Promise<string | null> {
    const r = await this.call<{ diff?: string }>('repo_file_diff', { path, unified: true, context_lines: 20 });
    return r ? (r.diff ?? '') : null;
  }

  /** 读取文件内容（按 UTF-8 文本解码；二进制文件不保证可读）。 */
  async getFileContent(path: string): Promise<string | null> {
    const r = await this.call<{ content?: string }>('repo_read_file', { path, offset: 0, length: 1024 * 1024 });
    if (!r || typeof r.content !== 'string') return null;
    try { return base64DecodeToString(r.content); } catch { return r.content; }
  }

  private call<T>(kind: string, payload: Record<string, unknown>): Promise<T | null> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.resolve(null);
    const requestId = `r${++this.reqSeq}-${Date.now()}`;
    const message = {
      type: 'call',
      kind,
      data: base64Encode(JSON.stringify({ request_id: requestId, ...payload })),
    };
    return new Promise<T | null>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, CALL_TIMEOUT_MS);
      this.pending.set(requestId, { resolve: (v) => resolve(v ?? null), timeoutId });
      try {
        this.socket?.send(JSON.stringify(message));
      } catch {
        clearTimeout(timeoutId);
        this.pending.delete(requestId);
        resolve(null);
      }
    });
  }

  private handleMessage(raw: string) {
    let msg: { type?: string; kind?: string; data?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    // 端口变化事件（开发环境起/停了监听端口）→ 通知上层刷新端口列表。
    if (msg.kind === 'port_change') {
      let payload: any = null;
      try { if (typeof msg.data === 'string') payload = JSON.parse(base64DecodeToString(msg.data)); } catch { /* ignore */ }
      this.onPortChange?.(payload?.change_type === 'PORT_CHANGE_TYPE_OPENED');
      return;
    }
    // 仓库文件改动事件 → 通知上层刷新改动列表。
    if (msg.kind === 'repo_file_change') { this.onRepoFileChange?.(); return; }
    if (msg.type !== 'call-response') return;
    let resp: any = null;
    try {
      if (typeof msg.data === 'string') resp = JSON.parse(base64DecodeToString(msg.data));
    } catch {
      return;
    }
    const requestId = resp?.request_id;
    if (!requestId) return;
    const p = this.pending.get(requestId);
    if (!p) return;
    clearTimeout(p.timeoutId);
    this.pending.delete(requestId);
    p.resolve(resp);
  }

  private failPending() {
    for (const p of this.pending.values()) {
      clearTimeout(p.timeoutId);
      p.resolve(null);
    }
    this.pending.clear();
  }

  private closeSocket() {
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

  private buildUrl() {
    const ws = getBaseUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${ws}/api/v1/users/tasks/control?id=${encodeURIComponent(this.taskId)}`;
  }
}
