// 背景 service worker 入口:装配 bridge + router + 浏览器事件监听。
// 所有监听器必须在顶层同步注册(MV3 SW 冷启动后事件才收得到)。
import { Bridge } from "./bridge";
import { getAttached, markDetached, attach, onTargetAttached, onTargetDetached } from "./cdp";
import { normalizePairingCode } from "./core";
import { Ev, type TabInfo } from "./protocol";
import { handleRequest } from "./router";
import { addControlled, getControlled, releaseTab, toTabInfo } from "./tabs";

const bridge = new Bridge();
bridge.onRequest = handleRequest;

// ---- debugger 事件 → 内核 ----

// CDP 事件全量转发,浏览器语义(快照/ref/坐标)都在 Go 侧,扩展不做解释。
// Target.attach/detachToTarget 是 OOPIF 子会话管理(传输层),扩展自处理不转发。
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === undefined) return;
  if (method === "Target.attachedToTarget") {
    const p = params as { sessionId: string; targetInfo: { type?: string; url?: string } };
    void onTargetAttached(source.tabId, p.sessionId, p.targetInfo);
    return;
  }
  if (method === "Target.detachedFromTarget") {
    const p = params as { sessionId: string };
    onTargetDetached(source.tabId, p.sessionId);
    return;
  }
  // 子会话(OOPIF)的 CDP 事件带 sessionId,内核按 tabId 路由到属主会话。
  // flat session 的 source 带 sessionId(Chrome 125+),类型定义尚未覆盖,故断言取。
  const sessionId = (source as { sessionId?: string }).sessionId;
  bridge.send({ event: Ev.CDP, tabId: source.tabId, sessionId, method, params: params ?? {} });
});

// 被剥离(用户点提示条取消/页面关闭/DevTools 接管):上报但保留受控成员资格,
// 内核可决定重试 attach,无需用户重新授权
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId === undefined) return;
  void markDetached(source.tabId);
  bridge.send({ event: Ev.Detached, tabId: source.tabId, reason });
});

// ---- tabs 事件 → 内核 ----

// tab.updated 节流:同一 tab 500ms 内只发最后一帧(loading 期间事件很密)
const UPDATE_THROTTLE_MS = 500;
const pendingUpdates = new Map<number, { timer: ReturnType<typeof setTimeout>; latest: TabInfo }>();

function reportTabUpdated(tabId: number, info: TabInfo): void {
  const pending = pendingUpdates.get(tabId);
  if (pending) {
    pending.latest = info; // 窗口期内只更新载荷,窗口关闭时发最新
    return;
  }
  bridge.send({ event: Ev.TabUpdated, tabId, info });
  pendingUpdates.set(tabId, {
    latest: info,
    timer: setTimeout(() => {
      const p = pendingUpdates.get(tabId);
      pendingUpdates.delete(tabId);
      if (p && p.latest !== info) {
        bridge.send({ event: Ev.TabUpdated, tabId, info: p.latest });
      }
    }, UPDATE_THROTTLE_MS),
  });
}

// opener 在受控集合 → 新标签页自动纳入并 attach(跟随弹窗/新窗口流程)
chrome.tabs.onCreated.addListener((tab) => {
  void (async () => {
    if (tab.id === undefined || tab.openerTabId === undefined) return;
    const controlled = await getControlled();
    if (!controlled.has(tab.openerTabId)) return;
    await addControlled(tab.id);
    try {
      await attach(tab.id);
    } catch {
      // 弹窗可能秒关或落在受限页,attach 失败不阻塞纳管上报
    }
    controlled.add(tab.id);
    reportTabUpdated(tab.id, toTabInfo(tab, controlled));
  })();
});

chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  void (async () => {
    const controlled = await getControlled();
    if (!controlled.has(tabId)) return;
    reportTabUpdated(tabId, toTabInfo(tab, controlled));
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const controlled = await getControlled();
    if (!controlled.has(tabId)) return;
    await releaseTab(tabId);
    bridge.send({ event: Ev.TabRemoved, tabId });
  })();
});

// ---- popup/options 指令 ----

interface UICommand {
  type: "handoff" | "release" | "pair" | "unpair" | "setPort" | "reconnect";
  tabId?: number;
  code?: string;
  port?: number | null;
}

chrome.runtime.onMessage.addListener((msg: UICommand, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (msg.type) {
        case "handoff": {
          // 用户主动交出标签页:纳管 + attach + 上报 handoff
          const tabId = msg.tabId!;
          await addControlled(tabId);
          await attach(tabId);
          const [tab, controlled] = await Promise.all([chrome.tabs.get(tabId), getControlled()]);
          bridge.send({ event: Ev.Handoff, tabId, info: toTabInfo(tab, controlled) });
          sendResponse({ ok: true });
          break;
        }
        case "release": {
          // 用户收回:detach + 移出集合 + 上报专属 reason
          const tabId = msg.tabId!;
          await releaseTab(tabId);
          bridge.send({ event: Ev.Detached, tabId, reason: "released_by_user" });
          sendResponse({ ok: true });
          break;
        }
        case "pair": {
          // 配对码放 session:配对成功即清除,SW 重启也不残留明文码到磁盘
          await chrome.storage.session.set({ pairingCode: normalizePairingCode(msg.code ?? "") });
          if (msg.port) await chrome.storage.local.set({ port: msg.port });
          else await chrome.storage.local.remove("port");
          await bridge.reconnectNow();
          sendResponse({ ok: true });
          break;
        }
        case "unpair":
          await bridge.unpair();
          sendResponse({ ok: true });
          break;
        case "setPort":
          if (msg.port) await chrome.storage.local.set({ port: msg.port });
          else await chrome.storage.local.remove("port");
          await bridge.reconnectNow();
          sendResponse({ ok: true });
          break;
        case "reconnect":
          await bridge.reconnectNow();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: "未知指令" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // 异步应答
});

// ---- 生命周期与保活 ----

// alarms 兜底:SW 被杀后 WS 断开且 setTimeout 退避随之丢失,靠 alarm 复活重连。
// 0.5 分钟是 alarms 的最小周期(Chrome 120+)。
const KEEPALIVE_ALARM = "bridge-keepalive";
chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void bridge.ensureConnected();
});

chrome.runtime.onStartup.addListener(() => void bridge.ensureConnected());
chrome.runtime.onInstalled.addListener(() => void bridge.ensureConnected());

// SW 每次冷启动(含被杀后复活)都尝试连接;若已有连接则幂等跳过。
// 顺带校对受控/附加集合与真实标签页的偏差(浏览器重启后 session 已清空,无需处理)。
void (async () => {
  const [controlled, attached] = await Promise.all([getControlled(), getAttached()]);
  const alive = new Set((await chrome.tabs.query({})).map((t) => t.id));
  for (const tabId of controlled) {
    if (!alive.has(tabId)) await releaseTab(tabId);
  }
  for (const tabId of attached) {
    if (!alive.has(tabId)) await markDetached(tabId);
  }
  await bridge.ensureConnected();
})();
