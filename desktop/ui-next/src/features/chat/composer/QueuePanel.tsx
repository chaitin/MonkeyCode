import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
  IconGripVertical,
  IconPencil,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type DragEvent } from "react";

import { useI18n } from "@/lib/i18n";
import type { ComposerAtt, QueueItem } from "./useComposer";

export interface QueuePanelProps {
  queue: QueueItem[];
  updateQueueItem(id: string, text: string, atts: ComposerAtt[]): void;
  removeQueueItem(id: string): void;
  moveQueueItem(id: string, targetIndex: number): void;
  lockedId?: string | null;
}

const summaryOf = (item: QueueItem) =>
  item.text.trim() || item.atts.map((att) => att.name).join(", ");

export function QueuePanel({
  queue,
  updateQueueItem,
  removeQueueItem,
  moveQueueItem,
  lockedId = null,
}: QueuePanelProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editAtts, setEditAtts] = useState<ComposerAtt[]>([]);
  const [editError, setEditError] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    if (editingId && !queue.some((item) => item.id === editingId)) setEditingId(null);
  }, [editingId, queue]);

  if (queue.length === 0) return null;

  const beginEdit = (item: QueueItem) => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditAtts([...item.atts]);
    setEditError(false);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditError(false);
  };
  const saveEdit = (item: QueueItem) => {
    if (item.id === lockedId) return;
    if (!editText.trim() && editAtts.length === 0) {
      setEditError(true);
      return;
    }
    updateQueueItem(item.id, editText, editAtts);
    cancelEdit();
  };
  const dragStart = (event: DragEvent, id: string) => {
    setDraggingId(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const drop = (event: DragEvent, targetIndex: number) => {
    event.preventDefault();
    const id = draggingId || event.dataTransfer.getData("text/plain");
    if (id && id !== lockedId) moveQueueItem(id, targetIndex);
    setDraggingId(null);
  };

  return (
    <section
      aria-label={t("chat.queue.panel")}
      className="rounded-box border border-base-300 bg-base-100 text-base-content"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="shrink-0 font-semibold">
          {t("chat.queue.title", { count: queue.length })}
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-base-content/60">
            · {t("chat.queue.next")}: {summaryOf(queue[0]!)}
          </span>
        )}
        <IconChevronRight
          size={14}
          stroke={1.75}
          aria-hidden
          className={`ml-auto shrink-0 text-base-content/40 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <ol className="flex max-h-44 flex-col overflow-x-hidden overflow-y-auto border-t border-base-300 px-2 py-1 text-xs">
          {queue.map((item, index) => {
            const locked = item.id === lockedId;
            const editing = item.id === editingId;
            return (
              <li
                key={item.id}
                draggable={!locked && !editing}
                onDragStart={(event) => dragStart(event, item.id)}
                onDragEnd={() => setDraggingId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => drop(event, index)}
                className={`border-b border-base-300 py-2 last:border-b-0 ${draggingId === item.id ? "opacity-50" : ""}`}
              >
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      aria-label={t("chat.queue.editInput", { index: index + 1 })}
                      className="textarea textarea-bordered min-h-16 w-full resize-y bg-base-100 text-base-content"
                      value={editText}
                      disabled={locked}
                      onChange={(event) => {
                        setEditText(event.target.value);
                        setEditError(false);
                      }}
                    />
                    {editAtts.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {editAtts.map((att, attIndex) => (
                          <span key={`${att.path}-${attIndex}`} className="badge badge-ghost gap-1 text-xs" title={att.path}>
                            <span className="max-w-40 truncate">{att.name}</span>
                            <button
                              type="button"
                              aria-label={t("chat.queue.removeAttachment", { name: att.name })}
                              className="btn btn-ghost btn-circle btn-xs"
                              disabled={locked}
                              onClick={() => {
                                setEditAtts((current) => current.filter((_, i) => i !== attIndex));
                                setEditError(false);
                              }}
                            >
                              <IconX size={11} stroke={1.75} aria-hidden />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {editError && <p role="alert" className="text-error">{t("chat.queue.empty")}</p>}
                    <div className="flex justify-end gap-1">
                      <button type="button" className="btn btn-ghost btn-xs" onClick={cancelEdit}>
                        {t("chat.queue.cancel")}
                      </button>
                      <button type="button" className="btn btn-primary btn-xs" disabled={locked} onClick={() => saveEdit(item)}>
                        {t("chat.queue.save")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span title={t("chat.queue.drag")} className="cursor-grab text-base-content/40">
                      <IconGripVertical size={15} stroke={1.75} aria-hidden />
                    </span>
                    <span className="w-4 shrink-0 text-center tabular-nums text-base-content/40">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={summaryOf(item)}>{summaryOf(item)}</span>
                    {locked && <span className="loading loading-spinner loading-xs" aria-label={t("chat.queue.sending")} />}
                    <button
                      type="button"
                      aria-label={t("chat.queue.moveUp", { index: index + 1 })}
                      className="btn btn-ghost btn-square btn-xs"
                      disabled={locked || index === 0 || queue[index - 1]?.id === lockedId}
                      onClick={() => moveQueueItem(item.id, index - 1)}
                    >
                      <IconArrowUp size={13} stroke={1.75} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.queue.moveDown", { index: index + 1 })}
                      className="btn btn-ghost btn-square btn-xs"
                      disabled={locked || index === queue.length - 1}
                      onClick={() => moveQueueItem(item.id, index + 1)}
                    >
                      <IconArrowDown size={13} stroke={1.75} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.queue.edit", { index: index + 1 })}
                      className="btn btn-ghost btn-square btn-xs"
                      disabled={locked}
                      onClick={() => beginEdit(item)}
                    >
                      <IconPencil size={13} stroke={1.75} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={t("chat.queue.remove", { index: index + 1 })}
                      className="btn btn-ghost btn-square btn-xs text-error"
                      disabled={locked}
                      onClick={() => removeQueueItem(item.id)}
                    >
                      <IconTrash size={13} stroke={1.75} aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
