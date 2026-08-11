// 待办:「想让 Agent 做的事」的收集箱 + 调度台。**覆盖视图**,设置页同款
// (LAYOUT §4:视图级头部 + 居中内容列,Esc 离开,点任何导航即切走;侧栏
// 保持原空间列表不动——待办是随手打开的调度台,不是常驻空间)。
// - 用户自有清单:添加/行内编辑/勾选/删除(useTodos 编排,壳 todos.json 持久化);
// - 每条可「派发成任务」:App 打开新建任务视图并预填正文(todoId 回链),创建
//   成功后本条记下去向(本地任务/本地会话/云端),行尾出关联任务的状态词,
//   点击跳回对应会话或云端空间;
// - 派发后的完成仍由用户手动勾掉:任务跑完 ≠ 事情办妥,验收权留给人。
// 行管理走右键菜单(与侧栏行同口径,删除二段确认),悬停件只切可见性(§6.2)。
import { IconChecklist, IconCloud, IconSend, IconX } from "@tabler/icons-react";
import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { resolveShortcut } from "@/app/shortcuts";
import { rowStatusLabel } from "@/features/sidebar/Sidebar";
import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { useI18n } from "@/lib/i18n";
import type { SessionMeta } from "@/lib/ipc/sessions";
import type { TodoItem } from "@/lib/ipc/todos";
import { useEscLayer } from "@/lib/util/escLayer";
import type { TodoOps } from "./useTodos";

/** 关联任务的状态点色(与侧栏 rowTrailing 同色语;静默态中性点)。 */
function linkTone(meta: SessionMeta): string {
  if (meta.waiting_ask) return "status-warning";
  if (meta.status === "running") return "status-primary";
  if (meta.status === "error") return "status-error";
  return "";
}

function TodoRow({
  item,
  sessions,
  ops,
  onDispatch,
  onOpenSession,
  onOpenCloud,
}: {
  item: TodoItem;
  sessions: SessionMeta[];
  ops: Pick<TodoOps, "edit" | "toggle" | "remove">;
  onDispatch: (item: TodoItem) => void;
  onOpenSession: (id: string) => void;
  onOpenCloud: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const done = item.status === "done";
  const cloud = item.dispatched_kind === "cloud";
  // 本地/会话去向:从壳的会话表回查活体(期间被删则 meta 缺席,链子挂空)
  const meta =
    item.dispatched_kind && !cloud ? sessions.find((s) => s.id === item.dispatched_id) : undefined;
  const linkWord = cloud
    ? t("cloud.view.badge")
    : meta
      ? rowStatusLabel(meta, t)
      : item.dispatched_kind
        ? t("todo.linkGone")
        : "";
  const menuItems: MenuItem[] = [
    { label: t("todo.editAction"), run: () => setEditing(true) },
    ...(!item.dispatched_kind && !done
      ? [{ label: t("todo.dispatch"), run: () => onDispatch(item) }]
      : []),
    { label: t("todo.delete"), confirm: t("todo.deleteConfirm"), danger: true, run: () => ops.remove(item.id) },
  ];

  const commitEdit = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // IME 组字回车不提交
    if (e.key === "Escape") return setEditing(false);
    if (e.key !== "Enter") return;
    const content = e.currentTarget.value.trim();
    if (content && content !== item.content) ops.edit(item.id, content);
    setEditing(false);
  };

  return (
    <li
      className="group flex items-start gap-2.5 rounded-box px-2 py-1.5 transition-colors hover:bg-base-200/60"
      title={editing ? undefined : [item.content, linkWord, t("sidebar.row.hint")].filter(Boolean).join("\n")}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        openMenu({ x: e.clientX, y: e.clientY }, menuItems);
      }}
    >
      <input
        type="checkbox"
        className="checkbox checkbox-sm mt-0.5 shrink-0"
        checked={done}
        aria-label={done ? t("todo.markUndone") : t("todo.markDone")}
        onChange={() => ops.toggle(item.id)}
      />
      {editing ? (
        <input
          type="text"
          aria-label={t("todo.editAction")}
          className="input input-sm w-full"
          defaultValue={item.content}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={commitEdit}
          onBlur={() => setEditing(false)}
        />
      ) : (
        <>
          {/* 正文可点进编辑(title 提示);完成行降档 + 划线(TaskPanel 完成项同款) */}
          <button
            type="button"
            title={t("todo.editHint")}
            className={`min-w-0 flex-1 cursor-text truncate text-left text-sm leading-6 ${done ? "line-through opacity-50" : ""}`}
            onClick={() => setEditing(true)}
          >
            {item.content}
          </button>
          {/* 派发钮:核心动作给悬停显形的可见入口(常驻占位只切可见性,§6.2
              铁律);已派发/已完成的行改出关联任务状态章 */}
          {!item.dispatched_kind && !done && (
            <button
              type="button"
              className="btn btn-ghost btn-xs invisible shrink-0 gap-1 text-primary group-focus-within:visible group-hover:visible"
              onClick={() => onDispatch(item)}
            >
              <IconSend size={12} stroke={1.75} aria-hidden />
              {t("todo.dispatch")}
            </button>
          )}
          {item.dispatched_kind && (
            <button
              type="button"
              className="btn btn-ghost btn-xs shrink-0 gap-1.5 font-normal text-base-content/60"
              title={cloud ? t("todo.openCloud") : meta ? t("todo.openTask") : t("todo.linkGone")}
              disabled={!cloud && !meta}
              onClick={() => (cloud ? onOpenCloud() : meta && onOpenSession(meta.id))}
            >
              {cloud ? (
                <IconCloud size={12} stroke={1.75} aria-hidden />
              ) : (
                meta && <span aria-hidden className={`status ${linkTone(meta)}`} />
              )}
              {linkWord}
            </button>
          )}
        </>
      )}
    </li>
  );
}

