// 受控集合与 tabs.* op 实现。受控集合持久在 storage.session:
// SW 重启不丢、浏览器重启自动清空(授权不跨浏览器会话)。
import { attach, detach, OpError } from "./cdp";
import { isAllowedCreateUrl, mapDebuggerError } from "./core";
import type { TabInfo } from "./protocol";

const CONTROLLED_KEY = "controlledTabs";
const AGENT_WINDOW_KEY = "agentWindowId";

/** agent 专属窗口:agent 新建的标签页集中在这里,不聚焦创建、不抢用户
 * 前台(CDP 键鼠/截图直达渲染进程,无需标签页在前台)。用户关掉后自动重建。 */
async function agentWindowId(): Promise<number | null> {
  const got = await chrome.storage.session.get(AGENT_WINDOW_KEY);
  const id = got[AGENT_WINDOW_KEY] as number | undefined;
  if (id === undefined) return null;
  try {
    await chrome.windows.get(id);
    return id;
  } catch {
    await chrome.storage.session.remove(AGENT_WINDOW_KEY);
    return null;
  }
}

export async function getControlled(): Promise<Set<number>> {
  const got = await chrome.storage.session.get(CONTROLLED_KEY);
  return new Set<number>(got[CONTROLLED_KEY] ?? []);
}

export async function addControlled(tabId: number): Promise<void> {
  const set = await getControlled();
  if (set.has(tabId)) return;
  set.add(tabId);
  await chrome.storage.session.set({ [CONTROLLED_KEY]: [...set] });
}

export async function removeControlled(tabId: number): Promise<void> {
  const set = await getControlled();
  if (!set.delete(tabId)) return;
  await chrome.storage.session.set({ [CONTROLLED_KEY]: [...set] });
}

export function toTabInfo(tab: chrome.tabs.Tab, controlled: ReadonlySet<number>): TabInfo {
  return {
    tabId: tab.id ?? -1,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    controlled: tab.id !== undefined && controlled.has(tab.id),
    status: tab.status,
  };
}

function toOpError(e: unknown): OpError {
  if (e instanceof OpError) return e;
  return new OpError(mapDebuggerError(e instanceof Error ? e.message : String(e)));
}

/** tabs.create:在 agent 专属窗口新建(不抢用户前台)→ 纳入受控 → attach,
 * 整链成功才返回 */
export async function tabsCreate(params?: Record<string, unknown>): Promise<{ tabId: number }> {
  const url = typeof params?.url === "string" ? params.url : "about:blank";
  if (!isAllowedCreateUrl(url)) {
    throw new OpError({ code: "restricted_url", message: `仅允许打开 http/https/about:blank: ${url}` });
  }
  let tabId: number | undefined;
  const winId = await agentWindowId();
  if (winId === null) {
    // 首个 agent 标签页:开专属窗口(不聚焦;最小化会暂停渲染影响截图,用 normal)
    const win = await chrome.windows.create({ url, focused: false, state: "normal" });
    tabId = win.tabs?.[0]?.id;
    if (win.id !== undefined) {
      await chrome.storage.session.set({ [AGENT_WINDOW_KEY]: win.id });
    }
  } else {
    // active 仅指专属窗口内的前台,不影响用户当前窗口的焦点
    const tab = await chrome.tabs.create({ url, windowId: winId, active: true });
    tabId = tab.id;
  }
  if (tabId === undefined) throw new OpError({ code: "no_tab", message: "标签页创建失败" });
  await addControlled(tabId);
  try {
    await attach(tabId);
  } catch (e) {
    // attach 失败的新标签页没有受控意义,回滚集合避免留下不可用成员
    await removeControlled(tabId);
    throw toOpError(e);
  }
  return { tabId };
}

/** tabs.list:全部标签页(含受控标注) */
export async function tabsList(): Promise<TabInfo[]> {
  const [tabs, controlled] = await Promise.all([chrome.tabs.query({}), getControlled()]);
  return tabs.map((t) => toTabInfo(t, controlled));
}

/** tabs.activate:激活标签页并前置其窗口(截图与真实输入需要前台) */
export async function tabsActivate(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (e) {
    throw toOpError(e);
  }
}

/** tabs.close:关闭标签页(受控准入由 router 把关) */
export async function tabsClose(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    throw toOpError(e);
  }
}

/** 收回控制:detach + 移出集合(popup「收回」与 tab 关闭清理共用) */
export async function releaseTab(tabId: number): Promise<void> {
  try {
    await detach(tabId);
  } catch {
    // 收回是尽力清理,detach 失败(如目标已消失)不阻塞移出集合
  }
  await removeControlled(tabId);
}
