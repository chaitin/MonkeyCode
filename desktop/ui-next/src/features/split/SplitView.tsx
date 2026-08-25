// 工作台 = 应用主壳(2026-08-18 用户终案「工作台升级为主界面」:旧
// rail/侧栏/单会话主区三列壳退役)。视图头([mac 红绿灯] 任务列开关 +
// 标题 + 布局下拉 + 设置)+ 可折叠任务列(三 tab:本地项目/本地会话/
// 云端任务——导航全部在此,行政事务随之迁入:行右键 改名/归档/删除、
// 已归档折叠小节、待办组、云端列表整体复用 CloudTaskList)+ 布局树格区。
// 布局 = 用户拆的二叉树(tree.ts,tmux/iTerm 同构):每格可向右/向下拆分、
// 可关闭(兄弟上位)、按住格头标题拖拽换位;
// 每条分隔线恰是一个树节点,拖它只动两侧子树。1/2横/2纵/4 为快捷模板。
// 每格 = 细头 + ChatView/CloudTaskView 的 pane 变体(全交互;槽位条目经
// slots.ts 的 "c:" 记号分流本地/云端);空槽:任务列展开时 = 轻提示卡,
// 收起时 = 完整装载卡。降噪定案(2026-08-18):焦点格全套,非焦点格只留
// 身份 + 状态 + 内容。设计:docs/superpowers/specs/
// 2026-08-16-desktop-split-view-design.md。
// 状态机在 App(useSplitState):toast 路由/通知抑制要在壳外读槽位,
// 本组件只管画壳与转发动作。
import {
  IconActivity,
  IconArchive,
  IconBrandGithub,
  IconChevronDown,
  IconDots,
  IconCloud,
  IconFolder,
  IconFolderCode,
  IconFolderOpen,
  IconLayoutSidebar,
  IconKeyboard,
  IconMessages,
  IconPlus,
  IconSettings,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";

import { ChatView } from "@/features/chat/ChatView";
import { DetailModal } from "@/features/chat/DetailModal";
import { appShortcutOfEvent, shortcutChord, type AppShortcutAction } from "@/app/shortcuts";
import { CloudTaskList, type CloudTasksFeed } from "@/features/cloud/CloudTaskList";
import { CloudTaskView } from "@/features/cloud/CloudTaskView";
import { NewTaskModal } from "@/features/newtask/NewTaskModal";
import { rowStatusLabel, rowTrailing } from "@/features/sidebar/sessionStatus";
import { FixedGroupHeader, GroupLabel, levelPad, ListRow, SectionFold, StatusDot } from "@/features/sidebar/listKit";
import { TODO_GROUP_KEY, TodoSection, type TodoWiring } from "@/features/todo/TodoSection";

/** 「临时会话」组的折叠哨兵键(与 TODO_GROUP_KEY 同构,住 mc.collapsedGroups;
 *  \0 前缀避开真实项目路径)。2026-08-18 用户定案:本地会话不再单设 tab,
 *  收进本地项目列表、与待办同级成组——chat 本就无项目可归。 */
/** 任务列拖宽边界:184 是 tab 双钮 + 缩进阶梯不破的下限,420 防吃画布。 */
const SIDE_MIN = 184;
const SIDE_MAX = 420;
const SIDE_DEFAULT = 232; // = --spacing-side
const ROOT_DROP_EDGE_SIZE = 48;
const MIN_DRAG_PANE_SIZE = 48;
const MIN_MATERIALIZED_PANE_SIZE = 48;
const MAX_MATERIALIZED_PANES = 512;
const MAX_MATERIALIZED_HANDLES = 512;
const FALLBACK_GRID_WIDTH = 1024;
const FALLBACK_GRID_HEIGHT = 768;
const CHATS_GROUP_KEY = "\0chats";

interface SplitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SplitRenderPath {
  parent: SplitRenderPath | null;
  side: "a" | "b";
  depth: number;
}

const splitPathString = (path: SplitRenderPath | null): string => {
  if (!path) return "";
  const chars = new Array<string>(path.depth);
  let current: SplitRenderPath | null = path;
  while (current) {
    chars[current.depth - 1] = current.side;
    current = current.parent;
  }
  return chars.join("");
};

const pct = (value: number) => `${value * 100}%`;
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { CloudProject, CloudTask, CloudTaskDetail } from "@/lib/ipc/cloudtasks";
import type { SessionKind, SessionMeta } from "@/lib/ipc/sessions";
import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { groupSessions, projectKey, readArchivedProjects, readCollapsedGroups, readProjectOrder, readSessionArchivesOpen, reorderKeys, writeArchivedProjects, writeCollapsedGroups, writeProjectOrder, writeSessionArchivesOpen } from "@/lib/util/projects";
import { Brand } from "@/features/titlebar/TitleBar";
import { useUpdate } from "@/features/update/useUpdate";
import { isMacShell, openExternal } from "@/lib/ipc/host";
import { readFold, writeFold } from "@/lib/util/prefs";
import { renameIsNoop } from "@/lib/util/rename";
import { cloudSlotId, cloudTaskIdOf, firstEmptyIn, isCloudSlotId, LOAD_MIME, SWAP_MIME } from "./slots";
import { leaves, paneCount, SPLIT_MAX_RATIO, SPLIT_MIN_RATIO, type SplitDir, type SplitEdge, type SplitHorizontalEdge, type SplitNode, type SplitVerticalEdge } from "./tree";
import type { SplitStateApi } from "./useSplitState";

/** 快捷模板(「布局」下拉):套形状不套比例;当前同形的项 menu-active。 */
/** 拖拽 dataTransfer 类型(私有 MIME,不与文件拖入相混):
 *  SWAP = 格头换位(载荷 = 源槽号);LOAD = 任务列拖行装载(载荷 = 槽位
 *  条目,含云端记号)。 */

/** 云端接线(App 供数;缺省不出云端 tab——测试与降级路径轻装)。 */
export interface SplitCloudWiring {
  feed: CloudTasksFeed;
  projects: CloudProject[];
  reloadKey: number;
  onDeleted: (id: string) => void;
  onChanged: () => void;
}

/** 行政接线(任务列行右键/待办组;旧侧栏能力随壳退役迁入)。 */
export interface SplitAdminWiring {
  attentionIds: ReadonlySet<string>;
  onRename: (meta: SessionMeta, title: string) => void;
  /** 返回是否更新成功；归档失败时 Panel 必须保留。 */
  onToggleArchive: (meta: SessionMeta) => Promise<boolean>;
  onDelete: (meta: SessionMeta) => void;
  todo?: TodoWiring;
}

export function SplitView({
  active = true,
  sessions,
  split,
  epoch,
  focusRequest,
  onFocusRequestHandled,
  onAssign,
  onLoadSession,
  onCreatedInSlot,
  onCloudCreatedInSlot,
  onComposerIntent,
  createRequest,
  onCreateRequestHandled,
  onOpenSettings,
  recentDirs,
  cloud,
  admin,
  titlebarSlot = null,
}: {
  /** 设置模态在场时保持工作台挂载，但停用所有 window/Tauri 级交互。 */
  active?: boolean;
  sessions: SessionMeta[];
  split: SplitStateApi;
  epoch: number;
  focusRequest: number;
  onFocusRequestHandled: (request: number) => void;
  /** 定点装载(装载卡点选/拖行落格):落**指定槽** + 已读 + composer 聚焦,
   *  收口在 App。条目 = 槽位记号 id(云端带 "c:")。 */
  onAssign: (slot: number, entry: string) => void;
  /** 路由装载(任务列点行):在场则定位、否则装进叶序第一个空格(无空格
   *  顶替焦点格)——与屏外 toast 点击同一条 place 语义,收口在 App。 */
  onLoadSession: (entry: string) => void;
  /** 格内内嵌新建的落地:App 乐观入表 + refresh + 装载。 */
  /** 内嵌创建落地(todoId = 待办派发回链,App 侧 markDispatched)。 */
  onCreatedInSlot: (slot: number, meta: SessionMeta, todoId?: string) => void;
  /** 云端任务在格内建成:App 侧回链待办/刷 feed/装载 "c:" 条目进本格。 */
  onCloudCreatedInSlot: (slot: number, task: CloudTaskDetail, todoId?: string) => void;
  /** 点格切换焦点时请求 composer 聚焦(App 侧接 requestComposerFocus)。 */
  onComposerIntent?: () => void;
  /** App 侧发起的创建意图(待办派发「启动任务」):seq 去重消费,走
   *  「新建即新格」同一条路。 */
  createRequest?: {
    seq: number;
    kind: SessionKind | "cloud";
    dir?: string;
    text?: string;
    files?: File[];
    todoId?: string;
  } | null;
  onCreateRequestHandled?: () => void;
  /** 轻输入条点击后的 composer 聚焦意图(App requestComposerFocus)。 */
  /** 设置入口(视图头齿轮;rail 退役后唯一的设置门)。 */
  onOpenSettings: () => void;
  /** 最近项目目录(App 从 sessions 派生,与整页新建视图同一份)。 */
  recentDirs: string[];
  cloud?: SplitCloudWiring;
  admin?: SplitAdminWiring;
  /** Windows/Linux 自绘标题栏左端的寄宿位(App 经 TitleBar leading 供给):
   *  列收起时 ☰/新建 portal 进去,不再单开一行 h-10 顶条(2026-08-20 用户
   *  报障「收起后空一行」)。mac/浏览器无此条 → null,收起走 rightBar。 */
  titlebarSlot?: HTMLElement | null;
}) {
  const { t } = useI18n();
  // 「更换」= 原地重开装载卡;「新建」= 原地内嵌创建表单(kind 跟随发起处
  // 的 tab);dropSlot = 拖拽(换位/装载)的悬停目标。会话内瞬态,不落盘
  const [swapSlot, setSwapSlot] = useState<number | null>(null);
  const [creatingSlot, setCreatingSlot] = useState<{
    slot: number;
    kind: SessionKind | "cloud";
    /** 打开表单时槽里的原值；满布局会覆盖已有格，不能把这份旧值误判成
     * 后续外部装载并立即关掉表单。 */
    entryAtOpen: string | null;
    dir?: string;
    spawned?: boolean;
    cloudProject?: CloudProject;
    text?: string;
    files?: File[];
    todoId?: string;
  } | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [dropEdge, setDropEdge] = useState<{ edge: SplitEdge; target: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState(() => ({
    width: typeof window === "undefined" ? FALLBACK_GRID_WIDTH : window.innerWidth || FALLBACK_GRID_WIDTH,
    height: typeof window === "undefined" ? FALLBACK_GRID_HEIGHT : window.innerHeight || FALLBACK_GRID_HEIGHT,
  }));
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const rect = grid.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setGridSize((prev) =>
        prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height },
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active) setShortcutsOpen(false);
  }, [active]);
  // 任务列宽度可拖(2026-08-20 用户「给一个最小的宽度就行」):最小 184
  // 保住 tab/行截断链,上限 420 不吃画布;缺省仍 --spacing-side(232)
  const [sideWidth, setSideWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem("mc.workbenchListWidth") ?? "", 10);
      return Number.isFinite(v) ? Math.min(Math.max(v, SIDE_MIN), SIDE_MAX) : SIDE_DEFAULT;
    } catch {
      return SIDE_DEFAULT;
    }
  });
  // 模板下拉(受控 dropdown,外点/Esc 即收——手法与 ChatView ⋯ 菜单一致)
  // 任务列当前 tab 提级到此:头部「新建」的 kind 要跟它走(参考图重排
  // 2026-08-18:新建入主区头部,任务列顶部还给 chrome 行)。「本地会话」
  // tab 同日撤并——chat 是本地列表里的「临时会话」组,新建会话走组头「+」
  const [pickTab, setPickTab] = useState<"local" | "cloud">("local");
  // 点格联动信号:同一格重复点击 focusedEntry 不变,effect 载不到——每次
  // pane pointerdown 递增,任务列 reveal 效应吃 [focusedEntry, revealTick]
  const [revealTick, setRevealTick] = useState(0);
  // 装载优先的兜底:place 路由(toast 点击/首启播种)不经 pick,条目落进
  // 「创建中」的槽时表单让位——否则表单盖住新装会话,spawned 取消还会
  // 连格收走(2026-08-20 审计,与 pick/换位两处同族)
  useEffect(() => {
    if (!creatingSlot) return;
    const current = split.slots[creatingSlot.slot] ?? null;
    if (current !== creatingSlot.entryAtOpen) setCreatingSlot(null);
  }, [split.slots, creatingSlot]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem("mc.workbenchListWidth", String(sideWidth));
      } catch {
        /* 隐私模式等存不了就算了,会话内仍生效 */
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [sideWidth]);
  // 格头「视图动作」插槽落点(按槽记;云端格把 文件/终端/任务菜单 portal
  // 进来——格头唯一框架,无任务类型分支)。ref 回调必须**恒等**:每渲染
  // 换新函数的话 React 会 detach(null)→attach(el) 反复打状态,直接
  // Maximum update depth(实测)
  const [paneExtras, setPaneExtras] = useState<Record<number, HTMLElement | null>>({});
  const paneExtraRefs = useRef(new Map<number, (el: HTMLElement | null) => void>());
  const paneExtraRefFor = (slot: number) => {
    const existing = paneExtraRefs.current.get(slot);
    if (existing) return existing;
    const created = (el: HTMLElement | null) => {
      setPaneExtras((prev) => (prev[slot] === el ? prev : { ...prev, [slot]: el }));
    };
    paneExtraRefs.current.set(slot, created);
    return created;
  };
  // 视图菜单项注册表(开 ⋯ 时现取;注册函数按槽恒等,注销置 null)
  const viewMenus = useRef<Record<number, (() => MenuItem[]) | null>>({});
  const paneMenuRegs = useRef(new Map<number, (fn: (() => MenuItem[]) | null) => void>());
  const paneMenuRegFor = (slot: number) => {
    const existing = paneMenuRegs.current.get(slot);
    if (existing) return existing;
    const created = (fn: (() => MenuItem[]) | null) => {
      viewMenus.current[slot] = fn;
    };
    paneMenuRegs.current.set(slot, created);
    return created;
  };
  // 任务列开合(默认展开;键语义取反,见 prefs.FoldKey 注)
  const [listOpen, setListOpen] = useState(() => !readFold("mc.workbenchListHidden"));
  const toggleList = () => {
    setListOpen((open) => {
      writeFold("mc.workbenchListHidden", open); // open→收起 = hidden true
      return !open;
    });
  };

  const placed = new Set(split.slots.filter(Boolean) as string[]);
  const zoomedSlot = split.zoomed;
  const total = paneCount(split.tree);
  const visible = zoomedSlot !== null ? 1 : total;
  const visibleLeaves = zoomedSlot !== null ? [zoomedSlot] : leaves(split.tree);
  // 右侧顶条只剩一种存在理由:列收起(☰/新建兜底之家 + mac 净空)。
  // 2026-08-19 用户终案「sidebar 和右侧一个底色,任务 panel 浮上去——
  // 无论单格还是多格」:格永远是浮卡(单格融合 2026-08-18 版随之反转
  // 退役,格头回卡上),列开着时右侧无任何顶条,拖窗面由画布衬/卡缝
  // (grid 自带拖拽属性,不继承、格内交互不受扰)与列顶行接棒
  // 有自绘标题栏(Windows/Linux)时 ☰/新建 借住其左端(portal,见下),
  // 顶条整行免开(2026-08-20 用户报障「收起后空了一行,好丑」)
  const rightBar = !listOpen && !titlebarSlot;
  const focusedEntry = split.slots[split.focused] ?? null;

  /** 新建入口的落格路由(任务列底部钮/空格提示钮共用):优先叶序第一个
   *  空格,没有空格就用焦点格(顶替它的内容是显式动作)。 */
  type CreateExtras = { dir?: string; cloudProject?: CloudProject; text?: string; files?: File[]; todoId?: string };
  const openCreate = (kind: SessionKind | "cloud", slot?: number, extras?: CreateExtras) => {
    const target = slot ?? firstEmptyIn(split.slots, visibleLeaves) ?? (visibleLeaves.includes(split.focused) ? split.focused : (visibleLeaves[0] ?? 0));
    setSwapSlot(null);
    setCreatingSlot({ slot: target, kind, entryAtOpen: split.slots[target] ?? null, ...extras });
  };
  /** 「新建即新格」(2026-08-18 用户定案「创建任务也是一个 panel」):列侧
   *  一切新建入口走此——有空格先用空格(它就是现成的新格),没有就把焦点
   *  格向右拆一格**专供创建**(spawned,取消即收回,不留空格尾巴)。格内
   *  入口(提示卡/装载卡)仍就地创建,不走这条。 */
  const openCreateInNewPane = (kind: SessionKind | "cloud", extras?: CreateExtras) => {
    if (split.zoomed !== null) split.toggleZoom(split.zoomed); // 独占态先回程
    const all = leaves(split.tree);
    const empty = firstEmptyIn(split.slots, all);
    if (empty !== null) {
      openCreate(kind, empty, extras);
      return;
    }
    const spawned = split.splitPane(split.focused, "col");
    if (spawned !== null) {
      setSwapSlot(null);
      setCreatingSlot({ slot: spawned, kind, entryAtOpen: null, ...extras, spawned: true });
      return;
    }
    openCreate(kind, undefined, extras);
  };
  const newTaskAction = () => {
    openCreateInNewPane(pickTab === "cloud" ? "cloud" : "local");
  };
  const openCreateAfterLastPane = (slot: number | null, kind: SessionKind | "cloud") => {
    if (slot === null) return;
    setSwapSlot(null);
    setCreatingSlot({ slot, kind, entryAtOpen: null });
  };
  const closePane = (slot: number, kind: SessionKind | "cloud") => {
    setSwapSlot(null);
    setCreatingSlot((creating) => (creating?.slot === slot ? null : creating));
    openCreateAfterLastPane(split.closePane(slot), kind);
  };
  const toggleArchive = async (meta: SessionMeta) => {
    if (!admin) return;
    const archived = !meta.archived;
    const succeeded = await admin.onToggleArchive(meta);
    if (succeeded && archived) openCreateAfterLastPane(split.closeEntry(meta.id), meta.kind ?? "local");
  };
  const onWorkbenchShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (!active) return;
    const action = appShortcutOfEvent(e);
    let handled = true;
    switch (action) {
      case "new-task":
        newTaskAction();
        break;
      case "focus-composer":
        onComposerIntent?.();
        break;
      case "toggle-sidebar":
        toggleList();
        break;
      case "split-right":
        split.splitPane(split.focused, "col");
        break;
      case "split-down":
        split.splitPane(split.focused, "row");
        break;
      default:
        handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onWorkbenchShortcut(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // App 侧创建意图(待办派发):seq 去重消费,走「新建即新格」同一条路
  const consumedCreateSeq = useRef(0);
  useEffect(() => {
    if (!createRequest || createRequest.seq === consumedCreateSeq.current) return;
    consumedCreateSeq.current = createRequest.seq;
    openCreateInNewPane(createRequest.kind, createRequest);
    onCreateRequestHandled?.();
  });

  // ==== 分隔线拖拽(FilesDrawer::trackPointer 同款收尾纪律):收尾两条路
  // 都有——正常 mouseup 之外,组件卸载(换模板)时兜底再收一次,否则
  // body 上的全局 cursor/user-select 副作用会永久留下 ====
  const stopDragRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDragRef.current?.(), []);
  useEffect(() => {
    if (!active) stopDragRef.current?.();
  }, [active]);
  const trackPointer = (cursor: string, onMove: (ev: MouseEvent) => void) => {
    stopDragRef.current?.();
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.body.style.setProperty("-webkit-user-select", "none");
    const finish = () => {
      if (stopDragRef.current !== finish) return;
      stopDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.removeProperty("-webkit-user-select");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
    };
    stopDragRef.current = finish;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finish);
  };
  const clamp = (v: number) => Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, v));
  // 树值本身不设与格数绑定的固定下限；真实拖动按当前所属区域至少留出
  // 48px，避免 Number.EPSILON 在浏览器布局中被量化成 0px。
  const clampVisible = (v: number, pixels: number) => {
    if (pixels <= 0) return clamp(v); // jsdom/首拍尚无布局度量
    const min = Math.min(0.5, MIN_DRAG_PANE_SIZE / pixels);
    return Math.min(1 - min, Math.max(min, v));
  };
  const startHandleDrag = (path: () => string, dir: SplitDir, area: SplitRect) => (e: ReactMouseEvent) => {
    e.preventDefault();
    const grid = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-split-grid]");
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const rect = {
      left: gridRect.left + area.x * gridRect.width,
      top: gridRect.top + area.y * gridRect.height,
      width: area.width * gridRect.width,
      height: area.height * gridRect.height,
    };
    const resolvedPath = path();
    trackPointer(dir === "col" ? "col-resize" : "row-resize", (ev) => {
      const frac =
        dir === "col"
          ? (ev.clientX - rect.left) / Math.max(1, rect.width)
          : (ev.clientY - rect.top) / Math.max(1, rect.height);
      split.setNodeRatio(resolvedPath, clampVisible(frac, dir === "col" ? rect.width : rect.height));
    });
  };

  const pick = (slot: number, entry: string) => {
    setSwapSlot(null);
    // 装载优先:落点若是「创建中」的格,表单退场(不清的话表单盖着新装的
    // 会话,取消还会把 spawned 格连会话一起收掉——2026-08-20 审计)
    setCreatingSlot((c) => (c?.slot === slot ? null : c));
    setCreatingSlot(null);
    onAssign(slot, entry);
  };

  // ==== 格上拖拽落点(两条通道):格头换位(SWAP)与任务列拖行装载(LOAD)。
  // 私有 MIME 判定,ChatView pane 自己收文件拖放,互不打扰 ====
  const rootDropEdgeOf = (e: ReactDragEvent<HTMLElement>): SplitHorizontalEdge | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const left = e.clientX - rect.left;
    const right = rect.right - e.clientX;
    const inY = e.clientY >= rect.top && e.clientY <= rect.bottom;
    const hitsLeft = inY && left >= 0 && left <= ROOT_DROP_EDGE_SIZE;
    const hitsRight = inY && right >= 0 && right <= ROOT_DROP_EDGE_SIZE;
    if (hitsLeft && hitsRight) return left <= right ? "left" : "right";
    if (hitsLeft) return "left";
    if (hitsRight) return "right";
    return null;
  };
  const paneDropEdgeOf = (e: ReactDragEvent<HTMLElement>): SplitVerticalEdge | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const top = e.clientY - rect.top;
    const bottom = rect.bottom - e.clientY;
    const inX = e.clientX >= rect.left && e.clientX <= rect.right;
    const hitsTop = inX && top >= 0 && top <= ROOT_DROP_EDGE_SIZE;
    const hitsBottom = inX && bottom >= 0 && bottom <= ROOT_DROP_EDGE_SIZE;
    if (hitsTop && hitsBottom) return top <= bottom ? "top" : "bottom";
    if (hitsTop) return "top";
    if (hitsBottom) return "bottom";
    return null;
  };
  const hasSplitDrag = (e: ReactDragEvent) => {
    const types = [...e.dataTransfer.types];
    return types.includes(SWAP_MIME) || types.includes(LOAD_MIME);
  };
  const onGridDragOverCapture = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasSplitDrag(e)) return;
    const edge = rootDropEdgeOf(e);
    setDropEdge(edge ? { edge, target: split.focused } : null);
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDropSlot(null);
  };
  const onGridDropCapture = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!hasSplitDrag(e)) return;
    const edge = rootDropEdgeOf(e);
    if (!edge) return;
    e.preventDefault();
    e.stopPropagation();
    setDropEdge(null);
    setDropSlot(null);
    const swapRaw = e.dataTransfer.getData(SWAP_MIME);
    if (swapRaw !== "") {
      const src = Number(swapRaw);
      if (Number.isSafeInteger(src) && leaves(split.tree).includes(src)) split.movePaneToEdge(src, split.focused, edge);
      return;
    }
    const loadRaw = e.dataTransfer.getData(LOAD_MIME);
    if (loadRaw !== "") {
      const target = split.addEdgePane(split.focused, edge);
      if (target !== null) pick(target, loadRaw);
    }
  };

  const onPaneDragOver = (slot: number) => (e: ReactDragEvent<HTMLElement>) => {
    const types = [...e.dataTransfer.types];
    if (!types.includes(SWAP_MIME) && !types.includes(LOAD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const edge = paneDropEdgeOf(e);
    setDropEdge(edge ? { edge, target: slot } : null);
    setDropSlot(edge ? null : slot);
  };
  const onPaneDrop = (slot: number) => (e: ReactDragEvent<HTMLElement>) => {
    const swapRaw = e.dataTransfer.getData(SWAP_MIME);
    const loadRaw = e.dataTransfer.getData(LOAD_MIME);
    const edge = paneDropEdgeOf(e);
    setDropSlot(null);
    setDropEdge(null);
    if (swapRaw !== "") {
      e.preventDefault();
      const src = Number(swapRaw);
      if (Number.isInteger(src) && src !== slot) {
        // 换位涉及创建格时表单让位(表单钉在槽号上,换位后会盖住换进来的
        // 会话——装载优先同族,2026-08-20 审计)
        setCreatingSlot((c) => (c && (c.slot === src || c.slot === slot) ? null : c));
        if (edge) split.movePaneToEdge(src, slot, edge);
        else split.swapPanes(src, slot);
      }
      return;
    }
    if (loadRaw !== "") {
      e.preventDefault();
      if (edge) {
        const target = split.addEdgePane(slot, edge);
        if (target !== null) pick(target, loadRaw);
      } else {
        pick(slot, loadRaw); // 定点装载:move 语义自动收走它原先所在的格
      }
    }
  };

  /** 槽位显示体(renderPane 与单格融合头共用):本地找 sessions、云端合成
   *  伪 meta(词汇对齐 §6.1:云端行尾点仅 error;CloudTaskView 契约「至少
   *  含 id,详情异步补全」,历史任务不在首页 feed 也能开)。 */
  const slotHead = (slot: number) => {
    const entry = split.slots[slot];
    const cloudId = entry && isCloudSlotId(entry) ? cloudTaskIdOf(entry) : null;
    const meta = entry && !cloudId ? sessions.find((m) => m.id === entry) : undefined;
    const cloudTask: CloudTask | undefined = cloudId
      ? (cloud?.feed.tasks?.find((c) => c.id === cloudId) ?? { id: cloudId })
      : undefined;
    const headMeta: SessionMeta | null = meta
      ? meta
      : cloudTask
        ? ({
            id: entry!,
            title: cloudTask.title || cloudTask.summary || cloudTask.content || cloudTask.id,
            summary: cloudTask.summary,
            workdir: "",
            model: "",
            turns: 0,
            status: cloudTask.status === "error" ? "error" : undefined,
          } as SessionMeta)
        : null;
    return { entry, meta, cloudTask, headMeta };
  };

  const renderPane = (slot: number) => {
    const { entry, meta, cloudTask, headMeta } = slotHead(slot);
    const focused = split.focused === slot;
    // 格级未读(2026-08-20 用户「多格下轮结束/审批/提问要提醒」):可见非
    // 焦点格的值得提醒事件由 App 落进 attentionIds,落焦即消;waiting_ask
    // 按会话态兜底——焦点在场时收到的提问不产生未读,切走后这格仍在等人
    const attention = !focused && !!entry && (!!admin?.attentionIds.has(entry) || !!meta?.waiting_ask);
    const creating = creatingSlot?.slot === slot ? creatingSlot : null;
    const loading = !creating && (!headMeta || swapSlot === slot);
    return (
      <section
        key={slot}
        data-menu-inline-boundary=""
        aria-label={t("split.pane", { n: String(slot + 1) })}
        // capture 相:格内任意处按下即夺焦(含 composer/按钮,不拦事件)
        onPointerDownCapture={() => {
          // 焦点变更才请求 composer 聚焦(2026-08-20 用户「选中 panel 应
          // focus 到 composer」);同格内点击不抢焦——正在别处选文本呢
          if (split.focused !== slot) onComposerIntent?.();
          split.focus(slot);
          setRevealTick((n) => n + 1);
        }}
        onDragOver={onPaneDragOver(slot)}
        onDragLeave={() => {
          setDropSlot((d) => (d === slot ? null : d));
          setDropEdge((d) => (d?.target === slot ? null : d));
        }}
        onDrop={onPaneDrop(slot)}
        // 平铺分栏(2026-08-19 用户 mockup 终案,当日浮卡随之退役):白底
        // 通栏、1px 细线分隔(grid 底色透缝),细头恒在;焦点表达 = 细头
        // 标题下划线(比 ring 环安静,与 tab 同语汇)
        className="mc-workbench-surface-100 group/pane relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {!creating && (
          <PaneHeader
            slot={slot}
            meta={headMeta}
            focused={focused && visible > 1}
            attention={attention}
            onRename={admin && meta ? (title) => admin.onRename(meta, title) : undefined}
            extrasRef={entry ? paneExtraRefFor(slot) : undefined}
            viewMenu={() => [
              // 本地格行政项(与云端格 终止/删除 对称;旧详情页 ⋯ 三件套
              // 缺的两件,2026-08-20 审计补齐):同走 admin 接线,错误外显
              // 与任务列行菜单同源
              ...(meta && admin
                ? [
                    {
                      label: meta.archived ? t("sidebar.row.unarchive") : t("sidebar.row.archive"),
                      run: () => void toggleArchive(meta),
                    },
                    {
                      label: t("sidebar.row.delete"),
                      confirm: t("sidebar.row.deleteConfirm"),
                      danger: true,
                      disabledReason: meta.status === "running" ? t("sidebar.row.deleteRunning") : undefined,
                      run: () => admin.onDelete(meta),
                    },
                  ]
                : []),
              ...(viewMenus.current[slot]?.() ?? []),
            ]}
            zoomed={zoomedSlot === slot}
            swapping={swapSlot === slot}
            onSplit={(dir) => {
              setSwapSlot(null);
              split.splitPane(slot, dir);
            }}
            onZoom={() => {
              setSwapSlot(null);
              split.toggleZoom(slot);
            }}
            onSwap={() => setSwapSlot((s) => (s === slot ? null : slot))}
            onClose={() => closePane(slot, cloudTask ? "cloud" : (meta?.kind ?? "local"))}
          />
        )}
        {creating ? (
          // 格内内嵌新建:同一个 NewTaskModal,embedded 形态(云端不内嵌,
          // 见 SplitCloudWiring.onNewTask)。建成 → 落回本格;取消 → 回装载卡
          <NewTaskModal
            open
            initialKind={creating.kind}
            initialDir={creating.dir}
            initialCloudProject={creating.cloudProject}
            initialText={creating.text}
            initialFiles={creating.files}
            recentDirs={recentDirs}
            onOpenSettings={onOpenSettings}
            nativeDropEnabled={active && focused}
            onCreated={(created) => {
              setCreatingSlot(null);
              setSwapSlot(null);
              onCreatedInSlot(slot, created, creating.todoId);
            }}
            onCloudCreated={(task) => {
              setCreatingSlot(null);
              setSwapSlot(null);
              onCloudCreatedInSlot(slot, task, creating.todoId);
            }}
            onClose={(reason) => {
              // 专为创建拆出来的格只在取消时收回；成功后任务已经落进该格。
              if (reason !== "success" && creating.spawned) split.closePane(slot);
              setCreatingSlot(null);
            }}
          />
        ) : loading ? (
          listOpen ? (
            // 任务列在场时空格不再重复一份完整列表:轻提示 + 新建直达
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4">
              <p className="text-xs text-base-content/50">{t("split.emptyHint")}</p>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => openCreate(pickTab === "cloud" ? "cloud" : "local", slot)}
              >
                <IconPlus size={14} stroke={1.75} aria-hidden />
                {t("split.newTask")}
              </button>
            </div>
          ) : (
            <LoaderCard
              sessions={sessions}
              placed={placed}
              cloud={cloud}
              onPick={(picked) => pick(slot, picked)}
              onNewTask={(kind) => openCreate(kind, slot)}
              onNewCloud={() => openCreate("cloud", slot)}
            />
          )
        ) : cloudTask ? (
          <CloudTaskView
            // useCloudTask 的连接/ref 全按 task id 建立，id 改变必须整棵重挂；
            // 本地引擎 epoch 与云端生命周期无关。
            key={cloudTask.id}
            variant="pane"
            task={cloudTask}
            headerSlot={paneExtras[slot] ?? null}
            menuRegister={paneMenuRegFor(slot)}
            hotkeysActive={active && focused}
            nativeDropEnabled={active && focused}
            focusRequest={active && focused ? focusRequest : 0}
            onFocusRequestHandled={onFocusRequestHandled}
            onTasksChanged={cloud?.onChanged}
            onDeleted={() => {
              cloud?.onDeleted(cloudTask.id);
              split.ejectAt(slot);
            }}
          />
        ) : (
          <ChatView
            // key 含 epoch:引擎自愈整格重建;槽内换会话走同一实例
            key={epoch}
            variant="pane"
            meta={meta!}
            epoch={epoch}
            headerSlot={paneExtras[slot] ?? null}
            hotkeysActive={active && focused}
            nativeDropEnabled={active && focused}
            focusRequest={active && focused ? focusRequest : 0}
            onFocusRequestHandled={onFocusRequestHandled}
          />
        )}
        {/* 拖拽落点:secondary 虚环(焦点已改由细头标题下划线表达) */}
        {dropSlot === slot && (
          <div aria-hidden data-split-drop="" className="pointer-events-none absolute inset-0 z-20 ring-2 ring-secondary/60 ring-inset" />
        )}
        {dropEdge?.target === slot && (dropEdge.edge === "top" || dropEdge.edge === "bottom") && (
          <div
            aria-hidden
            data-split-pane-drop={dropEdge.edge}
            className={`pointer-events-none absolute inset-x-0 z-20 h-12 bg-secondary/15 ring-2 ring-secondary/70 ring-inset ${
              dropEdge.edge === "top" ? "top-0" : "bottom-0"
            }`}
          />
        )}
      </section>
    );
  };

  /** 把布局树迭代投影成同级 pane/handle，避免深树继续形成深 Fiber/DOM。 */
  const renderLayout = (root: SplitNode) => {
    type Branch = Extract<SplitNode, { dir: SplitDir }>;
    const pending: { node: SplitNode; path: SplitRenderPath | null; area: SplitRect }[] = [
      { node: root, path: null, area: { x: 0, y: 0, width: 1, height: 1 } },
    ];
    const panes: { slot: number; area: SplitRect }[] = [];
    const handles: { node: Branch; path: SplitRenderPath | null; area: SplitRect; id: number }[] = [];
    const viewportWidth = gridSize.width || FALLBACK_GRID_WIDTH;
    const viewportHeight = gridSize.height || FALLBACK_GRID_HEIGHT;
    const materialized = (area: SplitRect) =>
      area.width * viewportWidth >= MIN_MATERIALIZED_PANE_SIZE &&
      area.height * viewportHeight >= MIN_MATERIALIZED_PANE_SIZE;
    // 像素虚拟化仍要保留焦点叶及其祖先：格数超过画布容量时，当前格
    // 不能因面积不足而连操作入口一起消失。
    const focusedNodes = new Set<SplitNode>();
    const parents = new Map<SplitNode, SplitNode | null>([[root, null]]);
    const leafOrder = new Map<number, number>();
    const branchOrder = new Map<SplitNode, number>();
    const search: SplitNode[] = [root];
    let focusedNode: SplitNode | null = null;
    let visitOrder = 0;
    while (search.length > 0) {
      const node = search.pop()!;
      if ("leaf" in node) {
        leafOrder.set(node.leaf, visitOrder++);
        if (node.leaf === split.focused) focusedNode = node;
        continue;
      }
      branchOrder.set(node, visitOrder++);
      parents.set(node.a, node);
      parents.set(node.b, node);
      search.push(node.b, node.a);
    }
    while (focusedNode) {
      focusedNodes.add(focusedNode);
      focusedNode = parents.get(focusedNode) ?? null;
    }
    while (pending.length > 0) {
      const item = pending.pop()!;
      if ("leaf" in item.node) {
        if (panes.length < MAX_MATERIALIZED_PANES || item.node.leaf === split.focused) {
          panes.push({ slot: item.node.leaf, area: item.area });
        }
        continue;
      }

      const node = item.node;
      const depth = (item.path?.depth ?? 0) + 1;
      const aPath: SplitRenderPath = { parent: item.path, side: "a", depth };
      const bPath: SplitRenderPath = { parent: item.path, side: "b", depth };
      const aArea: SplitRect = { ...item.area };
      const bArea: SplitRect = { ...item.area };
      if (node.dir === "col") {
        aArea.width *= node.ratio;
        bArea.x += aArea.width;
        bArea.width *= 1 - node.ratio;
      } else {
        aArea.height *= node.ratio;
        bArea.y += aArea.height;
        bArea.height *= 1 - node.ratio;
      }
      // 不物化实际不足一个可用 pane 尺寸的子树：它既不能完整交互，继续挂完整
      // PaneHeader/ChatView 只会让恶意深树产生数十万 DOM。ResizeObserver
      // 会在画布变大后重算；正常拖动另有 48px 下限，不会制造这种子树。
      const onFocusedPath = focusedNodes.has(node);
      // 焦点路径每层连同直接兄弟一起保留，保证连续拆分后新格和被拆格都
      // 仍有可操作入口；兄弟若还是巨大子树，其更深后代仍受像素阈值约束。
      const aVisible = materialized(aArea) || onFocusedPath || focusedNodes.has(node.a);
      const bVisible = materialized(bArea) || onFocusedPath || focusedNodes.has(node.b);
      if (((aVisible && bVisible) || onFocusedPath) && handles.length < MAX_MATERIALIZED_HANDLES) {
        handles.push({ node, path: item.path, area: item.area, id: handles.length });
      }
      // 栈后进先出：焦点子树后压、优先遍历，确保全局物化预算先留给当前格。
      if (focusedNodes.has(node.b)) {
        if (aVisible) pending.push({ node: node.a, path: aPath, area: aArea });
        if (bVisible) pending.push({ node: node.b, path: bPath, area: bArea });
      } else {
        if (bVisible) pending.push({ node: node.b, path: bPath, area: bArea });
        if (aVisible) pending.push({ node: node.a, path: aPath, area: aArea });
      }
    }

    // 焦点优先只影响谁获得物化预算，不能改变 DOM/辅助技术的树内视觉顺序。
    panes.sort((a, b) => (leafOrder.get(a.slot) ?? 0) - (leafOrder.get(b.slot) ?? 0));
    handles.sort((a, b) => (branchOrder.get(a.node) ?? 0) - (branchOrder.get(b.node) ?? 0));

    return (
      <>
        {panes.map(({ slot, area }) => (
          <div
            key={`pane-${slot}`}
            className="absolute flex min-h-0 min-w-0"
            style={{
              left: pct(area.x),
              top: pct(area.y),
              width: pct(area.width),
              height: pct(area.height),
              minWidth: MIN_MATERIALIZED_PANE_SIZE,
              minHeight: MIN_MATERIALIZED_PANE_SIZE,
            }}
          >
            {renderPane(slot)}
          </div>
        ))}
        {handles.map(({ node, path, area, id }) => {
          const vertical = node.dir === "col";
          const resolvePath = () => splitPathString(path);
          const pathAttr = !path ? "root" : path.depth <= 64 ? splitPathString(path) : `deep-${id}`;
          const boundary = vertical
            ? area.x + area.width * node.ratio
            : area.y + area.height * node.ratio;
          return (
            <div
              key={`handle-${id}`}
              data-split-handle={pathAttr}
              role="separator"
              aria-orientation={vertical ? "vertical" : "horizontal"}
              aria-label={t("split.resize")}
              aria-valuemin={Math.round(SPLIT_MIN_RATIO * 100)}
              aria-valuemax={Math.round(SPLIT_MAX_RATIO * 100)}
              aria-valuenow={Math.round(node.ratio * 100)}
              tabIndex={0}
              title={t("split.resizeHint")}
              className={`absolute z-30 focus-visible:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset ${
                vertical ? "w-2 -translate-x-1/2 cursor-col-resize" : "h-2 -translate-y-1/2 cursor-row-resize"
              }`}
              style={
                vertical
                  ? { left: pct(boundary), top: pct(area.y), height: pct(area.height) }
                  : { left: pct(area.x), top: pct(boundary), width: pct(area.width) }
              }
              onMouseDown={startHandleDrag(resolvePath, node.dir, area)}
              onKeyDown={(e) => {
                const delta =
                  vertical && e.key === "ArrowLeft"
                    ? -0.05
                    : vertical && e.key === "ArrowRight"
                      ? 0.05
                      : !vertical && e.key === "ArrowUp"
                        ? -0.05
                        : !vertical && e.key === "ArrowDown"
                          ? 0.05
                          : 0;
                if (delta === 0) return;
                e.preventDefault();
                e.stopPropagation();
                const grid = e.currentTarget.closest<HTMLElement>("[data-split-grid]");
                const gridRect = grid?.getBoundingClientRect();
                const pixels = gridRect
                  ? vertical
                    ? area.width * gridRect.width
                    : area.height * gridRect.height
                  : 0;
                split.setNodeRatio(resolvePath(), clampVisible(node.ratio + delta, pixels));
              }}
              onDoubleClick={() => split.equalizeNode(resolvePath())}
            >
              <span
                aria-hidden
                className={`mc-workbench-surface-300 pointer-events-none absolute ${
                  vertical
                    ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
                    : "inset-x-0 top-1/2 h-px -translate-y-1/2"
                }`}
              />
            </div>
          );
        })}
      </>
    );
  };

  return (
    <>
      <main className="relative flex min-w-0 flex-1 overflow-hidden bg-base-100">
      <div className="mc-workbench-background" aria-hidden />
      {/* 参考图重排(2026-08-18):任务列升为**整窗高左列**(mac 灯与列
          开关住其顶部),头部只横跨主区;格区卡片化。 */}
      {listOpen && (
        <WorkbenchList
          width={sideWidth}
          sessions={sessions}
          placed={placed}
          focusedEntry={focusedEntry}
          cloud={cloud}
          admin={admin}
          onToggleArchive={toggleArchive}
          tab={pickTab}
          onTabChange={setPickTab}
          revealTick={revealTick}
          onToggleList={toggleList}
          onPick={onLoadSession}
          onNewTask={newTaskAction}
          onNewChat={() => openCreateInNewPane("chat")}
          onNewTaskInDir={(dir) => openCreateInNewPane("local", { dir })}
          onNewCloudIn={(project) => openCreateInNewPane("cloud", { cloudProject: project })}
          onOpenSettings={onOpenSettings}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />
      )}
      {/* 任务列拖宽把手:8px 透明骑列缘线(格分隔线同款;trackPointer
          收尾纪律,双击回缺省宽) */}
      {listOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("split.sideResize")}
          aria-valuemin={SIDE_MIN}
          aria-valuemax={SIDE_MAX}
          aria-valuenow={sideWidth}
          tabIndex={0}
          title={t("split.sideResize")}
          className="relative z-30 -mx-1 w-2 shrink-0 cursor-col-resize focus-visible:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset"
          onMouseDown={(e) => {
            e.preventDefault();
            trackPointer("col-resize", (ev) => {
              setSideWidth(Math.min(Math.max(ev.clientX, SIDE_MIN), SIDE_MAX));
            });
          }}
          onKeyDown={(e) => {
            let next: number | null = null;
            if (e.key === "ArrowLeft") next = Math.max(SIDE_MIN, sideWidth - 8);
            else if (e.key === "ArrowRight") next = Math.min(SIDE_MAX, sideWidth + 8);
            else if (e.key === "Home") next = SIDE_MIN;
            else if (e.key === "End") next = SIDE_MAX;
            if (next === null) return;
            e.preventDefault();
            e.stopPropagation();
            setSideWidth(next);
          }}
          onDoubleClick={() => setSideWidth(SIDE_DEFAULT)}
        />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* §7 拖拽区铁律:属性不继承,非交互子节点各自带。列收起时本头
            接管窗口左上角,mac 原生灯净空标记跟着挂(壳侧
            traffic_light_position 定位,UI 只让位,见 app.css) */}
        {/* 高度铁律:窗顶 chrome 行一律 h-10(40px)——先按 mac 原生灯
            (垂直中心 ≈18)定了 h-9 同心,用户复看「有点太小」加到 40。
            mac 下 app.css 给本行 4px 底衬把行心压回 18:「差 2px 无感」是
            错判,灯是大圆点,真机一眼即穿(2026-08-18 二次报障;壳侧挪灯
            API 实测无效,见 main.rs)。左列与本头同高同底色、无分隔线,
            拼成一体的 L 形 chrome;内容画布是独立的一块(data-split-grid) */}
        {/* Windows/Linux 列收起:☰/新建 portal 进自绘标题栏左端——28px
            条本来就在,再开一行 h-10 只装两颗钮是纯浪费(2026-08-20 用户
            报障)。btn-xs 适配条高;列开着时双钮在品牌行,标题栏回归纯
            chrome。mac/浏览器无标题栏条,仍走下方 rightBar */}
        {active && !listOpen && titlebarSlot && createPortal(
          <span className="flex h-full items-center gap-0.5 ps-1">
            <button
              type="button"
              aria-label={t("split.listShow")}
              title={t("split.listShow")}
              aria-pressed={false}
              className="btn btn-ghost btn-square btn-xs text-base-content/60"
              onClick={toggleList}
            >
              <IconLayoutSidebar size={14} stroke={1.75} aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("split.newTask")}
              title={t("split.newTask")}
              className="btn btn-ghost btn-square btn-xs"
              onClick={newTaskAction}
            >
              <IconPlus size={14} stroke={1.75} className="text-primary" aria-hidden />
            </button>
          </span>,
          titlebarSlot,
        )}
        {rightBar && (
          <header
            data-view-header=""
            data-tauri-drag-region=""
            data-mac-lights-clear=""
            className="mc-workbench-surface-100 flex h-10 shrink-0 items-center gap-2 px-4"
          >
            {!listOpen && (
              <button
                type="button"
                aria-label={t("split.listShow")}
                title={t("split.listShow")}
                aria-pressed={false}
                className="btn btn-ghost btn-square btn-sm text-base-content/60"
                onClick={toggleList}
              >
                <IconLayoutSidebar size={16} stroke={1.75} aria-hidden />
              </button>
            )}
            {/* 新建钮的家在任务列顶行(2026-08-18 用户定案);列收起时随 ☰
                一起回到这儿兜底,创建入口不断路 */}
            {!listOpen && (
              <button
                type="button"
                aria-label={t("split.newTask")}
                title={t("split.newTask")}
                className="btn btn-ghost btn-square btn-sm"
                onClick={newTaskAction}
              >
                <IconPlus size={16} stroke={1.75} className="text-primary" aria-hidden />
              </button>
            )}
            {/* 无标题(2026-08-18 用户定案不变);空段撑开 + 拖拽区 */}
          <div data-tauri-drag-region="" className="min-w-0 flex-1" />
          </header>
        )}

        {/* ⚠️ 两层 min-w-0 总闸不变(2026-08-18 溢出事故,机检见
            SplitView.test):右栈与格区。格区 = **独立的内容块**(用户定案
            2026-08-18「sidebar 和 header 做一个整体,内容区域单独一块」):
            比 chrome 深半档的画布 + 左上圆角内嵌进 L 形 chrome,12px 衬,
            分隔线藏进卡缝 */}
        {/* 平铺画布:bg 只为透出 1px 分隔线;无衬(2026-08-19 mockup 终案,
            浮卡的 12px 衬退役)。拖窗面 = 细头空白区(PaneHeader 自带拖拽
            属性)+ 列顶行 */}
        <div
          ref={gridRef}
          data-split-grid=""
          data-tauri-drag-region=""
          className="mc-workbench-surface-300 relative flex min-h-0 min-w-0 flex-1"
          onDragOverCapture={onGridDragOverCapture}
          onDropCapture={onGridDropCapture}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDropEdge(null);
              setDropSlot(null);
            }
          }}
        >
          {zoomedSlot !== null ? renderPane(zoomedSlot) : renderLayout(split.tree)}
          {dropEdge && (dropEdge.edge === "left" || dropEdge.edge === "right") && (
            <div
              aria-hidden
              data-split-root-drop={dropEdge.edge}
              className={`pointer-events-none absolute inset-y-0 z-40 w-12 bg-secondary/15 ring-2 ring-secondary/70 ring-inset ${
                dropEdge.edge === "left" ? "start-0" : "end-0"
              }`}
            />
          )}
        </div>
      </div>
      </main>
      {active && shortcutsOpen && <ShortcutHelp onClose={() => setShortcutsOpen(false)} />}
    </>
  );
}

