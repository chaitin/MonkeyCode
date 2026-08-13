// 侧栏「待办」组(本地任务空间列表顶部;Sidebar 拼装,本模块自治)。
// 形态演进都有用户定案背书,别回退:主区独立页三版(rail 开关/侧栏入口行/
// 覆盖视图)已废 → 清单本体进侧栏(2026-08-12);行首勾选件两版(checkbox-xs/
// 14px 圆圈钮)已废,完成走右键(2026-08-12);行内编辑已废,**点行开详情
// 弹窗**(2026-08-13 用户定案:「点击就是修改」不合直觉,弹窗正好收编图片
// 的展示与管理,右键的「添加图片/查看图片」两项随之退役)。
// 组内:hover「+」行内添加(Enter 连续记,粘贴截图随 Enter 挂上);未完成
// 段 HTML5 拖拽排序(项目组同款,2026-08-13 用户要求);「已完成」小节折叠;
// 行 = 纯文字安静行 + 行尾图片角标(被动指示)+ 要紧态状态点。
import { IconChecklist, IconCircleCheck, IconPhoto, IconPlus, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import { Lightbox, UploadImg } from "@/components/media/UploadImg";
import { GroupLabel, levelPad, NEST_NO_GUIDE, StatusDot } from "@/features/sidebar/listKit";
import { rowStatusLabel, rowTrailing } from "@/features/sidebar/sessionStatus";
import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { useI18n } from "@/lib/i18n";
import type { SessionMeta } from "@/lib/ipc/sessions";
import { todoUploadURL, type TodoItem } from "@/lib/ipc/todos";
import { pickImageFiles } from "@/lib/ipc/uploads";
import { pushEscLayer } from "@/lib/util/escLayer";
import { readFold, writeFold } from "@/lib/util/prefs";
import type { TodoOps } from "./useTodos";

/** 待办组的接线(App 提供):清单数据 + 变更 ops + 派发/跳转出口。 */
export interface TodoWiring {
  todos: TodoItem[];
  ops: Pick<TodoOps, "add" | "edit" | "toggle" | "remove" | "reorder" | "addImages" | "removeImage">;
  /** 派发成任务:App 打开新建任务视图并预填正文与图片(带 todoId 回链) */
  onDispatch: (item: TodoItem) => void;
  onOpenSession: (id: string) => void;
  onOpenCloud: () => void;
}

/** 待办组在 mc.collapsedGroups 里的注册 key(\0 哨兵,不会与目录路径相撞;
 * 沿用项目组的「默认展开」语义与持久化管道)。 */
export const TODO_GROUP_KEY = "\0todos";

/** 拖拽「移到末尾」的落区标记(条目 id 是 UUID,不会相撞)。 */
const END_DROP = "\0end";

/** 剪贴板 file item 里的图片(截图粘贴;非图文件不收——待办附件只收图)。 */
function imageFilesOfPaste(e: ClipboardEvent<HTMLElement>): File[] {
  return [...(e.clipboardData?.items ?? [])]
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
}

/** 关联任务去向词:云端 = 「云端」;活体会话 = 状态词;链子挂空 = 说明。 */
function linkWordOf(item: TodoItem, meta: SessionMeta | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (item.dispatched_kind === "cloud") return t("cloud.view.badge");
  if (meta) return rowStatusLabel(meta, t);
  return item.dispatched_kind ? t("todo.linkGone") : "";
}

/** 待办行(组内 L1;完成行在「已完成」小节 L2):纯文字安静行 + 行尾图片
 * 角标(被动指示,数量进 tooltip)与要紧态状态点(派发去向回查会话表)。
 * 点行 = 开详情弹窗(编辑/图片/派发/跳转都在弹窗里);右键 = 完成/派发/
 * 打开关联/删除(二段)。未完成段的行可拖拽排序(落点线绝对定位不挤布局)。 */
function TodoRow({
  item,
  todo,
  sessions,
  level = 1,
  onOpenDetail,
  drag,
  dropTarget,
}: {
  item: TodoItem;
  todo: TodoWiring;
  sessions: SessionMeta[];
  level?: number;
  onOpenDetail: () => void;
  /** 仅未完成段的行给(完成段固定沉底,不参与排序) */
  drag?: {
    onDragStart: (id: string) => void;
    onDragOver: (id: string) => void;
    onDragEnd: () => void;
    onDropBefore: (before: string | null) => void;
  };
  dropTarget?: boolean;
}) {
  const { t } = useI18n();
  const done = item.status === "done";
  const cloud = item.dispatched_kind === "cloud";
  // 本地/会话去向:从壳的会话表回查活体(期间被删则 meta 缺席,链子挂空)
  const meta =
    item.dispatched_kind && !cloud ? sessions.find((s) => s.id === item.dispatched_id) : undefined;
  const trailing = meta ? rowTrailing(meta, t, false) : null;
  const jump = cloud ? todo.onOpenCloud : meta ? () => todo.onOpenSession(meta.id) : undefined;
  const images = item.images ?? [];
  const menuItems: MenuItem[] = [
    { label: done ? t("todo.markUndone") : t("todo.markDone"), run: () => todo.ops.toggle(item.id) },
    ...(!item.dispatched_kind && !done
      ? [{ label: t("todo.dispatch"), run: () => todo.onDispatch(item) }]
      : []),
    ...(jump ? [{ label: cloud ? t("todo.openCloud") : t("todo.openTask"), run: jump }] : []),
    { label: t("todo.delete"), confirm: t("todo.deleteConfirm"), danger: true, run: () => todo.ops.remove(item.id) },
  ];
  const tooltip = [
    item.content,
    linkWordOf(item, meta, t),
    images.length ? t("todo.imageCount", { n: String(images.length) }) : "",
    t("sidebar.row.hint"),
    drag ? t("todo.dragHint") : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li
      className="relative"
      onDragOver={(e: DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDragOver(item.id);
      }}
      onDrop={(e: DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDropBefore(item.id);
      }}
    >
      <a
        className={`flex min-w-0 items-center gap-2 ${levelPad(level)}`}
        title={tooltip}
        draggable={!!drag}
        onDragStart={() => drag?.onDragStart(item.id)}
        onDragEnd={() => drag?.onDragEnd()}
        onClick={onOpenDetail}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu({ x: e.clientX, y: e.clientY }, menuItems);
        }}
      >
        {/* 落点指示线绝对定位(border 参与布局会把行顶下去 2px,项目组同注) */}
        {dropTarget && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />}
        <span className={`min-w-0 flex-1 truncate ${done ? "text-base-content/55 line-through" : ""}`}>
          {item.content}
        </span>
        {/* 图片角标:被动指示(点行即开弹窗看图,不再单设入口);数量进 tooltip */}
        {images.length > 0 && (
          <IconPhoto size={13} stroke={1.75} aria-hidden className="shrink-0 text-base-content/40" />
        )}
        {trailing && <StatusDot {...trailing} />}
      </a>
    </li>
  );
}

