type JsonObject = Record<string, unknown>;

export type DesktopEndpoint = {
  machine_id: string;
  display_name: string;
  online?: boolean;
};

export type DesktopAgentMessage = {
  type: "event" | "request";
  message_id: string;
  source: string;
  target: string;
  method: string;
  routed_at: number;
  payload: JsonObject;
};

type Pending = {
  target: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (payload: JsonObject) => void;
  reject: (error: DesktopEndpointError) => void;
};

export class DesktopEndpointError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DesktopEndpointError";
  }
}

class DesktopEndpointClient {
  private machineId = "";
  private pending = new Map<string, Pending>();
  private removeMessageListener: (() => void) | null = null;
  private removeCloseListener: (() => void) | null = null;
  private directoryListeners = new Set<(endpoints: DesktopEndpoint[]) => void>();
  private agentListeners = new Set<(message: DesktopAgentMessage) => void>();

  async start(baseUrl: string): Promise<void> {
    const bridge = window.monkeyCodeDesktop?.endpointBridge;
    if (!bridge) return;
    await this.stop();
    this.removeMessageListener = bridge.onMessage((message) => this.handleMessage(message));
    this.removeCloseListener = bridge.onClose(() => this.finishPendingAsUnknown());
    try {
      const result = await bridge.start(baseUrl);
      this.machineId = result.machine_id;
    } catch (error) {
      this.removeMessageListener();
      this.removeCloseListener();
      this.removeMessageListener = null;
      this.removeCloseListener = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.removeMessageListener?.();
    this.removeCloseListener?.();
    this.removeMessageListener = null;
    this.removeCloseListener = null;
    this.finishPendingAsUnknown();
    await window.monkeyCodeDesktop?.endpointBridge.stop();
  }

  subscribeDirectory(listener: (endpoints: DesktopEndpoint[]) => void): () => void {
    this.directoryListeners.add(listener);
    return () => this.directoryListeners.delete(listener);
  }

  subscribeAgent(listener: (message: DesktopAgentMessage) => void): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  async event(target: string, method: string, payload: JsonObject): Promise<string> {
    const messageId = crypto.randomUUID();
    await this.send({ type: "event", message_id: messageId, target, method, payload });
    return messageId;
  }

  request(target: string, method: string, payload: JsonObject, timeoutMs = 30_000): Promise<JsonObject> {
    const messageId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(messageId);
        reject(new DesktopEndpointError("outcome_unknown", "请求结果未知"));
      }, timeoutMs);
      this.pending.set(messageId, { target, timer, resolve, reject });
      void this.send({ type: "request", message_id: messageId, target, method, payload }).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(messageId);
        reject(error);
      });
    });
  }

  async respond(target: string, replyTo: string, payload: JsonObject): Promise<string> {
    const messageId = crypto.randomUUID();
    await this.send({ type: "response", message_id: messageId, target, reply_to: replyTo, payload });
    return messageId;
  }

  private async send(message: JsonObject): Promise<void> {
    const bridge = window.monkeyCodeDesktop?.endpointBridge;
    if (!bridge) throw new DesktopEndpointError("not_available", "桌面端桥接不可用");
    await bridge.send(JSON.stringify(message));
  }

  private handleMessage(raw: string): void {
    let message: JsonObject;
    try {
      message = JSON.parse(raw) as JsonObject;
    } catch {
      return;
    }
    if (message.type === "directory.snapshot" && Array.isArray(message.endpoints)) {
      const endpoints = message.endpoints.filter(isEndpoint);
      for (const listener of this.directoryListeners) listener([...endpoints]);
      return;
    }
    if (message.type === "response") {
      this.handleResponse(message);
      return;
    }
    if (message.type === "error") {
      this.handleError(message);
      return;
    }
    if (isAgentMessage(message) && message.target === this.machineId) {
      for (const listener of this.agentListeners) listener(message);
    }
  }

  private handleResponse(message: JsonObject): void {
    if (
      typeof message.reply_to !== "string" ||
      typeof message.source !== "string" ||
      message.target !== this.machineId ||
      !isObject(message.payload)
    ) return;
    const pending = this.pending.get(message.reply_to);
    if (!pending || pending.target !== message.source) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.reply_to);
    pending.resolve(message.payload);
  }

  private handleError(message: JsonObject): void {
    if (typeof message.reply_to !== "string" || !isObject(message.error)) return;
    const pending = this.pending.get(message.reply_to);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.reply_to);
    pending.reject(new DesktopEndpointError(
      typeof message.error.code === "string" ? message.error.code : "protocol_error",
      typeof message.error.message === "string" ? message.error.message : "桥接协议错误",
    ));
  }

  private finishPendingAsUnknown(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DesktopEndpointError("outcome_unknown", "请求结果未知"));
    }
    this.pending.clear();
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEndpoint(value: unknown): value is DesktopEndpoint {
  return isObject(value) && typeof value.machine_id === "string" && typeof value.display_name === "string";
}

function isAgentMessage(value: JsonObject): value is JsonObject & DesktopAgentMessage {
  return (value.type === "event" || value.type === "request") &&
    typeof value.message_id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string" &&
    typeof value.method === "string" &&
    typeof value.routed_at === "number" &&
    isObject(value.payload);
}

export const desktopEndpointClient = new DesktopEndpointClient();
