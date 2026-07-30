// popup:连接状态 + 「交给 agent」入口 + 受控标签页列表(带收回)。
// 状态只读自 storage.session(background 是唯一写入方),指令走 runtime 消息。
import { isControllableUrl, parseBrowserInfo } from "../core";
import type { BridgeStatus } from "../bridge";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dot = $("dot");
const statusText = $("status-text");
const statusExtra = $("status-extra");
const currentSection = $("current-section");
const currentTitle = $("current-title");
const handoffBtn = $<HTMLButtonElement>("handoff-btn");
const controlledSection = $("controlled-section");
const controlledList = $("controlled-list");
const unpairedSection = $("unpaired-section");

async function sendCommand(cmd: Record<string, unknown>): Promise<void> {
  const resp = await chrome.runtime.sendMessage(cmd);
  if (!resp?.ok) {
    statusExtra.textContent = `操作失败: ${resp?.error ?? "未知错误"}`;
  }
}

async function render(): Promise<void> {
  const session = await chrome.storage.session.get(["bridgeStatus", "connectedPort", "bridgeError", "controlledTabs"]);
  const status: BridgeStatus = session.bridgeStatus ?? "unpaired";
  const controlled = new Set<number>(session.controlledTabs ?? []);

  // 连接状态区
  dot.className = "dot" + (status === "connected" ? " ok" : status === "connecting" ? " busy" : "");
  const browser = parseBrowserInfo(navigator.userAgent);
  const labels: Record<BridgeStatus, string> = {
    unpaired: "未配对",
    connecting: "连接中…",
    connected: `已连接 · ${browser.name}`,
    disconnected: "已断开(自动重试中)",
  };
  statusText.textContent = labels[status];
  statusExtra.textContent =
    status === "connected" ? `本地 agent 端口 ${session.connectedPort ?? "?"}` : (session.bridgeError ?? "");
  unpairedSection.hidden = status !== "unpaired";

  // 当前标签页区:未受控且是 http(s) 页面且已连接时给出交接按钮
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    currentSection.hidden = false;
    currentTitle.textContent = tab.title || tab.url || "(无标题)";
    const canHandoff = status === "connected" && !controlled.has(tab.id) && isControllableUrl(tab.url);
    handoffBtn.hidden = !canHandoff;
    handoffBtn.onclick = () => void sendCommand({ type: "handoff", tabId: tab.id }).then(render);
  } else {
    currentSection.hidden = true;
  }

  // 受控列表区
  controlledSection.hidden = controlled.size === 0;
  controlledList.replaceChildren();
  for (const tabId of controlled) {
    const item = document.createElement("div");
    item.className = "tab-item";
    const title = document.createElement("span");
    title.className = "tab-title";
    try {
      const t = await chrome.tabs.get(tabId);
      title.textContent = t.title || t.url || `标签页 ${tabId}`;
    } catch {
      title.textContent = `标签页 ${tabId}(已关闭)`;
    }
    const release = document.createElement("button");
    release.className = "small";
    release.textContent = "收回";
    release.onclick = () => void sendCommand({ type: "release", tabId }).then(render);
    item.append(title, release);
    controlledList.append(item);
  }
}

$("open-options").onclick = () => void chrome.runtime.openOptionsPage();

// background 更新运行态时实时刷新
chrome.storage.session.onChanged.addListener(() => void render());
void render();
