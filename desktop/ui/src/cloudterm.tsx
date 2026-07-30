// 云端 VM 终端:xterm.js + 壳 WS 管道(协议对齐 web 端 common/terminal.tsx:
// 文本 JSON 帧 {type,data};上行 data=base64(输入)/resize=JSON{row,col}/5s ping;
// 下行 connected/data(base64)/resize/error/ping)。terminal_id 复用优先
// (对齐 web 终端面板):挂载先拉 VM 的终端列表重连第一个——每次新生成
// 会把孤儿会话在 VM 里越堆越多,shell 上下文也随开关全丢;列表为空或
// 拉取失败才新建。多 tab/显式销毁仍留给网页控制台。
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { connectCloudTerminal, mcTerminalList } from "./cloudapi";
import { MONO } from "./components";

/** xterm 的 theme 是 JS 对象,吃不了 var(),只能把令牌解析成具体色值;
 * 缺省值兜住令牌读不到的极端情况(样式表还没落地时不至于白底黑字闪一下)。 */
function readTermTheme(): { background: string; foreground: string } {
  const css = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { background: pick("--termBg", "#1c1d20"), foreground: pick("--termTx", "#d6d7d2") };
}

export function CloudTerminal({ vmId }: { vmId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("连接终端…");

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: MONO,
      cursorBlink: true,
      theme: readTermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    // 主题切换只改根节点的 data-theme(见 theme.ts),xterm 已经把颜色烤进了
    // 自己的渲染层,得盯着这个属性重新喂一次,不然开着终端换主题会留一块旧底色。
    const themeWatch = new MutationObserver(() => {
      term.options.theme = readTermTheme();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const b64 = {
      enc: (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))),
      dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
    };

    let pipe: { send(t: string): Promise<void>; close(): void } | null = null;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | null = null;

    const sendJSON = (v: unknown) => void pipe?.send(JSON.stringify(v)).catch(() => {});
    const sendResize = () => sendJSON({ type: "resize", data: JSON.stringify({ row: term.rows, col: term.cols }) });

    // 诊断覆盖层:首个 data 帧写入前显示连接/收帧进度——黑屏时凭这行字
    // 就能区分"帧没到 webview"(计数不动)与"xterm 没渲染"(计数在涨)
    let frames = 0;
    let gotData = false;

    // 复用优先:先查 VM 已有终端会话,重连第一个(shell 上下文得以保留,
    // 也能接上网页控制台开的);没有/查不到再新建
    const pickTerminalId = async (): Promise<string> => {
      try {
        const r = await mcTerminalList(vmId);
        const existing = (r.terminals ?? []).find((t) => t.id)?.id;
        if (existing) return existing;
      } catch {
        /* 列表拉不到不挡路:退回新建 */
      }
      return crypto.randomUUID();
    };

    pickTerminalId().then((terminalId) => {
      if (closed) return; // 查列表期间面板已关:别再建连接
      connectCloudTerminal(vmId, terminalId, {
      onText(text) {
        let m: { type?: string; data?: string };
        try {
          m = JSON.parse(text);
        } catch {
          return;
        }
        frames += 1;
        if (frames <= 5) console.debug(`[cloudterm] 帧#${frames}:`, text.slice(0, 120));
        switch (m.type) {
          case "data":
            if (m.data) {
              term.write(b64.dec(m.data));
              if (!gotData) {
                gotData = true;
                setStatus("");
              }
            }
            break;
          case "connected":
            if (!gotData) setStatus(`终端已连接,等待输出…(${frames} 帧)`);
            break;
          case "error":
            setStatus(m.data || "终端出错");
            break;
          default: // ping/resize 等
            if (!gotData) setStatus(`终端已连接,等待输出…(${frames} 帧)`);
        }
      },
      onClose() {
        if (!closed) setStatus("终端连接已断开");
      },
    })
      .then((p) => {
        if (closed) {
          p.close();
          return;
        }
        pipe = p;
        if (!gotData) setStatus("终端已连接,等待输出…(0 帧)");
        // 对齐 web 端:连接后等 DOM 落定再 fit + 上报尺寸,过早 fit 的
        // 行列数可能失真;顺带聚焦,光标可见
        requestAnimationFrame(() => {
          fit.fit();
          sendResize();
          term.focus();
        });
        ping = setInterval(() => sendJSON({ type: "ping" }), 5000);
      })
      .catch((e) => {
        if (!closed) setStatus("终端连接失败: " + String(e));
      });
    });

    const offData = term.onData((input) => {
      sendJSON({ type: "data", data: b64.enc(input) });
    });

    // 面板尺寸变化自适应并上报
    const ro = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    ro.observe(el);

    return () => {
      closed = true;
      if (ping) clearInterval(ping);
      themeWatch.disconnect();
      ro.disconnect();
      offData.dispose();
      pipe?.close();
      term.dispose();
    };
  }, [vmId]);

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 0, background: "var(--termBg)" }}>
      <div ref={hostRef} style={{ position: "absolute", inset: "6px 0 6px 10px" }} />
      {status && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "var(--termTx2)", pointerEvents: "none" }}>
          {status}
        </div>
      )}
    </div>
  );
}
