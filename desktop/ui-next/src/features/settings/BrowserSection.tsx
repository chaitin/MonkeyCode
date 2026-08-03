// 浏览器扩展桥:状态行(未启用/未配对/等待扩展/已连接)+ 一次性配对码 +
// 3 步接入引导。分区不进保存条——配对是壳侧即时动作,与 models/mcp 的
// "改表单→保存→重启引擎"不是一回事。
//
// 轮询而非事件:壳没有为配对/连接变化广播事件,状态由内核 HTTP 端点回答;
// 只在本分区挂载期间 5s 拉一次(旧 UI BrowserExtCard 同款节奏),切走即停。
import { useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { browserExtRepair, browserExtStatus, openExtensionDir, type BrowserExtStatus } from "@/lib/ipc/config";
import { inDesktopShell } from "@/lib/ipc/ipc";
import { copyText } from "@/lib/util/clipboard";

const POLL_MS = 5000;
const COPIED_MS = 1500;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 状态行:一个语义色点 + 一句话。四态互斥,顺序即优先级。 */
function statusLine(st: BrowserExtStatus | null, fetchErr: string, t: ReturnType<typeof useI18n>["t"]) {
  if (fetchErr) return { tone: "status-error", text: t("settings.browser.statusError", { reason: fetchErr }) };
  if (!st) return { tone: "status-neutral", text: t("settings.browser.statusLoading") };
  if (!st.enabled) {
    return {
      tone: "status-error",
      text: st.error ? t("settings.browser.disabledWith", { reason: st.error }) : t("settings.browser.disabled"),
    };
  }
  if (st.connected) {
    const browser = [st.browser_name || t("settings.browser.browserFallback"), st.browser_version].filter(Boolean).join(" ");
    return { tone: "status-success", text: t("settings.browser.connected", { browser }) };
  }
  if (st.paired) return { tone: "status-warning", text: t("settings.browser.waitingExt") };
  return { tone: "status-warning", text: t("settings.browser.unpaired") };
}

export function BrowserSection() {
  const { t } = useI18n();
  const [st, setSt] = useState<BrowserExtStatus | null>(null);
  const [fetchErr, setFetchErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extDirMsg, setExtDirMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const copiedTimer = useRef(0);

  // 挂载即拉 + 5s 轮询;卸载停表。alive 守卫:在途应答不写已卸载的组件
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const next = await browserExtStatus();
        if (!alive) return;
        setSt(next);
        setFetchErr("");
      } catch (e) {
        if (alive) setFetchErr(errMsg(e));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const repair = async () => {
    setBusy(true);
    try {
      setSt(await browserExtRepair());
      setFetchErr("");
    } catch (e) {
      setFetchErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const code = st?.pairing_code ?? "";
  // 4-4 分组:8 位裸串照抄容易串行,分组后一眼一段
  const codeShown = code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
  const copyCode = () => {
    copyText(code);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const openExt = () => {
    setExtDirMsg(null);
    void openExtensionDir()
      .then((p) => setExtDirMsg(p ? { text: t("settings.browser.extDirOpened", { path: p }) } : null))
      .catch((e: unknown) => setExtDirMsg({ text: errMsg(e), error: true }));
  };

  const line = statusLine(st, fetchErr, t);
  const desktop = inDesktopShell();

  return (
    <section aria-label={t("settings.nav.browser")} className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-box border border-base-300 p-4">
        <div role="status" className="flex items-center gap-2 text-xs">
          <span aria-hidden className={`status ${line.tone} status-sm shrink-0`} />
          <span className="min-w-0 flex-1 font-medium">{line.text}</span>
          {st?.enabled && st.paired && (
            <button type="button" className="btn btn-xs shrink-0" disabled={busy} onClick={() => void repair()}>
              {busy && <span className="loading loading-spinner loading-xs" aria-hidden />}
              {t("settings.browser.repair")}
            </button>
          )}
        </div>
        {st?.enabled && !st.paired && code && (
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs text-base-content/60">{t("settings.browser.pairingCode")}</span>
            <span className="font-mono text-lg font-bold tracking-widest select-text">{codeShown}</span>
            <button type="button" className="btn btn-xs" onClick={copyCode}>
              {copied ? t("settings.browser.copied") : t("settings.browser.copy")}
            </button>
          </div>
        )}
        {st?.enabled && st.addr && (
          <span className="font-mono text-xs text-base-content/45 select-text">
            {t("settings.browser.addr", { addr: st.addr })}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 text-xs leading-relaxed text-base-content/70">
        <p className="font-semibold text-base-content">{t("settings.browser.guideTitle")}</p>
        <p>{t("settings.browser.guideIntro")}</p>
        <ol className="ms-5 flex list-decimal flex-col gap-1.5">
          <li>
            <strong className="font-semibold text-base-content">{t("settings.browser.step1")}</strong>{" "}
            {desktop ? (
              <>
                <button type="button" className="btn btn-xs mx-1 align-middle" onClick={openExt}>
                  {t("settings.about.openExtension")}
                </button>
                {t("settings.browser.step1Desktop")}
              </>
            ) : (
              t("settings.browser.step1Web")
            )}
          </li>
          <li>
            <strong className="font-semibold text-base-content">{t("settings.browser.step2")}</strong>{" "}
            {t("settings.browser.step2Detail")}
          </li>
          <li>
            <strong className="font-semibold text-base-content">{t("settings.browser.step3")}</strong>{" "}
            {t("settings.browser.step3Detail")}
          </li>
        </ol>
        {extDirMsg && (
          <p role={extDirMsg.error ? "alert" : "status"} className={extDirMsg.error ? "text-error" : "font-mono text-base-content/50"}>
            {extDirMsg.text}
          </p>
        )}
        <p className="text-base-content/50">{t("settings.browser.stopHint")}</p>
      </div>
    </section>
  );
}
