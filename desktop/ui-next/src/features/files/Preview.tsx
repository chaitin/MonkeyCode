// 预览窗格:头部(文件名 + 全路径 + 改动徽标 + 关闭)+ 三态主体
// (loading/error/ready),ready 再按模式分流——文件(空/二进制占位、
// 代码高亮)与 diff(空 diff 占位、unified diff 渲染)。超限文件在壳侧
// 以 {error} 拒绝,走 error 态外显原因。
import { IconFolderOpen, IconX } from "@tabler/icons-react";

import { useI18n } from "@/lib/i18n";
import { isMacShell } from "@/lib/ipc/host";
import { CodeView } from "./CodeView";
import { DiffView } from "./DiffView";
import { basename, statusMeta } from "./status";

export type PreviewMode = "file" | "diff";

export interface PreviewModel {
  path: string;
  mode: PreviewMode;
  state: "loading" | "error" | "ready";
  /** ready:文件内容或 diff 文本;error:错误消息;loading:空串 */
  text: string;
}

export function Preview({
  model,
  status,
  onReveal,
  onClose,
}: {
  model: PreviewModel;
  status?: string;
  /** 在系统文件管理器中定位此文件(缺省则不渲染该入口) */
  onReveal?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const meta = status ? statusMeta(status) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-t border-base-300 px-4 py-1.5">
        <span className="shrink-0 font-mono text-xs font-semibold">{basename(model.path)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/45">{model.path}</span>
        {meta && <span className={`badge badge-soft badge-xs shrink-0 ${meta.badgeClass}`}>{t(meta.labelKey)}</span>}
        {onReveal && (
          <button
            type="button"
            aria-label={isMacShell() ? t("files.revealFileMac") : t("files.revealFile")}
            title={isMacShell() ? t("files.revealFileMac") : t("files.revealFile")}
            onClick={onReveal}
            className="btn btn-ghost btn-square btn-xs shrink-0"
          >
            <IconFolderOpen size={13} stroke={1.75} aria-hidden />
          </button>
        )}
        <button
          type="button"
          aria-label={t("files.preview.close")}
          title={t("files.preview.close")}
          onClick={onClose}
          className="btn btn-ghost btn-square btn-xs shrink-0"
        >
          <IconX size={14} stroke={1.75} aria-hidden />
        </button>
      </header>
      {/* 只写 overflow-y 时 overflow-x 被算成 auto(LAYOUT §5):预览体今天
          都靠 whitespace-pre-wrap+wrap-anywhere 折行、撑不宽,但这条不能赌
          ——将来任何一个不折行的预览体都会在这里长出横滚条 */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <PreviewBody model={model} />
      </div>
    </div>
  );
}

function PreviewBody({ model }: { model: PreviewModel }) {
  const { t } = useI18n();
  if (model.state === "loading") {
    return (
      <div role="status" className="flex items-center gap-2 px-4 py-3 text-xs text-base-content/50">
        <span className="loading loading-spinner loading-xs" aria-hidden />
        {t("files.loading")}
      </div>
    );
  }
  if (model.state === "error") {
    return <p role="alert" className="px-4 py-3 font-mono text-xs text-error">{t("files.preview.error", { message: model.text })}</p>;
  }
  if (model.mode === "diff") {
    if (!model.text.trim()) return <Placeholder text={t("files.preview.noDiff")} />;
    return <DiffView text={model.text} />;
  }
  if (!model.text) return <Placeholder text={t("files.preview.empty")} />;
  if (model.text.includes("\0")) return <Placeholder text={t("files.preview.binary")} />;
  return <CodeView path={model.path} text={model.text} />;
}

function Placeholder({ text }: { text: string }) {
  return <p className="px-4 py-3 text-xs text-base-content/50">{text}</p>;
}
