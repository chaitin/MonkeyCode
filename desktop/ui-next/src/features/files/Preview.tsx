// 预览窗格:头部(文件名 + 全路径 + 改动徽标 + 关闭)+ 三态主体
// (loading/error/ready),ready 再按模式分流——文件(空/二进制占位、
// Markdown 渲染/代码高亮)与 diff(空 diff 占位、unified diff 渲染)。超限文件在壳侧
// 以 {error} 拒绝,走 error 态外显原因。
import { IconFolderOpen, IconX } from "@tabler/icons-react";

import { Markdown } from "@/components/markdown/Markdown";
import { useI18n } from "@/lib/i18n";
import { isMacShell } from "@/lib/ipc/host";
import { resolveMarkdownPath } from "@/lib/util/markdownPaths";
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

export interface PreviewResourceAdapter {
  /** 已按当前 Markdown 目录解析的工作区路径 → 图片 data URL。 */
  localImageUrl?: (path: string) => Promise<string>;
  /** 已按当前 Markdown 目录解析的工作区文件路径。 */
  onLocalLink?: (path: string) => void;
}

export function Preview({
  model,
  status,
  resources,
  onReveal,
  onClose,
}: {
  model: PreviewModel;
  status?: string;
  resources?: PreviewResourceAdapter;
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
        <PreviewBody model={model} resources={resources} />
      </div>
    </div>
  );
}

function PreviewBody({ model, resources }: { model: PreviewModel; resources?: PreviewResourceAdapter }) {
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
  if (/\.(?:md|markdown)$/i.test(model.path)) {
    const imageAdapter = resources?.localImageUrl;
    const linkAdapter = resources?.onLocalLink;
    const localImageUrl = imageAdapter
      ? (path: string) => {
          const resolved = resolveMarkdownPath(model.path, path);
          return resolved === null ? Promise.reject(new Error(t("chat.revealOutside"))) : imageAdapter(resolved);
        }
      : undefined;
    const onLocalLink = linkAdapter
      ? (path: string) => {
          const resolved = resolveMarkdownPath(model.path, path);
          if (resolved !== null) linkAdapter(resolved);
        }
      : undefined;
    return (
      // 按文件路径重挂，避免同名相对图片跨目录复用上一份 Promise 缓存。
      <Markdown
        key={model.path}
        source={model.text}
        className="px-4 py-3"
        localImageUrl={localImageUrl}
        onLocalLink={onLocalLink}
      />
    );
  }
  return <CodeView path={model.path} text={model.text} />;
}

function Placeholder({ text }: { text: string }) {
  return <p className="px-4 py-3 text-xs text-base-content/50">{text}</p>;
}
