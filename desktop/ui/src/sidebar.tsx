// 双层侧栏:窄主导航负责空间切换，内容栏只展示当前空间的数据。
// 一级空间保持稳定(云端 / 本地 / 对话)，项目、任务、会话属于二级内容；
// 这比把所有对象塞进一条长列表更利于检索，也给后续空间扩展留出位置。
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { isImeEnter, markImeEnd } from "./chat";
import { ConfirmPane, DeleteMenuItem, type MenuState } from "./components";
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
  IconX,
} from "./icons";
import logoUrl from "./logo.png";
import { isProjectArchived, projectArchiveKey } from "./projectArchive";
import { MacDragSpacer } from "./titlebar";
import type { CloudTask, McConnectionState, SessionMeta } from "./types";

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
  processing: { text: "运行中", color: "var(--acc)" },
  error: { text: "运行出错", color: "var(--err)" },
  finished: { text: "已完成", color: "var(--t4)" },
};

function rowStatus(meta: SessionMeta): { text: string; color: string; textColor?: string; hollow?: boolean } {
  if (meta.waiting_ask) return { text: "等待确认", color: "var(--warn)" };
  switch (meta.status) {
    case "running":
      return { text: "运行中", color: "var(--acc)" };
    case "error":
      return { text: "运行出错", color: "var(--err)" };
    case "interrupted":
      return { text: "已停止", color: "var(--t4)" };
    case "idle":
    case "finished":
      // finished 是旧版顶层会话的一轮结束状态；新版壳会返回 idle。
      return { text: "可继续", color: "var(--ok)", textColor: "var(--t4)", hollow: true };
    default:
      return meta.turns > 0
        ? { text: "可继续", color: "var(--ok)", textColor: "var(--t4)", hollow: true }
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0 });
  const st = rowStatus(meta);
  const title = meta.title || (meta.kind === "chat" ? "新对话" : "新任务");
  const turns = turnCountLabel(meta.turns);
  const statusColor = archived && !attention ? "var(--t5)" : st.color;

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
  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (meta.title || "")) onRename(next);
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        className={active ? undefined : "hv"}
        title={`${title}\n${meta.kind === "chat" ? "独立对话" : meta.workdir}\n右键管理`}
        onClick={onClick}
        onContextMenu={(e) => {
          if (editing) return;
          e.preventDefault();
          e.stopPropagation();
          openMenuAt(e.clientX, e.clientY);
        }}
        style={{
          minHeight: 48,
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 3,
          padding: `6px 8px 6px ${11 + Math.max(0, depth) * 14}px`,
          borderRadius: 8,
          cursor: "pointer",
          background: active ? (archived ? "var(--hov2)" : "var(--accSel)") : "transparent",
          color: "var(--t2)",
          minWidth: 0,
        }}
      >
        <div style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center" }}>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
              onCompositionEnd={markImeEnd}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !isImeEnter(e)) commitRename();
                else if (e.key === "Escape") setEditing(false);
              }}
              style={{
                flex: 1,
                minWidth: 0,
                height: 23,
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
            <span className="ellipsis" style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, fontWeight: 400, color: active ? "var(--t1)" : archived ? "var(--t4)" : "var(--t2)" }}>
              {title}
            </span>
          )}
        </div>
        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 5, minWidth: 0, fontSize: 10.5, lineHeight: 1.25 }}>
          <span
            title={attention ? (meta.status === "error" ? "后台任务出错" : "会话有新进展") : undefined}
            style={{
              width: attention ? 7 : 6,
              height: attention ? 7 : 6,
              borderRadius: "50%",
              background: attention
                ? (meta.status === "error" ? "var(--err)" : "var(--acc)")
                : st.hollow ? "transparent" : statusColor,
              border: !attention && st.hollow ? `1.3px solid ${statusColor}` : "none",
              boxShadow: attention
                ? `0 0 0 2px ${meta.status === "error" ? "var(--errBg)" : "var(--accBg)"}`
                : "none",
              flex: "none",
            }}
          />
          <span className="ellipsis" style={{ color: archived && !attention ? "var(--t5)" : st.textColor ?? st.color, minWidth: 0, flex: "none" }}>
            {st.text}
          </span>
          {turns && <span style={{ color: "var(--t5)", marginLeft: "auto", flex: "none", fontVariantNumeric: "tabular-nums" }}>{turns}</span>}
        </div>
      </div>

      {menu !== "closed" && (
        <>
          <div className="backdrop" onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div className="pop" style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: 122 }} onClick={(e) => e.stopPropagation()}>
            {menu === "open" ? (
              <>
                <button className="hv menu-item" onClick={() => { closeMenu(); setDraft(meta.title || ""); setEditing(true); }}>
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

function ProjectGroup({
  name,
  detail,
  project = false,
  projectArchived = false,
  depth = 0,
  expanded,
  muted,
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
        title={[detail, project && onProjectArchive ? "右键管理项目" : ""].filter(Boolean).join("\n") || undefined}
        aria-expanded={expanded}
        onClick={onToggle}
        onContextMenu={project && onProjectArchive ? (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenuAt(e.clientX, e.clientY);
        } : undefined}
        style={{
          minHeight: 34,
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: `0 5px 0 ${7 + Math.max(0, depth) * 14}px`,
          borderRadius: 8,
          cursor: "pointer",
          userSelect: "none",
          fontWeight: project ? 600 : 550,
          fontSize: project ? 12.5 : 11.5,
          color: muted ? "var(--t5)" : projectArchived ? "var(--t3)" : "var(--t1)",
        }}
      >
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

function CloudTaskRow({ task, active, onClick }: { task: CloudTask; active: boolean; onClick: () => void }) {
  const label = task.title || task.summary || task.content || "云端任务";
  const st = CLOUD_STATUS[task.status ?? ""] ?? { text: "云端任务", color: "var(--t5)" };
  return (
    <div
      className={active ? undefined : "hv"}
      title={label}
      onClick={onClick}
      style={{
        minHeight: 50,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        padding: "7px 9px 7px 11px",
        borderRadius: 9,
        cursor: "pointer",
        background: active ? "var(--accSel)" : "transparent",
        color: "var(--t2)",
        minWidth: 0,
      }}
    >
      {active && (
        <span aria-hidden="true" style={{ position: "absolute", left: 2, top: 11, bottom: 11, width: 2, borderRadius: 2, background: "var(--acc)" }} />
      )}
      <span className="ellipsis" style={{ width: "100%", fontSize: 13, lineHeight: 1.25, fontWeight: 400, color: active ? "var(--t1)" : "var(--t2)" }}>{label}</span>
      <span style={{ width: "100%", minWidth: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, lineHeight: 1.2 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color, flex: "none" }} />
        <span style={{ color: st.color }}>{st.text}</span>
        <span style={{ marginLeft: "auto", color: "var(--t5)", fontVariantNumeric: "tabular-nums" }}>{relativeTime(task.created_at)}</span>
      </span>
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
  update,
  updateBusy,
  onUpdate,
  mcConnection,
  cloudTasks,
  activeCloudId,
  cloudSyncing,
  cloudError,
  onConnectCloud,
  onRefreshCloud,
  onNewCloudTask,
  onOpenCloudTask,
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
  update?: { available: boolean; latest?: string } | null;
  updateBusy?: boolean;
  onUpdate?: () => void;
  mcConnection: McConnectionState;
  cloudTasks: CloudTask[];
  activeCloudId?: string | null;
  cloudSyncing?: boolean;
  cloudError?: string;
  onConnectCloud: () => void;
  onRefreshCloud?: () => void;
  onNewCloudTask: () => void;
  onOpenCloudTask: (task: CloudTask) => void;
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
    !norm || `${m.title} ${m.workdir} ${rowStatus(m).text}`.toLocaleLowerCase().includes(norm);
  const matchesCloud = (task: CloudTask) =>
    !norm || `${task.title ?? ""} ${task.summary ?? ""} ${task.content ?? ""} ${CLOUD_STATUS[task.status ?? ""]?.text ?? ""}`.toLocaleLowerCase().includes(norm);

  const localAll = sessions.filter((m) => m.kind !== "chat");
  const chatAll = sessions.filter((m) => m.kind === "chat");
  const chats = chatAll.filter((m) => !m.archived && matchesSession(m));
  const chatArchived = chatAll.filter((m) => m.archived && matchesSession(m));
  const filteredLocal = localAll.filter(matchesSession);
  const projectGroups = groupByProject(filteredLocal.filter((m) => !isProjectArchived(archivedProjects, m.workdir)));
  const archivedProjectGroups = groupByProject(filteredLocal.filter((m) => isProjectArchived(archivedProjects, m.workdir)));
  const activeLocalAll = localAll.filter((m) => !isProjectArchived(archivedProjects, m.workdir));
  const activeProjectCount = groupByProject(activeLocalAll).length;
  const activeSessionCount = activeLocalAll.filter((m) => !m.archived).length;
  const localAttention = [...attention].filter((id) => localAll.some((m) => m.id === id)).length;
  const chatAttention = [...attention].filter((id) => chatAll.some((m) => m.id === id)).length;
  const cloudRunning = cloudTasks.filter((task) => task.status === "pending" || task.status === "processing");
  const cloudPast = cloudTasks.filter((task) => task.status !== "pending" && task.status !== "processing");
  const filteredCloudRunning = cloudRunning.filter(matchesCloud);
  const filteredCloudPast = cloudPast.filter(matchesCloud);

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

  const projectRow = (group: ProjectGroup, projectArchived: boolean, depth = 0) => {
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
        detail={`${group.dir}\n${activeItems.length} 个会话${archivedItems.length ? ` · ${archivedItems.length} 个已归档` : ""}`}
        project
        projectArchived={projectArchived}
        depth={depth}
        expanded={!!norm || !collapsed.has(group.dir)}
        onToggle={() => toggleGroup(group.dir)}
        onNewTask={startTask}
        onProjectArchive={() => onProjectArchive(group.dir, !projectArchived)}
      >
        {activeItems.map((m) => sessionRow(m, false, depth + 1))}
        {archivedItems.length > 0 && (
          <ProjectGroup
            name={`已归档会话 · ${archivedItems.length}`}
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
        <button onClick={action.run} style={{ marginTop: 7, padding: 0, border: "none", background: "transparent", color: "var(--acc)", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
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
      return stateCard(mcConnection.error ? `连接失败：${mcConnection.error}` : "连接 MonkeyCode 后，可在这里查看和跟进云端任务。", {
        label: mcConnection.error ? "重试连接" : "连接 MonkeyCode",
        run: onConnectCloud,
      });
    }
    if (cloudTasks.length === 0 && !cloudError) {
      return <EmptyState icon={<IconCloud size={21} color="var(--t6)" />} title="还没有云端任务" detail="从这里新建，或在网页和手机端派发任务。" />;
    }
    return (
      <>
        {cloudError && <div title={cloudError} className="ellipsis" style={{ margin: "2px 4px 7px", padding: "6px 8px", borderRadius: 7, background: "var(--warnBg)", color: "var(--warn)", fontSize: 10.5 }}>刷新失败，当前显示上次结果</div>}
        {filteredCloudRunning.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 8 }}>
            <span style={{ padding: "4px 9px 3px", color: "var(--t5)", fontSize: 10.5, fontWeight: 700, letterSpacing: 0.35 }}>进行中</span>
            {filteredCloudRunning.map((task) => <CloudTaskRow key={task.id} task={task} active={task.id === activeCloudId} onClick={() => onOpenCloudTask(task)} />)}
          </div>
        )}
        {filteredCloudPast.length > 0 && (
          <ProjectGroup name={`历史任务 · ${filteredCloudPast.length}`} expanded={!!norm || cloudHistoryOpen} muted onToggle={toggleCloudHistory}>
            {filteredCloudPast.map((task) => <CloudTaskRow key={task.id} task={task} active={task.id === activeCloudId} onClick={() => onOpenCloudTask(task)} />)}
          </ProjectGroup>
        )}
        {norm && filteredCloudRunning.length === 0 && filteredCloudPast.length === 0 && (
          <EmptyState icon={<IconSearch size={19} color="var(--t6)" />} title="没有匹配的任务" detail="试试任务标题或描述中的其他关键词。" />
        )}
      </>
    );
  };

  const panel = (() => {
    if (space === "cloud") {
      return {
        title: "云端任务",
        detail: cloudRunning.length ? `${cloudRunning.length} 个正在进行` : `${cloudTasks.length} 个任务`,
        placeholder: "搜索云端任务",
        actions: (
          <>
            {onRefreshCloud && mcConnection.phase === "connected" && (
              <button className="hv icon-btn" title="刷新云端任务" onClick={onRefreshCloud} style={{ ...headerAction, background: "transparent" }}>
                <IconRefresh size={12} style={cloudSyncing ? { animation: "mcspin .9s linear infinite" } : undefined} />
              </button>
            )}
            <button className="hv-acc icon-btn" title="新建云端任务" onClick={onNewCloudTask} style={{ ...headerAction, background: "var(--acc)" }}>
              <IconPlus size={11} color="var(--onAcc)" />
            </button>
          </>
        ),
        content: cloudContent(),
      };
    }
    if (space === "chat") {
      return {
        title: "对话",
        detail: `${chatAll.filter((m) => !m.archived).length} 条独立对话`,
        placeholder: "搜索对话",
        actions: (
          <button className="hv-acc icon-btn" title="新建对话" onClick={onNewChat} style={{ ...headerAction, background: "var(--acc)" }}>
            <IconPlus size={11} color="var(--onAcc)" />
          </button>
        ),
        content: (
          <>
            {chats.length ? <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{chats.map((m) => sessionRow(m, false))}</div> : (
              <EmptyState icon={norm ? <IconSearch size={19} color="var(--t6)" /> : <IconChat size={21} color="var(--t6)" />} title={norm ? "没有匹配的对话" : "还没有独立对话"} detail={norm ? "试试标题中的其他关键词。" : "新建一段不绑定项目的普通对话。"} />
            )}
            {chatArchived.length > 0 && (
              <ProjectGroup name={`已归档对话 · ${chatArchived.length}`} expanded={!!norm || chatArchiveOpen} muted onToggle={toggleChatArchive}>
                {chatArchived.map((m) => sessionRow(m, true))}
              </ProjectGroup>
            )}
          </>
        ),
      };
    }
    return {
      title: "本地项目",
      detail: `${activeProjectCount} 个项目 · ${activeSessionCount} 个会话`,
      placeholder: "搜索项目或会话",
      actions: (
        <button className="hv-acc icon-btn" title="新建本地任务" onClick={() => onNewTask()} style={{ ...headerAction, background: "var(--acc)" }}>
          <IconPlus size={11} color="var(--onAcc)" />
        </button>
      ),
      content: (
        <>
          {projectGroups.map((group) => projectRow(group, false))}
          {projectGroups.length === 0 && archivedProjectGroups.length === 0 && (
            <EmptyState icon={norm ? <IconSearch size={19} color="var(--t6)" /> : <IconMonitor size={21} color="var(--t6)" />} title={norm ? "没有匹配的会话" : "还没有本地项目"} detail={norm ? "试试项目名、目录或会话标题。" : "选择一个文件夹，开始第一个本地任务。"} />
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
      <div className="mc-nav-rail" style={{ width: 62, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", background: "var(--rail)", borderRight: "1px solid var(--line2)" }}>
        <MacDragSpacer />
        <img src={logoUrl} alt="MonkeyCode" draggable={false} style={{ width: 31, height: 31, borderRadius: 9, margin: "2px 0 15px" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
          <RailButton active={space === "cloud"} label="云端" badge={cloudRunning.length} icon={<IconCloud size={16} color={space === "cloud" ? "var(--accSelT)" : "var(--t4)"} />} onClick={() => selectSpace("cloud")} />
          <RailButton active={space === "local"} label="本地" badge={localAttention} icon={<IconMonitor size={16} color={space === "local" ? "var(--accSelT)" : "var(--t4)"} strokeWidth={1.25} />} onClick={() => selectSpace("local")} />
          <RailButton active={space === "chat"} label="对话" badge={chatAttention} icon={<IconChat size={16} color={space === "chat" ? "var(--accSelT)" : "var(--t4)"} />} onClick={() => selectSpace("chat")} />
        </div>
        <span style={{ flex: 1 }} />
        <span title={status} style={{ width: 32, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "var(--ok)" : "var(--t6)", boxShadow: connected ? "0 0 0 3px var(--okBg)" : "none" }} />
        </span>
        <button className="hv icon-btn" title="设置" onClick={onOpenSettings} style={{ position: "relative", width: 36, height: 36, borderRadius: 10, marginBottom: 12 }}>
          <IconGear size={15} />
          {update?.available && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "var(--notice)", border: "1.5px solid var(--rail)" }} />}
        </button>
      </div>

      <aside className="mc-sidebar-panel" style={{ width: 232, flex: "none", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--side)", borderRight: "1px solid var(--line)" }}>
        <MacDragSpacer />
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
            {!updateBusy && <span style={{ color: "var(--acc)", fontSize: 10.5, fontWeight: 700 }}>更新</span>}
          </button>
        )}
      </aside>
    </div>
  );
}
