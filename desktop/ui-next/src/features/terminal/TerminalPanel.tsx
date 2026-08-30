// 终端多实例面板(2026-08-30 用户定案「终端也需要可以开多个」):侧边栏
// 「终端」tab 的内容体。实例的真身(xterm/PTY/标题/状态)全部住在
// termStore(模块级)——本组件只是它的视图:收起侧边栏/切会话时组件卸载,
// shell 与回滚缓冲原地活着,回来重新 attach。tab 名跟随前台进程/OSC 标题
// (termStore 头注),缺省「终端 {n}」(编号单调不重排)。
// 全关后留空态 + 新建入口,不自动复活——用户关掉最后一个是明确意图。
import { IconPlus, IconTerminal2, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useI18n } from "@/lib/i18n";
import {
  attachTerminal, closeTerminal, fitReport, openTerminal, sessionTerminals, setActiveTerminal,
  subscribeTerminals, terminalsVersion, type TermInstance,
} from "./termStore";

export function TerminalPanel({ sessionId, workdir }: { sessionId: string; workdir?: string }) {
  const { t } = useI18n();
  useSyncExternalStore(subscribeTerminals, terminalsVersion);
  const s = sessionTerminals(sessionId);

  // 首开播种:本会话从未开过终端才自动起一个;用户全关后(seeded 仍 true)
  // 不复活
  useEffect(() => {
    if (!sessionTerminals(sessionId).seeded) openTerminal(sessionId, workdir);
    // workdir 与 sessionId 同源,不单独驱动重开
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-base-300 px-2">
        {/* overflow-clip(SidePanel tab 条同款教训):单轴 hidden 会把另一轴
            算成 auto,变成滚动容器后点击获焦就上下跳 */}
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-clip">
          {s.instances.map((inst) => {
            const label = inst.title || t("term.tab", { n: String(inst.key) });
            return (
              <div
                key={inst.key}
                className={`flex shrink-0 items-center rounded-field ${s.active === inst.key ? "bg-base-200" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={s.active === inst.key}
                  title={label}
                  className="btn btn-ghost btn-xs gap-1.5 px-2"
                  onClick={() => setActiveTerminal(sessionId, inst.key)}
                >
                  <IconTerminal2 size={12} stroke={1.75} aria-hidden className="text-base-content/50" />
                  <span className="max-w-28 truncate">{label}</span>
                </button>
                <button
                  type="button"
                  aria-label={t("term.closeTab", { n: String(inst.key) })}
                  title={t("term.closeTab", { n: String(inst.key) })}
                  className="btn btn-ghost btn-square btn-xs -ms-1 text-base-content/50"
                  onClick={() => closeTerminal(sessionId, inst.key)}
                >
                  <IconX size={11} stroke={1.75} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {/* 空态时头部「+」让位给空态 CTA(同名双钮对可访问性树是歧义) */}
        {s.instances.length > 0 && (
          <button
            type="button"
            aria-label={t("term.new")}
            title={t("term.new")}
            className="btn btn-ghost btn-square btn-xs shrink-0 text-base-content/60"
            onClick={() => openTerminal(sessionId, workdir)}
          >
            <IconPlus size={13} stroke={1.75} aria-hidden />
          </button>
        )}
      </div>
      {s.instances.map((inst) => (
        <TermHost key={inst.key} inst={inst} visible={s.active === inst.key} />
      ))}
      {s.instances.length === 0 && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
          <p className="text-sm text-base-content/50">{t("term.empty")}</p>
          <button type="button" className="btn btn-sm" onClick={() => openTerminal(sessionId, workdir)}>
            <IconPlus size={14} stroke={1.75} aria-hidden />
            {t("term.new")}
          </button>
        </div>
      )}
    </div>
  );
}

/** 实例视图:把库里的常驻宿主 div 接进面板;卸载只摘 DOM 不动实例。 */
function TermHost({ inst, visible }: { inst: TermInstance; visible: boolean }) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    attachTerminal(inst, host);
    // 面板尺寸变化自适应并上报(jsdom 无 ResizeObserver,守卫降级)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => fitReport(inst));
      ro.observe(host);
    }
    return () => {
      ro?.disconnect();
      inst.container.remove();
    };
  }, [inst]);
  // 变为可见即聚焦:点 tab 切过来就能直接敲
  useEffect(() => {
    if (visible && !inst.exited && !inst.disposed) inst.term.focus();
  }, [visible, inst]);
  return (
    <div className={visible ? "relative min-h-0 flex-1" : "hidden"} style={{ background: "var(--termBg)" }}>
      <div ref={hostRef} className="absolute inset-x-0 inset-y-1.5 ps-2" data-testid="term-host" />
      {inst.status && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs"
          style={{ color: "var(--termTx2)" }}
        >
          {t(inst.status, { reason: inst.failReason })}
        </div>
      )}
    </div>
  );
}
