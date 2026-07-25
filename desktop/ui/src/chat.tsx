// 会话视图:标题栏 / 对话流 / 运行条 / 排队 chip / composer。
// 布局与数值取自设计稿 Chat 屏;协议交互(发送/审批/切模型等)统一走 session 句柄
// (useSession),App 只注入布局级回调(抽屉/子会话/归档/删除)。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  DeleteMenuItem,
  HeaderFilesButton,
  HeaderMenu,
  LogList,
  MONO,
  TaskPanel,
  ViewHeader,
  type MenuState,
} from "./components";
import { Composer, QueuedChip, RunningBar } from "./composer";
import { IconArchive, IconChat, IconCheck, IconChevronDown, IconFolder, IconInfo, IconShield, IconTaskDone, IconX } from "./icons";
import logoUrl from "./logo.png";
import { useUpwardMenuHeight } from "./menuPosition";
import { workspaceRelativePath } from "./markdownPaths";
import type { SessionHandle } from "./useSession";
import { modelSourceLabel, type LogItem, type ModelInfo, type SessionMeta, type SessionNotice, type Usage } from "./types";

// IME 守卫随 composer 收敛到 composer.tsx;从这转口保持既有引用面
// (sidebar/newtask 均 import 自 ./chat)
export { isImeEnter, markImeEnd } from "./composer";

// 各会话的滚动位置记忆:切走再切回仍在原位;贴底离开的会话回来仍贴底。
// 记「视口顶部的条目序号 + 条目内偏移」而非 scrollTop 像素:历史分批回放、
// 工具结果合并进先前条目、折叠态重置都会改变上方内容高度,像素值会漂,
// 锚点跟着条目走才对得上"看到哪了"。切换时滚动容器随 chat 清空整个卸载重挂,
// 且 ChatView 本身也会因设置页等视图切换而重挂,记忆只能存在模块级
const scrollMemo = new Map<string, { anchor: number; offset: number; pinned: boolean }>();

const fmtK = (n: number) =>
  n >= 1_000_000 ? Math.round(n / 100_000) / 10 + "M" : n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n);

/** 对话与操作区共用响应式内容轨：默认窗口保持紧凑，宽屏渐进展开，
 * 但在 920px 封顶以免正文行长失控；窄屏至少保留 24px 单侧外沿。 */
export const COL_MAX = "min(clamp(820px, 76%, 920px), calc(100% - 48px))";

export const basename = (p: string) => p.replace(/[\/\\]+$/, "").split(/[\/\\]/).pop() || p;

/** 上下文用量圆环(设计稿 composer 的 ctx ring):悬停展示精确数字气泡
 * (自定义气泡而非 title:WKWebView 的原生提示不可靠且出现慢) */
function ContextRing({ usage }: { usage: Usage | null }) {
  const [hover, setHover] = useState(false);
  const C = 2 * Math.PI * 7;
  const frac = usage && usage.size > 0 ? usage.used / usage.size : 0;
  const dash = (C * Math.max(0.03, Math.min(1, frac))).toFixed(1) + " " + C.toFixed(1);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative", display: "flex", flex: "none", cursor: "default" }}
    >
      <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7" stroke="var(--track)" strokeWidth="2" />
        <circle
          cx="9"
          cy="9"
          r="7"
          stroke={frac > 0.85 ? "var(--err)" : "var(--acc)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={dash}
          transform="rotate(-90 9 9)"
        />
      </svg>
      {hover && (
        <span
          className="pop"
          style={{
            position: "absolute",
            bottom: 26,
            right: -6,
            borderRadius: 8,
            padding: "7px 11px",
            gap: 3,
            whiteSpace: "nowrap",
            animation: "mcin .12s ease",
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--t5)" }}>上下文用量</span>
          {usage ? (
            <>
              <span style={{ font: "12px " + MONO, color: "var(--t1)" }}>
                {usage.used.toLocaleString()} / {usage.size.toLocaleString()} tokens
              </span>
            </>
          ) : (
            <span style={{ fontSize: 11.5, color: "var(--t4)" }}>暂无数据,本轮请求后更新</span>
          )}
        </span>
      )}
    </span>
  );
}

/** 权限模式 pill:默认权限 / YOLO 点击互切(⇧⇥ 同) */
function PermPill({ yolo, onToggle }: { yolo: boolean; onToggle: () => void }) {
  const fg = yolo ? "var(--warn)" : "var(--t3)";
  return (
    <button
      title="点击切换权限模式 (⇧⇥);YOLO 下所有操作不再询问,直接执行"
      onClick={onToggle}
      style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        gap: 5,
        padding: "0 9px",
        borderRadius: 12,
        border: `1px solid ${yolo ? "var(--warnBd)" : "var(--btnBd)"}`,
        background: yolo ? "var(--warnBg)" : "transparent",
        color: fg,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        flex: "none",
      }}
    >
      <IconShield color={fg} />
      {yolo ? "YOLO" : "默认权限"}
    </button>
  );
}

