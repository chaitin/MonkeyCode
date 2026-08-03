// 会话视图:标题栏 / 对话流 / 运行条 / 排队 chip / composer。
// 布局与数值取自设计稿 Chat 屏;协议交互(发送/审批/切模型等)统一走 session 句柄
// (useSession),App 只注入布局级回调(抽屉/子会话/归档/删除)。
import {
  useEffect,
  useLayoutEffect,
  useMemo,
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
  HeaderSummary,
  LogList,
  MONO,
  OutlineNav,
  OUTLINE_JUMP_INSET,
  TaskPanel,
  ViewHeader,
  mergeLiveOutline,
  outlineActiveSeq,
  outlineEntries,
  useRenameDraft,
  type MenuState,
  type OutlineEntry,
} from "./components";
import { Composer, QueuedChip, RunningBar, UploadingChip } from "./composer";
import { IconArchive, IconChat, IconCheck, IconChevronDown, IconFolder, IconInfo, IconPencil, IconShield, IconTaskDone, IconX } from "./icons";
import logoUrl from "./logo.png";
import { useUpwardMenuHeight } from "./menuPosition";
import {
  filterModels,
  groupMemberSections,
  modelDisplay,
  modelDisplayByName,
  modelMenuTabs,
  shouldShowModelExtras,
  stripSourceSuffix,
} from "./modelMenu";
import { useNativeFileDrop } from "./nativeDrop";
import { workspaceRelativePath } from "./markdownPaths";
import type { SessionHandle } from "./useSession";
import { SOURCE_MONKEYCODE, type LogItem, type ModelInfo, type SessionMeta, type SessionNotice, type Usage } from "./types";

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

/** 模型菜单的共享选项行:本地/云端统一为整行 hover + 当前项勾选。
 * tag = 会员档位药丸(基础/专业/旗舰);title 缺省 = label,展示短名的
 * 条目传完整原名做 hover 兜底;disabled = 灰态禁选(超会员档的锁定条目)。 */
