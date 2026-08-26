import { IconGripVertical, IconPaperclip, IconTrash, IconX } from "@tabler/icons-react";
import { useState, type DragEvent } from "react";

import { Lightbox, UploadImg } from "@/components/media/UploadImg";
import { useI18n } from "@/lib/i18n";
import type { SendQueueBlock, SendQueueInFlight, SendQueueItem, SendQueueSteering } from "./sendQueue";

/** 队列排序专用类型。附件入口只应接受 kind=file，排序事件也会在组件内停止冒泡。 */
export const SEND_QUEUE_DRAG_MIME = "application/x-monkeycode-send-queue-item";

export interface SendQueueListProps<A> {
  pending: SendQueueItem<A>[];
  inFlight: SendQueueInFlight<A> | null;
  blocked: SendQueueBlock | null;
  steering?: SendQueueSteering<A>[];
  onRemove(id: string): void;
  onReorder(id: string, beforeId: string | null): void;
  /** 仅在会话运行中且引擎支持 steering 时传入。 */
  onSteer?: (id: string) => void;
  /** 不确定 steering 只有显式用户动作才能恢复 pending 或删除。 */
  onRetrySteering?: (id: string) => void;
  onDiscardSteering?: (id: string) => void;
  /** 普通 blocked 时解除暂停；uncertain 时把原项以同一 ID 放回队首重试。 */
  onResume(): void;
  /** uncertain 项已可能送达，只有用户明确选择移除时才丢弃。 */
  onDiscardUncertain(id: string): void;
  /** 用户主动暂停后清空所有尚未投递的消息。 */
  onClearQueue?: () => void;
  /** 任务已结束/不存在时停止后台 runtime 并删除整个 lane。 */
  onStopAndClear?: () => void;
  attachmentName?: (attachment: A) => string;
  attachmentIsImage?: (attachment: A) => boolean;
  loadAttachmentUrl?: (attachment: A) => Promise<string>;
  onOpenAttachment?: (attachment: A) => void;
  /** Composer 紧随其后时共享边界，避免队列再像一张独立业务卡。 */
  attachedToComposer?: boolean;
}

const COLLAPSED_ITEMS = 3;

function hasInternalDrag(dataTransfer: DataTransfer | null): boolean {
  return [...(dataTransfer?.types ?? [])].includes(SEND_QUEUE_DRAG_MIME);
}

function ItemSummary<A>({
  item,
  attachmentsOpen,
  onToggleAttachments,
}: {
  item: SendQueueItem<A>;
  attachmentsOpen: boolean;
  onToggleAttachments(): void;
}) {
  const { t } = useI18n();
  return (
    <>
      <span className="min-w-0 flex-1 truncate" title={item.content}>
        {item.content}
      </span>
      {item.attachments.length > 0 && (
        <button
          type="button"
          aria-expanded={attachmentsOpen}
          aria-label={t(attachmentsOpen ? "chat.sendQueue.hideAttachments" : "chat.sendQueue.showAttachments", {
            n: item.attachments.length,
          })}
          className="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 gap-1 px-1.5 text-xs font-normal text-base-content/55"
          title={t("chat.sendQueue.attachments", { n: item.attachments.length })}
          onClick={onToggleAttachments}
        >
          <IconPaperclip size={13} stroke={1.75} aria-hidden />
          <span>{item.attachments.length}</span>
        </button>
      )}
    </>
  );
}

function AttachmentImage<A>({ attachment, name, load }: { attachment: A; name: string; load: (attachment: A) => Promise<string> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <UploadImg
        load={() => load(attachment)}
        alt={name}
        title={name}
        className="h-10 w-10 cursor-zoom-in rounded-md object-cover"
        onClick={() => setOpen(true)}
      />
      {open && (
        <Lightbox alt={name} onClose={() => setOpen(false)}>
          <UploadImg load={() => load(attachment)} alt={name} className="max-h-[84vh] max-w-full" />
        </Lightbox>
      )}
    </>
  );
}

