// 云端 VM 终端:xterm.js + 壳 WS 管道(协议在 lib/cloud/terminal:文本 JSON
// 帧 {type,data};上行 data=base64(输入)/resize=JSON{row,col}/5s ping;
// 下行 connected/data(base64→xterm)/resize/error/ping)。terminal_id 复用
// 优先(pickTerminalId):每次新生成会把孤儿会话在 VM 里越堆越多。
// 主题:终端岛恒深色面——颜色与字体令牌都在 styles/term.css，挂载时经
// getComputedStyle 解析喂给 xterm(它吃不了 var())。
import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  connectCloudTerminal,
  parseTermFrame,
  pickTerminalId,
  TERM_PING_MS,
  termBytes,
  termUplink,
} from "@/lib/cloud/terminal";
import type { CloudPipe } from "@/lib/cloud/pipes";
import { useI18n } from "@/lib/i18n";

/** CSS 令牌 → xterm options。令牌缺席时省略该项，让 xterm 使用库默认。 */
function readTermOptions() {
  const css = getComputedStyle(document.documentElement);
  const background = css.getPropertyValue("--termBg").trim();
  const foreground = css.getPropertyValue("--termTx").trim();
  const fontFamily = css.getPropertyValue("--font-mono").trim();
  const theme = {
    ...(background ? { background } : {}),
    ...(foreground ? { foreground } : {}),
  };
  return {
    ...(fontFamily ? { fontFamily } : {}),
    ...(background || foreground ? { theme } : {}),
  };
}

export function CloudTerminal({ vmId }: { vmId: string }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState(() => t("cloud.term.connecting"));

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const motionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const term = new Terminal({
      fontSize: 12.5,
      cursorBlink: !motionQuery?.matches,
      ...readTermOptions(),
    });
    const syncCursorBlink = (event: MediaQueryListEvent) => {
      term.options.cursorBlink = !event.matches;
    };
    motionQuery?.addEventListener("change", syncCursorBlink);
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      // 容器尺寸未定时 fit 可能抛(挂载首帧);ResizeObserver 会补
    }

    let pipe: CloudPipe | null = null;
    let closed = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    let gotData = false;

    const sendRaw = (text: string) => void pipe?.send(text).catch(() => {});
    const sendResize = () => sendRaw(termUplink.resize(term.rows, term.cols));

    void pickTerminalId(vmId).then((terminalId) => {
      if (closed) return; // 查列表期间面板已关:别再建连接
      connectCloudTerminal(vmId, terminalId, {
        onText(text) {
          const m = parseTermFrame(text);
          if (!m) return;
          switch (m.type) {
            case "data":
              if (m.data) {
                term.write(termBytes(m.data));
                if (!gotData) {
                  gotData = true;
                  setStatus("");
                }
              }
              break;
            case "error":
              setStatus(m.data || t("cloud.term.error"));
              break;
            default: // connected/ping/resize 等
              if (!gotData) setStatus(t("cloud.term.waiting"));
          }
        },
        onClose() {
          if (!closed) setStatus(t("cloud.term.closed"));
        },
      })
        .then((p) => {
          if (closed) {
            p.close();
            return;
          }
          pipe = p;
          if (!gotData) setStatus(t("cloud.term.waiting"));
          // 对齐 web 端:连接后等 DOM 落定再 fit + 上报尺寸,过早 fit 的
          // 行列数可能失真;顺带聚焦,光标可见
          requestAnimationFrame(() => {
            try {
              fit.fit();
            } catch {
              /* 面板刚被关掉时 fit 会抛,忽略 */
            }
            sendResize();
            term.focus();
          });
          ping = setInterval(() => sendRaw(termUplink.ping()), TERM_PING_MS);
        })
        .catch((e: unknown) => {
          if (!closed) setStatus(t("cloud.term.failed", { reason: e instanceof Error ? e.message : String(e) }));
        });
    });

    const offData = term.onData((input) => {
      sendRaw(termUplink.data(input));
    });

    // 面板尺寸变化自适应并上报(jsdom 无 ResizeObserver,守卫降级)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* 面板收起瞬间 fit 会抛,忽略 */
        }
        sendResize();
      });
      ro.observe(el);
    }

    return () => {
      closed = true;
      if (ping) clearInterval(ping);
      ro?.disconnect();
      motionQuery?.removeEventListener("change", syncCursorBlink);
      offData.dispose();
      pipe?.close();
      term.dispose();
    };
    // t 刻意不进依赖:locale 切换不值得拆建终端连接(状态文案下次事件刷新)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vmId]);

  return (
    <div className="relative h-full min-h-0" style={{ background: "var(--termBg)" }}>
      <div ref={hostRef} className="absolute inset-x-0 inset-y-1.5 ps-2" data-testid="term-host" />
      {status && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs"
          style={{ color: "var(--termTx2)" }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
