// 桥接的纯逻辑:不 import 任何 chrome API,供 vitest 直接单测。
// bridge/cdp/router 只做 IO 装配,判断规则全部收口在这里。
import { Ev, Op, PROTO_VERSION, type HelloFrame, type RespError } from "./protocol";

// ---- 端口 ----

/** 端口扫描起止(与内核默认监听区间对齐) */
export const PORT_SCAN_START = 7440;
export const PORT_SCAN_END = 7449;

/** 候选端口:用户自定义端口优先且独占,否则扫描默认区间 */
export function portCandidates(custom?: number | null): number[] {
  if (custom && Number.isInteger(custom) && custom > 0 && custom <= 65535) return [custom];
  const ports: number[] = [];
  for (let p = PORT_SCAN_START; p <= PORT_SCAN_END; p++) ports.push(p);
  return ports;
}

// ---- 重连退避 ----

/** 指数退避:1s 起,每次翻倍,30s 封顶(attempt 从 0 计) */
export function backoffDelayMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  // 2^n 会溢出,先用封顶判断短路
  if (n >= 5) return 30_000;
  return Math.min(1000 * 2 ** n, 30_000);
}

// ---- hello 帧 ----

/** 配对码归一化:去连字符与空白、大写(用户从 mc-desktop 抄码时容错) */
export function normalizePairingCode(raw: string): string {
  return raw.replace(/[-\s]/g, "").toUpperCase();
}

export interface HelloOptions {
  token?: string | null;
  code?: string | null;
  extId: string;
  extVersion?: string;
  browser?: { name?: string; version?: string };
}

/** 构造 hello 首帧:token 优先(已配对),否则用归一化后的配对码 */
export function buildHello(opts: HelloOptions): HelloFrame {
  const auth = opts.token
    ? { token: opts.token }
    : { code: normalizePairingCode(opts.code ?? "") };
  return {
    event: Ev.Hello,
    auth,
    ext: { id: opts.extId, ...(opts.extVersion ? { version: opts.extVersion } : {}) },
    ...(opts.browser ? { browser: opts.browser } : {}),
    proto: PROTO_VERSION,
  };
}

// ---- 错误码映射 ----

/** chrome.runtime.lastError.message → 协议错误码(protocol.go 的 ErrCode*) */
export function mapDebuggerError(message: string | undefined): RespError {
  const msg = message ?? "";
  if (/no tab with/i.test(msg)) return { code: "no_tab", message: msg };
  if (/another debugger is already attached/i.test(msg)) return { code: "debugger_conflict", message: msg };
  if (/cannot access|cannot attach|chrome:\/\//i.test(msg)) return { code: "restricted_url", message: msg };
  if (/detached while/i.test(msg)) return { code: "detached", message: msg };
  return { code: "cdp_error", message: msg };
}

// ---- op 准入 ----

/** 需要标签页已在受控集合内才允许的 op */
const CONTROLLED_ONLY_OPS: ReadonlySet<string> = new Set([Op.CDP, Op.Attach, Op.TabsClose, Op.FramesList]);

/**
 * op 准入判断:对受控敏感的 op(cdp/attach/tabs.close),tab 不在受控集合
 * 即拒绝 not_controlled。其余 op 放行,由各自实现自行报错。
 */
export function checkOpAllowed(op: string, tabId: number | undefined, controlled: ReadonlySet<number>): RespError | null {
  if (!CONTROLLED_ONLY_OPS.has(op)) return null;
  if (tabId !== undefined && controlled.has(tabId)) return null;
  return { code: "not_controlled", message: `标签页 ${tabId ?? "?"} 未交给 agent 控制` };
}

// ---- URL 白名单 ----

/** tabs.create 仅允许 http/https/about:blank(避免扩展替内核打开特权页) */
export function isAllowedCreateUrl(url: string): boolean {
  if (url === "about:blank") return true;
  return /^https?:\/\//i.test(url);
}

/** popup「交给 agent」入口的可控性判断(与 tabs.create 同一套白名单) */
export function isControllableUrl(url: string | undefined): boolean {
  return !!url && isAllowedCreateUrl(url);
}

// ---- 浏览器识别 ----

/** userAgent → 浏览器名与版本(hello 自述与 popup 展示用;Edge 的 UA 也带 Chrome 段,先判 Edg) */
export function parseBrowserInfo(ua: string): { name: string; version?: string } {
  const edge = ua.match(/Edg\/([\d.]+)/);
  if (edge) return { name: "Edge", version: edge[1] };
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  if (chrome) return { name: "Chrome", version: chrome[1] };
  return { name: "Chromium" };
}
