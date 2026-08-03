// 双层侧栏:窄主导航负责空间切换，内容栏只展示当前空间的数据。
// 一级空间保持稳定(云端 / 本地 / 对话)，项目、任务、会话属于二级内容；
// 这比把所有对象塞进一条长列表更利于检索，也给后续空间扩展留出位置。
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ConfirmPane, DeleteMenuItem, useRenameDraft, type MenuState } from "./components";
import {
  IconArchive,
  IconChat,
  IconChevronRight,
  IconCloud,
  IconFolder,
  IconGear,
  IconMonitor,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStop,
  IconX,
} from "./icons";
import { engineCardView, railDotView } from "./engineBanner";
import { isWindowsShell } from "./host";
import logoUrl from "./logo.png";
import { isProjectArchived, projectArchiveKey } from "./projectArchive";
import { applyProjectOrder, persistProjectOrder, readProjectOrder, reorderProjects } from "./projectOrder";
import { MacBrandBand, MacWindowControls } from "./titlebar";
import type { CloudProject, CloudProjectTasks, CloudTask, EngineStatus, McConnectionState, SessionMeta } from "./types";

export interface ProjectGroup {
  dir: string;
  name: string;
  latest: string;
  items: SessionMeta[];
}

/** 本地会话按项目目录分组；普通对话在调用方提前过滤，不进入项目树。 */
export function groupByProject(sessions: SessionMeta[]): ProjectGroup[] {
  const map = new Map<string, SessionMeta[]>();
  for (const m of sessions) {
    const list = map.get(m.workdir);
    if (list) list.push(m);
    else map.set(m.workdir, [m]);
  }
  const groups = [...map.entries()].map(([dir, items]) => {
    items.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
    return {
      dir,
      name: dir.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() || dir,
      latest: String(items[0]?.updated_at ?? ""),
      items,
    };
  });
  groups.sort((a, b) => b.latest.localeCompare(a.latest));
  return groups;
}

function readStoredSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

function storeSet(key: string, value: ReadonlySet<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // 偏好写盘失败不应阻断侧栏的本次展开/收起。
  }
}

export type SidebarSpace = "cloud" | "local" | "chat";