/** 待办详情弹窗(点行打开):正文编辑(Enter/失焦提交)+ 图片管理(网格
 * 缩略图、悬停 × 移除、点图 Lightbox 放大、「添加图片」选图、弹窗内粘贴
 * 截图直接挂)+ 底部动作(已派发出状态章点击跳转;未派发未完成给「派发
 * 成任务」,派发即关弹窗)。Esc 经 escLayer 层栈:放大层后开后入,先关图
 * 再轮到弹窗(Lightbox 同款纪律)。 */
function TodoDetailModal({
  item,
  todo,
  sessions,
  onClose,
}: {
  item: TodoItem;
  todo: TodoWiring;
  sessions: SessionMeta[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState<string | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  useEffect(() => {
    return pushEscLayer(() => {
      onClose();
      return true;
    });
    // onClose 由调用方保证稳定(setState);挂载期一次入栈即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const done = item.status === "done";
  const cloud = item.dispatched_kind === "cloud";
  const meta =
    item.dispatched_kind && !cloud ? sessions.find((s) => s.id === item.dispatched_id) : undefined;
  const trailing = meta ? rowTrailing(meta, t, false) : null;
  const jump = cloud ? todo.onOpenCloud : meta ? () => todo.onOpenSession(meta.id) : undefined;
  const linkWord = linkWordOf(item, meta, t);
  const images = item.images ?? [];
  const commit = (value: string) => {
    const content = value.trim();
    if (content && content !== item.content) todo.ops.edit(item.id, content);
  };
  return (
    <>
      <div className="modal modal-open" role="dialog" aria-label={t("todo.detail")}>
        <div
          className="modal-box flex w-md max-w-[92vw] flex-col gap-3 p-4"
          // 弹窗任意处粘贴截图 = 直接挂到本条(上传编排在 useTodos,成败外显)
          onPaste={(e) => {
            const files = imageFilesOfPaste(e);
            if (!files.length) return;
            e.preventDefault();
            todo.ops.addImages(item.id, files);
          }}
        >
          {/* autoFocus 不可省:粘贴事件只送达焦点所在处,弹窗开着而焦点还留
              在列表上时,截图根本贴不进来(2026-08-13 用户报障)。只聚焦不
              全选——开弹窗常为看图/贴图,全选会让误触键一键吞掉整句正文 */}
          <input
            type="text"
            aria-label={t("todo.editAction")}
            className="input input-sm w-full"
            defaultValue={item.content}
            autoFocus
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.nativeEvent.isComposing) return; // IME 组字回车不提交
              if (e.key !== "Enter") return;
              commit(e.currentTarget.value);
              e.currentTarget.blur();
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
          />
          {/* 图片网格:缩略图取聊天气泡同款原比例限高;× 悬停显形(绝对定位
              不挤布局);尾随一颗「添加图片」入口钮 */}
          <div className="flex flex-wrap items-start gap-2">
            {images.map((name) => (
              <div key={name} className="group relative">
                <UploadImg
                  load={() => todoUploadURL(name)}
                  alt={name}
                  title={name}
                  className="block max-h-28 max-w-36 cursor-zoom-in rounded-box border border-base-300"
                  onClick={() => setZoom(name)}
                />
                <button
                  type="button"
                  aria-label={t("todo.imageRemove", { name })}
                  className="btn btn-circle btn-xs absolute -end-1.5 -top-1.5 size-4.5 min-h-0 border-base-300 bg-base-100 p-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => todo.ops.removeImage(item.id, name)}
                >
                  <IconX size={10} stroke={2} aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1.5 border border-dashed border-base-300 text-base-content/60"
              onClick={() => void pickImageFiles(t("todo.attach")).then((files) => files.length && todo.ops.addImages(item.id, files))}
            >
              <IconPhoto size={14} stroke={1.75} aria-hidden />
              {t("todo.attach")}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* 已派发:状态章(soft 徽标 + 活态点)点击跳关联任务;链子挂空给说明 */}
            {item.dispatched_kind &&
              (jump ? (
                <button type="button" className="badge badge-ghost badge-sm cursor-pointer gap-1.5" onClick={jump}>
                  {trailing && <StatusDot {...trailing} />}
                  {linkWord}
                </button>
              ) : (
                <span className="badge badge-ghost badge-sm text-base-content/40">{linkWord}</span>
              ))}
            <span className="flex-1" />
            {!item.dispatched_kind && !done && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  onClose(); // 派发开新建任务视图,弹窗使命已尽
                  todo.onDispatch(item);
                }}
              >
                {t("todo.dispatch")}
              </button>
            )}
          </div>
        </div>
        <div className="modal-backdrop cursor-pointer" onClick={onClose} aria-hidden />
      </div>
      {zoom && (
        <Lightbox alt={zoom} onClose={closeZoom}>
          <UploadImg load={() => todoUploadURL(zoom)} alt={zoom} className="max-h-[80vh] max-w-full rounded-box object-contain" />
        </Lightbox>
      )}
    </>
  );
}

/** 待办组本体(details 区块标签,项目组同款;折叠由 Sidebar 经
 * mc.collapsedGroups 哨兵 key 托管)。 */
export function TodoSection({
  todo,
  sessions,
  collapsed,
  onToggleCollapsed,
}: {
  todo: TodoWiring;
  sessions: SessionMeta[];
  collapsed: boolean;
  onToggleCollapsed: (key: string, open: boolean) => void;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  // 添加行粘贴的截图暂存(随 Enter 一并挂上;收起输入即弃):不出预览 chips
  // ——侧栏行宽摆不下,给一句「已附 N 张图」的文字回执就够
  const [staged, setStaged] = useState<File[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const closeDetail = useCallback(() => setDetailId(null), []);
  const [doneOpen, setDoneOpen] = useState<boolean>(() => readFold("mc.todoDoneOpen"));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const pending = todo.todos.filter((i) => i.status !== "done");
  const finished = todo.todos.filter((i) => i.status === "done");
  // 条目被删(右键删除)时弹窗随条目消失(条件渲染兜底)
  const detail = todo.todos.find((i) => i.id === detailId);

  const pendingIds = pending.map((i) => i.id);
  /** 落点是否**真的会改变顺序**(不会就不画线、不落盘;项目组同一套判定)。 */
  const willMove = (before: string | null): boolean => {
    if (!draggedId || draggedId === before) return false;
    const at = pendingIds.indexOf(draggedId);
    if (at < 0) return false;
    if (before === null) return at !== pendingIds.length - 1;
    return pendingIds[at + 1] !== before;
  };
  const drag = {
    onDragStart: (id: string) => setDraggedId(id),
    onDragOver: (id: string) => setDragOverId((prev) => (prev === id ? prev : id)),
    onDragEnd: () => {
      setDraggedId(null);
      setDragOverId(null);
    },
    onDropBefore: (before: string | null) => {
      setDragOverId(null);
      if (!draggedId || !willMove(before)) return;
      todo.ops.reorder(draggedId, before);
      setDraggedId(null);
    },
  };

  const row = (item: TodoItem, level: number) => (
    <TodoRow
      key={item.id}
      item={item}
      todo={todo}
      sessions={sessions}
      level={level}
      onOpenDetail={() => setDetailId(item.id)}
      drag={level === 1 ? drag : undefined}
      dropTarget={level === 1 && dragOverId === item.id && willMove(item.id)}
    />
  );
  return (
    <li>
      <details
        open={!collapsed}
        onToggle={(e) => {
          if (e.target !== e.currentTarget) return; // toggle 合成冒泡守卫
          onToggleCollapsed(TODO_GROUP_KEY, e.currentTarget.open);
        }}
      >
        <summary className="group relative flex items-center after:hidden" title={t("rail.todo")}>
          <GroupLabel icon={IconChecklist} name={t("rail.todo")} />
          {/* 快捷添加:常驻占位 hover 显形(项目组头「+」同款,§6.2 铁律);
              组收着时先展开再开输入,不然输入行加在看不见的地方 */}
          <button
            type="button"
            aria-label={t("todo.add")}
            title={t("todo.add")}
            className="btn btn-ghost btn-square btn-xs invisible group-hover:visible group-focus-within:visible"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (collapsed) onToggleCollapsed(TODO_GROUP_KEY, true);
              setAdding(true);
            }}
          >
            <IconPlus size={14} stroke={1.75} aria-hidden />
          </button>
        </summary>
        {/* 收起即卸载(details 残留占位的 webview 坑,§6.2) */}
        {!collapsed && (
          <ul className={`ms-0 min-w-0 ps-0 pb-1.5 ${NEST_NO_GUIDE}`}>
            {adding && (
              <li className="flex-col items-stretch">
                <div className={`min-h-8 p-1 ${levelPad(1)}`}>
                  <input
                    type="text"
                    aria-label={t("todo.add")}
                    placeholder={t("todo.addPlaceholder")}
                    className="input input-xs w-full"
                    autoFocus
                    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Escape") return setAdding(false);
                      if (e.key !== "Enter") return;
                      const content = e.currentTarget.value.trim();
                      if (content) {
                        todo.ops.add(content, staged.length ? staged : undefined);
                        setStaged([]); // 暂存图归第一条,连着记的后续条目不重复挂
                      }
                      e.currentTarget.value = ""; // 连着记几条不用重开输入
                    }}
                    // 粘贴截图 = 暂存,随 Enter 挂上这条新待办
                    onPaste={(e) => {
                      const files = imageFilesOfPaste(e);
                      if (!files.length) return;
                      e.preventDefault();
                      setStaged((prev) => [...prev, ...files]);
                    }}
                    onBlur={() => {
                      setAdding(false);
                      setStaged([]); // 收起输入即弃(还没上传,无孤儿文件)
                    }}
                  />
                </div>
                {/* pointer-events-none:menu 会给 li 的直接子节点补悬停底,
                    一句静态回执不该有悬停态 */}
                {staged.length > 0 && (
                  <div className={`${levelPad(1)} pointer-events-none pb-1 text-xs text-base-content/40`}>
                    {t("todo.stagedHint", { n: String(staged.length) })}
                  </div>
                )}
              </li>
            )}
            {pending.map((i) => row(i, 1))}
            {/* 收尾落区:拖拽中才出现的一条 12px 空行——没有它排不到末位
                (每行表达的都是「放到我之前」,项目组同注) */}
            {draggedId && pending.length > 0 && (
              <li
                aria-hidden
                className="relative"
                onDragOver={(e: DragEvent) => {
                  e.preventDefault();
                  setDragOverId(END_DROP);
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault();
                  drag.onDropBefore(null);
                }}
              >
                <div className="pointer-events-none h-3 p-0">
                  {dragOverId === END_DROP && willMove(null) && (
                    <span className="absolute inset-x-0 top-1 h-0.5 bg-primary" />
                  )}
                </div>
              </li>
            )}
            {/* 空组给一句轻引导(menu-disabled 官方禁用形态,不吃点击) */}
            {pending.length === 0 && !adding && (
              <li className="menu-disabled">
                <span className={`${levelPad(1)} text-xs`}>{t("todo.empty.title")}</span>
              </li>
            )}
            {finished.length > 0 && (
              <li>
                <details
                  open={doneOpen}
                  onToggle={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const next = e.currentTarget.open;
                    if (next === doneOpen) return;
                    setDoneOpen(next);
                    writeFold("mc.todoDoneOpen", next);
                  }}
                >
                  {/* Archive 小节同构:10px 图标行首、去尾箭头、标签不带计数 */}
                  <summary className="flex items-center gap-2 ps-6 text-xs text-base-content/40 after:hidden">
                    <IconCircleCheck size={10} stroke={1.75} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t("todo.done")}</span>
                  </summary>
                  {doneOpen && (
                    <ul className={`ms-0 min-w-0 ps-0 pb-1 ${NEST_NO_GUIDE}`}>
                      {finished.map((i) => row(i, 2))}
                    </ul>
                  )}
                </details>
              </li>
            )}
          </ul>
        )}
      </details>
      {/* portal 到 body:.menu 的行样式选择器命中 li 的**直接子节点**
          (padding/悬停底),modal 留在组里整层覆盖会被当菜单行染色;
          fixed 定位不依赖 DOM 位置,--chrome-h 顶偏移取根级变量不受影响 */}
      {detail &&
        createPortal(
          <TodoDetailModal item={detail} todo={todo} sessions={sessions} onClose={closeDetail} />,
          document.body,
        )}
    </li>
  );
}
