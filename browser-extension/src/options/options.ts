// options:端口设置 + 配对码配对 + 解除配对。
// 已配对与否以 storage.local 里是否存在 token 为准;连接状态读 storage.session。
import type { BridgeStatus } from "../bridge";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const dot = $("dot");
const statusText = $("status-text");
const errorEl = $("error");
const pairForm = $("pair-form");
const pairedPanel = $("paired-panel");
const portInput = $<HTMLInputElement>("port");
const codeInput = $<HTMLInputElement>("code");
const pairBtn = $<HTMLButtonElement>("pair-btn");
const unpairBtn = $<HTMLButtonElement>("unpair-btn");

async function render(): Promise<void> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(["token", "port"]),
    chrome.storage.session.get(["bridgeStatus", "connectedPort", "bridgeError"]),
  ]);
  const paired = !!local.token;
  const status: BridgeStatus = session.bridgeStatus ?? "unpaired";

  dot.className = "dot" + (status === "connected" ? " ok" : status === "connecting" ? " busy" : "");
  const labels: Record<BridgeStatus, string> = {
    unpaired: "未配对",
    connecting: "连接中…",
    connected: `已连接(端口 ${session.connectedPort ?? "?"})`,
    disconnected: "已断开(自动重试中)",
  };
  statusText.textContent = labels[status];
  errorEl.textContent = session.bridgeError ?? "";

  pairForm.hidden = paired;
  pairedPanel.hidden = !paired;
  // 端口输入框保留用户正在编辑的值,仅初次填充
  if (!portInput.dataset.touched && local.port) portInput.value = String(local.port);
}

pairBtn.onclick = () => {
  void (async () => {
    const code = codeInput.value.trim();
    if (!code) {
      errorEl.textContent = "请先输入配对码";
      return;
    }
    const port = portInput.value ? Number(portInput.value) : null;
    pairBtn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: "pair", code, port });
      if (!resp?.ok) errorEl.textContent = `配对请求失败: ${resp?.error ?? "未知错误"}`;
      else codeInput.value = ""; // 配对码单次有效,发出后即清空输入
    } finally {
      pairBtn.disabled = false;
    }
    await render();
  })();
};

unpairBtn.onclick = () => {
  void chrome.runtime.sendMessage({ type: "unpair" }).then(render);
};

portInput.addEventListener("input", () => {
  portInput.dataset.touched = "1";
});

// 状态与配对结果由 background 异步落库,监听两个命名空间实时刷新
chrome.storage.session.onChanged.addListener(() => void render());
chrome.storage.local.onChanged.addListener(() => void render());
void render();