function AttachmentList<A>({
  attachments,
  attachmentName,
  attachmentIsImage,
  loadAttachmentUrl,
  onOpenAttachment,
}: Pick<
  SendQueueListProps<A>,
  "attachmentName" | "attachmentIsImage" | "loadAttachmentUrl" | "onOpenAttachment"
> & { attachments: A[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-10 pb-2 pt-1">
      {attachments.map((attachment, index) => {
        const name = attachmentName?.(attachment) || String(attachment);
        if (attachmentIsImage?.(attachment) && loadAttachmentUrl) {
          return <AttachmentImage key={`${name}-${index}`} attachment={attachment} name={name} load={loadAttachmentUrl} />;
        }
        const content = (
          <>
            <IconPaperclip size={12} stroke={1.75} aria-hidden className="shrink-0" />
            <span className="max-w-48 truncate">{name}</span>
          </>
        );
        return onOpenAttachment ? (
          <button
            key={`${name}-${index}`}
            type="button"
            className="btn btn-ghost btn-xs max-w-56 justify-start font-normal"
            title={name}
            onClick={() => onOpenAttachment(attachment)}
          >
            {content}
          </button>
        ) : (
          <span key={`${name}-${index}`} className="flex h-6 max-w-56 items-center gap-1 px-2 text-xs text-base-content/60" title={name}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

function PausedActions({ onResume, onClear }: { onResume(): void; onClear(): void }) {
  const { t } = useI18n();
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-xs shrink-0 text-error"
        onClick={() => {
          if (confirmClear) onClear();
          else setConfirmClear(true);
        }}
      >
        {t(confirmClear ? "chat.sendQueue.confirmClear" : "chat.sendQueue.clear")}
      </button>
      <button type="button" className="btn btn-primary btn-xs shrink-0" onClick={onResume}>
        {t("chat.sendQueue.continue")}
      </button>
    </span>
  );
}

export function SendQueueList<A>({
  pending,
  inFlight,
  blocked,
  steering = [],
  onRemove,
  onReorder,
  onSteer,
  onRetrySteering,
  onDiscardSteering,
  onResume,
  onDiscardUncertain,
  onClearQueue,
  onStopAndClear,
  attachmentName,
  attachmentIsImage,
  loadAttachmentUrl,
  onOpenAttachment,
  attachedToComposer = false,
}: SendQueueListProps<A>) {
  const { t } = useI18n();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [attachmentsFor, setAttachmentsFor] = useState<string | null>(null);
  const ids = pending.map((item) => item.id);
  const hiddenCount = Math.max(0, pending.length - COLLAPSED_ITEMS);
  const visiblePending = expanded ? pending : pending.slice(0, COLLAPSED_ITEMS);
  // 收到业务帧后消息已经出现在时间线；awaiting-turn-end 只是一把内部逐轮
  // 投递锁，继续画成“发送中”会与上方用户气泡重复并给出错误状态。
  const visibleInFlight = inFlight?.phase === "awaiting-turn-end" ? null : inFlight;
  const uncertain = visibleInFlight?.phase === "uncertain";
  const visibleSteering = steering.filter(
    (entry) => !entry.discardRequested && (entry.phase === "dispatching" || entry.phase === "uncertain"),
  );
  const steeringDispatching = steering.some((entry) => entry.phase === "dispatching");
  // 空队列的 user-paused 只是取消与 task-ended 之间的投递屏障，不画空状态栏。
  const visibleBlock = blocked?.code === "user-paused" && pending.length === 0 ? null : blocked;
  const terminalBlock = visibleBlock?.code === "task-ended" || visibleBlock?.code === "task-missing";
  const userPaused = visibleBlock?.code === "user-paused";

  if (pending.length === 0 && visibleInFlight === null && visibleSteering.length === 0 && visibleBlock === null) return null;

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
    <section
      aria-label={t("chat.sendQueue.label")}
      className={
        attachedToComposer
          ? "-mx-2.5 -mb-2 overflow-hidden rounded-xl rounded-b-none border border-b-0 border-base-300/70 bg-base-200/45 px-4 py-1.5"
          : "overflow-hidden rounded-xl bg-base-200/45 px-2 py-1.5"
      }
    >
      {pending.length > 0 && (
        <header className="flex h-7 min-w-0 items-center gap-1.5 px-1 text-xs text-base-content/50">
          <span className="shrink-0 font-medium text-base-content/70">
            {t("chat.sendQueue.summary", { n: pending.length })}
          </span>
          <span aria-hidden>·</span>
          <span className="min-w-0 truncate">{t("chat.sendQueue.hint")}</span>
        </header>
      )}

      <ol className="flex flex-col">
        {visibleSteering.map((entry) => {
          const isUncertain = entry.phase === "uncertain";
          return (
            <li key={`steering-${entry.item.id}`} className="rounded-lg bg-primary/5 text-sm">
              <div className="flex min-h-9 min-w-0 items-center gap-2 px-2">
                {isUncertain ? (
                  <IconX size={15} stroke={1.75} className="shrink-0 text-warning" aria-hidden />
                ) : (
                  <span className="loading loading-spinner loading-xs shrink-0" aria-hidden />
                )}
                <span className="shrink-0 text-xs font-medium text-base-content/55">
                  {t(isUncertain ? "chat.sendQueue.steerUncertain" : "chat.sendQueue.steering")}
                </span>
                <ItemSummary
                  item={entry.item}
                  attachmentsOpen={attachmentsFor === entry.item.id}
                  onToggleAttachments={() =>
                    setAttachmentsFor((id) => (id === entry.item.id ? null : entry.item.id))
                  }
                />
                {isUncertain && (
                  <span className="flex shrink-0 items-center gap-1">
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => onRetrySteering?.(entry.item.id)}>
                      {t("chat.sendQueue.retry")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-error"
                      onClick={() => onDiscardSteering?.(entry.item.id)}
                    >
                      {t("chat.sendQueue.discardUncertain")}
                    </button>
                  </span>
                )}
              </div>
              {attachmentsFor === entry.item.id && (
                <AttachmentList
                  attachments={entry.item.attachments}
                  attachmentName={attachmentName}
                  attachmentIsImage={attachmentIsImage}
                  loadAttachmentUrl={loadAttachmentUrl}
                  onOpenAttachment={onOpenAttachment}
                />
              )}
            </li>
          );
        })}

        {visibleInFlight && (
          <li className="rounded-lg bg-primary/5 text-sm">
            <div className="flex min-h-9 min-w-0 items-center gap-2 px-2">
              {uncertain ? (
                <IconX size={15} stroke={1.75} className="shrink-0 text-warning" aria-hidden />
              ) : (
                <span className="loading loading-spinner loading-xs shrink-0" aria-hidden />
              )}
              <span className="shrink-0 text-xs font-medium text-base-content/55">
                {t(uncertain ? "chat.sendQueue.uncertain" : "chat.sendQueue.sending")}
              </span>
              <ItemSummary
                item={visibleInFlight.item}
                attachmentsOpen={attachmentsFor === visibleInFlight.item.id}
                onToggleAttachments={() =>
                  setAttachmentsFor((id) => (id === visibleInFlight.item.id ? null : visibleInFlight.item.id))
                }
              />
              {uncertain && (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={onResume}>
                    {t("chat.sendQueue.retry")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs text-error"
                    onClick={() => onDiscardUncertain(visibleInFlight.item.id)}
                  >
                    {t("chat.sendQueue.discardUncertain")}
                  </button>
                </span>
              )}
            </div>
            {attachmentsFor === visibleInFlight.item.id && (
              <AttachmentList
                attachments={visibleInFlight.item.attachments}
                attachmentName={attachmentName}
                attachmentIsImage={attachmentIsImage}
                loadAttachmentUrl={loadAttachmentUrl}
                onOpenAttachment={onOpenAttachment}
              />
            )}
          </li>
        )}

        {visiblePending.map((item, index) => {
          const showIndicator = beforeId === item.id && willMove(item.id);
          return (
            <li
              key={item.id}
              className="group relative border-t border-base-300/55 text-sm first:border-t-0 hover:bg-base-100/55"
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
              <div className="flex min-h-9 min-w-0 items-center gap-1 px-0.5">
                <button
                  type="button"
                  draggable
                  aria-label={t("chat.sendQueue.drag")}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title={t("chat.sendQueue.drag")}
                  className="btn btn-ghost btn-square btn-xs h-7 min-h-7 w-6 cursor-grab text-base-content/30 hover:text-base-content/70 active:cursor-grabbing"
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(SEND_QUEUE_DRAG_MIME, item.id);
                    setDraggedId(item.id);
                    setBeforeId(undefined);
                  }}
                  onDragEnd={finishDrag}
                  onKeyDown={(event) => {
                    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const current = ids.indexOf(item.id);
                    if (current < 0) return;
                    if (event.key === "ArrowUp") {
                      if (current > 0) onReorder(item.id, ids[current - 1]!);
                      return;
                    }
                    if (current < ids.length - 1) {
                      // 折叠态最后一个可见项向下移动会进入隐藏区；先展开，
                      // 让稳定 key 对应的按钮留在 DOM 中，键盘焦点才能跟随该项。
                      if (!expanded && current === visiblePending.length - 1) setExpanded(true);
                      onReorder(item.id, ids[current + 2] ?? null);
                    }
                  }}
                >
                  <IconGripVertical size={14} stroke={1.75} aria-hidden />
                </button>
                <span aria-hidden className="w-4 shrink-0 text-center text-xs tabular-nums text-base-content/35">
                  {index + 1}
                </span>
                <ItemSummary
                  item={item}
                  attachmentsOpen={attachmentsFor === item.id}
                  onToggleAttachments={() => setAttachmentsFor((id) => (id === item.id ? null : item.id))}
                />
                {onSteer && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 px-1.5 font-normal text-primary"
                    disabled={steeringDispatching}
                    onClick={() => onSteer(item.id)}
                  >
                    {t("chat.sendQueue.steer")}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t("chat.sendQueue.remove")}
                  title={t("chat.sendQueue.remove")}
                  className="btn btn-ghost btn-square btn-xs h-7 min-h-7 w-7 shrink-0 text-base-content/35 opacity-0 hover:text-error hover:opacity-100 focus-visible:text-error focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  onClick={() => onRemove(item.id)}
                >
                  <IconTrash size={13} stroke={1.75} aria-hidden />
                </button>
              </div>
              {attachmentsFor === item.id && (
                <AttachmentList
                  attachments={item.attachments}
                  attachmentName={attachmentName}
                  attachmentIsImage={attachmentIsImage}
                  loadAttachmentUrl={loadAttachmentUrl}
                  onOpenAttachment={onOpenAttachment}
                />
              )}
            </li>
          );
        })}

        {hiddenCount > 0 && (
          <li className="border-t border-base-300/55 px-8 py-0.5">
            <button
              type="button"
              className="btn btn-ghost btn-xs h-7 min-h-7 px-2 font-normal text-base-content/55"
              onClick={() => setExpanded((value) => !value)}
            >
              {t(expanded ? "chat.sendQueue.collapse" : "chat.sendQueue.expand", { n: hiddenCount })}
            </button>
          </li>
        )}

        {pending.length > 0 && (expanded || hiddenCount === 0) && (
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
      </ol>

      {visibleBlock && (
        <div role="alert" className="mt-1 flex min-w-0 items-center gap-2 px-2 py-1 text-xs text-warning">
          <span className="min-w-0 flex-1 truncate" title={userPaused ? t("chat.sendQueue.userPaused") : visibleBlock.message}>
            {userPaused ? t("chat.sendQueue.userPaused") : `${t("chat.sendQueue.blocked")}: ${visibleBlock.message}`}
          </span>
          {userPaused && onClearQueue && <PausedActions onResume={onResume} onClear={onClearQueue} />}
          {!uncertain && !terminalBlock && !userPaused && (
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