/** 云端任务保留相对时间；会话行只展示状态和轮次，不消费这个字段。 */
export function relativeTime(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "";
  const raw = typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return "";
  const delta = Math.max(0, Date.now() - time);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)} 天前`;
  const d = new Date(time);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

const CLOUD_STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: "排队中", color: "var(--warn)" },
  processing: { text: "运行中", color: "var(--accTx)" },
  error: { text: "运行出错", color: "var(--err)" },
  finished: { text: "已完成", color: "var(--t4)" },
};

function rowStatus(meta: SessionMeta): { text: string; color: string } {
  if (meta.waiting_ask) return { text: "等待确认", color: "var(--warn)" };
  switch (meta.status) {
    case "running":
      return { text: "运行中", color: "var(--accTx)" };
    case "error":
      return { text: "运行出错", color: "var(--err)" };
    case "interrupted":
      return { text: "已停止", color: "var(--t4)" };
    case "idle":
    case "finished":
      // finished 是旧版顶层会话的一轮结束状态；新版壳会返回 idle。
      return { text: "可继续", color: "var(--t4)" };
    default:
      return meta.turns > 0
        ? { text: "可继续", color: "var(--t4)" }
        : { text: "尚未开始", color: "var(--t5)" };
  }
}

/** turns 是已发起的用户轮次数；异常历史值不应污染侧栏。 */
export function turnCountLabel(value?: number): string {
  if (!Number.isFinite(value) || Number(value) <= 0) return "";
  return `${Math.trunc(Number(value))} 轮`;
}

function SessionRow({
  meta,
  active,
  attention,
  archived,
  depth = 0,
  onClick,
  onArchive,
  onDelete,
  onRename,
}: {
  meta: SessionMeta;
  active: boolean;
  attention: boolean;
  archived: boolean;
  depth?: number;
  onClick: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [menu, setMenu] = useState<MenuState>("closed");
  const rename = useRenameDraft(meta.title || "", onRename);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const st = rowStatus(meta);
  const title = meta.title || (meta.kind === "chat" ? "新会话" : "新任务");
  // 对话(chat)行单行化:有摘要用摘要作主行(摘要随对话演进,比首条消息
  // 凝出的标题更达意),缺席回落标题;本地项目行保持 标题+摘要 两行式。
  const isChat = meta.kind === "chat";
  const primary = isChat && meta.summary ? meta.summary : title;
  const turns = turnCountLabel(meta.turns);
  const emphasizeState = !!meta.waiting_ask || meta.status === "running" || meta.status === "error";
  const showState = emphasizeState || meta.status === "interrupted";
  const trailing = showState ? st.text : turns || st.text;
  const trailingColor = archived
    ? "var(--t5)"
    : showState
      ? st.color
      : active ? "var(--accSelDim)" : "var(--t5)";

  const closeMenu = () => setMenu("closed");
  const openMenuAt = (clientX: number, clientY: number) => {
    const left = Math.max(8, Math.min(clientX, window.innerWidth - 146));
    const openUp = clientY + 166 > window.innerHeight;
    setPos({
      left,
      ...(openUp ? { bottom: Math.max(8, window.innerHeight - clientY + 4) } : { top: clientY + 4 }),
    });
    setMenu("open");
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        className={active ? undefined : "hv"}
        title={`${title}\n${meta.summary ? `${meta.summary}\n` : ""}${meta.kind === "chat" ? "独立会话" : meta.workdir}\n右键管理`}
        onClick={onClick}
        onContextMenu={(e) => {
          if (rename.editing) return;
          e.preventDefault();
          e.stopPropagation();
          openMenuAt(e.clientX, e.clientY);
        }}
        style={{
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          gap: 7,
          // 纵向内边距只在长出摘要行(两行)时起作用:单行内容 17px,离
          // minHeight 34 还远,居中布局不受影响,几何与单行时代逐像素一致
          padding: `5px 8px 5px ${11 + Math.max(0, depth) * 14}px`,
          borderRadius: 7,
          cursor: "pointer",
          background: active ? (archived ? "var(--hov2)" : "var(--accSel)") : "transparent",
          color: "var(--t2)",
          minWidth: 0,
        }}
      >
        {rename.editing ? (
          <input
            {...rename.inputProps}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              minWidth: 0,
              height: 24,
              border: "1px solid var(--accBd)",
              borderRadius: 5,
              padding: "2px 6px",
              fontSize: 12.5,
              background: "var(--card)",
              color: "var(--t1)",
              outline: "none",
            }}
          />
        ) : (
          // 本地项目行两行式:标题行(标题 + 状态尾注)+ 摘要行(引擎每轮
          // 生成,随对话演进改写),摘要缺席(旧会话/首轮未回/引擎过旧)不长
          // 第二行;对话行恒单行(主行=摘要或标题),密度与云端任务行一致
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <span className="ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, fontWeight: 400, color: active ? "var(--t1)" : archived ? "var(--t4)" : "var(--t2)" }}>
                {primary}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: "none" }}>
                {(attention || emphasizeState) && (
                  <span
                    title={attention ? (meta.status === "error" ? "后台运行出错" : "有新进展") : undefined}
                    style={{
                      width: attention ? 7 : 6,
                      height: attention ? 7 : 6,
                      borderRadius: "50%",
                      background: attention ? (meta.status === "error" ? "var(--err)" : "var(--acc)") : st.color,
                      boxShadow: attention
                        ? `0 0 0 2px ${meta.status === "error" ? "var(--errBg)" : "var(--accBg)"}`
                        : "none",
                      flex: "none",
                    }}
                  />
                )}
                <span className="ellipsis" style={{ maxWidth: 60, color: trailingColor, fontSize: 10.5, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" }}>
                  {trailing}
                </span>
              </span>
            </div>
            {!isChat && meta.summary && (
              <span className="ellipsis" style={{ fontSize: 11, lineHeight: 1.3, color: archived ? "var(--t6)" : active ? "var(--t4)" : "var(--t5)" }}>
                {meta.summary}
              </span>
            )}
          </div>
        )}
      </div>

      {menu !== "closed" && (
        <>
          <div className="backdrop" onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div className="pop" style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: 122 }} onClick={(e) => e.stopPropagation()}>
            {menu === "open" ? (
              <>
                <button className="hv menu-item" onClick={() => { closeMenu(); rename.start(); }}>
                  <IconPencil />
                  重命名
                </button>
                <button className="hv menu-item" onClick={() => { closeMenu(); onArchive(); }}>
                  <IconArchive />
                  {meta.archived ? "取消归档" : "归档"}
                </button>
                <DeleteMenuItem running={meta.status === "running"} onDelete={() => setMenu("confirm")} />
              </>
            ) : (
              <ConfirmPane
                message="删除后不可恢复。"
                confirmLabel="确认删除"
                onConfirm={() => { closeMenu(); onDelete(); }}
                onCancel={closeMenu}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 拖动排序的接线:手势与落点计算都在 Sidebar，这里只转发事件和画状态。 */
export interface ProjectDrag {
  dir: string;
  active: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  };
}

function ProjectGroup({
  name,
  detail,
  project = false,
  projectArchived = false,
  depth = 0,
  expanded,
  muted,
  drag,
  onToggle,
  onNewTask,
  onProjectArchive,
  children,
}: {
  name: string;
  detail?: string;
  project?: boolean;
  projectArchived?: boolean;
  depth?: number;
  expanded: boolean;
  muted?: boolean;
  drag?: ProjectDrag;
  onToggle: () => void;
  onNewTask?: () => void;
  onProjectArchive?: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const openMenuAt = (clientX: number, clientY: number) => {
    const left = Math.max(8, Math.min(clientX, window.innerWidth - 166));
    const openUp = clientY + 106 > window.innerHeight;
    setPos({
      left,
      ...(openUp ? { bottom: Math.max(8, window.innerHeight - clientY + 4) } : { top: clientY + 4 }),
    });
    setMenuOpen(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div
        className="hv project-row"
        title={[detail, project && onProjectArchive ? "右键管理项目" : "", drag ? "拖动可调整项目顺序" : ""].filter(Boolean).join("\n") || undefined}
        aria-expanded={expanded}
        data-project-dir={drag?.dir}
        onClick={onToggle}
        onContextMenu={project && onProjectArchive ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenuAt(e.clientX, e.clientY);
        } : undefined}
        {...drag?.handlers}
        style={{
          minHeight: 34,
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: `0 5px 0 ${7 + Math.max(0, depth) * 14}px`,
          borderRadius: 8,
          cursor: drag?.active ? "grabbing" : "pointer",
          userSelect: "none",
          // WKWebView 到 Safari 17.4 才认无前缀 user-select,mac 上少了这行
          // 整条规则就是空的——项目名会被拖选中。参照 .mc-preview-line::before
          // (styles.css)两个都写:那是本仓库唯一被真拖选过、因此踩到过的地方。
          WebkitUserSelect: "none",
          // 拖动中原地留一个淡影，跟落点指示线一起交代"从哪来、到哪去"
          opacity: drag?.active ? 0.45 : undefined,
          // 触屏/触控板上按住不放要走拖动，不能被浏览器的滚动手势吃掉
          touchAction: drag ? "none" : undefined,
          fontWeight: project ? 600 : 550,
          fontSize: project ? 12.5 : 11.5,
          color: muted ? "var(--t5)" : projectArchived ? "var(--t3)" : "var(--t1)",
        }}
      >
        {(drag?.dropBefore || drag?.dropAfter) && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 6,
              right: 6,
              ...(drag.dropBefore ? { top: -2 } : { bottom: -2 }),
              height: 2,
              borderRadius: 1,
              background: "var(--acc)",
              pointerEvents: "none",
            }}
          />
        )}
        <span style={{ width: 13, height: 13, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {project ? (
            <IconFolder size={13} color={muted || projectArchived ? "var(--t5)" : "var(--t3)"} />
          ) : (
            <IconChevronRight size={9} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s ease" }} />
          )}
        </span>
        <span className="ellipsis" style={{ flex: 1 }}>{name}</span>
        {onNewTask && (
          <button
            className="hv3 icon-btn project-quick-add"
            title="在此项目新建任务"
            aria-label={`在 ${name} 中新建任务`}
            onClick={(e) => { e.stopPropagation(); onNewTask(); }}
            style={{
              position: "absolute",
              right: 4,
              top: 6,
              width: 22,
              height: 22,
              border: "none",
              borderRadius: 6,
              background: "transparent",
              boxShadow: "none",
            }}
          >
            <IconPlus size={10} color="var(--t3)" />
          </button>
        )}
      </div>
      {expanded && <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: depth > 0 ? 4 : 6 }}>{children}</div>}

      {menuOpen && onProjectArchive && (
        <>
          <div className="backdrop" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
          <div className="pop" style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: 148 }} onClick={(e) => e.stopPropagation()}>
            {onNewTask && (
              <button className="hv menu-item" onClick={() => { setMenuOpen(false); onNewTask(); }}>
                <IconPlus size={12} />
                在此新建任务
              </button>
            )}
            <button className="hv menu-item" onClick={() => { setMenuOpen(false); onProjectArchive(); }}>
              <IconArchive />
              {projectArchived ? "恢复项目" : "归档项目"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CloudTaskRow({
  task,
  active,
  depth = 0,
  onClick,
  onStop,
  onDelete,
}: {
  task: CloudTask;
  active: boolean;
  depth?: number;
  onClick: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const [menu, setMenu] = useState<MenuState>("closed");
  const [confirmAction, setConfirmAction] = useState<"stop" | "delete">("delete");
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const label = task.title || task.summary || task.content || "云端任务";
  const st = CLOUD_STATUS[task.status ?? ""] ?? { text: "云端任务", color: "var(--t5)" };
  const running = task.status === "pending" || task.status === "processing";
  const emphasizeState = running || task.status === "error";
  const openMenuAt = (clientX: number, clientY: number) => {
    const left = Math.max(8, Math.min(clientX, window.innerWidth - 166));
    const openUp = clientY + 150 > window.innerHeight;
    setPos({
      left,
      ...(openUp ? { bottom: Math.max(8, window.innerHeight - clientY + 4) } : { top: clientY + 4 }),
    });
    setMenu("open");
  };
  const closeMenu = () => setMenu("closed");
  return (
    <div style={{ position: "relative" }}>
      <div
        className={active ? undefined : "hv"}
        title={`${label}\n${st.text}\n右键管理`}
        onClick={onClick}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenuAt(event.clientX, event.clientY);
        }}
        style={{
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: `0 8px 0 ${11 + Math.max(0, depth) * 14}px`,
          borderRadius: 7,
          cursor: "pointer",
          background: active ? "var(--accSel)" : "transparent",
          color: "var(--t2)",
          minWidth: 0,
        }}
      >
        <span className="ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, fontWeight: 400, color: active ? "var(--t1)" : "var(--t2)" }}>
          {label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, flex: "none" }}>
          {emphasizeState && <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color, flex: "none" }} />}
          <span className="ellipsis" style={{ maxWidth: 60, color: active ? "var(--accSelDim)" : st.color, fontSize: 10.5, lineHeight: 1.2 }}>
            {st.text}
          </span>
        </span>
      </div>

      {menu !== "closed" && (
        <>
          <div className="backdrop" onClick={(event) => { event.stopPropagation(); closeMenu(); }} />
          <div className="pop" style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: 142 }} onClick={(event) => event.stopPropagation()}>
            {menu === "open" ? (
              <>
                {running && (
                  <button className="hv-errbg menu-item" style={{ color: "var(--err)" }} onClick={() => { setConfirmAction("stop"); setMenu("confirm"); }}>
                    <IconStop size={10} color="var(--err)" />
                    终止任务
                  </button>
                )}
                <DeleteMenuItem running={running} label="删除任务" onDelete={() => { setConfirmAction("delete"); setMenu("confirm"); }} />
              </>
            ) : (
              <ConfirmPane
                message={confirmAction === "stop" ? "任务终止后无法恢复。" : "删除后不可恢复。"}
                confirmLabel={confirmAction === "stop" ? "确认终止" : "确认删除"}
                onConfirm={() => {
                  closeMenu();
                  if (confirmAction === "stop") onStop();
                  else onDelete();
                }}
                onCancel={closeMenu}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div style={{ margin: "20px 4px", padding: "18px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
      <span style={{ width: 36, height: 36, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--card)", border: "1px solid var(--line2)", boxShadow: "var(--cardSh)" }}>{icon}</span>
      <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--t3)" }}>{title}</span>
      <span style={{ maxWidth: 175, fontSize: 11, lineHeight: 1.6, color: "var(--t5)" }}>{detail}</span>
    </div>
  );
}

function SearchBox({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label style={{ height: 32, margin: "0 10px 9px", padding: "0 9px", display: "flex", alignItems: "center", gap: 7, border: "1px solid var(--line2)", borderRadius: 9, background: "var(--sidebarInput)", color: "var(--t5)" }}>
      <IconSearch size={12} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: "none", outline: "none", padding: 0, background: "transparent", color: "var(--t2)", fontSize: 11.5 }}
      />
      {value && (
        <button className="hv2 icon-btn" title="清除搜索" onClick={() => onChange("")} style={{ width: 18, height: 18, borderRadius: 5 }}>
          <IconX size={8} />
        </button>
      )}
    </label>
  );
}

function RailButton({
  active,
  label,
  badge,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  badge?: number;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? undefined : "hv"}
      title={`切换到${label}`}
      aria-pressed={active}
      onClick={onClick}
      style={{
        position: "relative",
        width: 48,
        minHeight: 48,
        border: "none",
        borderRadius: 12,
        background: active ? "var(--railSel)" : "transparent",
        color: active ? "var(--accSelT)" : "var(--t4)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        fontSize: 10,
        fontWeight: active ? 700 : 550,
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
      {!!badge && (
        <span style={{ position: "absolute", top: 5, right: 4, minWidth: 15, height: 15, padding: "0 4px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--acc)", color: "var(--onAcc)", border: "2px solid var(--rail)", fontSize: 8.5, fontWeight: 800 }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

function PanelHeader({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div style={{ height: 52, flex: "none", padding: "0 11px 0 13px", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 720, color: "var(--t1)" }}>{title}</span>
        <span className="ellipsis" style={{ fontSize: 10.5, color: "var(--t5)" }}>{detail}</span>
      </span>
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}

const headerAction: CSSProperties = {
  width: 26,
  height: 26,
  border: "none",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flex: "none",
};

export function Sidebar({
  sessions,
  archivedProjects,
  currentId,
  attention,
  sessionActive,
  connected,
  status,
  engine = null,
  engineBusy = false,
  onEngineRestart,
  onOpenLogDir,
  update,
  updateBusy,
  onUpdate,
  mcConnection,
  cloudTasks,
  cloudHistory = [],
  cloudProjects = [],
  cloudProjectTasks = {},
  onLoadCloudProjectTasks,
  activeCloudId,
  cloudSyncing,
  cloudError,
  onConnectCloud,
  onRefreshCloud,
  onNewCloudTask,
  onOpenCloudTask,
  onStopCloudTask = () => {},
  onDeleteCloudTask = () => {},
  onSelect,
  onNewTask,
  onProjectArchive,
  onNewChat,
  onOpenSettings,
  onArchive,
  onDelete,
  onRename,
}: {
  sessions: SessionMeta[];
  archivedProjects: ReadonlySet<string>;
  currentId: string | null;
  attention: Set<string>;
  sessionActive: boolean;
  connected: boolean;
  status: string;
  /** 引擎生命周期状态(契约 6);null = 快照未到,点回落会话连接语义 */
  engine?: EngineStatus | null;
  /** 壳正在重启引擎(横幅与卡共用同一个 restarting 态) */
  engineBusy?: boolean;
  onEngineRestart?: () => void;
  onOpenLogDir?: () => void;
  update?: { available: boolean; latest?: string } | null;
  updateBusy?: boolean;
  onUpdate?: () => void;
  mcConnection: McConnectionState;
  cloudTasks: CloudTask[];
  cloudHistory?: CloudTask[];
  cloudProjects?: CloudProject[];
  /** 项目 id → 展开时按需拉到的任务;缺省项 = 还没拉过 */
  cloudProjectTasks?: Record<string, CloudProjectTasks>;
  onLoadCloudProjectTasks?: (project: CloudProject) => void;
  activeCloudId?: string | null;
  cloudSyncing?: boolean;
  cloudError?: string;
  onConnectCloud: () => void;
  onRefreshCloud?: () => void;
  onNewCloudTask: (project?: CloudProject) => void;
  onOpenCloudTask: (task: CloudTask) => void;
  onStopCloudTask?: (task: CloudTask) => void;
  onDeleteCloudTask?: (task: CloudTask) => void;
  onSelect: (meta: SessionMeta) => void;
  onNewTask: (dir?: string) => void;
  onProjectArchive: (dir: string, archived: boolean) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onArchive: (meta: SessionMeta) => void;
  onDelete: (meta: SessionMeta) => void;
  onRename: (meta: SessionMeta, title: string) => void;
}) {
  const activeMeta = sessions.find((m) => m.id === currentId);
  const inferred: SidebarSpace = activeCloudId ? "cloud" : activeMeta?.kind === "chat" ? "chat" : "local";
  const [space, setSpace] = useState<SidebarSpace>(() => {
    const saved = localStorage.getItem("mc.sidebarSpace");
    return saved === "cloud" || saved === "chat" || saved === "local" ? saved : inferred;
  });
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readStoredSet("mc.collapsedGroups"));
  const [sessionArchivesOpen, setSessionArchivesOpen] = useState<Set<string>>(() => readStoredSet("mc.sessionArchivesOpen"));
  const [chatArchiveOpen, setChatArchiveOpen] = useState(() => localStorage.getItem("mc.archivedOpen") === "1");
  const [projectArchiveOpen, setProjectArchiveOpen] = useState(() => localStorage.getItem("mc.projectArchiveOpen") === "1");
  const [cloudHistoryOpen, setCloudHistoryOpen] = useState(() => localStorage.getItem("mc.cloudHistoryOpen") === "1");
  // 没有运行中任务的云端项目默认收起(展开也只有一行占位),这里记的是用户
  // 显式点开的那些。不持久化:开着的项目每次启动都要重新拉一遍任务,不值当
  const [openedCloudProjects, setOpenedCloudProjects] = useState<Set<string>>(new Set());
  const [projectOrder, setProjectOrder] = useState<string[]>(readProjectOrder);
  // 冷启动宽限:starting/attempt=0 持续超过 3s 才亮引擎卡——快速启动不闪卡,
  // WSL 预热/慢盘的长启动期不再零反馈(横幅对这段刻意留白,见 engineBanner.ts)
  const coldStarting = engine?.phase === "starting" && engine.attempt === 0;
  const [coldStartVisible, setColdStartVisible] = useState(false);
  useEffect(() => {
    if (!coldStarting) {
      setColdStartVisible(false);
      return;
    }
    const t = setTimeout(() => setColdStartVisible(true), 3000);
    return () => clearTimeout(t);
  }, [coldStarting]);
  const engineCard = engineCardView(engine, coldStartVisible);
  const railDot = railDotView(engine, connected, status);
  // 拖动中只有落点需要重渲染;行位置快照和阈值判定放 ref，避免每次 move 都刷 state
  const [dragTo, setDragTo] = useState<{ dir: string; index: number } | null>(null);
  const dragRef = useRef<{ dir: string; startY: number; startX: number; active: boolean; rows: { dir: string; mid: number }[]; from: number; to: number } | null>(null);
  const draggedRef = useRef(false);

  // 选区锁是全局副作用:拖动中途卸载(热更新、整页切换)若不还原，整个应用
  // 都会选不中文字,且现场早已消失、极难回溯。
  useEffect(() => () => {
    document.body.style.userSelect = "";
    document.body.style.removeProperty("-webkit-user-select");
  }, []);

  // 外部入口(桌宠提醒、通知跳转)真正打开另一个空间时同步主导航；
  // 单纯点主导航不会因当前主视图没变而被 effect 立即弹回。
  useEffect(() => {
    if (activeCloudId) setSpace("cloud");
    else if (sessionActive && activeMeta) setSpace(activeMeta.kind === "chat" ? "chat" : "local");
  }, [activeCloudId, sessionActive, currentId, activeMeta?.kind]);

  const selectSpace = (next: SidebarSpace) => {
    setSpace(next);
    setQuery("");
    localStorage.setItem("mc.sidebarSpace", next);
  };
  const toggleGroup = (dir: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      storeSet("mc.collapsedGroups", next);
      return next;
    });
  };
  // 没有在跑任务的云端项目:默认收起,这里记显式点开的(展开后由上面的
  // 按需拉取补内容)。与 collapsed 分开存,免得两套默认态互相打架
  const toggleCloudProject = (key: string) => {
    setOpenedCloudProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const toggleSessionArchive = (dir: string) => {
    const key = projectArchiveKey(dir);
    setSessionArchivesOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      storeSet("mc.sessionArchivesOpen", next);
      return next;
    });
  };
  const toggleChatArchive = () => {
    setChatArchiveOpen((open) => {
      localStorage.setItem("mc.archivedOpen", open ? "0" : "1");
      return !open;
    });
  };
  const toggleProjectArchive = () => {
    setProjectArchiveOpen((open) => {
      localStorage.setItem("mc.projectArchiveOpen", open ? "0" : "1");
      return !open;
    });
  };
  const toggleCloudHistory = () => {
    setCloudHistoryOpen((open) => {
      localStorage.setItem("mc.cloudHistoryOpen", open ? "0" : "1");
      return !open;
    });
  };

  const norm = query.trim().toLocaleLowerCase();
  const matchesSession = (m: SessionMeta) =>
    !norm || `${m.title} ${m.summary ?? ""} ${m.workdir} ${rowStatus(m).text}`.toLocaleLowerCase().includes(norm);
  const matchesCloud = (task: CloudTask) =>
    !norm || `${task.title ?? ""} ${task.summary ?? ""} ${task.content ?? ""} ${CLOUD_STATUS[task.status ?? ""]?.text ?? ""}`.toLocaleLowerCase().includes(norm);

  const localAll = sessions.filter((m) => m.kind !== "chat");
  const chatAll = sessions.filter((m) => m.kind === "chat");
  const chats = chatAll.filter((m) => !m.archived && matchesSession(m));
  const chatArchived = chatAll.filter((m) => m.archived && matchesSession(m));
  const filteredLocal = localAll.filter(matchesSession);
  // 手动顺序覆盖在活跃度排序之上;归档区不参与，仍按最近活跃排。
  const projectGroups = applyProjectOrder(
    groupByProject(filteredLocal.filter((m) => !isProjectArchived(archivedProjects, m.workdir))),
    projectOrder,
  );
  const archivedProjectGroups = groupByProject(filteredLocal.filter((m) => isProjectArchived(archivedProjects, m.workdir)));

  // 搜索态的列表是过滤过的，此时提交顺序会把没显示出来的项目冲掉——直接不给拖。
  const reorderable = !norm && projectGroups.length > 1;
  // 选区锁与 filesdrawer 的分栏拖拽同一套做法(见 trackPointer):按住期间
  // 全局禁选,松手还原,不覆盖用户在别处已有的偏好。两个前缀都写的理由同
  // 项目行样式——只写标准属性在 WKWebView 上等于没写。
  const lockBodySelection = () => {
    document.body.style.userSelect = "none";
    document.body.style.setProperty("-webkit-user-select", "none");
  };
  const unlockBodySelection = () => {
    document.body.style.userSelect = "";
    document.body.style.removeProperty("-webkit-user-select");
  };
  const endDrag = () => {
    unlockBodySelection();
    dragRef.current = null;
    setDragTo(null);
  };
  /** 落点是"插到第几项之前"的缝隙下标:与行中线比较，越过一半才算换位。 */
  const dropIndexAt = (rows: { mid: number }[], y: number) => {
    for (let i = 0; i < rows.length; i++) if (y < rows[i].mid) return i;
    return rows.length;
  };
  const projectDrag = (group: ProjectGroup, index: number): ProjectDrag | undefined => {
    if (!reorderable) return undefined;
    const from = dragTo && dragRef.current ? dragRef.current.from : -1;
    // 落在自己两侧的缝隙就是原位，不画线，避免"看起来会动其实不动"
    const settled = dragTo ? dragTo.index === from || dragTo.index === from + 1 : true;
    return {
      dir: group.dir,
      active: dragTo?.dir === group.dir,
      dropBefore: !settled && dragTo?.index === index,
      dropAfter: !settled && dragTo?.index === projectGroups.length && index === projectGroups.length - 1,
      handlers: {
        onPointerDown: (e) => {
          if (e.button !== 0) return;
          // 快捷新建按钮只拦了 click，pointerdown 仍会冒泡上来;一旦在它上面
          // setPointerCapture，click 的 target 就被重定向到整行，按钮会失灵。
          if ((e.target as HTMLElement | null)?.closest("button")) return;
          dragRef.current = { dir: group.dir, startX: e.clientX, startY: e.clientY, active: false, rows: [], from: index, to: index };
          e.currentTarget.setPointerCapture(e.pointerId);
          // 行上那条只管住项目名自己。指针接着要纵向扫过下方的会话行,而
          // SessionRow 没设 none,从这里按下拖过去仍会连出跨元素选区,所以
          // 按下即锁全局,松手复原。
          lockBodySelection();
        },
        onPointerMove: (e) => {
          const state = dragRef.current;
          if (!state || state.dir !== group.dir) return;
          if (!state.active) {
            // 阈值之内仍算点击，让折叠/展开照常工作
            if (Math.abs(e.clientY - state.startY) < 4 && Math.abs(e.clientX - state.startX) < 4) return;
            // 拖动全程不重排 DOM(项目行下面还挂着会话行，整块跟手太重)，
            // 所以起手快照一次行位置就够用，后续只按指针 Y 比对。
            const rows: { dir: string; mid: number }[] = [];
            for (const el of document.querySelectorAll<HTMLElement>("[data-project-dir]")) {
              const rect = el.getBoundingClientRect();
              rows.push({ dir: el.dataset.projectDir ?? "", mid: (rect.top + rect.bottom) / 2 });
            }
            state.rows = rows;
            state.from = rows.findIndex((row) => row.dir === group.dir);
            state.active = true;
          }
          // 落点同时写 ref:pointermove 的 state 更新会被批处理，pointerup
          // 读 state 可能还是上一帧的值，提交必须以 ref 为准。
          state.to = dropIndexAt(state.rows, e.clientY);
          setDragTo({ dir: group.dir, index: state.to });
        },
        onPointerUp: () => {
          const state = dragRef.current;
          if (state?.active) {
            setProjectOrder(persistProjectOrder(reorderProjects(projectGroups.map((g) => g.dir), group.dir, state.to)));
            // 松手后紧跟着的 click 是拖动的尾巴，不该再切换折叠
            draggedRef.current = true;
          }
          endDrag();
        },
        onPointerCancel: endDrag,
      },
    };
  };

  const activeLocalAll = localAll.filter((m) => !isProjectArchived(archivedProjects, m.workdir));
  const activeProjectCount = groupByProject(activeLocalAll).length;
  const activeSessionCount = activeLocalAll.filter((m) => !m.archived).length;
  const localAttention = [...attention].filter((id) => localAll.some((m) => m.id === id)).length;
  const chatAttention = [...attention].filter((id) => chatAll.some((m) => m.id === id)).length;
  const allCloudTasks = new Map<string, CloudTask>();
  for (const task of [...cloudTasks, ...cloudHistory, ...cloudProjects.flatMap((project) => project.tasks ?? [])]) {
    allCloudTasks.set(task.id, task);
  }
  const filteredCloudTasks = cloudTasks.filter(matchesCloud);
  const filteredCloudHistory = cloudHistory.filter(matchesCloud);
  // 项目列表接口每个项目只捎带 ≤3 条**运行中**的任务(后端按 pending/processing
  // 过滤),历史任务一条都没有——所以"项目下没任务"多半只是"此刻没有在跑的"。
  // 展开时按 project_id 单拉一次(loaded),拉到就以它为准。
  const filteredCloudProjects: { project: CloudProject; tasks: CloudTask[]; key: string; open: boolean; state?: CloudProjectTasks }[] = [];
  for (const project of cloudProjects) {
    const projectMatch = !norm || `${project.name ?? ""} ${project.full_name ?? ""} ${project.repo_url ?? ""}`.toLocaleLowerCase().includes(norm);
    const state = project.id ? cloudProjectTasks[project.id] : undefined;
    const running = project.tasks ?? [];
    const tasks = [...(state?.tasks ?? running)]
      .sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0))
      .filter((task) => projectMatch || matchesCloud(task));
    if (!projectMatch && tasks.length === 0) continue;
    const key = `cloud:${project.id || project.repo_url || project.name || filteredCloudProjects.length}`;
    // 有在跑的任务就默认展开(和以前一样,collapsed 记显式收起的);其余默认
    // 收起,openedCloudProjects 记显式点开的——一屏项目全摊开只有噪音
    const open = !!norm || (running.length > 0 ? !collapsed.has(key) : openedCloudProjects.has(key));
    filteredCloudProjects.push({ project, tasks, key, open, state });
  }
  // 展开着的项目按需补拉任务(App 侧缓存去重,拉过/在途的不重发)。搜索期间
  // 全部临时展开,那时不拉:一次搜索不该顺带打一串请求。
  const pendingTaskLoads = norm || space !== "cloud"
    ? []
    : filteredCloudProjects.filter((e) => e.open && e.project.id && !e.state).map((e) => e.project.id as string);
  const pendingTaskLoadKey = pendingTaskLoads.join(",");
  useEffect(() => {
    if (!onLoadCloudProjectTasks || !pendingTaskLoadKey) return;
    for (const id of pendingTaskLoadKey.split(",")) {
      const project = cloudProjects.find((p) => p.id === id);
      if (project) onLoadCloudProjectTasks(project);
    }
  }, [pendingTaskLoadKey]);

  const sessionRow = (meta: SessionMeta, archived: boolean, depth = 0) => (
    <SessionRow
      key={meta.id}
      meta={meta}
      active={meta.id === currentId && sessionActive}
      attention={attention.has(meta.id)}
      archived={archived}
      depth={depth}
      onClick={() => onSelect(meta)}
      onArchive={() => onArchive(meta)}
      onDelete={() => onDelete(meta)}
      onRename={(title) => onRename(meta, title)}
    />
  );

  const cloudTaskRow = (task: CloudTask, depth = 0) => (
    <CloudTaskRow
      key={task.id}
      task={task}
      active={task.id === activeCloudId}
      depth={depth}
      onClick={() => onOpenCloudTask(task)}
      onStop={() => onStopCloudTask(task)}
      onDelete={() => onDeleteCloudTask(task)}
    />
  );
  const cloudActionError = !!cloudError && /^(终止|删除)任务失败：/.test(cloudError);

  const projectRow = (group: ProjectGroup, projectArchived: boolean, depth = 0, index = -1) => {
    const activeItems = group.items.filter((m) => !m.archived);
    const archivedItems = group.items.filter((m) => m.archived);
    const archiveKey = projectArchiveKey(group.dir);
    const startTask = () => {
      // 在归档项目里新建任务等同于重新启用项目；项目行 + 与右键菜单共用。
      if (projectArchived) onProjectArchive(group.dir, false);
      onNewTask(group.dir);
    };
    return (
      <ProjectGroup
        key={group.dir}
        name={group.name}
        detail={`${group.dir}\n${activeItems.length} 个任务${archivedItems.length ? ` · ${archivedItems.length} 个已归档` : ""}`}
        project
        projectArchived={projectArchived}
        depth={depth}
        expanded={!!norm || !collapsed.has(group.dir)}
        drag={index >= 0 ? projectDrag(group, index) : undefined}
        onToggle={() => {
          // 一次拖动会以 click 收尾，这一下不该顺带折叠项目
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          toggleGroup(group.dir);
        }}
        onNewTask={startTask}
        onProjectArchive={() => onProjectArchive(group.dir, !projectArchived)}
      >
        {activeItems.map((m) => sessionRow(m, false, depth + 1))}
        {archivedItems.length > 0 && (
          <ProjectGroup
            name={`已归档任务 · ${archivedItems.length}`}
            depth={depth + 1}
            expanded={!!norm || sessionArchivesOpen.has(archiveKey)}
            muted
            onToggle={() => toggleSessionArchive(group.dir)}
          >
            {archivedItems.map((m) => sessionRow(m, true, depth + 2))}
          </ProjectGroup>
        )}
      </ProjectGroup>
    );
  };

  const stateCard = (content: string, action?: { label: string; run: () => void }) => (
    <div style={{ margin: "6px 3px 12px", padding: "11px 12px", border: "1px dashed var(--dashBd)", borderRadius: 10, color: "var(--t4)", fontSize: 11.5, lineHeight: 1.55 }}>
      <div>{content}</div>
      {action && (
        <button onClick={action.run} style={{ marginTop: 7, padding: 0, border: "none", background: "transparent", color: "var(--accTx)", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
          {action.label}
        </button>
      )}
    </div>
  );

  const cloudContent = () => {
    if (mcConnection.phase === "checking") return stateCard("正在检查 MonkeyCode 连接状态…");
    if (mcConnection.phase === "connecting") return stateCard("正在连接 MonkeyCode…");
    if (mcConnection.phase === "disconnecting") return stateCard("正在断开 MonkeyCode…");
    if (mcConnection.phase === "error") {
      return stateCard(`状态检查失败：${mcConnection.error || "无法连接 MonkeyCode"}`, onRefreshCloud ? { label: "重试", run: onRefreshCloud } : undefined);
    }
    if (mcConnection.phase === "disconnected") {
      return stateCard(
        mcConnection.error
          ? `连接失败：${mcConnection.error}`
          : "连接 MonkeyCode 后，可在这里查看和跟进云端任务。也可到设置中使用账号密码登录。",
        {
          label: mcConnection.error ? "重试连接" : "连接 MonkeyCode",
          run: onConnectCloud,
        },
      );
    }
    if (cloudTasks.length === 0 && cloudHistory.length === 0 && cloudProjects.length === 0 && !cloudError) {
      return <EmptyState icon={<IconCloud size={21} color="var(--t6)" />} title="还没有云端项目或任务" detail="从这里新建，或在网页和手机端派发任务。" />;
    }
    return (
      <>
        {cloudError && (
          <div
            title={cloudError}
            className="ellipsis"
            style={{
              margin: "2px 4px 7px",
              padding: "6px 8px",
              borderRadius: 7,
              background: cloudActionError ? "var(--errBg)" : "var(--warnBg)",
              color: cloudActionError ? "var(--err)" : "var(--warn)",
              fontSize: 10.5,
            }}
          >
            {cloudActionError ? cloudError : "部分数据刷新失败，当前显示上次结果"}
          </div>
        )}
        {filteredCloudTasks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
            <span style={{ padding: "4px 9px 3px", color: "var(--t5)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.35 }}>快速任务</span>
            {filteredCloudTasks.map((task) => cloudTaskRow(task))}
          </div>
        )}
        {filteredCloudHistory.length > 0 && (
          <ProjectGroup name={`历史任务 · ${filteredCloudHistory.length}`} expanded={!!norm || cloudHistoryOpen} muted onToggle={toggleCloudHistory}>
            {filteredCloudHistory.map((task) => cloudTaskRow(task, 1))}
          </ProjectGroup>
        )}
        {filteredCloudProjects.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1, borderTop: "1px solid var(--line2)", marginTop: 9, paddingTop: 8 }}>
            <span style={{ padding: "3px 9px 4px", color: "var(--t5)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.35 }}>项目</span>
            {filteredCloudProjects.map(({ project, tasks, key, open, state }) => {
              const name = project.name || project.full_name || "未命名项目";
              const running = (project.tasks ?? []).length;
              return (
                <ProjectGroup
                  key={key}
                  name={name}
                  detail={`${project.repo_url || project.full_name || "云端项目"}\n${state?.tasks ? `${tasks.length} 个任务` : running ? `${running} 个进行中` : "展开查看任务"}`}
                  project
                  expanded={open}
                  onToggle={() => (running > 0 ? toggleGroup(key) : toggleCloudProject(key))}
                  onNewTask={() => onNewCloudTask(project)}
                >
                  {tasks.length > 0
                    ? tasks.map((task) => cloudTaskRow(task, 1))
                    : (
                      <span style={{ padding: "3px 12px 5px 38px", color: state?.error ? "var(--warn)" : "var(--t6)", fontSize: 10.5 }}>
                        {state?.loading || (!state && running === 0) ? "加载中…" : state?.error ? `任务加载失败：${state.error}` : "暂无任务"}
                      </span>
                    )}
                </ProjectGroup>
              );
            })}
          </div>
        )}
        {norm && filteredCloudTasks.length === 0 && filteredCloudHistory.length === 0 && filteredCloudProjects.length === 0 && (
          <EmptyState icon={<IconSearch size={19} color="var(--t6)" />} title="没有匹配的项目或任务" detail="试试项目名、仓库或任务标题中的其他关键词。" />
        )}
      </>
    );
  };

  const panel = (() => {
    if (space === "cloud") {
      return {
        title: "云端项目",
        detail: `${cloudProjects.length} 个项目 · ${allCloudTasks.size} 个任务`,
        placeholder: "搜索项目或任务",
        actions: (
          <>
            {onRefreshCloud && mcConnection.phase === "connected" && (
              <button className="hv icon-btn" title="刷新云端任务" onClick={onRefreshCloud} style={{ ...headerAction, background: "transparent" }}>
                <IconRefresh size={12} style={cloudSyncing ? { animation: "mcspin .9s linear infinite" } : undefined} />
              </button>
            )}
            <button className="hv-acc icon-btn" title="新建云端任务" onClick={() => onNewCloudTask()} style={{ ...headerAction, background: "var(--acc)" }}>
              <IconPlus size={11} color="var(--onAcc)" />
            </button>
          </>
        ),
        content: cloudContent(),
      };
    }
    if (space === "chat") {
      return {
        title: "会话",
        detail: `${chatAll.filter((m) => !m.archived).length} 个独立会话`,
        placeholder: "搜索会话",
        actions: (
          <button className="hv-acc icon-btn" title="新建会话" onClick={onNewChat} style={{ ...headerAction, background: "var(--acc)" }}>
            <IconPlus size={11} color="var(--onAcc)" />
          </button>
        ),
        content: (
          <>
            {chats.length ? <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{chats.map((m) => sessionRow(m, false))}</div> : (
              <EmptyState icon={norm ? <IconSearch size={19} color="var(--t6)" /> : <IconChat size={21} color="var(--t6)" />} title={norm ? "没有匹配的会话" : "还没有独立会话"} detail={norm ? "试试标题中的其他关键词。" : "新建一段不绑定项目的普通会话。"} />
            )}
            {chatArchived.length > 0 && (
              <ProjectGroup name={`已归档会话 · ${chatArchived.length}`} expanded={!!norm || chatArchiveOpen} muted onToggle={toggleChatArchive}>
                {chatArchived.map((m) => sessionRow(m, true))}
              </ProjectGroup>
            )}
          </>
        ),
      };
    }
    return {
      title: "本地项目",
      detail: `${activeProjectCount} 个项目 · ${activeSessionCount} 个任务`,
      placeholder: "搜索项目或任务",
      actions: (
        <button className="hv-acc icon-btn" title="新建本地任务" onClick={() => onNewTask()} style={{ ...headerAction, background: "var(--acc)" }}>
          <IconPlus size={11} color="var(--onAcc)" />
        </button>
      ),
      content: (
        <>
          {projectGroups.map((group, index) => projectRow(group, false, 0, index))}
          {projectGroups.length === 0 && archivedProjectGroups.length === 0 && (
            <EmptyState icon={norm ? <IconSearch size={19} color="var(--t6)" /> : <IconMonitor size={21} color="var(--t6)" />} title={norm ? "没有匹配的任务" : "还没有本地项目"} detail={norm ? "试试项目名、目录或任务标题。" : "选择一个文件夹，开始第一个本地任务。"} />
          )}
          {archivedProjectGroups.length > 0 && (
            <ProjectGroup name={`已归档项目 · ${archivedProjectGroups.length}`} expanded={!!norm || projectArchiveOpen} muted onToggle={toggleProjectArchive}>
              {archivedProjectGroups.map((group) => projectRow(group, true, 1))}
            </ProjectGroup>
          )}
        </>
      ),
    };
  })();

  return (
    <div className="mc-sidebar-shell" style={{ flex: "none", display: "flex", minHeight: 0 }}>
      {/* 栏宽、右分隔线、底色都在 styles.css(.mc-nav-rail):窄窗要收窄,mac 下
          分隔线和底色还要为红绿灯让开顶部一段——写成内联样式就把这些规则全挡了 */}
      <div className="mc-nav-rail" style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <MacWindowControls />
        {!isWindowsShell() && <img src={logoUrl} alt="MonkeyCode" draggable={false} style={{ width: 31, height: 31, borderRadius: 9, margin: "2px 0 15px" }} />}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
          <RailButton active={space === "cloud"} label="云端" icon={<IconCloud size={16} color={space === "cloud" ? "var(--accSelT)" : "var(--t4)"} />} onClick={() => selectSpace("cloud")} />
          <RailButton active={space === "local"} label="本地" badge={localAttention} icon={<IconMonitor size={16} color={space === "local" ? "var(--accSelT)" : "var(--t4)"} strokeWidth={1.25} />} onClick={() => selectSpace("local")} />
          <RailButton active={space === "chat"} label="会话" badge={chatAttention} icon={<IconChat size={16} color={space === "chat" ? "var(--accSelT)" : "var(--t4)"} />} onClick={() => selectSpace("chat")} />
        </div>
        <span style={{ flex: 1 }} />
        <span title={railDot.title} style={{ width: 32, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: railDot.color, boxShadow: railDot.glow ? `0 0 0 3px ${railDot.glow}` : "none", animation: railDot.pulse ? "mcpulse 1.2s infinite" : "none" }} />
        </span>
        <button className="hv icon-btn" title="设置" onClick={onOpenSettings} style={{ position: "relative", width: 36, height: 36, borderRadius: 10, marginBottom: 12 }}>
          <IconGear size={15} />
          {update?.available && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "var(--notice)", border: "1.5px solid var(--rail)" }} />}
        </button>
      </div>

      {/* 栏宽在 styles.css(.mc-sidebar-panel + --sideW):窄窗要收窄,且要与
          Windows 自绘标题栏同列共用同一个令牌,写死在这里两层就会错开 */}
      <aside className="mc-sidebar-panel" style={{ flex: "none", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--side)", borderRight: "1px solid var(--line)" }}>
        <MacBrandBand />
        <PanelHeader title={panel.title} detail={panel.detail}>{panel.actions}</PanelHeader>
        <SearchBox value={query} placeholder={panel.placeholder} onChange={setQuery} />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            scrollbarGutter: "stable",
            overscrollBehavior: "contain",
            // 8px 固定滚动槽 + 1px 右内边距 = 原来的 9px；有无滚动条时
            // 会话行宽度完全一致，也不会与右侧边界贴在一起。
            padding: "0 1px 10px 9px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {panel.content}
        </div>
        {engineCard && (
          <div
            title={engineCard.detail || undefined}
            style={{ margin: update?.available ? "6px 9px 0" : "6px 9px 9px", minHeight: 36, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--card)", display: "flex", alignItems: "center", gap: 7 }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: engineCard.busy ? "var(--notice)" : "var(--err)", animation: engineCard.busy ? "mcpulse 1.2s infinite" : "none", flex: "none" }} />
            <span className="ellipsis selectable" style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 11.5, fontWeight: 600, color: "var(--t2)" }}>
              {engineCard.text}
            </span>
            {engineCard.canRestart && onEngineRestart && (
              <button
                className="hv-acc"
                disabled={engineBusy}
                onClick={() => !engineBusy && onEngineRestart()}
                style={{ flex: "none", height: 22, padding: "0 9px", border: "none", borderRadius: 6, cursor: engineBusy ? "default" : "pointer", fontSize: 10.5, fontWeight: 700, background: "var(--acc)", color: "var(--onAcc)", opacity: engineBusy ? 0.7 : 1 }}
              >
                {engineBusy ? "重启中" : "重启"}
              </button>
            )}
            {onOpenLogDir && (
              <button
                className="hv"
                title="在文件管理器中打开引擎日志目录(ohmyagent.log 与崩溃留存)"
                onClick={onOpenLogDir}
                style={{ flex: "none", height: 22, padding: "0 8px", border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 600, background: "transparent", color: "var(--t3)" }}
              >
                日志
              </button>
            )}
          </div>
        )}
        {update?.available && (
          <button
            className="hv2"
            disabled={updateBusy}
            onClick={() => !updateBusy && onUpdate?.()}
            style={{ margin: "6px 9px 9px", minHeight: 36, padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 9, background: "var(--card)", display: "flex", alignItems: "center", gap: 7, color: "var(--t2)", cursor: updateBusy ? "default" : "pointer" }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--notice)", animation: updateBusy ? "mcpulse 1.2s infinite" : "none" }} />
            <span className="ellipsis" style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 11.5, fontWeight: 600 }}>
              {updateBusy ? "正在下载更新…" : `新版本 ${update.latest ?? ""} 可用`}
            </span>
            {!updateBusy && <span style={{ color: "var(--accTx)", fontSize: 10.5, fontWeight: 700 }}>更新</span>}
          </button>
        )}
      </aside>
    </div>
  );
}
