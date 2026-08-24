// 关于:宿主/内核版本对照 + 检查更新(复用 lib/ipc/update)。更新安装成功后
// 壳自行重启,installing 态不回收;安装失败复位忙态并外显失败文案(与侧栏
// useUpdate 同一语义)。
//
// 排障入口(打开程序目录 / 打开存储目录 / 导出日志)常态不展示,连点版本号
// 5 次解锁,解锁只在本次挂载内有效(用户定案 2026-08-07):它们是电话指引
// 支持同学用的,不是给普通用户的常驻按钮。「打开扩展目录」按同一定案撤下
// ——它的常驻入口在设置·浏览器分区。
//
// 「导出日志」当时连同扩展目录一起撤了,理由是"日志就在存储目录里"。但那
// 两件事并不等价:export_engine_log 走的是**另存对话框**,一步就能拿到一份
// 可直接拖进工单的副本(旧 UI 的 title 原话「另存一份引擎日志,报障时附上」);
// 而"打开存储目录"要用户自己进 ohmyagent/logs/ 认出是哪个文件再复制出来——
// 电话指引里这是最容易卡住的一步。撤掉后 exportEngineLog 在整个 ui-next 里
// 零调用者,壳命令空挂着。故按同一把解锁钥匙恢复(常态仍不占位)。
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { exportEngineLog } from "@/lib/ipc/config";
import { hostInfo, openAppDir, openLogDir, type HostInfo } from "@/lib/ipc/host";
import { checkUpdateNow, clearUpdateError, installUpdateNow, useUpdateState } from "@/features/update/useUpdate";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 解锁隐藏排障入口所需的版本号连点次数(电话里说得清的量级)。 */
const UNLOCK_TAPS = 5;

export function AboutSection() {
  const { t } = useI18n();
  const [info, setInfo] = useState<HostInfo | null>(null);
  // 更新态取**共享 store**(features/update/useUpdate):与侧栏底部条同源。
  // 各持一份 useState 的话,侧栏已在提示「有新版本」时进关于页仍显示普通
  // 「检查更新」钮;反过来在这儿查到的结果也传不到侧栏,而这次检查还把
  // 接下来 30 分钟的回焦复查一起闸掉了(两条路共用 update.ts 的模块级闸门)
  const { update, installing, error: installError } = useUpdateState();
  const [phase, setPhase] = useState<"idle" | "checking">("idle");
  const [msg, setMsg] = useState<{ text: string; error?: boolean; updateAvailable?: boolean } | null>(null);
  // 连点解锁计数:不落盘、不跨挂载(离开设置页即复位)——隐藏入口就该
  // 每次都要重新解一遍,免得某次排障之后按钮永久留在别人的关于页上
  const [taps, setTaps] = useState(0);
  const unlocked = taps >= UNLOCK_TAPS;

  useEffect(() => {
    let alive = true;
    void hostInfo().then((v) => {
      if (alive) setInfo(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const check = async () => {
    setPhase("checking");
    setMsg(null);
    // 手动检查不过闸门(用户明确要查就得查)但记一笔账;结果并入共享 store
    const s = await checkUpdateNow(); // 失败/浏览器模式均为 null(update.ts 收口)
    setPhase("idle");
    if (!s) {
      setMsg({ text: t("settings.about.checkFailed"), error: true });
      return;
    }
    setMsg(
      s.available
        ? {
            text: t("settings.about.available", { latest: s.latest ?? "", current: s.current }),
            updateAvailable: true,
          }
        : { text: t("settings.about.upToDate", { current: s.current }) },
    );
  };

  const install = () => {
    setMsg(null);
    installUpdateNow();
  };

  /** 排障动作的统一收尾:失败就地外显(壳的 Err 是中文,吞掉就成了「点了
   *  没反应」);ok 可按结果补一句成功反馈,返回 null 表示这次不必说话
   *  (如另存对话框被用户取消)。 */
  const runDiag = async <T,>(fn: () => Promise<T>, ok?: (v: T) => string | null) => {
    setMsg(null);
    clearUpdateError();
    try {
      // 动作先单独求值:写成 ok?.(await fn()) 的话,ok 缺席时可选调用会连
      // **实参**一起短路掉——按钮点了什么都不会发生
      const done = await fn();
      const text = ok?.(done);
      if (text) setMsg({ text });
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    }
  };

  const busy = phase !== "idle" || installing;
  const found = !!update?.available;
  const shownMsg: typeof msg = installError ? { text: t("update.failed", { reason: installError }), error: true } : msg;
  const updateLabel =
    phase === "checking"
      ? t("settings.about.checking")
      : installing
        ? t("settings.about.installing")
        : found
          ? t("settings.about.install")
          : t("settings.about.check");

  return (
    <section aria-label={t("settings.nav.about")} className="flex flex-col gap-3">
      {/* 应用卡:logo+版本在左,更新动作在右——版本信息与它的动作同一行归组 */}
      <div className="flex items-center gap-4 rounded-box border border-base-300 p-4">
        <img src="/logo.png" alt="" aria-hidden className="h-12 w-12 rounded-2xl shadow-sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-bold">{t("app.name")}</span>
          {/* 版本行即解锁热区:连点 5 次现出排障入口。按钮形态但不带任何
              视觉暗示(纯文本、无 hover 态),不解锁的人看不出这里能点 */}
          <button
            type="button"
            className="cursor-default truncate text-start font-mono text-xs text-base-content/60"
            onClick={() => setTaps((n) => n + 1)}
          >
            {t("settings.about.version", {
              version: info?.version ?? "—",
              engine: info?.engine_version ?? t("settings.about.engineNotReady"),
            })}
          </button>
        </div>
        <button
          type="button"
          className={found ? "btn btn-primary btn-sm shrink-0" : "btn btn-sm shrink-0"}
          disabled={busy}
          onClick={() => void (found ? install() : check())}
        >
          {busy && <span className="loading loading-spinner loading-xs" aria-hidden />}
          {updateLabel}
        </button>
      </div>
      {shownMsg && (
        <div
          role={shownMsg.error ? "alert" : "status"}
          className={
            shownMsg.error
              ? "alert alert-error alert-soft py-1.5 text-xs"
              : shownMsg.updateAvailable
                ? "alert alert-info alert-soft py-1.5 text-xs"
                : "alert alert-success alert-soft py-1.5 text-xs"
          }
        >
          <span>
            {shownMsg.text}
            {shownMsg.updateAvailable && <> {t("settings.about.installHint")}</>}
          </span>
        </div>
      )}
      {unlocked && (
        <div className="flex flex-wrap items-center gap-2">
          {/* 连点版本号解锁的排障入口。失败就地外显:壳的 Err 是中文,
              吞掉就成了「点了没反应」 */}
          <button type="button" className="btn btn-sm" onClick={() => void runDiag(openAppDir)}>
            {t("settings.about.openAppDir")}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void runDiag(openLogDir)}>
            {t("settings.about.openDataDir")}
          </button>
          {/* 另存一份引擎日志当报障附件:取消(返回 null)不出提示 */}
          <button
            type="button"
            className="btn btn-sm"
            title={t("settings.about.exportLogHint")}
            onClick={() => void runDiag(exportEngineLog, (dest) => (dest ? t("settings.about.exportDone") : null))}
          >
            {t("settings.about.exportLog")}
          </button>
        </div>
      )}
    </section>
  );
}
