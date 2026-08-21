// 全局下载条:右下角 toast 栈,跨视图常显(daisyUI toast + progress)。
import { IconX } from "@tabler/icons-react";

import { useI18n } from "@/lib/i18n";
import {
  cancelDownload,
  dismissDownload,
  revealDownload,
  useDownloads,
  type DownloadItem,
} from "@/lib/ipc/downloads";

function DownloadCard({ item }: { item: DownloadItem }) {
  const { t } = useI18n();
  const pct = item.total ? Math.min(100, Math.round((item.written / item.total) * 100)) : null;
  return (
    <div className="card card-border w-72 bg-base-100">
      <div className="flex flex-col gap-1.5 p-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium" title={item.filename}>
            {item.filename}
          </span>
          {item.state === "running" ? (
            <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("downloads.cancel")} onClick={() => cancelDownload(item.dlId)}>
              <IconX size={14} stroke={1.75} aria-hidden />
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("downloads.dismiss")} onClick={() => dismissDownload(item.dlId)}>
              <IconX size={14} stroke={1.75} aria-hidden />
            </button>
          )}
        </div>
        {item.state === "running" &&
          (pct === null ? (
            <progress className="progress progress-primary w-full" aria-label={t("downloads.progress")} />
          ) : (
            <progress className="progress progress-primary w-full" aria-label={t("downloads.progress")} value={pct} max={100} />
          ))}
        {item.state === "done" && (
          <>
            {/* 落点必须写出来:downloads.ts 的注释原本声称「路径本身就在下载卡上,
                用户仍可自寻」,但这里从来没渲染过 dest —— 下完了不知道存哪儿。
                旧卡片是「已保存到 {dest}」且 title 挂全路径 */}
            <span className="truncate text-base-content/50" title={item.dest}>
              {t("downloads.savedTo", { dest: item.dest })}
            </span>
            <button type="button" className="link link-primary self-start" onClick={() => revealDownload(item)}>
              {t("downloads.reveal")}
            </button>
          </>
        )}
        {item.state === "error" && <span className="text-error">{t("downloads.failed", { reason: item.error ?? "" })}</span>}
        {item.state === "canceled" && <span className="text-base-content/50">{t("downloads.canceled")}</span>}
      </div>
    </div>
  );
}

export function DownloadsDock() {
  const downloads = useDownloads();
  if (downloads.length === 0) return null;
  // z 必须压过 daisyUI 模态(modal.css 写死 z-index:999),不能停在 z-50:
  // LAYOUT §1 的 z 序是 backdrop<pop<drawer<lightbox<toast,toast 在最上。
  // 沉在模态之下的后果是——看图片放大/子会话回放/未保存确认期间下载完成,
  // 卡片被 40% 遮罩压暗、「在文件夹中显示」与关闭钮点不到,点下去反而把
  // 弹层关了(命中测试落到 .modal-backdrop)。旧 UI downloadsBar 就写着
  // 「zIndex: 80,压在文件抽屉(36)/缩放浮层(50)之上,下载去向任何页面都可见」
  return (
    <div className="toast toast-end z-[var(--z-window-overlay)]">
      {downloads.map((d) => (
        <DownloadCard key={d.dlId} item={d} />
      ))}
    </div>
  );
}
