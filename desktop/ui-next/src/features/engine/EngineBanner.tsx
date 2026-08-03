// 引擎状态横幅:崩溃/启动失败时置顶 alert,重启与日志入口。
// starting 有 3 秒宽限——快启动不闪横幅;ready/stopped 不渲染。
// 产品语义(对表旧工程 engineBanner.ts):
// - attempt 0/1 不提"第 N 次"——首次启动/首次重试报次数只会吓人,
//   attempt≥2 才是"反复在失败"的信号;
// - crashed 必须说清自动重试的去向:retry_in_ms 有值报"N 秒后自动重试",
//   null 是熔断,要明说"已停止自动重试"把球交回用户;
// - log_tail 收进 collapse 详情,不挤横幅主行;
// - 重启失败复位按钮并外显错误,不能让按钮永远转圈。
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { engineRestart, engineStatus, onEngineStatus, type EngineStatus } from "@/lib/ipc/engine";
import { openLogDir } from "@/lib/ipc/host";

const STARTING_GRACE_MS = 3000;

export function EngineBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [graceOver, setGraceOver] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void engineStatus().then((s) => {
      if (alive && s) setStatus(s);
    });
    const off = onEngineStatus((s) => {
      setStatus(s);
      setRestarting(false);
      setRestartError(null); // 状态推进了,上一次重启失败的残留文案不再成立
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const phase = status?.phase;
  useEffect(() => {
    setGraceOver(false);
    if (phase !== "starting") return;
    const timer = window.setTimeout(() => setGraceOver(true), STARTING_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (!status || phase === "ready" || phase === "stopped") return null;

  if (status.phase === "starting") {
    if (!graceOver) return null;
    return (
      <div role="status" className="alert alert-warning alert-soft rounded-none py-1.5 text-xs">
        <span className="loading loading-spinner loading-xs" aria-hidden />
        <span>
          {status.attempt >= 2 ? t("engine.startingRetry", { attempt: status.attempt }) : t("engine.starting")}
        </span>
      </div>
    );
  }

  const crashed = status.phase === "crashed" ? status : null;
  const detail = crashed ? crashed.detail : status.phase === "failed" ? status.error : "";
  const retryText = crashed
    ? crashed.retry_in_ms === null
      ? t("engine.retryStopped")
      : t("engine.retryIn", { seconds: Math.round(crashed.retry_in_ms / 1000) })
    : null;
  const restart = () => {
    setRestarting(true);
    setRestartError(null);
    void engineRestart().catch((e) => {
      // 失败复位按钮并外显——留在忙态就是把失败演成"正在重启"
      setRestarting(false);
      setRestartError(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <div role="alert" className="alert alert-error alert-soft rounded-none py-1.5 text-xs">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate" title={detail}>
            {t(crashed ? "engine.crashed" : "engine.failed", { detail })}
          </span>
          {retryText && (
            <span className="shrink-0 opacity-80">
              {retryText}
              {crashed && crashed.attempt >= 2 && ` · ${t("engine.attempt", { attempt: crashed.attempt })}`}
            </span>
          )}
        </div>
        {crashed && crashed.log_tail.trim() !== "" && (
          <details className="collapse collapse-arrow text-xs opacity-75">
            <summary className="collapse-title select-none">{t("engine.logTail")}</summary>
            <div className="collapse-content">
              <pre className="max-h-24 overflow-auto font-mono whitespace-pre-wrap">{crashed.log_tail}</pre>
            </div>
          </details>
        )}
        {restartError && <span className="text-error">{t("engine.restartFailed", { reason: restartError })}</span>}
      </div>
      <button type="button" className="btn btn-error btn-xs" disabled={restarting} onClick={restart}>
        {restarting && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {t("engine.restart")}
      </button>
      {/* 打开目录失败就地转成重启错误位外显(横幅上没有第二个报错位),
          不吞——吞掉就是「点了没反应」 */}
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        onClick={() => void openLogDir().catch((e) => setRestartError(e instanceof Error ? e.message : String(e)))}
      >
        {t("engine.logs")}
      </button>
    </div>
  );
}