export function TodoView({
  todos,
  sessions,
  ops,
  onDispatch,
  onOpenSession,
  onOpenCloud,
  onClose,
}: {
  todos: TodoItem[];
  /** 壳会话表(App 同一份):派发后的行尾状态词从这里回查 */
  sessions: SessionMeta[];
  ops: Pick<TodoOps, "add" | "edit" | "toggle" | "remove">;
  /** 派发成任务:App 打开新建任务视图并预填正文(带 todoId 回链) */
  onDispatch: (item: TodoItem) => void;
  onOpenSession: (id: string) => void;
  onOpenCloud: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const open = todos.filter((item) => item.status !== "done");
  const finished = todos.filter((item) => item.status === "done");

  // 视图级 Esc 走 escLayer 层栈(NewTaskModal 同款):输入态只收敛焦点,
  // 不拿一下 Esc 把整页关掉;handler 引用经 ref 稳定,不把本层顶到栈顶
  const escRef = useRef<() => boolean>(() => false);
  escRef.current = () => {
    const el = document.activeElement;
    if (
      el instanceof HTMLElement &&
      resolveShortcut({ key: "Escape", targetTag: el.tagName, openPermId: null }).kind === "blur"
    ) {
      el.blur();
      return true;
    }
    onClose();
    return true;
  };
  useEscLayer(true, useCallback(() => escRef.current(), []));

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    ops.add(content);
    setDraft("");
  };

  const rowProps = { sessions, ops, onDispatch, onOpenSession, onOpenCloud };
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-base-100 [scrollbar-gutter:stable]">
      <header data-view-header="" data-tauri-drag-region="" className="flex h-13 shrink-0 items-center gap-2 border-b border-base-300 px-4">
        <h1 data-tauri-drag-region="" className="min-w-0 flex-1 truncate text-sm font-semibold">
          {t("rail.todo")}
        </h1>
        <button type="button" aria-label={t("todo.close")} className="btn btn-ghost btn-square btn-sm" onClick={onClose}>
          <IconX size={16} stroke={1.75} aria-hidden />
        </button>
      </header>
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="input w-full"
            aria-label={t("todo.add")}
            placeholder={t("todo.addPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              submit();
            }}
          />
          <button type="button" className="btn btn-primary shrink-0" disabled={!draft.trim()} onClick={submit}>
            {t("todo.add")}
          </button>
        </div>
        {todos.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-3 py-16 text-center">
            <IconChecklist size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
            <div className="text-sm font-semibold">{t("todo.empty.title")}</div>
            <div className="max-w-sm text-xs leading-relaxed text-base-content/60">{t("todo.empty.detail")}</div>
          </div>
        ) : (
          <ul className="mt-4 flex flex-col" aria-label={t("rail.todo")}>
            {open.map((item) => (
              <TodoRow key={item.id} item={item} {...rowProps} />
            ))}
            {finished.length > 0 && (
              <>
                <li aria-hidden className="mt-3 mb-1 px-2 text-xs text-base-content/40">
                  {t("todo.doneSection", { n: String(finished.length) })}
                </li>
                {finished.map((item) => (
                  <TodoRow key={item.id} item={item} {...rowProps} />
                ))}
              </>
            )}
          </ul>
        )}
      </div>
    </main>
  );
}