const SHORTCUT_HELP: ReadonlyArray<{
  action: AppShortcutAction;
  label: MessageKey;
  context: MessageKey;
}> = [
  { action: "new-task", label: "shortcuts.newTask", context: "shortcuts.context.workbench" },
  { action: "focus-composer", label: "shortcuts.focusComposer", context: "shortcuts.context.focused" },
  { action: "open-settings", label: "shortcuts.openSettings", context: "shortcuts.context.app" },
  { action: "toggle-sidebar", label: "shortcuts.toggleSidebar", context: "shortcuts.context.workbench" },
  { action: "split-right", label: "shortcuts.splitRight", context: "shortcuts.context.focused" },
  { action: "split-down", label: "shortcuts.splitDown", context: "shortcuts.context.focused" },
  { action: "toggle-permission", label: "shortcuts.togglePermission", context: "shortcuts.context.local" },
  { action: "stop-generation", label: "shortcuts.stopGeneration", context: "shortcuts.context.running" },
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <DetailModal ariaLabel={t("shortcuts.title")} title={t("shortcuts.title")} onClose={onClose}>
      <p className="mb-3 text-xs text-base-content/60">{t("shortcuts.primaryHint")}</p>
      <div className="divide-y divide-base-300 rounded-box border border-base-300">
        {SHORTCUT_HELP.map((item) => (
          <div key={item.action} className="flex items-center gap-3 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t(item.label)}</span>
              <span className="block text-base-content/45">{t(item.context)}</span>
            </span>
            <kbd className="kbd kbd-sm shrink-0">{shortcutChord(item.action)}</kbd>
          </div>
        ))}
      </div>
    </DetailModal>
  );
}

