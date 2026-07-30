// chrome.debugger 薄封装:attach 幂等、detach 容错、sendCommand 透传,
// 错误统一映射为协议错误码(映射规则在 core.ts,可单测)。
// 已附加集合持久在 storage.session:debugger 附加关系跨 SW 休眠存活,
// 内存 Set 会在 SW 重启后丢失导致误判"未附加"。
//
// 跨源 iframe(OOPIF):attach 标签页后 setAutoAttach(flatten) 让子 frame 以
// flat 子会话形式挂进来;子会话经 sessionId 路由(Chrome 125+)。auto-attach
// 非递归,故每个新子会话再 setAutoAttach 一次以触达更深层。
import { mapDebuggerError } from "./core";
import type { FrameInfo, RespError } from "./protocol";

const ATTACHED_KEY = "attachedTabs";
const CDP_VERSION = "1.3";

// tabId → (sessionId → {url}):标签页的 OOPIF 子会话表。内存态,SW 重启后
// 由重新 attach → setAutoAttach 重建(见 background 冷启动)。
const oopifSessions = new Map<number, Map<string, { url: string }>>();

/** 对标签页/子会话启用 iframe auto-attach(flatten;幂等,重复调无害) */
async function setAutoAttach(tabId: number, sessionId?: string): Promise<void> {
  const target = sessionId ? { tabId, sessionId } : { tabId };
  try {
    await chrome.debugger.sendCommand(target, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }],
    });
  } catch {
    // 目标可能已消失;auto-attach 失败不阻塞主流程(OOPIF 采集尽力而为)
  }
}

/** Target.attachedToTarget:记子会话并对其递归 setAutoAttach(触达更深层 OOPIF) */
export async function onTargetAttached(
  tabId: number,
  sessionId: string,
  targetInfo: { type?: string; url?: string },
): Promise<void> {
  if (targetInfo.type !== "iframe") return;
  let sessions = oopifSessions.get(tabId);
  if (!sessions) {
    sessions = new Map();
    oopifSessions.set(tabId, sessions);
  }
  sessions.set(sessionId, { url: targetInfo.url ?? "" });
  await setAutoAttach(tabId, sessionId);
}

/** Target.detachedFromTarget:移除子会话 */
export function onTargetDetached(tabId: number, sessionId: string): void {
  oopifSessions.get(tabId)?.delete(sessionId);
}

/** frames.list:标签页当前的 OOPIF 子会话 */
export function framesList(tabId: number): FrameInfo[] {
  const sessions = oopifSessions.get(tabId);
  if (!sessions) return [];
  return [...sessions.entries()].map(([sessionId, info]) => ({ sessionId, url: info.url }));
}

/** 携带协议错误码的异常,router 捕获后转应答帧 */
export class OpError extends Error {
  code: string;
  constructor(err: RespError) {
    super(err.message ?? err.code);
    this.code = err.code;
  }
  toResp(): RespError {
    return { code: this.code, message: this.message };
  }
}

function toOpError(e: unknown): OpError {
  if (e instanceof OpError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new OpError(mapDebuggerError(msg));
}

export async function getAttached(): Promise<Set<number>> {
  const got = await chrome.storage.session.get(ATTACHED_KEY);
  return new Set<number>(got[ATTACHED_KEY] ?? []);
}

async function setAttached(set: Set<number>): Promise<void> {
  await chrome.storage.session.set({ [ATTACHED_KEY]: [...set] });
}

export async function markDetached(tabId: number): Promise<void> {
  const set = await getAttached();
  if (set.delete(tabId)) await setAttached(set);
}

/** attach 幂等:已附加视为成功;"already attached" 且是我们自己附加的也视为成功。
 * attach 后启用 iframe auto-attach(即使已 attach 也确保,SW 重启后重建子会话表)。 */
export async function attach(tabId: number): Promise<void> {
  const set = await getAttached();
  if (!set.has(tabId)) {
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // SW 重启后 session 记录还在但极端情况下可能失同步:自己重复 attach 会
      // 报 already attached,此时按幂等处理;真被 DevTools 等占用则由映射报冲突
      if (!/another debugger is already attached/i.test(msg) || !set.has(tabId)) {
        throw toOpError(e);
      }
    }
    set.add(tabId);
    await setAttached(set);
  }
  await setAutoAttach(tabId);
}

/** detach:"not attached" 类错误视为成功(目标可能已关闭或已被剥离) */
export async function detach(tabId: number): Promise<void> {
  try {
    await chrome.debugger.detach({ tabId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/not attached|no target|no tab with/i.test(msg)) throw toOpError(e);
  } finally {
    oopifSessions.delete(tabId);
    await markDetached(tabId);
  }
}

/** CDP 命令透传,结果原样返回;sessionId 非空时路由到 OOPIF 子会话 */
export async function sendCommand(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  const target = sessionId ? { tabId, sessionId } : { tabId };
  try {
    return (await chrome.debugger.sendCommand(target, method, params)) ?? {};
  } catch (e) {
    throw toOpError(e);
  }
}