export function ModelMenuItem({
  label,
  selected,
  tag,
  hint,
  title,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  tag?: string;
  hint?: string;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={disabled ? "menu-item" : "hv menu-item"}
      aria-current={selected ? "true" : undefined}
      disabled={disabled}
      title={title ?? label}
      onClick={disabled ? undefined : onClick}
      style={{
        width: "100%",
        minWidth: 0,
        padding: "7px 10px",
        color: selected ? "var(--accTx)" : "var(--t2)",
        fontWeight: selected ? 600 : 400,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : undefined,
      }}
    >
      <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {tag && (
        <span
          style={{
            flex: "none",
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 6px",
            borderRadius: 4,
            background: "var(--hov)",
            color: "var(--t4)",
            whiteSpace: "nowrap",
          }}
        >
          {tag}
        </span>
      )}
      {hint && <span style={{ flex: "none", fontSize: 11, color: "var(--t5)", fontWeight: 400 }}>{hint}</span>}
      {selected && <IconCheck size={11} color="var(--accTx)" strokeWidth={1.6} />}
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
        // 宽度上限由各使用处的包裹层给(newtask/chat/cloudtask 语境不同);
        // 自身可收缩到 0——composer 行寸土寸金,长模型名靠 ellipsis 截断,
        // 不能把「开始任务/发送」按钮挤出卡片
        maxWidth: "100%",
        minWidth: 0,
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
  // 来源 tab:null =「跟随当前模型的来源」渲染期派生,仅用户点击才落
  // 具体值——models 异步晚到/刷新时不会停在错误来源
  const [tab, setTab] = useState<string | null>(null);
  const { anchorRef, menuMaxHeight } = useUpwardMenuHeight<HTMLDivElement>(open, 370);

  // 过滤框在模型多时才有意义;tab 行只要 ≥2 来源就恒显(它是来源间唯一导航)
  const showExtras = shouldShowModelExtras(models.length);
  const tabs = modelMenuTabs(models);
  // 当前来源归一必须 `|| ""`:自定义的 tab key 是空串,`??` 会把它吞成会员
  const currentSource = models.find((m) => m.name === current)?.source || "";
  const wantTab = tab ?? currentSource;
  const activeTab = tabs.some((t) => t.key === wantTab) ? wantTab : (tabs[0]?.key ?? "");
  const showTabs = tabs.length >= 2;
  // 过滤在 tab 内;会员 tab 按档位/付费/我的/团队分节(节头表达档位,
  // 条目不再带药丸),其余来源平铺
  const tabItems = filterModels(models.filter((m) => (m.source || "") === activeTab), filter);
  const memberSections = activeTab === SOURCE_MONKEYCODE ? groupMemberSections(tabItems) : null;

  // Esc 关闭必须在 window **capture** 阶段拦截:App 的全局快捷键挂在冒泡
  // 阶段,会话视图存在待审批时 Esc 是不可逆的拒绝(appView.ts)——菜单
  // 开着时这一下只能归菜单,stopImmediatePropagation 保证审批处理器不跑。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const pick = (name: string) => {
    setOpen(false);
    onPick(name);
  };

  // 条目渲染收口:会员 tab 分节内省略档位药丸(节头已表达);locked
  // 条目灰态禁选,title 说明解锁路径
  const itemOf = (m: ModelInfo, noTag = false) => {
    const d = modelDisplay(m);
    return (
      <ModelMenuItem
        key={m.name}
        label={d.label}
        tag={noTag ? undefined : d.tier}
        title={m.locked ? `${stripSourceSuffix(m.name)} · 当前会员档不可用,升级后重新同步` : stripSourceSuffix(m.name)}
        selected={m.name === current}
        disabled={m.locked}
        hint={m.default ? "默认" : undefined}
        onClick={() => pick(m.name)}
      />
    );
  };

  return (
    <div
      ref={anchorRef}
      style={{ position: "relative", display: "flex", flex: "0 1 auto", minWidth: 0, maxWidth: 220 }}
    >
      <ModelPickerTrigger
        label={modelDisplayByName(models, current).label}
        open={open}
        disabled={disabled}
        title={disabled ? "轮次执行中,结束后可切换" : `${stripSourceSuffix(current) || "选择模型"} · 点击切换(下一轮生效)`}
        onClick={() => {
          if (disabled) return;
          setFilter("");
          setTab(null); // 打开时回到「跟随当前模型来源」
          setOpen(!open);
        }}
      />
      {open && (
        <>
          <div className="backdrop" onClick={() => setOpen(false)} />
          <div className="pop model-menu" style={{ position: "absolute", bottom: 30, right: 0, maxHeight: menuMaxHeight, overflow: "hidden" }}>
            {showExtras && (
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
            {showTabs && (
              <div style={{ display: "flex", gap: 2, padding: "2px 8px 4px" }}>
                {tabs.map((t) => (
                  // span 而非 button:不进 Tab 焦点序、无键盘处理,不与 Esc
                  // 的 window capture 及过滤框 autoFocus 抢交互
                  <span
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      height: 20,
                      padding: "0 8px",
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      userSelect: "none",
                      background: activeTab === t.key ? "var(--hov)" : "transparent",
                      color: activeTab === t.key ? "var(--accTx)" : "var(--t5)",
                    }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            )}
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {tabItems.length === 0 && (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--t5)" }}>
                  {models.length === 0 ? "尚未配置模型" : "无匹配模型"}
                </div>
              )}
              {/* 会员 tab:档位/付费/我的/团队分节,节头恒显(每节都承载语义);
                  其余来源平铺(单一来源下组头是冗余) */}
              {memberSections !== null
                ? memberSections.map((s) => (
                    <div key={s.label}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 3px" }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, fontWeight: 700, color: "var(--t5)", letterSpacing: 0.4 }}>
                          {s.label}
                        </span>
                        {s.badge && <span style={{ flex: "none", fontSize: 9.5, color: "var(--t6)" }}>{s.badge}</span>}
                      </div>
                      {s.items.map((m) => itemOf(m, true))}
                    </div>
                  ))
                : tabItems.map((m) => itemOf(m))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 思考深度档位(会话级),经引擎 session/setThinking RPC 生效(见
 * session.rs)。composer 不设抽象的「默认」项:未显式选档时直接显示
 * 模型设置里配置的档位(未配置 = 产品默认「低」,与壳物化一致,见
 * config.rs DEFAULT_MODEL_THINK),选啥就是啥。 */
export const THINK_LEVELS: { value: string; label: string; hint: string }[] = [
  { value: "off", label: "关闭", hint: "不思考,响应最快" },
  { value: "low", label: "低", hint: "简单任务,快速" },
  { value: "medium", label: "中", hint: "日常任务,均衡" },
  { value: "high", label: "高", hint: "疑难任务,深入但更慢" },
];

export const thinkLabelOf = (v: string) => THINK_LEVELS.find((l) => l.value === v)?.label ?? "关闭";

/** 会话/模型状态 → composer 显示的生效档位:会话显式选过用会话档,
 * 否则用模型设置的默认档(空 = 产品默认「低」,与壳物化一致)。 */
export const effectiveThink = (sessionThink: string, modelThink?: string) =>
  sessionThink || modelThink || "low";

/** 思考深度选择按钮 + 上弹菜单(会话/新任务 composer 共用;几何与
 * ModelPicker 同款,运行中禁用)。 */
export function ThinkPicker({
  current,
  disabled,
  onPick,
}: {
  current: string;
  disabled?: boolean;
  onPick: (level: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <ModelPickerTrigger
        label={`思考·${thinkLabelOf(current)}`}
        open={open}
        disabled={disabled}
        title={disabled ? "轮次执行中,结束后可切换" : "调整思考深度(下一轮生效)"}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
      />
      {open && (
        <>
          <div className="backdrop" onClick={() => setOpen(false)} />
          <div className="pop model-menu" style={{ position: "absolute", bottom: 30, right: 0 }}>
            {THINK_LEVELS.map((l) => (
              <ModelMenuItem
                key={l.value}
                label={l.label}
                selected={l.value === current}
                hint={l.hint}
                onClick={() => {
                  setOpen(false);
                  onPick(l.value);
                }}
              />
            ))}
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
  info: { color: "var(--accTx)", background: "var(--accBgSoft)", border: "var(--accBd)" },
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
      <span className="ellipsis selectable" style={{ flex: 1 }}>{notice.text}</span>
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
          title="跳转查看"
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
  onRename,
}: {
  meta: SessionMeta | undefined;
  /** 会话句柄(协议状态与动作,useSession) */
  session: SessionHandle;
  models: ModelInfo[];
  /** 展示用模型名(session.model 为空时 App 已回退默认) */
  currentModel: string;
  /** 普通对话有隐藏 cwd 供引擎运行,界面不暴露为项目;头部「临时目录」
   * 与本地任务的「文件」同走文件抽屉(会话产出的文件都落在临时目录,
   * 抽屉头部可跳系统文件管理器)。 */
  chatMode?: boolean;
  onOpenDrawer: (tab?: "files" | "changes") => void;
  onOpenChild: (id: string) => void;
  onOpenNoticeSession: (id: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const { chat, input, queued, atts, uploads, yolo } = session;
  const changesCount = session.changes?.length ?? 0;
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true); // 用户是否停留在底部(自动跟随滚动)
  // 待恢复的锚点;回放期间每批都重新对齐(上方内容变高也不漂),用户主动滚动后交还控制权
  const restoreRef = useRef<{ anchor: number; offset: number } | null>(null);
  const [menu, setMenu] = useState<MenuState>("closed");
  // 改名的编辑态与侧栏行同源;新任务空态还没有会话(meta 为空),标题不可改
  const rename = useRenameDraft(meta?.title ?? "", onRename);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0); // dragenter/leave 在子元素间反复触发,计数配对

  // 锚点恢复的轮询校准:渲染后布局还会无事件地微调一次(实测 ~6px,RO 也
  // 抓不到这种再分配),对齐到位后是零修正的空转,用户接管即停。
  // 会话切换恢复与大纲跳转共用同一条路径——跳转别自己写 scrollIntoView,
  // 图片解码/字体加载会把它顶漂,这里已经处理过。
  const restoreTimer = useRef(0);
  const stopRestorePolling = () => {
    window.clearInterval(restoreTimer.current);
    restoreTimer.current = 0;
  };
  const startRestore = (anchor: number, offset: number) => {
    restoreRef.current = { anchor, offset };
    alignLog();
    stopRestorePolling();
    restoreTimer.current = window.setInterval(() => {
      if (restoreRef.current) alignLog();
      else stopRestorePolling();
    }, 200);
  };
  useEffect(() => stopRestorePolling, []);

  // 「加载更早」的位置保持:前插会把所有条目往下推,记像素没用,记**元素**
  // ——keyBase 稳定 key 保证 React 不会把既有条目换成新节点,前插后按同一
  // 元素重新对齐,视口纹丝不动(云端那条路径至今没做,别照抄)
  const prependAnchor = useRef<{ node: Element; offset: number } | null>(null);
  const onLoadEarlier = () => {
    pinnedRef.current = false;
    void session.loadEarlier(() => {
      const el = logRef.current;
      const col = el?.firstElementChild;
      if (!el || !col) return;
      const elTop = el.getBoundingClientRect().top;
      for (const kid of Array.from(col.children)) {
        const r = kid.getBoundingClientRect();
        if (r.bottom > elTop) {
          prependAnchor.current = { node: kid, offset: elTop - r.top };
          break;
        }
      }
    });
  };
  // 用 layout effect:DOM 已更新但尚未绘制,这一帧就把位置纠回去,不闪
  useLayoutEffect(() => {
    const pa = prependAnchor.current;
    if (!pa) return;
    prependAnchor.current = null;
    const col = logRef.current?.firstElementChild;
    const idx = col ? Array.prototype.indexOf.call(col.children, pa.node) : -1;
    if (idx >= 0) startRestore(idx, pa.offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.items]);

  // ==== 提问大纲 ====
  // 壳目录 + 流内实时用户消息合并:刚发的提问不等轮末物化就进大纲
  const outline = useMemo(
    () => outlineEntries(mergeLiveOutline(session.outline, chat.items)),
    [session.outline, chat.items],
  );
  const [activeSeq, setActiveSeq] = useState<number | undefined>(undefined);
  const activeRaf = useRef(0);
  // 当前视口所在的提问 = 视口顶部之上最后一条用户气泡。判定沿用 saveAnchor
  // 同款 rect 比较,rAF 节流:流式期间每批帧都重算会把轨道刷成动画
  const updateActive = () => {
    const el = logRef.current;
    const col = el?.firstElementChild;
    if (!el || !col) return;
    const elTop = el.getBoundingClientRect().top;
    const seq = outlineActiveSeq(
      Array.from(col.children, (kid) => {
        const raw = (kid as HTMLElement).dataset?.mcSeq;
        return { top: kid.getBoundingClientRect().top, seq: raw ? Number(raw) : undefined };
      }),
      elTop,
    );
    setActiveSeq((prev) => (prev === seq ? prev : seq));
  };
  const scheduleActive = () => {
    if (activeRaf.current) return;
    activeRaf.current = window.requestAnimationFrame(() => {
      activeRaf.current = 0;
      updateActive();
    });
  };
  useEffect(scheduleActive, [chat.items]);
  // 取消后必须把 id 清零:scheduleActive 以「非零 = 已排队」做节流,残留
  // 旧 id 会让它永远短路(StrictMode 双挂载即触发,当前项从此不再更新)
  useEffect(
    () => () => {
      window.cancelAnimationFrame(activeRaf.current);
      activeRaf.current = 0;
    },
    [],
  );

  /** 定位到某次提问;目标不在当前 DOM 里返回 false(还没加载进来) */
  const jumpToSeq = (seq: number): boolean => {
    const col = logRef.current?.firstElementChild;
    const node = col?.querySelector(`[data-mc-seq="${seq}"]`);
    if (!col || !node) return false;
    const idx = Array.prototype.indexOf.call(col.children, node);
    if (idx < 0) return false;
    pinnedRef.current = false;
    // 复用锚点恢复:图片解码/字体加载后仍会自动纠偏(scrollIntoView 不会)
    startRestore(idx, -OUTLINE_JUMP_INSET);
    node.classList.remove("mc-jump-flash");
    void (node as HTMLElement).offsetWidth; // 重启动画
    node.classList.add("mc-jump-flash");
    window.setTimeout(() => node.classList.remove("mc-jump-flash"), 1000);
    return true;
  };
  const jumpWithRetry = (seq: number, tries = 12) => {
    if (jumpToSeq(seq) || tries <= 0) return;
    window.setTimeout(() => jumpWithRetry(seq, tries - 1), 32);
  };
  const onOutlineJump = (e: OutlineEntry) => {
    if (jumpToSeq(e.seq)) return;
    // 更早的提问还没加载:按它那一轮的偏移把历史补齐,再定位
    void session.ensureLoaded(e.offset).then(() => jumpWithRetry(e.seq));
  };

  // 会话切换:复位跟随状态并取出记忆位置。ChatView 不按会话重挂载,
  // 不显式复位的话 pinnedRef 会带着上一会话的值进入新会话(切过来停在顶部的根因)
  useLayoutEffect(() => {
    const saved = session.id ? scrollMemo.get(session.id) : undefined;
    pinnedRef.current = saved ? saved.pinned : true; // 首次打开默认贴底
    if (saved && !saved.pinned) startRestore(saved.anchor, saved.offset);
    else restoreRef.current = null;
    return () => stopRestorePolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    scheduleActive();
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
  // Linux 壳走原生拖放事件(HTML5 拖拽在 WebKitGTK 拿不到文件,见 nativeDrop.ts)
  useNativeFileDrop({
    enabled: true,
    onDragging: setDragging,
    onFiles: (files) => void session.addFiles(files),
    onError: (msg) => session.notify("⚠ 附件上传失败: " + msg),
  });

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
            color: "var(--accTx)",
          }}
        >
          松开以添加文件
        </div>
      )}
      {/* ==== 标题栏(共享 ViewHeader:56px 双行,空白区可拖拽窗口)==== */}
      <ViewHeader
        // 对话主标题与侧栏行同源:有摘要显摘要(随对话演进),无摘要回落
        // 标题;双击改的仍是标题(编辑框里可见),悬停提示露原标题。
        title={
          chatMode
            ? meta?.summary || meta?.title || "新会话"
            : meta?.title || "新任务"
        }
        titleTip={chatMode && meta?.summary && meta?.title ? `${meta.title}\n双击重命名` : undefined}
        rename={meta ? rename : undefined}
        subtitle={
          chatMode ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--t5)", minWidth: 0 }}>
              <IconChat size={11} color="var(--t5)" />
              <span style={{ flex: "none" }}>独立会话 · 不关联项目</span>
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--t5)", minWidth: 0 }}>
              <IconFolder size={11} color="var(--t6)" />
              {/* 完整路径退到悬停提示:这一行的横向预算要留给摘要,而路径长起来
                  (worktree、深目录)能把摘要挤没,自己却几乎全是重复的前缀 */}
              <span title={workdir} style={{ fontWeight: 600, color: "var(--t3)", flex: "none" }}>{basename(workdir)}</span>
              <HeaderSummary summary={meta?.summary} />
            </span>
          )
        }
      >
        {chatMode && meta && (
          <HeaderFilesButton
            title="浏览会话临时目录(会话中产出的文件都在这;抽屉里可跳系统文件管理器)"
            label="临时目录"
            onClick={() => onOpenDrawer()}
          />
        )}
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
                    color: "var(--accTx)",
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
          {meta && (
            <button
              className="hv menu-item"
              onClick={() => {
                setMenu("closed");
                rename.start();
              }}
            >
              <IconPencil />
              重命名
            </button>
          )}
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
              "开始一段新会话"
            ) : (
              <>在 <span style={{ whiteSpace: "nowrap", fontFamily: MONO, fontSize: 13.5 }}>{workdir}</span> 开始新任务</>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--t5)", textAlign: "center", lineHeight: 1.6 }}>
            {chatMode ? "可以用来记录想法、讨论方案，或者快速问一个问题。" : "描述你想做的事，比如修一个 Bug、加一个功能，或者让我先看看这个项目。"}
          </div>
        </div>
      ) : (
        <div
          ref={logRef}
          onScroll={onLogScroll}
          onWheel={onLogWheel}
          onTouchStart={cancelRestore}
          onMouseDown={onLogMouseDown}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, scrollbarGutter: "stable both-edges" }}
        >
          <div style={{ width: "100%", maxWidth: COL_MAX, margin: "0 auto", padding: "28px 30px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
            {session.canLoadEarlier && (
              <button
                className="hv"
                onClick={onLoadEarlier}
                style={{
                  alignSelf: "center",
                  border: "1px solid var(--line)",
                  background: "var(--card)",
                  color: "var(--t3)",
                  fontSize: 11.5,
                  borderRadius: 8,
                  padding: "4px 14px",
                  cursor: "pointer",
                  boxShadow: "var(--cardSh)",
                }}
              >
                {session.loadingEarlier ? "加载中…" : "加载更早的对话"}
              </button>
            )}
            <LogList
              items={chat.items}
              keyBase={chat.keyBase}
              onPermAnswer={session.answerPerm}
              onAskAnswer={session.answerAsk}
              onOpenChild={onOpenChild}
              uploadUrl={session.uploadUrl}
              onLocalLink={revealMarkdownLink}
              workdir={workdir}
              loadFullTool={session.loadFrame}
            />
          </div>
        </div>
      )}

      {/* 提问大纲:挂在 ChatView 根而不是日志视口内——参照物必须是**高度不变**
          的那一层。挂在日志视口里的话,下方任务面板/排队条一长高,视口变矮,
          居中的点列就跟着往上跑(这正是上一版把它钉到顶部的由来,但钉顶部
          又不是"中间"了)。根的高度恒定,居中即稳定;点列自身限高 60%,
          再多也只在中间那段内滚,够不着标题栏与 composer。 */}
      {!empty && <OutlineNav entries={outline} activeSeq={activeSeq} onJump={onOutlineJump} />}

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
            (chat.running || atts.length > 0 || uploads.length > 0) && (
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
                {(atts.length > 0 || uploads.length > 0) && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px 0" }}>
                {uploads.map((u) => (
                  <UploadingChip key={u.id} name={u.name} pct={u.pct} />
                ))}
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
              <ThinkPicker
                current={effectiveThink(chat.think, models.find((m) => m.name === currentModel)?.think)}
                disabled={chat.running}
                onPick={(level) => void session.setThink(level)}
              />
              <ModelPicker models={models} current={currentModel} disabled={chat.running} onPick={(name) => void session.switchModel(name)} />
              <ContextRing usage={usage} />
            </>
          }
        />
      </div>
    </div>
  );
}