/** 更新提醒条(任务列页脚;旧侧栏 UpdateFooter 原样迁入)。 */
function UpdateFooter() {
  const { t } = useI18n();
  const { update, installing, error, install } = useUpdate();
  if (!update?.available) return null;
  // 安装失败:忙态已由 useUpdate 复位,这里换错误形态外显原因,按钮可重试
  return (
    <div
      role={error ? "alert" : "status"}
      className={`alert ${error ? "alert-error" : ""} alert-soft m-2 mt-0 flex items-center py-1.5 text-xs`}
    >
      <span className="min-w-0 flex-1 truncate" title={error ?? undefined}>
        {error ? t("update.failed", { reason: error }) : t("update.available", { version: update.latest ?? "" })}
      </span>
      <button type="button" className={`btn ${error ? "btn-error" : "btn-primary"} btn-xs`} disabled={installing} onClick={install}>
        {installing && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {t("update.install")}
      </button>
    </div>
  );
}

/** 本地任务/会话的分拣(任务列与装载卡共用口径):**分组喂全量任务再
 *  过滤行**,项目顺序与主列表历史口径一致(先剔运行中再分组会错排)。 */
function partitionLocal(sessions: SessionMeta[], excludePlaced: ReadonlySet<string> | null) {
  const byRecent = (a: SessionMeta, b: SessionMeta) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  const pool = sessions.filter((m) => !excludePlaced || !excludePlaced.has(m.id));
  const localAll = pool.filter((m) => m.kind !== "chat");
  const tasks = localAll.filter((m) => !m.archived);
  const chats = pool.filter((m) => m.kind === "chat" && !m.archived).sort(byRecent);
  const archivedTasks = localAll.filter((m) => m.archived).sort(byRecent);
  const archivedChats = pool.filter((m) => m.kind === "chat" && m.archived).sort(byRecent);
  const busy = tasks.filter((m) => m.waiting_ask || m.status === "running").sort(byRecent);
  const busyIds = new Set(busy.map((m) => m.id));
  // 分组吃**全量**本地任务(含归档):groupSessions 自己把归档分桶进
  // g.archivedSessions / archivedProjects——先滤归档再分组,项目内
  // 「已归档任务」小节就恒空(2026-08-18 报障根因)
  const grouped = groupSessions(localAll, readProjectOrder(), readArchivedProjects());
  return { tasks, chats, archivedTasks, archivedChats, busy, busyIds, grouped };
}

/** 任务列(应用唯一导航;可折叠):顶部计数行 + 三 tab(本地项目/本地
 *  会话/云端任务)。行政事务在此(旧侧栏能力迁入):行右键 改名/归档/
 *  删除、待办组、已归档折叠小节;云端 tab 整体复用 CloudTaskList(行菜单/
 *  项目组/历史/未连接空态全套)。点行 place 路由、拖行 LOAD 定点装载。 */
function WorkbenchList({
  sessions,
  placed,
  focusedEntry,
  cloud,
  admin,
  onToggleArchive,
  tab,
  onTabChange,
  revealTick,
  width,
  onToggleList,
  onPick,
  onNewTask,
  onNewChat,
  onNewCloudIn,
  onNewTaskInDir,
  onOpenSettings,
  onOpenShortcuts,
}: {
  sessions: SessionMeta[];
  placed: ReadonlySet<string>;
  focusedEntry: string | null;
  cloud?: SplitCloudWiring;
  admin?: SplitAdminWiring;
  onToggleArchive: (meta: SessionMeta) => void;
  /** 当前 tab 受控于 SplitView(头部「新建」的 kind 跟它走)。 */
  tab: "local" | "cloud";
  onTabChange: (tab: "local" | "cloud") => void;
  /** 点格联动信号(同格重复点击也 reveal)。 */
  revealTick?: number;
  /** 列宽(SplitView 拖宽状态;缺省 --spacing-side)。 */
  width?: number;
  onToggleList: () => void;
  onPick: (entry: string) => void;
  /** 列顶「新建」主钮(kind 跟当前 tab;新建即新格)。 */
  onNewTask: () => void;
  /** 「临时会话」组头「+」快捷新建会话(内嵌创建预选会话页签)。 */
  onNewChat: () => void;
  /** 云端项目组头「在此新建」:格内创建预选该项目。 */
  onNewCloudIn: (project: CloudProject) => void;
  /** 组头「在此项目新建任务」(内嵌创建预填目录;旧侧栏能力)。 */
  onNewTaskInDir: (dir: string) => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}) {
  const { t, locale } = useI18n();
  // 项目组折叠:沿用 mc.collapsedGroups(与旧侧栏同键,升级不丢档);
  // 收起即卸载(§6.2)。「运行中」小节不可折
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);
  // 项目归档集/手动序/项目内归档小节都住 localStorage(partitionLocal 每次
  // 渲染现读):写盘后 bump 一下让本组件重读
  const [, setStoreRev] = useState(0);
  const bumpStore = () => setStoreRev((n) => n + 1);
  // 项目内「已归档任务」小节开合(旧 UI 契约键 mc.sessionArchivesOpen,
  // 按项目 key 记)
  const [archivesOpen, setArchivesOpen] = useState<Set<string>>(readSessionArchivesOpen);
  // 临时会话组内「已归档会话」小节开合(沿用 mc.archivedOpen 布尔键)
  const [chatArchivesOpen, setChatArchivesOpen] = useState<boolean>(() => readFold("mc.archivedOpen"));
  const toggleChatArchives = () => {
    const next = !chatArchivesOpen;
    setChatArchivesOpen(next);
    writeFold("mc.archivedOpen", next);
  };
  const toggleArchives = (key: string) => {
    const next = new Set(archivesOpen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setArchivesOpen(next);
    writeSessionArchivesOpen(next);
  };
  // 组头拖拽排序(旧侧栏能力:mc.projectOrder 全序快照,落点 border-t 线)
  const [draggedGroup, setDraggedGroup] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const setGroupOpen = (key: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    writeCollapsedGroups(next);
  };
  // 行内改名(旧侧栏能力迁入):Enter 提交/Esc·失焦取消
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 点格/焦点换人 → 任务列定位对应行:**tab 跟着切**(2026-08-19 用户
  // 「在云端 tab 点本地任务为啥不切换」,推翻同日「不硬切」初版)、展开
  // 所在组、滚动进视野;revealTick 让同一格的重复点击也联动
  useEffect(() => {
    if (!focusedEntry) return;
    if (isCloudSlotId(focusedEntry)) {
      if (tab !== "cloud") onTabChange("cloud");
      return; // 云端行定位交给 CloudTaskList 的 currentId 高亮
    }
    if (tab !== "local") onTabChange("local");
    const m = sessions.find((x) => x.id === focusedEntry);
    if (m) {
      const key = m.kind === "chat" ? CHATS_GROUP_KEY : projectKey(m.workdir);
      if (collapsed.has(key)) setGroupOpen(key, true);
    }
    requestAnimationFrame(() => {
      // jsdom 无 CSS.escape;会话 id 本无引号,双保险转义足矣
      const esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(focusedEntry) : focusedEntry.replace(/"/g, '\\"');
      document.querySelector(`[data-row-id="${esc}"]`)?.scrollIntoView?.({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只跟焦点/点格信号走;其余取当帧闭包
  }, [focusedEntry, revealTick]);

  const { tasks, chats, archivedTasks, archivedChats, grouped } = partitionLocal(sessions, null);
  // 「临时会话」与项目组同一条 mc.projectOrder 快照参与**拖动排序**(哨兵
  // 键入序;2026-08-18 用户「不能拖动排序么?默认放到待办下面?」):
  // 未入序时默认下标 0 = 待办组之下、项目组之前。插入点按「序里 chats
  // 之前仍存活的项目数」折算,项目来去不破位
  const projGroups = grouped.projects.filter((g) => g.sessions.length > 0 || g.archivedSessions.length > 0);
  const savedOrder = readProjectOrder();
  const chatsAt = savedOrder.indexOf(CHATS_GROUP_KEY);
  const chatsPos = chatsAt < 0 ? 0 : savedOrder.slice(0, chatsAt).filter((k) => projGroups.some((g) => g.key === k)).length;
  const groupKeys = projGroups.map((g) => g.key);
  groupKeys.splice(chatsPos, 0, CHATS_GROUP_KEY);
  const dropGroup = (target: string) => {
    if (draggedGroup && draggedGroup !== target) {
      writeProjectOrder(reorderKeys(groupKeys, draggedGroup, target));
      bumpStore();
    }
    setDraggedGroup(null);
    setDragOverGroup(null);
  };

  const menuFor = (meta: SessionMeta): MenuItem[] =>
    admin
      ? [
          { label: t("sidebar.row.rename"), run: () => setRenamingId(meta.id) },
          {
            label: meta.archived ? t("sidebar.row.unarchive") : t("sidebar.row.archive"),
            run: () => onToggleArchive(meta),
          },
          {
            label: t("sidebar.row.delete"),
            confirm: t("sidebar.row.deleteConfirm"),
            danger: true,
            disabledReason: meta.status === "running" ? t("sidebar.row.deleteRunning") : undefined,
            run: () => admin.onDelete(meta),
          },
        ]
      : [];

  // 行内改名输入行(旧侧栏同款:Enter 提交,空转判定收口 lib/util/rename)
  const renameRow = (meta: SessionMeta, level: number) => (
    <li key={meta.id}>
      <div className={`min-h-8 p-1 ${levelPad(level)}`}>
        <input
          type="text"
          aria-label={t("sidebar.row.rename")}
          placeholder={t("chat.rename.clearHint")}
          className="input input-xs w-full"
          defaultValue={meta.title}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRenamingId(null);
              return;
            }
            if (e.key !== "Enter") return;
            const title = e.currentTarget.value.trim();
            if (!renameIsNoop(title, meta)) admin?.onRename(meta, title);
            setRenamingId(null);
          }}
          onBlur={() => setRenamingId(null)}
        />
      </div>
    </li>
  );
  const row = (m: SessionMeta, level = 0) => {
    if (renamingId === m.id) return renameRow(m, level);
    const onBoard = placed.has(m.id);
    const attention = admin?.attentionIds.has(m.id) ?? false;
    return (
      <ListRow
        key={m.id}
        primary={m.title_custom ? m.title : m.summary || m.title}
        trailing={rowTrailing(m, t, attention)}
        tooltip={[
          m.title,
          m.summary,
          m.kind === "chat" ? t("sidebar.row.chatDetail") : m.workdir,
          rowStatusLabel(m, t),
          onBoard ? t("split.onBoard") : t("split.dragLoad"),
          admin ? t("sidebar.row.hint") : "",
        ]
          .filter(Boolean)
          .join("\n")}
        level={level}
        active={focusedEntry === m.id}
        archived={m.archived}
        attention={attention}
        onSelect={() => onPick(m.id)}
        menuItems={menuFor(m)}
        onDragStart={(e) => {
          e.dataTransfer.setData(LOAD_MIME, m.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        dataId={m.id}
      />
    );
  };
  const TABS: { k: "local" | "cloud"; icon: typeof IconFolderCode; label: MessageKey }[] = [
    { k: "local", icon: IconFolderCode, label: "split.tabTasks" },
    ...(cloud ? [{ k: "cloud" as const, icon: IconCloud, label: "split.tabCloud" as MessageKey }] : []),
  ];

  // ☰ 列开关 + 新建双钮(mac 住列顶 chrome 行,其余平台住品牌行行尾——
  // 家不同、钮一致)。新建 = ☰ 同语汇的 ghost 方钮(2026-08-18 用户报障
  // 「按钮丑」:soft-primary 色块是全 chrome 唯一大填充,违背「安静
  // chrome、填充只归选中」),品牌感只落图标色;kind 跟当前 tab,新建即新格
  const listActions = (
    <>
      <button
        type="button"
        aria-label={t("split.listHide")}
        title={t("split.listHide")}
        aria-pressed
        className="btn btn-ghost btn-square btn-sm text-base-content/60"
        onClick={onToggleList}
      >
        <IconLayoutSidebar size={16} stroke={1.75} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={t("split.newTask")}
        title={t("split.newTask")}
        className="btn btn-ghost btn-square btn-sm"
        onClick={onNewTask}
      >
        <IconPlus size={16} stroke={1.75} className="text-primary" aria-hidden />
      </button>
    </>
  );

  return (
    <aside
      aria-label={t("split.pickTitle")}
      style={width ? { width } : undefined}
      className="mc-workbench-surface-200 relative flex w-side shrink-0 flex-col border-e border-base-300"
    >
      {/* 列顶 chrome 行(参考图 2026-08-18)**只在 mac 渲染**:它存在的
          理由是给原生灯让位(净空标记见 app.css)。Windows/Linux/浏览器
          没有灯,这行就是一条空行挂两颗钮(2026-08-20 用户报障「空了
          一行,好丑」)——双钮改并进品牌行行尾,整行省掉。
          整行拖拽区(§7:非交互子节点各自带) */}
      {isMacShell() && (
        <div data-tauri-drag-region="" data-mac-lights-clear="" className="flex h-10 shrink-0 items-center px-2">
          {/* 左端让给 mac 灯,双钮整体靠右(2026-08-18 用户定案「都 float
              到右边」):☰ 在内、新建收尾贴角 */}
          <div data-tauri-drag-region="" className="min-w-0 flex-1" />
          {listActions}
        </div>
      )}
      {/* 品牌行(2026-08-18 用户定案「tab 上方加品牌」;旧侧栏头同款
          Brand = 字标 + work 徽标,自带逐节点拖拽区);非 mac 双钮住行尾
          (chrome 行已省,见上) */}
      <div data-tauri-drag-region="" className={`flex items-center gap-2 ps-5 pt-1 pb-2 ${isMacShell() ? "pe-4" : "pe-2 min-h-10"}`}>
        <Brand />
        {!isMacShell() && (
          <>
            <span data-tauri-drag-region="" className="min-w-0 flex-1" />
            {listActions}
          </>
        )}
      </div>
      {/* tab 盒式切换(形态五代:border 下划线 → box 白 pill → box 补轨
          → 文字级 → 回归 box,2026-08-20 用户「改成 box」):与换任务
          装载卡的 tabs-box 同语汇,选中 = 白底 pill;侧栏底色即 base-200,
          盒轨与列底同色隐形,只剩选中 pill 浮起,重量比带轨时代轻 */}
      <div className="ps-4 pe-4 pb-1">
        <div role="tablist" aria-label={t("split.pickTitle")} className="tabs tabs-box tabs-sm w-full">
          {TABS.map(({ k, label }) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={`tab flex-1 px-1 text-xs whitespace-nowrap font-semibold transition-colors duration-150 ${tab === k ? "tab-active" : ""}`}
              onClick={() => onTabChange(k)}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 [scrollbar-gutter:stable]">
        {tab === "local" ? (
          // menu 截断铁律(§6):flex-nowrap 一个都不能少,行内 truncate 链
          <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
            {/* 待办组(旧侧栏能力迁入,升级不丢档:同一 TodoSection、同一
                mc.collapsedGroups 哨兵键) */}
            {admin?.todo && (
              <TodoSection
                todo={admin.todo}
                sessions={sessions}
                collapsed={collapsed.has(TODO_GROUP_KEY)}
                onToggleCollapsed={setGroupOpen}
              />
            )}
            {/* 旧侧栏对表(2026-08-18 用户报障「完全不对」):无「运行中」
                置顶区——行留在项目组内,等待由组头 waiting 徽标 + 行尾
                状态点承担;组头 = Folder/FolderOpen 随开合 + 裸项目名 +
                waiting 徽标 + hover 显形「+」快捷新建(常驻占位) */}
            {groupKeys.map((gk) => {
              // 「项目」小节帽(2026-08-19 mockup):待办/临时会话是固定组,
              // 项目是动态列表,中间加分区帽;帽跟第一颗真项目走(临时
              // 会话可拖进项目之间,不跟它)
              const projectsCap =
                gk === groupKeys.find((k) => k !== CHATS_GROUP_KEY) ? (
                  <li key="projects-cap" aria-hidden className="pointer-events-none">
                    {/* 12px 帽层(2026-08-19 用户「太小了」:2xs 10px 升 xs) */}
                    <span className="pt-2 pb-0.5 text-xs font-medium text-base-content/45">
                      {t("split.projectsCaption")}
                    </span>
                  </li>
                ) : null;
              // 临时会话:与项目组同列参与排序的哨兵组(拖拽热区/落点线/
              // draggable 全套同款;无项目行政,hover「+」新建会话;组头
              // 常驻——藏空组会把新建会话的常驻入口一起藏掉)
              if (gk === CHATS_GROUP_KEY)
                return (
                  <Fragment key={gk}>
                    <li
                      className="relative"
                      onDragOver={(e) => {
                        if (!draggedGroup || draggedGroup === gk) return;
                        e.preventDefault();
                        setDragOverGroup(gk);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropGroup(gk);
                      }}
                    >
                      <div
                        className="group/ghead relative flex w-full min-w-0 items-stretch gap-0 p-0"
                        title={t("sidebar.project.dragHint")}
                        draggable
                        onClick={(e) => {
                          if (e.target === e.currentTarget) setGroupOpen(gk, collapsed.has(gk));
                        }}
                        onDragStart={(e) => {
                          setDraggedGroup(gk);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", gk);
                        }}
                        onDragEnd={() => {
                          setDraggedGroup(null);
                          setDragOverGroup(null);
                        }}
                      >
                        {dragOverGroup === gk && draggedGroup !== gk && (
                          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
                        )}
                        <FixedGroupHeader
                          icon={IconMessages}
                          name={t("split.chatsGroup")}
                          collapsed={collapsed.has(gk)}
                          onToggle={() => setGroupOpen(gk, collapsed.has(gk))}
                          onAdd={onNewChat}
                          addLabel={t("split.newChat")}
                        />
                      </div>
                    </li>
                    {!collapsed.has(gk) && (
                      <>
                        {chats.length === 0 && archivedChats.length === 0 && (
                          <li className="pointer-events-none">
                            <span className={`${levelPad(1)} text-base-content/40`}>{t("split.pickEmptyChats")}</span>
                          </li>
                        )}
                        {chats.map((m) => row(m, 1))}
                        {/* 组内小节与项目组「已归档任务」同构:Archive 头
                            L1、行 L2(SectionFold 是底部通栏小节的形态,
                            进组内不带缩进——2026-08-18 用户报障「缩进
                            不太对」) */}
                        {archivedChats.length > 0 && (
                          <>
                            <li>
                              <button
                                type="button"
                                className={`flex w-full min-w-0 items-center gap-2 text-start text-xs text-base-content/50 ${levelPad(1)}`}
                                aria-expanded={chatArchivesOpen}
                                onClick={toggleChatArchives}
                              >
                                <span className="inline-flex w-3 shrink-0 justify-center">
                                  <IconArchive size={10} stroke={1.75} aria-hidden />
                                </span>
                                <span className="min-w-0 flex-1 truncate">{t("sidebar.archivedChats")}</span>
                              </button>
                            </li>
                            {chatArchivesOpen && archivedChats.map((m) => row(m, 2))}
                          </>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              const g = projGroups.find((x) => x.key === gk)!;
              return (
                <Fragment key={g.key}>
                  {projectsCap}
                  {/* 拖拽热区挂 li(旧侧栏教训:只挂组头,组一展开上下全是
                      死区);落点线**绝对定位**不占布局(border-t 会把整列
                      顶跳 2px) */}
                  <li
                    className="relative"
                    onDragOver={(e) => {
                      if (!draggedGroup || draggedGroup === g.key) return;
                      e.preventDefault();
                      setDragOverGroup(g.key);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropGroup(g.key);
                    }}
                  >
                    <div
                      className="group/ghead relative flex w-full min-w-0 items-stretch gap-0 p-0"
                      title={[g.key, t("sidebar.project.hint"), t("sidebar.project.dragHint")].join("\n")}
                      draggable
                      onClick={(e) => {
                        if (e.target === e.currentTarget) setGroupOpen(g.key, collapsed.has(g.key));
                      }}
                      onDragStart={(e) => {
                        setDraggedGroup(g.key);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", g.key);
                      }}
                      onDragEnd={() => {
                        setDraggedGroup(null);
                        setDragOverGroup(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openMenu({ x: e.clientX, y: e.clientY }, [
                          { label: t("sidebar.project.newTaskIn"), run: () => onNewTaskInDir(g.key) },
                          {
                            label: t("sidebar.project.archive"),
                            run: () => {
                              const next = new Set(readArchivedProjects());
                              next.add(g.key);
                              writeArchivedProjects(next);
                              bumpStore();
                            },
                          },
                        ]);
                      }}
                    >
                      {dragOverGroup === g.key && draggedGroup !== g.key && (
                        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />
                      )}
                      <button
                        type="button"
                        className="flex min-h-8 min-w-0 flex-1 items-center gap-2 py-1.5 ps-3 pe-1 text-start"
                        aria-expanded={!collapsed.has(g.key)}
                        onClick={() => setGroupOpen(g.key, collapsed.has(g.key))}
                      >
                        <GroupLabel icon={collapsed.has(g.key) ? IconFolder : IconFolderOpen} name={g.name} />
                        {g.sessions.filter((m) => m.waiting_ask).length > 0 && (
                          <span className="badge badge-warning badge-xs">
                            {g.sessions.filter((m) => m.waiting_ask).length}
                          </span>
                        )}
                        {/* 开合 chevron 殿后常驻(2026-08-19 mockup:状态外显) */}
                        <IconChevronDown
                          size={12}
                          stroke={1.75}
                          aria-hidden
                          className={`shrink-0 text-base-content/40 transition-transform duration-150 ${collapsed.has(g.key) ? "-rotate-90" : ""}`}
                        />
                      </button>
                      {/* 快捷钮常驻占位、hover 只切可见性(插入式显隐会挤动
                          项目名,鼠标一进一出就抖) */}
                      <button
                        type="button"
                        aria-label={t("sidebar.project.newTask")}
                        title={t("sidebar.project.newTask")}
                        className="btn btn-ghost btn-xs invisible h-8 min-h-8 w-9 shrink-0 group-hover/ghead:visible group-focus-within/ghead:visible"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onNewTaskInDir(g.key);
                        }}
                      >
                        <IconPlus size={14} stroke={1.75} aria-hidden />
                      </button>
                    </div>
                  </li>
                  {!collapsed.has(g.key) && g.sessions.map((m) => row(m, 1))}
                  {/* 项目内「已归档任务」小节(旧侧栏同构:Archive 头 L1、
                      行 L2、开合按项目 key 记 mc.sessionArchivesOpen) */}
                  {!collapsed.has(g.key) && g.archivedSessions.length > 0 && (
                    <>
                      <li>
                        <button
                          type="button"
                          className={`flex w-full min-w-0 items-center gap-2 text-start text-xs text-base-content/50 ${levelPad(1)}`}
                          aria-expanded={archivesOpen.has(g.key)}
                          onClick={() => toggleArchives(g.key)}
                        >
                          <span className="inline-flex w-3 shrink-0 justify-center">
                            <IconArchive size={10} stroke={1.75} aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{t("sidebar.archivedTasks")}</span>
                        </button>
                      </li>
                      {archivesOpen.has(g.key) && g.archivedSessions.map((m) => row(m, 2))}
                    </>
                  )}
                </Fragment>
              );
            })}
            {/* 新安装还没有任何项目时也保留分区锚点，避免临时会话下面
                直接落一条空态文案，看起来像整块内容缺失。 */}
            {projGroups.length === 0 && (
              <li aria-hidden className="pointer-events-none">
                <span className="pt-2 pb-0.5 text-xs font-medium text-base-content/45">
                  {t("split.projectsCaption")}
                </span>
              </li>
            )}
            {tasks.length === 0 && archivedTasks.length === 0 && (
              <li className="pointer-events-none">
                <span className="text-xs text-base-content/50">{t("split.projectsEmpty")}</span>
              </li>
            )}
            {/* 底部「已归档项目」小节(旧侧栏能力回归:2026-08-18 用户报障
                归档项目在新壳里整个不可见且无法恢复):组头右键可恢复,
                组内活跃/归档行同列(归档行 ListRow 降色) */}
            {grouped.archivedProjects.length > 0 && (
              <SectionFold label={t("sidebar.archivedProjects")} foldKey="mc.projectArchiveOpen">
                {grouped.archivedProjects.map((g) => (
                  <Fragment key={g.key}>
                    <li>
                      <button
                        type="button"
                        className={`flex w-full min-w-0 items-center gap-2 text-start ${levelPad(1)}`}
                        title={`${g.key}\n${t("sidebar.project.hint")}`}
                        aria-expanded={!collapsed.has(g.key)}
                        onClick={() => setGroupOpen(g.key, collapsed.has(g.key))}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openMenu({ x: e.clientX, y: e.clientY }, [
                            {
                              label: t("sidebar.project.unarchive"),
                              run: () => {
                                const next = new Set(readArchivedProjects());
                                next.delete(g.key);
                                writeArchivedProjects(next);
                                bumpStore();
                              },
                            },
                          ]);
                        }}
                      >
                        <GroupLabel icon={IconFolder} name={g.name} />
                      </button>
                    </li>
                    {!collapsed.has(g.key) &&
                      [...g.sessions, ...g.archivedSessions].map((m) => row(m, 2))}
                  </Fragment>
                ))}
              </SectionFold>
            )}
          </ul>
        ) : cloud ? (
          // 云端 tab 整体复用 CloudTaskList(进行中/项目组/历史/行菜单/
          // 未连接空态全套;它自带 menu ul,不再外包)。点行经 place 路由入格
          <CloudTaskList
            feed={cloud.feed}
            projects={cloud.projects}
            currentId={focusedEntry && isCloudSlotId(focusedEntry) ? cloudTaskIdOf(focusedEntry) : null}
            onSelect={(task) => onPick(cloudSlotId(task.id))}
            reloadKey={cloud.reloadKey}
            onDeleted={cloud.onDeleted}
            onNewTaskIn={(project) => onNewCloudIn(project)}
            onTaskDragStart={(e, task) => {
              e.dataTransfer.setData(LOAD_MIME, cloudSlotId(task.id));
              e.dataTransfer.effectAllowed = "move";
            }}
          />
        ) : null}
      </div>
      {/* 设置沉底(2026-08-18 用户定案「放在 sidebar 的下方」;参考图把
          它放右下角):列收起时经 ☰ 一击可达,不在头部留第二个门
          (§3 一处法定位置) */}
      {/* 更新提醒条(旧侧栏底部条原样回迁,2026-08-20 用户问「还有么」——
          删旧 Sidebar 时漏迁;与设置页「关于」共享 useUpdate store) */}
      <UpdateFooter />
      {/* 设置沉左下(2026-08-19 mockup);官网/GitHub 靠右(2026-08-20 用户
          定案;URL 以 README 支持区为准,openExternal 出浏览器) */}
      <div className="flex items-center border-t border-base-300 p-1">
        <button
          type="button"
          className="btn btn-ghost btn-sm justify-start gap-2 px-2 font-normal text-base-content/70"
          onClick={onOpenSettings}
        >
          <IconSettings size={16} stroke={1.75} aria-hidden />
          {t("rail.settings")}
        </button>
        <button
          type="button"
          aria-label={t("shortcuts.title")}
          title={t("shortcuts.title")}
          className="btn btn-ghost btn-square btn-sm text-base-content/60"
          onClick={onOpenShortcuts}
        >
          <IconKeyboard size={16} stroke={1.75} aria-hidden />
        </button>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label={t("split.website")}
          title={t("split.website")}
          className="btn btn-ghost btn-square btn-sm text-base-content/60"
          // 官网按应用语言分流(frontend/site-redirect.ts 同一口径:中文站
          // .com、国际站 .net——2026-08-20 用户报障「为啥是国际版」)
          onClick={() => openExternal(locale.startsWith("zh") ? "https://monkeycode-ai.com/" : "https://monkeycode-ai.net/")}
        >
          <IconWorld size={16} stroke={1.75} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="GitHub"
          title="GitHub"
          className="btn btn-ghost btn-square btn-sm text-base-content/60"
          onClick={() => openExternal("https://github.com/chaitin/MonkeyCode")}
        >
          <IconBrandGithub size={16} stroke={1.75} aria-hidden />
        </button>
      </div>
    </aside>
  );
}

/** 格细头(h-9,base-200/60 淡底分块):状态点定宽槽 + 标题(**按住可
 *  拖拽换位**)+ 会话文件(本地格)/拆右/拆下/放大/更换/关闭——按钮簇
 *  hover 显隐(invisible 常驻占位,§6.2 铁律),更换/独占态强制可见。 */
function PaneHeader({
  slot,
  meta,
  focused,
  attention = false,
  onRename,
  extrasRef,
  viewMenu,
  zoomed,
  swapping,
  onSplit,
  onZoom,
  onSwap,
  onClose,
}: {
  slot: number;
  meta: SessionMeta | null;
  /** 多格并存时的焦点格:标题下划线表达(ring 环退役,2026-08-19)。 */
  focused: boolean;
  /** 格级未读(可见非焦点格的轮结束/审批/提问,2026-08-20 用户「得让人
   *  知道这个 panel 需要他操作」):头部左缘警示条(任务列 ATTENTION_BAR
   *  同语言)+ 状态点走 attention 语义,落焦即消。 */
  attention?: boolean;
  /** 双击标题/⋯菜单「重命名」(仅本地会话;旧单会话头能力回归,
   *  2026-08-19 用户报障「不能从 header 修改标题了」)。 */
  onRename?: (title: string) => void;
  /** 视图贡献动作的通用插槽(display:contents,视图经 createPortal 注入
   *  ——格头是唯一框架、不写任务类型分支,2026-08-19 用户定案「panel
   *  都是通用的」;云端投 文件/终端)。 */
  extrasRef?: (el: HTMLElement | null) => void;
  /** 视图菜单项 provider(开 ⋯ 时现取,并入唯一菜单——双 ⋯ 沙雕,
   *  2026-08-19 用户报障;云端投 控制台/预览/终止/删除)。 */
  viewMenu?: () => MenuItem[];
  zoomed: boolean;
  swapping: boolean;
  onSplit: (dir: SplitDir) => void;
  onZoom: () => void;
  onSwap: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  // ⋯ 菜单开着时簇钉住可见:openMenu 挂在 body,焦点/hover 一离格,
  // hover 显隐就把整簇藏了——「点了点点点,header 选项消失」(2026-08-20
  // 用户报障)
  const [menuOpen, setMenuOpen] = useState(false);
  const trailing = meta ? rowTrailing(meta, t, attention) : null;
  const btn = "btn btn-ghost btn-square btn-sm text-base-content/60";
  const cluster = `flex shrink-0 items-center gap-2 ${
    swapping || zoomed || menuOpen ? "visible" : "invisible group-hover/pane:visible group-focus-within/pane:visible"
  }`;
  return (
    // 白底细头 h-12(右侧无顶条后它就是每格的视图头,2026-08-19 用户
    // 「再大一点」;§7:拖拽属性不继承,空白区自任拖窗面)。未读态左缘
    // 竖警示条:与任务列 ATTENTION_BAR 同语言,h-12 下 inset-y-2 取 32px
    <div
      data-tauri-drag-region=""
      data-attention={attention ? "" : undefined}
      className={`relative flex h-12 shrink-0 items-center gap-2 border-b border-base-300 px-4${
        attention ? " before:absolute before:inset-y-2 before:start-1 before:w-0.5 before:rounded-full before:bg-warning before:content-['']" : ""
      }`}
    >
      {/* 12px 定宽槽:静默态无点也不让标题横移(§7:非交互节点自带拖窗) */}
      <span data-tauri-drag-region="" className="inline-flex w-3 shrink-0 justify-center">
        {trailing && <StatusDot {...trailing} />}
      </span>
      {/* 标题 = 换位拖拽把手(HTML5 draggable,落点高亮在 section 上) */}
      {renaming ? (
        <input
          type="text"
          aria-label={t("sidebar.row.rename")}
          placeholder={t("chat.rename.clearHint")}
          className="input input-sm min-w-0 flex-1"
          defaultValue={meta?.title ?? ""}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setRenaming(false);
              return;
            }
            if (e.key !== "Enter") return;
            const title = e.currentTarget.value.trim();
            if (meta && onRename && !renameIsNoop(title, meta)) onRename(title);
            setRenaming(false);
          }}
          onBlur={() => setRenaming(false)}
        />
      ) : (
      <>
      <span
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SWAP_MIME, String(slot));
          e.dataTransfer.effectAllowed = "move";
        }}
        onDoubleClick={() => meta && onRename && setRenaming(true)}
        className={`min-w-0 cursor-grab truncate text-sm font-medium ${meta ? "" : "text-base-content/40"}`}
        title={
          meta
            ? [meta.title, meta.summary, meta.workdir, onRename ? t("split.renameHint") : "", t("split.dragSwap")]
                .filter(Boolean)
                .join("\n")
            : t("split.dragSwap")
        }
      >
        {/* 焦点下划线只垫在文字宽度下(tab 同语汇)。下划线**绝对定位悬挂**
            不占布局;盒用 block+w-fit——truncate 的 inline-block 基线是
            盒底缘,行内基线对齐会把整盒顶高 ~4px,标题视觉离心
            (2026-08-19 用户报障「没有居中」,Chrome 实测钉死) */}
        <span
          data-split-focus={focused ? "" : undefined}
          className={`block w-fit max-w-full truncate ${
            focused ? "relative after:absolute after:inset-x-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-primary after:content-['']" : ""
          }`}
        >
          {meta ? (meta.title_custom ? meta.title : meta.summary || meta.title) : t("split.emptyPane")}
        </span>
      </span>
      {/* 真拖窗撑开段(2026-08-19 用户报障「有的区域拖不动」:Tauri 拖窗
          属性只认事件目标自身,标题 flex-1 时整条头都是交互件的地盘;
          标题收回文字宽,余量归这段) */}
      <span data-tauri-drag-region="" className="min-w-0 flex-1" />
      </>
      )}
      <div className={cluster}>
        {/* 文件钮不再是框架特例:本地/云端都由视图经插槽自投(2026-08-19
            「云端在格内、本地为啥全局」——抽屉也一并入格) */}
        {extrasRef && <span ref={extrasRef} className="contents" />}
        {/* 分窗操作(拆右/拆下/独占/更换)收进一个 ⋯ 菜单(2026-08-18
            用户定案「不是常见的操作」):细头常驻只留 文件/⋯/关闭 三件,
            更换/独占的活动态仍把簇钉为可见 */}
        <button
          type="button"
          aria-label={t("split.paneMenu")}
          title={t("split.paneMenu")}
          className={`${btn} ${swapping ? "btn-active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
            // 排序:内容事(改名/换任务)→ 布局事(分屏/最大化)→ 视图项
            // (云端:控制台/预览/终止/删除,危险项天然殿后)
            openMenu(
              { x: e.clientX, y: e.clientY },
              [
                ...(meta && onRename ? [{ label: t("sidebar.row.rename"), run: () => setRenaming(true) }] : []),
                ...(meta ? [{ label: swapping ? t("split.swapCancel") : t("split.swap"), run: onSwap }] : []),
                { label: t("split.splitRight"), run: () => onSplit("col") },
                { label: t("split.splitDown"), run: () => onSplit("row") },
                { label: zoomed ? t("split.unzoom") : t("split.zoom"), run: onZoom },
                ...(viewMenu?.() ?? []),
              ],
              { onClose: () => setMenuOpen(false) },
            );
          }}
        >
          <IconDots size={16} stroke={1.75} aria-hidden />
        </button>
        <button type="button" aria-label={t("split.close")} title={t("split.close")} className={btn} onClick={onClose}>
          <IconX size={16} stroke={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** 装载卡(任务列收起时空槽的常驻形态/更换态):轻量快速挑选——tab 同
 *  任务列但**无行政**(右键/待办/归档住任务列,装载卡只管装),判重排除
 *  已入格。云端 tab 为平铺轻版(完整云端管理在任务列)。 */
function LoaderCard({
  sessions,
  placed,
  cloud,
  onPick,
  onNewTask,
  onNewCloud,
}: {
  sessions: SessionMeta[];
  placed: ReadonlySet<string>;
  cloud?: SplitCloudWiring;
  onPick: (entry: string) => void;
  onNewTask: (kind: SessionKind) => void;
  onNewCloud: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"local" | "cloud">("local");
  const { tasks, chats, busy, busyIds, grouped } = partitionLocal(sessions, placed);

  const row = (m: SessionMeta, level = 0) => {
    const trailing = rowTrailing(m, t, false);
    return (
      <li key={m.id}>
        <button
          type="button"
          className={`flex w-full min-w-0 items-center gap-2 text-start ${levelPad(level)}`}
          title={[m.title, m.summary, m.workdir].filter(Boolean).join("\n")}
          onClick={() => onPick(m.id)}
        >
          <span className="min-w-0 flex-1 truncate">{m.title_custom ? m.title : m.summary || m.title}</span>
          {trailing && <StatusDot {...trailing} />}
        </button>
      </li>
    );
  };
  const cloudRow = (c: CloudTask) => (
    <li key={c.id}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-start"
        title={c.title || c.summary || c.content || c.id}
        onClick={() => onPick(cloudSlotId(c.id))}
      >
        <span className="min-w-0 flex-1 truncate">{c.title || c.summary || c.content || c.id}</span>
        {c.status === "error" && <StatusDot tone="status-error" label={t("status.error")} />}
      </button>
    </li>
  );
  const sectionLabel = (icon: typeof IconFolder, name: string) => (
    <li className="pointer-events-none">
      <span className="flex min-w-0 items-center gap-2">
        <GroupLabel icon={icon} name={name} />
      </span>
    </li>
  );
  const emptyText = (text: string) => (
    <div className="flex h-full items-center justify-center">
      <p className="text-xs text-base-content/50">{text}</p>
    </div>
  );
  const cloudTasks = (cloud?.feed.tasks ?? []).filter((c) => !placed.has(cloudSlotId(c.id)));

  const TABS: { k: "local" | "cloud"; icon: typeof IconFolderCode; label: MessageKey }[] = [
    { k: "local", icon: IconFolderCode, label: "split.tabTasks" },
    ...(cloud ? [{ k: "cloud" as const, icon: IconCloud, label: "split.tabCloud" as MessageKey }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <div className="card card-border flex max-h-full w-full max-w-sm flex-col border-base-200 bg-base-100">
        <div className="card-body min-h-0 gap-1 p-3">
          <div className="px-2 pt-1">
            <div role="tablist" aria-label={t("split.pickTitle")} className="tabs tabs-box tabs-sm w-full">
              {TABS.map(({ k, label }) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  className={`tab flex-1 px-1 text-xs whitespace-nowrap font-semibold transition-colors duration-150 ${tab === k ? "tab-active" : ""}`}
                  onClick={() => setTab(k)}
                >
                  {t(label)}
                </button>
                ))}
            </div>
          </div>
          {/* 定高列表区:各 tab 内容量不同,不定高的话切 tab 整卡跳高 */}
          <div className="h-72 overflow-x-hidden overflow-y-auto p-2 [scrollbar-gutter:stable]">
            {tab === "local" ? (
              tasks.length === 0 && chats.length === 0 ? (
                emptyText(t("split.pickEmpty"))
              ) : (
                // menu 截断铁律(§6):flex-nowrap 一个都不能少
                <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
                  {busy.length > 0 && sectionLabel(IconActivity, t("split.pickRunning"))}
                  {busy.map((m) => row(m, 1))}
                  {grouped.projects
                    .map((g) => ({ ...g, sessions: g.sessions.filter((m) => !busyIds.has(m.id)) }))
                    .filter((g) => g.sessions.length > 0)
                    .map((g) => (
                      <Fragment key={g.key}>
                        {sectionLabel(IconFolder, g.name)}
                        {g.sessions.map((m) => row(m, 1))}
                      </Fragment>
                    ))}
                  {/* 临时会话段(chat 收进本地,2026-08-18;装载卡只管挑,
                      新建会话走任务列组头「+」或创建页内切页签) */}
                  {chats.length > 0 && (
                    <Fragment>
                      {sectionLabel(IconMessages, t("split.chatsGroup"))}
                      {chats.map((m) => row(m, 1))}
                    </Fragment>
                  )}
                </ul>
              )
            ) : cloud?.feed.unauthorized ? (
              emptyText(t("cloud.list.offline.title"))
            ) : cloudTasks.length === 0 ? (
              emptyText(t("split.pickEmpty"))
            ) : (
              <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">{cloudTasks.map(cloudRow)}</ul>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => (tab === "cloud" ? onNewCloud() : onNewTask("local"))}
          >
            <IconPlus size={14} stroke={1.75} aria-hidden />
            {t("split.newTask")}
          </button>
        </div>
      </div>
    </div>
  );
}
