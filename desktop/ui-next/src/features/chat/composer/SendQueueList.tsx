import { IconGripVertical, IconPaperclip, IconTrash, IconX } from "@tabler/icons-react";
import { useState, type DragEvent } from "react";

import { useI18n } from "@/lib/i18n";
import type { SendQueueBlock, SendQueueInFlight, SendQueueItem } from "./sendQueue";

/** 队列排序专用类型。附件入口只应接受 kind=file，排序事件也会在组件内停止冒泡。 */
export const SEND_QUEUE_DRAG_MIME = "application/x-monkeycode-send-queue-item";

export interface SendQueueListProps<A> {
  pending: SendQueueItem<A>[];
  inFlight: SendQueueInFlight<A> | null;
  blocked: SendQueueBlock | null;
  onRemove(id: string): void;
  onReorder(id: string, beforeId: string | null): void;
  /** 普通 blocked 时解除暂停；uncertain 时把原项以同一 ID 放回队首重试。 */
  onResume(): void;
  /** uncertain 项已可能送达，只有用户明确选择移除时才丢弃。 */
  onDiscardUncertain(id: string): void;
  /** 任务已结束/不存在时停止后台 runtime 并删除整个 lane。 */
  onStopAndClear?: () => void;
}

function hasInternalDrag(dataTransfer: DataTransfer | null): boolean {
  return [...(dataTransfer?.types ?? [])].includes(SEND_QUEUE_DRAG_MIME);
}

function ItemSummary<A>({ item }: { item: SendQueueItem<A> }) {
  const { t } = useI18n();
  return (
    <>
      <span className="min-w-0 flex-1 truncate" title={item.content}>
        {item.content}
      </span>
      {item.attachments.length > 0 && (
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-base-content/60"
          title={t("chat.sendQueue.attachments", { n: item.attachments.length })}
        >
          <IconPaperclip size={13} stroke={1.75} aria-hidden />
          <span>{item.attachments.length}</span>
        </span>
      )}
    </>
  );
}

export function SendQueueList<A>({
  pending,
  inFlight,
  blocked,
  onRemove,
  onReorder,
  onResume,
  onDiscardUncertain,
  onStopAndClear,
}: SendQueueListProps<A>) {
  const { t } = useI18n();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState<string | null | undefined>(undefined);
  const ids = pending.map((item) => item.id);
  const uncertain = inFlight?.phase === "uncertain";
  const terminalBlock = blocked?.code === "task-ended" || blocked?.code === "task-missing";

  if (pending.length === 0 && inFlight === null && blocked === null) return null;

  const willMove = (before: string | null): boolean => {
    if (draggedId === null || draggedId === before) return false;
    const from = ids.indexOf(draggedId);
    if (from < 0) return false;
    if (before === null) return from !== ids.length - 1;
    const to = ids.indexOf(before);
    return to >= 0 && from + 1 !== to;
  };

  const acceptInternalDrag = (event: DragEvent, nextBeforeId: string | null) => {
    if (!hasInternalDrag(event.dataTransfer) && draggedId === null) return false;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setBeforeId(nextBeforeId);
    return true;
  };

  const dropInternal = (event: DragEvent, nextBeforeId: string | null) => {
    if (!hasInternalDrag(event.dataTransfer) && draggedId === null) return;
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData(SEND_QUEUE_DRAG_MIME) || draggedId;
    if (id && id !== nextBeforeId && willMove(nextBeforeId)) onReorder(id, nextBeforeId);
    setDraggedId(null);
    setBeforeId(undefined);
  };

  const finishDrag = (event: DragEvent) => {
    event.stopPropagation();
    setDraggedId(null);
    setBeforeId(undefined);
  };

  return (
    <section aria-label={t("chat.sendQueue.label")} className="mb-2 rounded-box border border-base-300 bg-base-200/50 p-1.5">
      <ul className="flex flex-col gap-1">
        {inFlight && (
          <li className="flex min-w-0 items-center gap-2 rounded-btn bg-base-100 px-2 py-1.5">
            {uncertain ? (
              <IconX size={15} stroke={1.75} className="shrink-0 text-warning" aria-hidden />
            ) : (
              <span className="loading loading-spinner loading-xs shrink-0" aria-hidden />
            )}
            <span className="sr-only">{t(uncertain ? "chat.sendQueue.uncertain" : "chat.sendQueue.sending")}</span>
            <ItemSummary item={inFlight.item} />
            {uncertain && (
              <span className="flex shrink-0 items-center gap-1">
                <button type="button" className="btn btn-ghost btn-xs" onClick={onResume}>
                  {t("chat.sendQueue.retry")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-error"
                  onClick={() => onDiscardUncertain(inFlight.item.id)}
                >
                  {t("chat.sendQueue.discardUncertain")}
                </button>
              </span>
            )}
          </li>
        )}

        {pending.map((item) => {
          const showIndicator = beforeId === item.id && willMove(item.id);
          return (
            <li
              key={item.id}
              className="relative flex min-w-0 items-center gap-1 rounded-btn bg-base-100 px-1 py-1"
              onDragOver={(event) => acceptInternalDrag(event, item.id)}
              onDrop={(event) => dropInternal(event, item.id)}
            >
              {showIndicator && (
                <span
                  aria-hidden
                  data-send-queue-drop-indicator=""
                  className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary"
                />
              )}
              <button
                type="button"
                draggable
                aria-label={t("chat.sendQueue.drag")}
                title={t("chat.sendQueue.drag")}
                className="btn btn-ghost btn-square btn-xs cursor-grab active:cursor-grabbing"
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(SEND_QUEUE_DRAG_MIME, item.id);
                  setDraggedId(item.id);
                  setBeforeId(undefined);
                }}
                onDragEnd={finishDrag}
              >
                <IconGripVertical size={15} stroke={1.75} aria-hidden />
              </button>
              <ItemSummary item={item} />
              <button
                type="button"
                aria-label={t("chat.sendQueue.remove")}
                title={t("chat.sendQueue.remove")}
                className="btn btn-ghost btn-square btn-xs"
                onClick={() => onRemove(item.id)}
              >
                <IconTrash size={14} stroke={1.75} aria-hidden />
              </button>
            </li>
          );
        })}

        {pending.length > 0 && (
          <li
            aria-hidden
            className="relative h-1"
            onDragOver={(event) => acceptInternalDrag(event, null)}
            onDrop={(event) => dropInternal(event, null)}
          >
            {beforeId === null && willMove(null) && (
              <span
                data-send-queue-drop-indicator=""
                className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary"
              />
            )}
          </li>
        )}
      </ul>

      {blocked && (
        <div role="alert" className="mt-1 flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-warning">
          <span className="min-w-0 flex-1 truncate" title={blocked.message}>
            {t("chat.sendQueue.blocked")}: {blocked.message}
          </span>
          {!uncertain && !terminalBlock && (
            <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={onResume}>
              {t("chat.sendQueue.resume")}
            </button>
          )}
          {terminalBlock && onStopAndClear && (
            <button type="button" className="btn btn-ghost btn-xs shrink-0 text-error" onClick={onStopAndClear}>
              {t("chat.sendQueue.stopAndClear")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
