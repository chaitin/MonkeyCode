// WS 连接管理:端口扫描 → hello 鉴权 → 收发循环 → 指数退避重连。
// MV3 SW 随时可能被杀:重连兜底靠 background 里注册的 chrome.alarms;
// 活跃的 WS 收发(内核 30s 一次 ping)可延长 SW 寿命(Chrome 116+)。
import { backoffDelayMs, buildHello, parseBrowserInfo, portCandidates } from "./core";
import { Ev, type Request } from "./protocol";

export type BridgeStatus = "unpaired" | "connecting" | "connected" | "disconnected";

// storage.local:跨会话配置;storage.session:运行态(popup/options 只读展示)
const LOCAL_TOKEN = "token";
const LOCAL_PORT = "port";
const SESSION_CODE = "pairingCode";
const SESSION_STATUS = "bridgeStatus";
const SESSION_PORT = "connectedPort";
const SESSION_ERROR = "bridgeError";

const HELLO_TIMEOUT_MS = 3000;

interface HelloResult {
  ws: WebSocket;
  token?: string;
}

/** 单端口连接尝试的失败原因:网络不通(换下一个端口)vs 鉴权被拒(停止扫描) */
class AuthRejectedError extends Error {}

export class Bridge {
  /** 由 background 注入:收到请求帧后的处理器(router) */
  onRequest: (req: Request) => Promise<unknown> = async () => ({});

  private ws: WebSocket | null = null;
  private connecting = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** 事件/应答帧发送:未连接直接丢弃(内核断线期间的事件没有补投语义) */
  send(frame: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** alarms 唤醒/SW 启动入口:无活跃连接则发起连接 */
  async ensureConnected(): Promise<void> {
    if (this.connected || this.connecting) return;
    await this.connect();
  }

  /** 配对/改端口后立刻重连:丢弃现有连接与退避计时,从头来 */
  async reconnectNow(): Promise<void> {
    this.clearRetry();
    this.attempt = 0;
    this.teardown();
    await this.connect();
  }

  /** 解除配对:清 token、断开、状态转未配对 */
  async unpair(): Promise<void> {
    this.clearRetry();
    this.teardown();
    await chrome.storage.local.remove(LOCAL_TOKEN);
    await this.setStatus("unpaired");
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const local = await chrome.storage.local.get([LOCAL_TOKEN, LOCAL_PORT]);
      const session = await chrome.storage.session.get(SESSION_CODE);
      const token: string | undefined = local[LOCAL_TOKEN];
      const code: string | undefined = session[SESSION_CODE];
      if (!token && !code) {
        await this.setStatus("unpaired");
        return;
      }

      await this.setStatus("connecting");
      const ports = portCandidates(local[LOCAL_PORT]);
      for (const port of ports) {
        try {
          const res = await this.openAndHello(port, token, code);
          await this.onEstablished(res, port);
          return;
        } catch (e) {
          if (e instanceof AuthRejectedError) {
            // 鉴权被拒:token 即已被解除配对,配对码即无效,都不必再扫端口
            if (token) {
              await chrome.storage.local.remove(LOCAL_TOKEN);
              await this.setStatus("unpaired", "配对已被解除,请重新配对");
            } else {
              await chrome.storage.session.remove(SESSION_CODE);
              await this.setStatus("unpaired", "配对码无效或已过期");
            }
            return;
          }
          // 网络不通:继续尝试下一个端口
        }
      }
      await this.setStatus("disconnected", "未找到本地服务,请确认 MonkeyCode 桌面应用已启动");
      this.scheduleRetry();
    } finally {
      this.connecting = false;
    }
  }

  /** 单端口尝试:WS 打开 → 发 hello → 等 hello.ok。打开后被关视为鉴权拒绝 */
  private openAndHello(port: number, token?: string, code?: string): Promise<HelloResult> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ext`);
      let opened = false;
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new Error("hello 超时"))), HELLO_TIMEOUT_MS);
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      ws.onopen = () => {
        opened = true;
        ws.send(
          JSON.stringify(
            buildHello({
              token,
              code,
              extId: chrome.runtime.id,
              extVersion: chrome.runtime.getManifest().version,
              browser: parseBrowserInfo(navigator.userAgent),
            })
          )
        );
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(String(evt.data));
          if (msg.event === Ev.HelloOK) {
            finish(() => resolve({ ws, token: msg.token }));
          }
        } catch {
          // hello 阶段的非 JSON 帧忽略,等超时兜底
        }
      };
      ws.onerror = () => finish(() => reject(new Error("连接失败")));
      ws.onclose = () =>
        finish(() => {
          // WS 握手成功后被服务端关闭 = hello 鉴权失败;从未打开 = 端口不通
          if (opened) reject(new AuthRejectedError("鉴权被拒"));
          else reject(new Error("端口不通"));
        });
    });
  }

  private async onEstablished(res: HelloResult, port: number): Promise<void> {
    this.ws = res.ws;
    this.attempt = 0;
    // 先挂收发处理器再做存储 IO:hello.ok 之后内核可能立刻下发请求,不能丢帧
    res.ws.onmessage = (evt) => void this.onFrame(String(evt.data));
    res.ws.onerror = null;
    res.ws.onclose = () => {
      // 已建连后的断开是网络/内核退出,不是鉴权问题,走退避重连
      this.ws = null;
      void this.setStatus("disconnected").then(() => this.scheduleRetry());
    };
    if (res.token) {
      // 配对成功:落盘长期 token,一次性配对码即刻作废
      await chrome.storage.local.set({ [LOCAL_TOKEN]: res.token });
      await chrome.storage.session.remove(SESSION_CODE);
    }
    await this.setStatus("connected");
    await chrome.storage.session.set({ [SESSION_PORT]: port });
  }

  private async onFrame(data: string): Promise<void> {
    // 联调痕迹:最近入站帧(chrome://extensions → SW 检查器里可查)
    const g = globalThis as { __mcFrames?: string[] };
    (g.__mcFrames ??= []).push(Date.now() + " " + data.slice(0, 120));
    if (g.__mcFrames.length > 50) g.__mcFrames.shift();
    let msg: Request & { op?: string };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg.op) return;
    if (msg.op === "ping") {
      // 保活:活跃收发能延长 SW 寿命,内核也以此确认桥接存活
      this.send({ event: Ev.Pong });
      return;
    }
    const resp = await this.onRequest(msg);
    this.send(resp);
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = backoffDelayMs(this.attempt++);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private teardown(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private async setStatus(status: BridgeStatus, error?: string): Promise<void> {
    await chrome.storage.session.set({
      [SESSION_STATUS]: status,
      [SESSION_ERROR]: error ?? "",
    });
    if (status !== "connected") {
      await chrome.storage.session.remove(SESSION_PORT);
    }
  }
}
