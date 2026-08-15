// 云端任务 composer:与本地 Composer 同一形态语言(composerKit 一套件)——
// 错误条 + 输入卡(卡内顶端运行条 / 附件 chips / 无边框 textarea / 底部集群)。
// 底部集群:左 = 附件入口(隐藏 file input,WebView 原生对话框),右 =
// 模型切换(OptionMenu 分组,经控制流 switch_model)+ 上下文用量环
// (h.chat.usage,云端 usage_update 帧与本地同构)+ 发送。
// 发送/上传/切换/错误通道全在 useCloudTask 的 handle 上,本组件纯视图。
import { IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

import { ComposerCard, ComposerTextarea, ErrorBar, RunBar, SlashPanel, UsageRing } from "@/features/chat/composer/composerKit";
import { OptionMenu } from "@/features/chat/composer/pickers";
import { useI18n } from "@/lib/i18n";
import { groupedCloudModelLabel } from "@/lib/cloud/options";
import { fmtK } from "@/lib/util/fmt";
import { useEscLayer } from "@/lib/util/escLayer";
import { commandText, createImeGuard, cycleIndex, filterCommands, slashQuery } from "@/lib/util/slash";
import type { SlashCommand } from "@/lib/protocol/types";
import type { CloudTaskHandle } from "./useCloudTask";

export function CloudComposer({
  h,
  pending,
  onSend,
}: {
  h: CloudTaskHandle;
  /** VM 启动中(task pending)。**输入框不禁用**:桌面侧不退化成只读等待页
   * ——启动期照常输入,内容押进出件箱,环境就绪即自动送达(旧 UI
   * cloudStartup.tsx:6-8「这是桌面侧独有的能力」)。VM 建成要以分钟计,
   * 干等一屏时间线是白等。只有真需要 VM 在场的动作(切模型)才禁。 */
  pending: boolean;
  /** 发送动作由视图包一层(发送前重新贴底),内容仍取 h.input */
  onSend: () => void;
}) {
  const { t } = useI18n();
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imeRef = useRef(createImeGuard());

  // 挂载即聚焦:云端任务视图按 task.id 挂 key(CloudTaskView),切任务 =
  // 整棵重建,挂载这一下正是「切换完任务」;重进同一任务(如关设置页)也
  // 在挂载路径上,焦点落输入框同样合理——回到任务就是要继续干活
  useEffect(() => {
    taRef.current?.focus();
    // 只挂载时一次;切换任务由整棵重建表达,不依赖 props 变化
  }, []);

  // 模型清单预取(幂等;失败保持 null,悬停菜单区再触发即重试)
  const { loadModels } = h;
  useEffect(() => loadModels(), [loadModels]);

  // ==== 斜杠指令面板(与本地 Composer 同一套纯逻辑 + 同一件 SlashPanel;
  // 指令清单由 useCloudTask 粘住,断线重连不空掉) ====
  const [slashSuppressed, setSlashSuppressed] = useState(false);
  const [active, setActive] = useState(0);
  const query = slashQuery(h.input);
  const slashOpen = query !== null && !slashSuppressed && h.commands.length > 0;
  const list = useMemo(() => filterCommands(h.commands, query ?? ""), [h.commands, query]);
  const act = Math.min(active, Math.max(0, list.length - 1));
  useEffect(() => setActive(0), [query, h.commands]);
  useEffect(() => {
    if (query === null) setSlashSuppressed(false); // `/` 段清掉即解除压制
  }, [query]);

  const pickCommand = (cmd: SlashCommand) => {
    h.setInput(commandText(cmd));
    setSlashSuppressed(true); // 填入的文本自己就是 /name,不压住会立刻回弹匹配自己
    taRef.current?.focus();
  };

  // Esc 关面板走 escLayer 层栈(全应用唯一一条 window capture,后开的浮层先
  // 拿到):面板开着时这一下只能归面板——审批热键挂在冒泡阶段且 esc = 不可逆
  // 的拒绝,消费即截断。返回 true = 已消费
  const escSlash = useCallback(() => {
    setSlashSuppressed(true);
    return true;
  }, []);
  useEscLayer(slashOpen, escSlash);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 面板优先:↑↓/↩/⇥ 归面板,不落到发送
    if (slashOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive(cycleIndex(act, e.key === "ArrowDown" ? 1 : -1, list.length));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && list.length > 0) {
        if (e.key === "Enter" && imeRef.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) return;
        e.preventDefault();
        pickCommand(list[act]!);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // IME 组合期(或 WKWebView 上组合刚结束 100ms 窗口内)的 Enter 是选字
      if (imeRef.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) return;
      e.preventDefault();
      if (inFlight) return; // 上一条还在拨号:回车与按钮同待遇
      onSend();
    }
  };

  // 粘贴附件:剪贴板 file item(截图/复制的文件)转附件,文本粘贴不受影响
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      h.addFiles(files);
    }
  };

  const onPickFiles = (list: FileList | null) => {
    if (list?.length) h.addFiles([...list]);
    // 复位 value:同一文件再次选择也要触发 change
    if (fileRef.current) fileRef.current.value = "";
  };

  // 发送在途:mode=new 连接还在拨号(休眠机器要先唤醒,以分钟计),
  // 云端尚未回显这条。此间禁止再次发送(见 useCloudTask.send 的同名拦截)
  const inFlight = h.sending !== null;

  // 运行条 detail:云端没有轮次概念,给累计 tokens(详情统计,轮询刷新)
  const tokens = h.meta?.stats?.total_tokens ?? 0;
  const runningDetail = tokens > 0 ? `${fmtK(tokens)} tokens` : undefined;

  // 模型菜单:当前项 = 详情里的模型;切换中触发器换文案
  const currentModelId = h.meta?.model?.id ?? "";
  const currentModelName = h.meta?.model?.remark || h.meta?.model?.model || t("cloud.model.label");
  const modelSections = (h.models ?? []).map((g) => ({
    key: g.key,
    label: g.label,
    ...(g.badge ? { badge: g.badge } : {}),
    options: g.models.map((m) => ({
      value: m.id ?? "",
      label: groupedCloudModelLabel(m),
      disabled: m.locked,
      // 锁定(超会员档)可见说明:行尾「未解锁」+ 悬停解锁路径(disabled
      // 按钮不弹 tooltip,hint 由 OptionMenu 挂在 li 上)
      ...(m.locked ? { note: t("settings.models.lockedBadge"), hint: t("chat.model.locked") } : {}),
    })),
  }));

  // 上下文用量(usage_update 帧,云端与本地同构;>85% 示警,同 Composer)
  const usage = h.chat.usage;
  const usagePct = usage && usage.size > 0 ? Math.round((usage.used / usage.size) * 100) : null;

  return (
    <div className="flex flex-col gap-2">
      {h.err && <ErrorBar text={h.err} onDismiss={h.clearErr} />}

      <ComposerCard>
        {h.running && (
          <RunBar
            label={t("cloud.view.running")}
            detail={runningDetail}
            stopLabel={t("chat.stop")}
            stopTitle={t("cloud.view.cancelRun")}
            onStop={h.cancelRun}
          />
        )}

        {(h.uploading > 0 || h.atts.length > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {h.atts.map((a, i) => (
              <span key={a.url} title={a.filename} className="badge badge-ghost text-xs">
                <span className="max-w-40 truncate">{a.filename}</span>
                <button
                  type="button"
                  aria-label={t("chat.attachRemove")}
                  className="btn btn-ghost btn-circle btn-xs"
                  onClick={() => h.removeAtt(i)}
                >
                  <IconX size={12} stroke={1.75} aria-hidden />
                </button>
              </span>
            ))}
            {h.uploading > 0 && (
              <span className="badge badge-ghost text-xs">
                <span className="loading loading-spinner loading-xs" aria-hidden />
                {t("cloud.attach.uploading")}
              </span>
            )}
          </div>
        )}

        {/* 启动期押后的那条:整屏让给了启动时间线,占位气泡没有落脚处,
            改在输入卡内给一条待发 chip(旧 UI QueuedChip「环境就绪后自动
            发送」同位同义)——不外显的话输入框一清、屏幕毫无变化 */}
        {pending && h.sending && (
          <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
            <span title={h.sending.content} className="badge badge-ghost gap-1.5 text-xs">
              <span className="loading loading-spinner loading-xs" aria-hidden />
              <span className="max-w-60 truncate">{h.sending.content}</span>
            </span>
            <span className="text-xs text-base-content/60">{t("cloud.send.startupQueued")}</span>
          </div>
        )}

        {slashOpen && <SlashPanel list={list} active={act} onHover={setActive} onPick={pickCommand} />}

        <ComposerTextarea
          taRef={taRef}
          aria-label={t("chat.composer")}
          placeholder={
            // 启动期/唤醒期都不禁输入:消息押后、条件解除即自动送达,
            // 占位文案把这件事说清楚免得白等
            pending
              ? t("cloud.view.composerPending")
              : h.waking
                ? t("cloud.view.composerWaking")
                : t("cloud.view.composerPlaceholder")
          }
          value={h.input}
          onChange={(e) => h.setInput(e.target.value)}
          onCompositionEnd={(e) => imeRef.current.markEnd(e.timeStamp)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        {/* 底部集群(同 Composer 口径:ps-1 光学对齐/pe-2 发送钮留白):
            左 = 附件入口,右 = 模型切换 + 用量环 + 发送 */}
        <div className="flex min-w-0 items-center gap-1 ps-1 pe-2 pb-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <button
            type="button"
            aria-label={t("chat.attach")}
            title={t("chat.attachTip")}
            className="btn btn-ghost btn-square btn-xs shrink-0 text-base-content/60"
            onClick={() => fileRef.current?.click()}
          >
            <IconPaperclip size={15} stroke={1.75} aria-hidden />
          </button>
          <span className="min-w-0 flex-1" />

          {/* 悬停即(重)拉模型清单:loadModels 幂等,失败后这里就是重试入口 */}
          <span className="contents" onPointerEnter={() => h.loadModels()}>
            <OptionMenu
              ariaLabel={t("cloud.model.label")}
              value={currentModelId}
              triggerLabel={h.switching ? t("cloud.model.switching") : currentModelName}
              onPick={(id) => void h.switchModel(id)}
              disabled={pending || h.running || h.switching}
              title={h.running ? t("chat.switchWhileRunning") : t("cloud.model.tip")}
              sections={modelSections}
              align="end"
            />
          </span>

          {/* 恒显(与本地 composer 同口径):没有 usage 帧时只画空轨道 +
              「暂无数据」,不整块消失——元素时有时无本身是干扰 */}
          <UsageRing
            pct={usagePct}
            label={t("chat.contextUsage")}
            tip={
              usagePct !== null && usage
                ? t("chat.usageTip", { pct: usagePct, used: fmtK(usage.used), size: fmtK(usage.size) })
                : t("chat.usageEmpty")
            }
          />
          {/* 发送在途(mode=new 连接在拨号/唤醒机器):按钮转圈并禁用——
              再点一次会掐掉在途连接,首条被弹回输入框挤掉刚打的字 */}
          <button
            type="button"
            aria-label={t("chat.send")}
            title={inFlight ? t("cloud.send.pending") : t("chat.sendTip")}
            className="btn btn-primary btn-square btn-sm shrink-0"
            disabled={inFlight || !h.input.trim()}
            onClick={onSend}
          >
            {inFlight ? (
              <span className="loading loading-spinner loading-xs" aria-hidden />
            ) : (
              <IconSend size={16} stroke={1.75} aria-hidden />
            )}
          </button>
        </div>
      </ComposerCard>
    </div>
  );
}
