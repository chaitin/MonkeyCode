// 桥接协议的 TS 镜像。唯一权威定义在 agent/internal/browser/protocol.go,
// 本文件只做常量与类型的逐字对齐,改协议必须先改 Go 侧。
export const PROTO_VERSION = 1;

// 内核→扩展的请求 op
export const Op = {
  CDP: "cdp",
  TabsCreate: "tabs.create",
  TabsList: "tabs.list",
  TabsActivate: "tabs.activate",
  TabsClose: "tabs.close",
  Attach: "attach",
  Detach: "detach",
  FramesList: "frames.list",
  Ping: "ping",
} as const;

// 扩展→内核的事件
export const Ev = {
  Hello: "hello",
  HelloOK: "hello.ok",
  CDP: "cdp",
  TabUpdated: "tab.updated",
  TabRemoved: "tab.removed",
  Detached: "detached",
  Handoff: "handoff",
  Pong: "pong",
} as const;

// 扩展侧错误码
export const Err = {
  Detached: "detached",
  NoTab: "no_tab",
  RestrictedURL: "restricted_url",
  NotControlled: "not_controlled",
  CDP: "cdp_error",
  DebuggerConflict: "debugger_conflict",
} as const;

// 内核→扩展请求帧
export interface Request {
  id: number;
  op: string;
  tabId?: number;
  method?: string;
  params?: Record<string, unknown>;
  /** 非空 = 路由到跨源 iframe(OOPIF)flat 子会话 */
  sessionId?: string;
}

// 跨源 iframe(OOPIF)子会话(frames.list 结果项)
export interface FrameInfo {
  sessionId: string;
  url?: string;
}

export interface RespError {
  code: string;
  message?: string;
}

// 应答帧(二选一)
export type Response = { id: number; result: unknown } | { id: number; error: RespError };

// 标签页元数据(tabs.list 结果项 / tab.updated / handoff 载荷)
export interface TabInfo {
  tabId: number;
  url?: string;
  title?: string;
  active?: boolean;
  controlled?: boolean;
  status?: string; // loading | complete
}

// hello 帧(扩展→内核首帧)
export interface HelloFrame {
  event: typeof Ev.Hello;
  auth: { token: string } | { code: string };
  ext: { id: string; version?: string };
  browser?: { name?: string; version?: string };
  proto: number;
}