/** 模型菜单的共享选项行:本地/云端统一为整行 hover + 当前项勾选。 */
export function ModelMenuItem({
  label,
  selected,
  hint,
  onClick,
}: {
  label: string;
  selected: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      className="hv menu-item"
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      style={{
        width: "100%",
        minWidth: 0,
        padding: "7px 10px",
        color: selected ? "var(--acc)" : "var(--t2)",
        fontWeight: selected ? 600 : 400,
      }}
    >
      <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {hint && <span style={{ flex: "none", fontSize: 11, color: "var(--t5)", fontWeight: 400 }}>{hint}</span>}
      {selected && <IconCheck size={11} color="var(--acc)" strokeWidth={1.6} />}
    </button>
  );
}

/** 模型选择触发按钮:新建页、本地会话、云端会话共用同一几何与开合态。 */
export function ModelPickerTrigger({
  label,
  open,
  disabled,
  title,
  onClick,
}: {
  label: string;
  open: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className={disabled ? undefined : "hv"}
      disabled={disabled}
      title={title}
      onClick={onClick}
      style={{
        height: 24,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 7px",
        border: "none",
        borderRadius: 6,
        background: open ? "var(--hov)" : "transparent",
        fontSize: 12,
        color: disabled ? "var(--t5)" : "var(--t3)",
        cursor: disabled ? "default" : "pointer",
        fontWeight: 500,
        maxWidth: 220,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span className="ellipsis">{label || "模型"}</span>
      <IconChevronDown style={{ marginTop: 1 }} />
    </button>
  );
}

/** 模型选择按钮 + 上弹菜单(按来源分组;模型多时带过滤框) */
export function ModelPicker({
  models,
  current,
  disabled,
  onPick,
}: {
  models: ModelInfo[];
  current: string;
  disabled?: boolean;
  onPick: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { anchorRef, menuMaxHeight } = useUpwardMenuHeight<HTMLDivElement>(open, 370);

  const q = filter.trim().toLowerCase();
  const shown = q ? models.filter((m) => m.name.toLowerCase().includes(q)) : models;
  // 按来源分桶:「自定义」(无 source)恒在前,其余组按首次出现顺序
  const groups: { label: string; items: ModelInfo[] }[] = [];
  for (const m of shown) {
    const label = modelSourceLabel(m.source);
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, items: [] };
      if (!m.source) groups.unshift(g);
      else groups.push(g);
    }
    g.items.push(m);
  }
  const showFilter = models.length > 10;

  return (
    <div ref={anchorRef} style={{ position: "relative", flex: "none" }}>
      <ModelPickerTrigger
        label={current}
        open={open}
        disabled={disabled}
        title={disabled ? "轮次执行中,结束后可切换" : "切换模型(下一轮生效)"}
        onClick={() => {
          if (disabled) return;
          setFilter("");
          setOpen(!open);
        }}
      />
      {open && (
        <>
          <div className="backdrop" onClick={() => setOpen(false)} />
          <div className="pop model-menu" style={{ position: "absolute", bottom: 30, right: 0, maxHeight: menuMaxHeight, overflow: "hidden" }}>
            {showFilter && (
              <div style={{ padding: "6px 8px 4px" }}>
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="过滤模型…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    height: 26,
                    padding: "0 8px",
                    fontSize: 12,
                    border: "1px solid var(--inputBd)",
                    borderRadius: 6,
                    background: "var(--bg)",
                    color: "var(--t2)",
                    outline: "none",
                  }}
                />
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {groups.length === 0 && (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--t5)" }}>无匹配模型</div>
              )}
              {groups.map((g) => (
                <div key={g.label}>
                  {(groups.length > 1 || g.label !== "自定义") && (
                    <div style={{ padding: "6px 10px 3px", fontSize: 10.5, fontWeight: 700, color: "var(--t5)", letterSpacing: 0.4 }}>
                      {g.label}
                    </div>
                  )}
                  {g.items.map((m) => (
                    <ModelMenuItem
                      key={m.name}
                      label={m.name}
                      selected={m.name === current}
                      hint={m.default ? "默认" : undefined}
                      onClick={() => {
                        setOpen(false);
                        onPick(m.name);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const NOTICE_VISUAL: Record<SessionNotice["tone"], { color: string; background: string; border: string }> = {
  success: { color: "var(--ok)", background: "var(--addBg)", border: "var(--accBd)" },
  warning: { color: "var(--warnT)", background: "var(--warnBg)", border: "var(--warnBd2)" },
  error: { color: "var(--err)", background: "var(--errBg)", border: "var(--errBd)" },
  info: { color: "var(--acc)", background: "var(--accBgSoft)", border: "var(--accBd)" },
};

/** Composer 上方短暂提示；后台会话提示的主体可点击跳转，关闭按钮只关闭。 */
export function SessionNoticeBanner({
  notice,
  onDismiss,
  onOpenSession,
}: {
  notice: SessionNotice;
  onDismiss: () => void;
  onOpenSession: (id: string) => void;
}) {
  const visual = NOTICE_VISUAL[notice.tone];
  const content = (
    <>
      {notice.tone === "success" ? <IconTaskDone size={13} color={visual.color} /> : <IconInfo size={13} color={visual.color} />}
      <span className="ellipsis" style={{ flex: 1 }}>{notice.text}</span>
      {notice.targetSessionId && <span style={{ flex: "none", fontSize: 11.5, fontWeight: 700 }}>查看 ›</span>}
    </>
  );
  const mainStyle = {
    minWidth: 0,
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 8px 7px 12px",
    border: "none",
    borderRadius: "8px 0 0 8px",
    background: "transparent",
    color: "inherit",
    fontSize: 12.5,
    textAlign: "left" as const,
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        borderRadius: 9,
        border: `1px solid ${visual.border}`,
        background: visual.background,
        color: visual.color,
        animation: "mcin .12s ease",
        overflow: "hidden",
      }}
    >
      {notice.targetSessionId ? (
        <button
          className="hv-op"
          title="打开对应会话"
          onClick={() => onOpenSession(notice.targetSessionId!)}
          style={{ ...mainStyle, cursor: "pointer" }}
        >
          {content}
        </button>
      ) : (
        <span style={mainStyle}>{content}</span>
      )}
      <button
        onClick={onDismiss}
        style={{ width: 28, alignSelf: "stretch", flex: "none", border: "none", background: "transparent", color: visual.color, cursor: "pointer", fontSize: 13, padding: 0 }}
        title="关闭"
      >
        ✕
      </button>
    </div>
  );
}

export function ChatView({
  meta,
  session,
  models,
  currentModel,
  chatMode = false,
  onOpenDrawer,
  onOpenChild,
  onOpenNoticeSession,
  onArchive,
  onDelete,
}: {
  meta: SessionMeta | undefined;
  /** 会话句柄(协议状态与动作,useSession) */
  session: SessionHandle;
  models: ModelInfo[];
  /** 展示用模型名(session.model 为空时 App 已回退默认) */
  currentModel: string;
  /** 普通对话有隐藏 cwd 供引擎运行，但界面不暴露为项目，也不显示文件入口。 */
  chatMode?: boolean;
  onOpenDrawer: (tab?: "files" | "changes") => void;
  onOpenChild: (id: string) => void;
  onOpenNoticeSession: (id: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { chat, input, queued, atts, yolo } = session;
  const changesCount = session.changes?.length ?? 0;
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true); // 用户是否停留在底部(自动跟随滚动)
  // 待恢复的锚点;回放期间每批都重新对齐(上方内容变高也不漂),用户主动滚动后交还控制权
  const restoreRef = useRef<{ anchor: number; offset: number } | null>(null);
  const [menu, setMenu] = useState<MenuState>("closed");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0); // dragenter/leave 在子元素间反复触发,计数配对

  // 会话切换:复位跟随状态并取出记忆位置。ChatView 不按会话重挂载,
  // 不显式复位的话 pinnedRef 会带着上一会话的值进入新会话(切过来停在顶部的根因)
  useLayoutEffect(() => {
    const saved = session.id ? scrollMemo.get(session.id) : undefined;
    pinnedRef.current = saved ? saved.pinned : true; // 首次打开默认贴底
    restoreRef.current = saved && !saved.pinned ? { anchor: saved.anchor, offset: saved.offset } : null;
    if (!restoreRef.current) return;
    // 渲染后布局还会无事件地微调一次(实测 ~6px,RO 也抓不到这种再分配):
    // 恢复期间低频轮询对齐兜底,对齐到位后是零修正的空转,用户接管即停
    const iv = window.setInterval(() => {
      if (restoreRef.current) alignLog();
      else clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [session.id]);

  // 自动滚动:优先对齐记忆锚点,否则贴底跟随
  const alignLog = () => {
    const el = logRef.current;
    if (!el) return;
    const a = restoreRef.current;
    if (a) {
      const kids = el.firstElementChild?.children;
      // 锚点条目还没回放出来时先不动(停在已回放内容的开头),出来后逐批对齐
      if (kids && a.anchor < kids.length) {
        const r = kids[a.anchor].getBoundingClientRect();
        el.scrollTop += r.top - el.getBoundingClientRect().top + a.offset;
      }
    } else if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  };
  useEffect(alignLog, [chat.items, chat.running]);

  // 图片解码/字体加载等异步高度变化不经过 items,回放结束后仍会把位置顶漂
  // (实测漂 6px):监听内容列高度做兜底重对齐。用户接管后(restore 清空且
  // 未贴底)此路径自然不动作
  const hasLog = chat.items.length > 0;
  useEffect(() => {
    const col = logRef.current?.firstElementChild;
    if (!col) return;
    const ro = new ResizeObserver(alignLog);
    ro.observe(col);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLog]);

  const saveAnchor = () => {
    const el = logRef.current;
    // 恢复进行中的程序滚动不写记忆,避免中途切走时锚点被半成品覆盖
    if (!el || !session.id || restoreRef.current) return;
    const elTop = el.getBoundingClientRect().top;
    let anchor = 0;
    let offset = 0;
    const kids = el.firstElementChild?.children ?? [];
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (r.bottom > elTop) {
        // 视口顶部所在的条目:offset 为条目顶到视口顶的已滚过距离
        anchor = i;
        offset = elTop - r.top;
        break;
      }
    }
    scrollMemo.set(session.id, { anchor, offset, pinned: pinnedRef.current });
  };
  const saveTimer = useRef(0);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    // scroll 事件只做"贴底→跟随"的单向判定,离底不在这里判:程序滚动同样发
    // scroll 事件,回放中一批内容长高 >40px 就会把跟随误判成用户离底(实测
    // 卡在中途)。离底判定只认用户真实输入(onWheel/滚动条拖拽)
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) pinnedRef.current = true;
    saveAnchor();
    // 滚动停止后布局仍会微调一次(实测 ~6px,不发 scroll 事件),停稳后补一次校准
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveAnchor, 600);
  };

  // 用户主动介入即终止锚点恢复,交还滚动控制权;向上意图同时解除贴底跟随
  const cancelRestore = () => {
    restoreRef.current = null;
  };
  const onLogWheel = (e: ReactWheelEvent) => {
    cancelRestore();
    if (e.deltaY < 0) pinnedRef.current = false; // 向上滚 = 离开底部去看历史
  };
  const onLogMouseDown = (e: ReactMouseEvent) => {
    cancelRestore();
    // 按在右缘滚动条带上 = 准备拖动定位,解除跟随(拖回底部会经 scroll 事件重新贴上)
    const el = logRef.current;
    if (el && e.clientX > el.getBoundingClientRect().right - 20) pinnedRef.current = false;
  };

  // 用户从历史位置发出新消息时,这次发送本身就是回到当前轮次的
  // 明确意图:立即结束锚点恢复并重新贴底。后续 user-input / 流式帧到达时
  // alignLog effect 会持续跟到最新内容;空输入或未连接的未接受发送不改变位置。
  const sendAndFollow = () => {
    if (!session.send()) return;
    restoreRef.current = null;
    pinnedRef.current = true;
    alignLog();
  };

  // 粘贴附件:剪贴板里的 file item(截图/复制的文件)上传为附件,文本粘贴不受影响
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      void session.addFiles(files);
    }
  };

  // 拖拽文件进对话区
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void session.addFiles(files);
  };

  const workdir = meta?.workdir ?? "";
  const revealMarkdownLink = (path: string) => {
    const rel = workspaceRelativePath(path, workdir);
    if (rel === null) {
      session.notify("⚠ 只能打开当前工作区内的文件");
      return;
    }
    session
      .reveal(rel)
      .then((r) => {
        if (r.error) session.notify("⚠ 无法定位文件: " + r.error);
      })
      .catch((e) => session.notify("⚠ 无法定位文件: " + (e instanceof Error ? e.message : String(e))));
  };
  const empty = chat.items.length === 0 && !chat.running;
  const openPerm = [...chat.items].reverse().find((it) => it.kind === "perm" && it.state === "open") as
    | Extract<LogItem, { kind: "perm" }>
    | undefined;
  const anyToolRunning = chat.items.some((it) => it.kind === "tool" && it.status === "run");
  const runningLabel = openPerm ? "等待权限确认" : anyToolRunning ? "执行中" : "思考中";
  const roundNo = Math.max(1, chat.items.filter((it) => it.kind === "user").length);
  const usage = chat.usage;

  return (
    <div
      style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div
          style={{
            position: "absolute",
            inset: 8,
            zIndex: 20,
            border: "2px dashed var(--acc)",
            borderRadius: 14,
            background: "var(--accBgSoft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--acc)",
          }}
        >
          松开以添加文件
        </div>
      )}
      {/* ==== 标题栏(共享 ViewHeader:56px 双行,空白区可拖拽窗口)==== */}
      <ViewHeader
        title={meta?.title || (chatMode ? "新对话" : "新任务")}
        subtitle={
          chatMode ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--t5)" }}>
              <IconChat size={11} color="var(--t5)" />
              独立对话 · 不关联项目
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--t5)", minWidth: 0 }}>
              <IconFolder size={11} color="var(--t6)" />
              <span style={{ fontWeight: 600, color: "var(--t3)", flex: "none" }}>{basename(workdir)}</span>
              <span style={{ color: "var(--t7)", flex: "none" }}>·</span>
              <span className="ellipsis" style={{ fontFamily: MONO }}>{workdir}</span>
            </span>
          )
        }
      >
        {!chatMode && (
          <HeaderFilesButton
            title="浏览工作区文件(标注本轮改动)"
            onClick={() => onOpenDrawer()}
            badge={
              changesCount > 0 && (
                <span
                  title="查看本轮改动"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDrawer("changes");
                  }}
                  style={{
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    background: "var(--accBg)",
                    color: "var(--acc)",
                    fontSize: 10.5,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 4px",
                  }}
                >
                  {changesCount}
                </span>
              )
            }
          />
        )}
        <HeaderMenu
          menu={menu}
          setMenu={setMenu}
          minWidth={118}
          confirm={{ message: "删除后不可恢复。", confirmLabel: "确认删除", onConfirm: onDelete }}
        >
          <button
            className="hv menu-item"
            onClick={() => {
              setMenu("closed");
              onArchive();
            }}
          >
            <IconArchive />
            {meta?.archived ? "取消归档" : "归档"}
          </button>
          <DeleteMenuItem running={chat.running} onDelete={() => setMenu("confirm")} />
        </HeaderMenu>
      </ViewHeader>

      {/* ==== 对话流 / 空态 ==== */}
      {empty ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
          <img src={logoUrl} alt="" draggable={false} style={{ width: 52, height: 52 }} />
          <div style={{ fontSize: 15, fontWeight: 700, textAlign: "center", maxWidth: 420 }}>
            {chatMode ? (
              "开始一段新对话"
            ) : (
              <>在 <span style={{ whiteSpace: "nowrap", fontFamily: MONO, fontSize: 13.5 }}>{workdir}</span> 开始新任务</>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--t5)", textAlign: "center", lineHeight: 1.6 }}>
            {chatMode ? "可以用来记录想法、讨论方案，或者快速问一个问题。" : "描述你想做的事，比如修一个 Bug、加一个功能，或者让我先看看这个项目。"}
          </div>
        </div>
      ) : (
        // scrollbar-gutter 两侧对称预留(Chromium 94+):滚动条出现时内容列不再被挤得比 composer 偏左
        <div
          ref={logRef}
          onScroll={onLogScroll}
          onWheel={onLogWheel}
          onTouchStart={cancelRestore}
          onMouseDown={onLogMouseDown}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, scrollbarGutter: "stable both-edges" }}
        >
          <div style={{ width: "100%", maxWidth: COL_MAX, margin: "0 auto", padding: "28px 30px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
            <LogList
              items={chat.items}
              onPermAnswer={session.answerPerm}
              onAskAnswer={session.answerAsk}
              onOpenChild={onOpenChild}
              uploadUrl={session.uploadUrl}
              onLocalLink={revealMarkdownLink}
              workdir={workdir}
            />
          </div>
        </div>
      )}

      {/* ==== 运行条 + 排队 + composer(680 列,钉在底部)====
          width 扣掉 16px:对话列在滚动容器内被 scrollbar-gutter 双侧各让 8px,
          composer 在容器外,同步扣减后两列在任意窗口宽度下公式一致、像素对齐 */}
      <div style={{ flex: "none", maxWidth: COL_MAX, width: "calc(100% - 16px)", margin: "0 auto", padding: "0 30px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* 实时任务面板(todo_update 驱动;钉住,不进对话流) */}
        {chat.plan.length > 0 && <TaskPanel entries={chat.plan} />}
        {/* 短暂提示:操作错误 + 可跳转的后台会话状态；独立于连接状态行。 */}
        {session.notice && (
          <SessionNoticeBanner notice={session.notice} onDismiss={session.dismissNotice} onOpenSession={onOpenNoticeSession} />
        )}
        {queued && <QueuedChip text={queued} hint="运行结束后自动发送" onClear={session.clearQueued} />}

        <Composer
          value={input}
          placeholder={
            chat.running
              ? "补充说明…运行中发送会排队"
              : chatMode
                ? "输入消息…粘贴或拖入图片、文件可作为附件"
                : "输入任务…粘贴或拖入图片、文件可作为附件"
          }
          sendActive={!!input.trim() || atts.length > 0}
          onChange={session.setInput}
          onSend={sendAndFollow}
          onPaste={onPaste}
          above={
            (chat.running || atts.length > 0) && (
              <>
                {chat.running && (
                  <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line2)", borderRadius: "13px 13px 0 0", background: "var(--accBgSoft)" }}>
                    <RunningBar
                      label={runningLabel}
                      detail={`第 ${roundNo} 轮${usage ? ` · ${fmtK(usage.used)} tokens` : ""}`}
                      onStop={session.stop}
                    />
                  </div>
                )}
                {atts.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px 0" }}>
                {atts.map((a, i) => (
                  <span key={a.path} style={{ position: "relative", display: "flex" }}>
                    {a.isImage ? (
                      <img
                        src={a.preview}
                        alt={a.path}
                        title={a.path}
                        style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--cardBd)" }}
                      />
                    ) : (
                      <span
                        title={a.path}
                        style={{
                          height: 30,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "0 10px",
                          borderRadius: 8,
                          border: "1px solid var(--cardBd)",
                          background: "var(--codeBg)",
                          fontSize: 12,
                          color: "var(--t2)",
                          maxWidth: 220,
                        }}
                      >
                        <IconFolder size={12} color="var(--t4)" />
                        <span className="ellipsis">{a.name}</span>
                      </span>
                    )}
                    <button
                      className="icon-btn"
                      title="移除"
                      onClick={() => session.removeAtt(i)}
                      style={{
                        position: "absolute",
                        top: -5,
                        right: -5,
                        width: 17,
                        height: 17,
                        border: "1px solid var(--line)",
                        borderRadius: "50%",
                        background: "var(--card)",
                        boxShadow: "var(--cardSh)",
                      }}
                    >
                      <IconX size={8} color="var(--t3)" />
                    </button>
                  </span>
                ))}
                </div>}
              </>
            )
          }
          controls={
            <>
              <PermPill yolo={yolo} onToggle={() => void session.toggleYolo()} />
              <span style={{ flex: 1 }} />
              <ModelPicker models={models} current={currentModel} disabled={chat.running} onPick={(name) => void session.switchModel(name)} />
              <ContextRing usage={usage} />
            </>
          }
        />
      </div>
    </div>
  );
}
