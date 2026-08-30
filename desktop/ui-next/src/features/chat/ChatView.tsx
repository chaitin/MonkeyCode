// 聊天视图:header(标题+摘要+连接态)+ 消息流(贴底跟随/滚动记忆/加载
// 更早保位)+ 提问大纲(左缘点列,跳转补页)+ 任务面板 + 全功能 composer。
// 滚动策略:
// - 程序 scrollTop 全部留落点标记，未标记的向上滚动才解除贴底；
// - 会话滚动记忆保存「稳定 row key + 条目内偏移 + pinned」；
// - 「加载更早」前插同样按稳定 key，在提交后 layoutEffect 对齐原视口位。
// 大纲跳转:锚(data-user-seq)不在 DOM 时按条目 offset 走 ensureLoaded
// 精确补页(session_history 以 offset 为终点,不盲翻),补页提交前的空窗
// 用短时重试兜；当前项由虚拟高度索引 O(1) 反查最近的用户行。
import { IconAlertTriangle, IconDots, IconFileDiff, IconFolder, IconLayoutSidebarRight, IconPencil, IconTerminal2, IconWorld } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { createPortal } from "react-dom";

import { useApprovalHotkeys } from "@/app/shortcuts";
import { useI18n } from "@/lib/i18n";
import { useSettingsNavigation } from "@/features/settings/SettingsNavigationContext";
import { sessionBackgroundStop, sessionOutline, type OutlineItem } from "@/lib/ipc/controls";
import { engineCaps } from "@/lib/ipc/approvals";
import { repoChanges, repoPreviewFiles, repoReveal } from "@/lib/ipc/repo";
import { designTemplatePreviewRead, sessionFrame, sessionPatch, type SessionMeta } from "@/lib/ipc/sessions";
import { onNativeFileDrop, uploadFileURL } from "@/lib/ipc/uploads";
import { workspaceRelativePath } from "@/lib/util/markdownPaths";
import {
  consumeProgrammaticScroll,
  markProgrammaticScroll,
} from "@/lib/util/scrollAnchor";
import { renameIsNoop } from "@/lib/util/rename";
import { createImeGuard } from "@/lib/util/slash";
import { useDismiss } from "@/lib/util/useDismiss";
import { LocalComposerHost, type LocalComposerHandle } from "./composer/LocalComposerHost";
import { DetailModal } from "./DetailModal";
import { LogList, type LogListHandle } from "./LogList";
import { OutlineNav, useOutlineEntries } from "./OutlineNav";
import { TaskPanel } from "./TaskPanel";
import { FilesPanel } from "@/features/files/FilesPanel";
import { SidePanel, type SidePanelTab } from "@/components/SidePanel";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { DesignPreviewWorkbench } from "@/features/design/DesignPreviewWorkbench";
import { hasDesignRelatedChanges, rankPreviewFiles, selectTurnPreviewArtifact, targetForFile, touchedTurnChanges, turnWarrantsArtifactPreview, writtenToolPaths, type DesignPreviewTarget } from "@/features/design/previewArtifact";
import { currentTurnAgentPreviewUrl, newestAgentPreviewUrl, normalizePreviewUrl } from "@/features/design/previewUrl";
import { useSessionFeed } from "./useSessionFeed";

const PIN_THRESHOLD = 40; // 距底多少像素内算"贴底"(scroll 只做进入贴底的单向判定)
const SCROLLBAR_EDGE = 18; // 视口右缘按下算滚动条拖拽意图,解除跟随
const RESTORE_POLLS = 15; // 锚点恢复的轮询校准次数(200ms 一次,3s 内收敛)
const RESTORE_WAIT_POLLS = 150; // 历史补页/大窗口 transition 最多等 30s,随后回退尾部
const FLASH_MS = 1100; // 与 chrome.css mc-flash 动画时长对齐(略长于 1s)

// 各会话的滚动位置记忆:切走再切回仍在原位;贴底离开的会话回来仍贴底。
// rowKey 只在**同一次打开**里稳定:加载更早会同步左移 keyBase,既有节点不换；
// 但切回任务会从尾窗重新归约,keyBase 又从 0 开始,旧 rowKey 已经不是同一条。
// 因此跨打开另存最近一条 user-input 的稳定 seq + 它到视口顶的偏移,并带上
// 大纲给出的 replay offset；切回时先按 offset 补齐历史,再按 seq 恢复。旧记录
// 没 seq/大纲尚未到时才退回 rowKey。ChatView 会因设置页等视图切换整体卸载,
// 记忆只能存在模块级(旧 UI chat.tsx 同款设计,理由随迁)。
interface ScrollAnchor {
  rowKey: string;
  offset: number;
  userSeq?: number;
  userOffset?: number;
  historyOffset?: number;
}
const scrollMemo = new Map<string, ScrollAnchor & { pinned: boolean }>();

export function ChatView({
  meta,
  epoch = 0,
  variant = "full",
  hotkeysActive = true,
  nativeDropEnabled = true,
  headerSlot = null,
  onDeleted,
  onPatched,
  onActionError,
  focusRequest = 0,
  onFocusRequestHandled,
}: {
  meta: SessionMeta;
  epoch?: number;
  /** pane = 分屏格内形态:细头由 SplitView 提供,故不渲染 52px 视图头
   *  (标题/文件/⋯ 菜单随之隐去,管理动作回普通视图做)、不渲染提问大纲
   *  (贴边点列在窄格里挤占行宽);列宽换 chat-measure-pane(无 48rem
   *  地板,见 app.css)。数据面与交互(composer/审批/任务面板)全保留。 */
  variant?: "full" | "pane";
  /** 审批快捷键开关:分屏多格并存时只有焦点格为 true(shortcuts.ts 头注)。 */
  hotkeysActive?: boolean;
  /** Linux 原生拖放是 window 级事件；分屏时仅焦点格接收。 */
  nativeDropEnabled?: boolean;
  /** 格头「视图动作」插槽:侧边栏开合钮 createPortal 进去(云端同构;格头
   *  唯一框架不写任务类型分支)。右侧侧边栏(文件/变更/预览)在格内同样
   *  是主区的 flex 兄弟列(2026-08-30 mockup 定案)。 */
  headerSlot?: HTMLElement | null;
  focusRequest?: number;
  onFocusRequestHandled?: (request: number) => void;
  /** ⋯ 菜单二段确认后的删除动作:通知 App 走与侧栏同一套删除流程 */
  onDeleted?: () => void;
  /** 改名/归档落盘后通知 App 重拉列表:壳侧 session_patch 不广播
   * session-event,不主动拉就没有任何信号回流(2026-08-06 用户报障
   * 「改了不生效」的根因;侧栏右键改名一直是 patch().then(refresh),
   * 头部这条链路对齐同一条路) */
  onPatched?: () => void;
  /** 头部改名/归档落盘失败时外显(走 App 的角落提示栈,与侧栏右键菜单
   *  同一条通道)。此前两处都是 `.catch(() => {})`:壳拒了也一声不吭,
   *  用户看到的是"改了个名字,过一会儿又变回去了"。 */
  onActionError?: (key: "notice.renameFailed" | "notice.archiveFailed", reason: string) => void;
}) {
  const { t } = useI18n();
  const { openSettings } = useSettingsNavigation();
  const pane = variant === "pane";
  const { state, conn, historyLoaded, openError, hasMore, loadingEarlier, earlierError, loadEarlier, ensureLoaded } =
    useSessionFeed(meta.id, epoch);
  useApprovalHotkeys(state, meta.id, undefined, hotkeysActive);
  const detectedPreviewUrl = useMemo(() => newestAgentPreviewUrl(state.items), [state.items]);
  const currentTurnPreviewUrl = useMemo(() => currentTurnAgentPreviewUrl(state.items), [state.items]);
  const currentTurnText = useMemo(() => {
    let user = "";
    const agents: string[] = [];
    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i]!;
      if (item.kind === "user") {
        user = item.text;
        break;
      }
      if (item.kind === "agent") agents.unshift(item.text);
    }
    return { user, agent: agents.join("\n") };
  }, [state.items]);
  const [preview, setPreview] = useState<{ sessionId: string; target: DesignPreviewTarget } | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const previewTarget = preview?.sessionId === meta.id ? preview.target : null;
  // 右侧侧边栏(2026-08-30 用户 mockup 定案):文件/变更/终端/预览扁平 tab
  // 统一收进来,header 只留一颗开合钮(云端 CloudTaskView 同构,tab 集不同)。
  const [sideOpen, setSideOpen] = useState(false);
  const [sideTab, setSideTab] = useState<"files" | "changes" | "terminal" | "preview">("files");
  // 非 git 工作区没有「变更」tab;FilesPanel 探测后经 onRepoInfo 收敛
  const [isGitRepo, setIsGitRepo] = useState(true);
  // 终端懒挂(首次进 tab 才挂面板;shell 不自动起,由用户在面板里显式
  // 新建——2026-08-30 用户定案);实例真身住 termStore(模块级),收起
  // 侧边栏/切会话只是视图离场,shell 与回滚缓冲原地活着,销毁只在用户关
  // 实例页签/删会话/退出应用
  const [termMounted, setTermMounted] = useState(false);
  /** 打开设计预览的唯一入口:落 target + 拉开侧边栏并切到「预览」tab。 */
  const openPreview = useCallback((sessionId: string, target: DesignPreviewTarget) => {
    setPreview({ sessionId, target });
    setSideOpen(true);
    setSideTab("preview");
  }, []);
  // composer 自己持有草稿/附件/上传状态；父层只留一个稳定命令端口给拖拽与
  // Markdown 错误和设计预览反馈。打字从此不会再重渲 ChatView 和时间线。
  const composerRef = useRef<LocalComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<LogListHandle>(null);
  const outlineOffsetsRef = useRef(new Map<number, number>());
  const pinnedRef = useRef(true); // 用户是否停留在底部(自动跟随滚动)
  const lastScrollTop = useRef(0); // 上一次 scroll 事件的位置(判滚动方向)
  // 待恢复的锚点;回放期间每批都重新对齐(上方内容变高也不漂),用户主动滚动后交还控制权
  const restoreRef = useRef<ScrollAnchor | null>(null);
  const restoreTimer = useRef(0);
  const restoreTicks = useRef(0);
  const restoreWaitTicks = useRef(0);
  const restoreLoadRef = useRef<string | null>(null);
  const restoreRO = useRef<ResizeObserver | null>(null);
  const saveTimer = useRef(0);

  const rowNode = (rowKey: string): HTMLElement | null => {
    const root = scrollRef.current;
    if (!root) return null;
    for (const node of root.querySelectorAll<HTMLElement>("[data-virtual-row]")) {
      if (node.dataset.rowKey === rowKey) return node;
    }
    return null;
  };

  // 程序写 scrollTop 的唯一出口:值真的变了才打标记(没变不发 scroll 事件,
  // 白记一笔会把之后的用户滚动误判成程序滚)。onScroll 靠标记区分来源
  const setScrollTop = useCallback((el: HTMLElement, v: number) => {
    const before = el.scrollTop;
    el.scrollTop = v;
    if (el.scrollTop !== before) markProgrammaticScroll(el);
  }, []);

  // 自动滚动:优先对齐待恢复锚点,否则贴底跟随。锚点条目还没回放出来时
  // 先不动(停在已回放内容的开头),出来后逐批对齐
  const align = (): boolean => {
    const el = scrollRef.current;
    if (!el) return false;
    const a = restoreRef.current;
    if (a) {
      // 跨任务重开优先认稳定 user seq。目标历史尚未补回时绝不能把旧
      // rowKey 映射到本次尾窗的“最近数字键”:那会把错误位置当恢复成功,
      // 正是长任务切回后只剩顶部 spacer/「加载更早」的来源。
      if (a.userSeq !== undefined && a.userOffset !== undefined) {
        if (!listRef.current?.ensureUserSeq(a.userSeq)) return false;
        const bubble = el.querySelector<HTMLElement>(`[data-user-seq="${a.userSeq}"]`);
        const row = bubble?.closest<HTMLElement>("[data-virtual-row]");
        if (!row) return false; // ensureUserSeq 已切窗口,下一次 layout/轮询再对齐
        const delta = row.getBoundingClientRect().top - el.getBoundingClientRect().top + a.userOffset;
        setScrollTop(el, el.scrollTop + delta);
        return true;
      }
      listRef.current?.ensureKey(a.rowKey);
      const visibleKey = listRef.current?.resolveKey(a.rowKey) ?? a.rowKey;
      const node = rowNode(visibleKey);
      if (node) {
        const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top + a.offset;
        setScrollTop(el, el.scrollTop + delta);
        return true;
      }
    } else if (pinnedRef.current) {
      setScrollTop(el, el.scrollHeight);
      return true;
    }
    return false;
  };

  // 恢复完成/用户接管:轮询与 RO 兜底一并解除,交还滚动控制权
  const finishRestore = useCallback(() => {
    restoreRef.current = null;
    window.clearInterval(restoreTimer.current);
    restoreTimer.current = 0;
    restoreRO.current?.disconnect();
    restoreRO.current = null;
  }, []);

  // 锚点恢复:立即对齐 + 200ms 轮询校准若干次——内容分批物化、渲染后布局
  // 还会无事件地微调(实测 ~6px,RO 也抓不到这种再分配),对齐到位后只是
  // 零修正的空转;另挂 ResizeObserver 监听内容列兜底(图片解码/字体加载
  // 会把位置顶漂几 px,不经过 items 变化)。恢复结束二者一并解除。
  const startRestore = (anchor: ScrollAnchor) => {
    finishRestore();
    restoreRef.current = anchor;
    if (anchor.userSeq !== undefined) listRef.current?.ensureUserSeq(anchor.userSeq);
    else listRef.current?.ensureKey(anchor.rowKey);
    const ready = align();
    restoreTicks.current = 0;
    restoreWaitTicks.current = 0;
    restoreTimer.current = window.setInterval(() => {
      if (!restoreRef.current) {
        finishRestore();
        return;
      }
      if (align()) {
        restoreWaitTicks.current = 0;
        if (++restoreTicks.current > RESTORE_POLLS) finishRestore();
        return;
      }
      // session_open 的长窗口与大纲补页都走 transition,Promise 返回不等于
      // DOM 已提交。只在真正命中锚点后才开始 3s 校准预算；等待阶段另给
      // 30s 上限。到上限后宁可回到最新消息,也不能永久停在虚拟顶 spacer。
      restoreTicks.current = 0;
      if (++restoreWaitTicks.current > RESTORE_WAIT_POLLS) {
        finishRestore();
        pinnedRef.current = true;
        align();
      }
    }, 200);
    if (ready) restoreTicks.current = 1;
    const col = scrollRef.current?.querySelector<HTMLElement>("[data-chat-items]");
    if (col && typeof ResizeObserver !== "undefined") {
      restoreRO.current = new ResizeObserver(align);
      restoreRO.current.observe(col);
    }
  };

  // 写档当前位置。恢复进行中的程序滚动不写记忆:中途切走时锚点不能被
  // 半成品覆盖;已脱离文档(卸载竞态)也不写,免得好档被零几何冲掉
  const saveAnchor = () => {
    const el = scrollRef.current;
    if (!el || !el.isConnected || restoreRef.current) return;
    const viewportTop = el.getBoundingClientRect().top;
    let anchor: HTMLElement | null = null;
    for (const row of el.querySelectorAll<HTMLElement>("[data-virtual-row]")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > viewportTop) {
        anchor = row;
        break;
      }
    }
    const rowKey = anchor?.dataset.rowKey;
    if (!anchor || !rowKey) return;
    const offset = viewportTop - anchor.getBoundingClientRect().top;
    // rowKey 跨 session_open 会漂；若当前阅读位置能归属到一条带 seq 的用户
    // 消息,同时记住那条稳定锚及其到视口顶的距离。大纲 offset 让切回时无需
    // 人再点一次「加载更早」就能补到对应轮次。
    const activeUser = listRef.current?.activeUser();
    const userSeq = activeUser?.seq;
    const userBubble = userSeq === undefined
      ? null
      : el.querySelector<HTMLElement>(`[data-user-seq="${userSeq}"]`);
    const userRow = userBubble?.closest<HTMLElement>("[data-virtual-row]");
    const prior = scrollMemo.get(meta.id);
    const stable = userSeq !== undefined && userRow
      ? {
          userSeq,
          userOffset: viewportTop - userRow.getBoundingClientRect().top,
          ...(outlineOffsetsRef.current.get(userSeq) !== undefined
            ? { historyOffset: outlineOffsetsRef.current.get(userSeq)! }
            : prior?.userSeq === userSeq && prior.historyOffset !== undefined
              ? { historyOffset: prior.historyOffset }
              : {}),
        }
      : {};
    // pinned 按几何兜底:人在底部就是贴底,写档不依赖旗标推断——旗标的
    // 置位要看事件方向与程序滚动判定,快滚到底的最后一发事件被判成程序
    // 滚动时旗标会漏置,切回来就不去底部了(2026-08-11 报障「滚到底再
    // 切回来落在中间」)
    const pinned = pinnedRef.current || el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    scrollMemo.set(meta.id, { rowKey, offset, pinned, ...stable });
  };

  // 大纲跳转/闪光的句柄先于会话边沿 effect 声明(下方 cleanup 要清它们,
  // 声明在后会构成「使用先于声明」);逻辑本体在下方「大纲跳转」段
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const flashTimer = useRef(0);
  const jumpTimer = useRef(0);
  const metaIdRef = useRef(meta.id);

  // 会话切换/挂载:复位跟随状态并取出记忆位置(不显式复位的话 pinnedRef
  // 会带着上一会话的值进入新会话);cleanup 时 DOM 仍在,写档旧会话位置,
  // 并把旧会话的轮询定时器/RO 清干净
  useLayoutEffect(() => {
    metaIdRef.current = meta.id; // 跳转链的会话身份基准(见 jumpWithRetry)
    restoreLoadRef.current = null;
    const saved = scrollMemo.get(meta.id);
    pinnedRef.current = saved ? saved.pinned : true; // 首次打开默认贴底
    if (saved && !saved.pinned) startRestore(saved);
    else {
      restoreRef.current = null;
      align();
    }
    // 方向判定基线跟着新会话走,免得首个 scroll 事件拿旧会话位置比出假「上滚」
    lastScrollTop.current = scrollRef.current?.scrollTop ?? 0;
    return () => {
      saveAnchor();
      finishRestore();
      window.clearTimeout(saveTimer.current);
      // 在途的节流写档一并取消:rAF 在切换提交后才触发,那时读的是新会话的
      // DOM,闭包里的 meta.id 却还是旧会话——不取消就把上面刚写好的档冲掉
      window.cancelAnimationFrame(saveRaf.current);
      saveRaf.current = 0;
      // 大纲跳转的重试链/闪光同属旧会话:seq 是各会话独立的帧序号,跨会话
      // 必然撞号,残留的轮询会在新会话 DOM 里查到同号 [data-user-seq],把
      // 新会话的视口拽到无关消息上并打断它的锚点恢复(卸载专用 effect 只
      // 管卸载,切会话是同一实例复用,必须在这里清)
      window.clearTimeout(jumpTimer.current);
      window.clearTimeout(flashTimer.current);
      setFlashSeq(null);
    };
    // 本 effect 是 session 边沿；这些函数只读 refs，随普通帧重跑会误写档。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  // 空态 = items 空且非 running(渲染分支与下方 RO 的重挂条件共用一个判定)
  const empty = state.items.length === 0 && !state.running;

  const openInteractionId = useMemo(() => {
    for (let i = state.items.length - 1; i >= 0; i--) {
      const item = state.items[i]!;
      if (item.kind === "design-template-selection" && item.state === "open") return `${meta.id}:design:${item.requestId}`;
      if (item.kind === "ask" && item.state === "open") return `${meta.id}:ask:${item.askId}`;
      if (item.kind === "perm" && item.state === "open") return `${meta.id}:perm:${item.id}`;
    }
    return "";
  }, [meta.id, state.items]);
  const revealedInteractionRef = useRef("");
  useLayoutEffect(() => {
    revealedInteractionRef.current = "";
  }, [meta.id]);
  // 阻塞式交互必须打断旧滚动锚点，否则 Agent 会等待视口外的卡片。
  useLayoutEffect(() => {
    if (!openInteractionId) {
      revealedInteractionRef.current = "";
      return;
    }
    if (revealedInteractionRef.current === openInteractionId) return;
    revealedInteractionRef.current = openInteractionId;
    finishRestore();
    pinnedRef.current = true;
    align();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openInteractionId]);

  // items 变化后赶在绘制前对齐(锚点恢复或贴底跟随)。
  // state.plan 也在依赖里:任务面板钉在 composer 上方(footer 内),plan 帧
  // 一到面板就撑高 footer,把 flex-1 的日志视口压矮同样多——内容没变、
  // scrollTop 不动,于是正好停在离底「一个面板高」的地方(用户报障
  // 2026-08-06:进本地会话不贴底)。这一档必须在绘制前修,交给下面的 RO
  // 会晚一帧,肉眼是一次跳动
  useLayoutEffect(() => {
    align();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items, state.running, state.plan]);

  // 尺寸兜底:贴底跟随原先**只**在 items/running 变化时对齐,可高度变化的
  // 来源远不止 items——两头都得盯住,漏一头就停在离底几十像素的地方:
  // - 视口(el):footer 长高(任务面板/运行条/附件 chips/textarea 自适应)、
  //   顶部连接横幅、窗口缩放都会压矮它;
  // - 内容轨(el.firstElementChild):图片解码、字体加载、以及 ToolCard 挂载后
  //   异步取回的完整工具正文(loadFullTool)都会把内容顶高——**不经过 items
  //   变化,也不改变视口尺寸**,只盯视口的话这一类一个都抓不到(用户报障
  //   2026-08-06:进本地会话不贴底,且 composer 上方并无任务面板)。
  // 恢复路径早就为同一原因给内容轨挂了 RO(见 startRestore),贴底路径此前
  // 是空的。align 内部自带优先级:恢复中以锚点优先,否则贴底;未贴底则什么
  // 都不做。scrollTop 不改变元素尺寸,不会与 RO 自激。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(align);
    ro.observe(el);
    const track = el.firstElementChild;
    if (track) ro.observe(track);
    return () => ro.disconnect();
    // empty 翻面时滚动容器整棵换掉,要重新 observe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  // 写档走 rAF 节流(scheduleActive 同款):现在只扫至多 160 个已挂载虚拟行，
  // 但 scroll 事件一帧仍会来多发；每帧至多保存一次即可。
  const saveRaf = useRef(0);
  const scheduleSave = () => {
    if (saveRaf.current) return;
    saveRaf.current = window.requestAnimationFrame(() => {
      saveRaf.current = 0;
      saveAnchor();
    });
  };

  // scroll 事件按来源判定贴底跟随(2026-08-11 报障「上滚到 user-input 突然
  // 回滚」的根因修复):此前只做「进入贴底 → 跟随」的单向判定,离底只认
  // wheel/右缘 mousedown——拖滚动条/PageUp 这类输入完全不解除跟随,而
  // WebKit 拖动初期的插值滚动还会擦着底部区把 pinned 又置回 true;此时行高
  // 测量触发内容轨 RO → align 一把吸回底部,吸底事件再次自我钉住,
  // 用户被困在底部(WebKit 复现:snaps=2,scrollTop 全程出不去)。
  // 现在凡代码写 scrollTop 都打标记(setScrollTop/虚拟行锚点补偿),这里逐事件
  // 消费:未标记的向上滚动 = 用户意图,解除跟随并终止锚点恢复,任何输入
  // 方式都覆盖;向上事件即使擦着底部区也不重新钉住。原先担心的「回放中
  // 内容长高误判离底」不复存在——纯内容增高不发 scroll 事件,程序贴底又
  // 都带标记
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prog = consumeProgrammaticScroll(el);
    const dy = el.scrollTop - lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (!prog && dy < -1 && el.scrollHeight - el.scrollTop - el.clientHeight > 2) {
      // 真离底才解除跟随。距底 >2px 这一条不可省:内容收缩引发的浏览器
      // clamp 也是「未标记的向上事件」,但它的落点永远**正好在新的最底部**
      // ——切回会话的回放/测量期,估高被真实行高替换、scrollHeight 一缩
      // 就是一发 clamp;当用户离底处理会把贴底跟随掐死在回放半路,最终
      // 停在中间(2026-08-11 报障)。人还在底部就不算离开。
      // 这里也不取消锚点恢复:恢复期同样有 clamp,真实用户接管由 wheel /
      // 右缘 mousedown 显式终止(finishRestore)
      pinnedRef.current = false;
    } else if (!restoreRef.current && dy > 1 && el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD) {
      // 向下滚进底部区恢复跟随。方向门槛(dy>1)不可省:拖动初期 WebKit 的
      // 插值事件会擦着底部区,无方向判定会把刚解除的跟随又钉回去(吸底
      // 陷阱)。不要求「非程序滚动」:程序性下滚落到底部区(align 贴底、
      // 跳转到末轮)时恢复跟随本就是正确语义,而落点误判会让真实用户滚到
      // 底后旗标漏置一拍
      pinnedRef.current = true;
    }
    scheduleSave();
    scheduleActive();
    // 滚近顶部(一屏内)自动补一页更早历史(2026-08-12 需求;此前只有顶部
    // 手动按钮,按钮保留兜底)。loadEarlier 自带 busyRef 防重入;前插按元素
    // 锚定保位后 scrollTop 被推离阈值,天然不连环,一页不足一屏才串行续页。
    // 恢复期禁止:切会话恢复的锚点是**条目下标**,此刻前插会让下标整体
    // 错位,恢复就对到错的条目上。
    // 贴底跟随中也禁止:内容不足两屏时贴底位置本身就距顶不足一屏,进会话
    // 的首次 align 贴底就满足触发条件——而 onLoadEarlier 第一行会清掉
    // pinnedRef(那是手动按钮"去看历史"的语义),流式新内容从此不再跟随。
    // 贴底的人没有在看历史,自动补页对它无意义
    if (
      hasMore &&
      !loadingEarlier &&
      !restoreRef.current &&
      !pinnedRef.current &&
      el.scrollTop < el.clientHeight
    ) {
      void onLoadEarlier();
    }
    // 滚动停止后布局仍会微调一次(不发 scroll 事件),停稳后补一次写档
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveAnchor, 600);
  };

  // 用户主动介入即终止锚点恢复,交还滚动控制权;向上意图同时解除贴底跟随
  const onLogWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    finishRestore();
    if (e.deltaY < 0) pinnedRef.current = false; // 向上滚 = 离开底部去看历史
  };
  const onLogMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    finishRestore();
    // 按在右缘滚动条带上 = 准备拖动定位,解除跟随(拖回底部经 scroll 事件重新贴上)
    const el = scrollRef.current;
    if (el && e.clientX > el.getBoundingClientRect().right - SCROLLBAR_EDGE) pinnedRef.current = false;
  };

  // 「加载更早」的位置保持:前插会把所有条目往下推,记像素没用,记**元素**
  // ——keyBase 稳定 key 保证 React 不会把既有条目换成新节点,前插提交后按
  // 同一元素重新对齐,视口纹丝不动
  const prependAnchor = useRef<{ rowKey: string; offset: number } | null>(null);
  const onLoadEarlier = async () => {
    pinnedRef.current = false;
    // 锚点必须由 loadEarlier 在前插**写入前**同步回调,不能"先记再 await":
    // 消费锚点的 layoutEffect 依赖 state.items,而流式期间每 ~30ms 就有一批
    // 新帧——先记的话锚点会被前插之前的某次提交吃掉,startRestore 按错的
    // 元素把视口拽住整整 3 秒(RESTORE_POLLS 轮询期)。旧 UI chat.tsx:640-665
    // 的 beforeApply 正是为此存在
    await loadEarlier(() => {
      const el = scrollRef.current;
      if (!el) return;
      const elTop = el.getBoundingClientRect().top;
      for (const kid of el.querySelectorAll<HTMLElement>("[data-virtual-row]")) {
        const r = kid.getBoundingClientRect();
        if (r.bottom > elTop) {
          const rowKey = kid.dataset.rowKey;
          if (rowKey) prependAnchor.current = { rowKey, offset: elTop - r.top };
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
    startRestore(pa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.items]);

  // 发送被接受(发出或排队)即回到贴底跟随:这次发送本身就是回到当前轮次
  // 的明确意图,立即结束锚点恢复并重新贴底
  const followBottom = useCallback(() => {
    finishRestore();
    pinnedRef.current = true;
    const el = scrollRef.current;
    if (el) setScrollTop(el, el.scrollHeight);
  }, [finishRestore, setScrollTop]);

  // markdown 工作区文件链接:判界(工作区外拒绝)→ repo_reveal 文件管理器
  // 定位;失败走 composer 提示条(§3:会话内操作失败的法定位置)。
  // useCallback + 下面两个回读通道同理:LogList 的每一行都按这些函数引用
  // 做 memo，比对稳定才能让流式更新只落到真正变化的尾行。
  // meta 经 ref 读:这三个回调是**每一行** memo 的 props,依赖数组里挂
  // meta.id 就等于身份跟着切会话换——新 meta 首渲染那一拍,旧会话的整列
  // 行 memo 全体失效,先把马上要卸载的旧列表白重渲染一遍(长会话几百 ms,
  // 2026-08-10 切会话 3.8s 冻结的组成部分),然后才轮到清空与新窗口挂载。
  // 回调只在用户交互时被调用,届时 ref 里已是当前会话,语义不变
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const revealMarkdownLink = useCallback(
    (path: string) => {
      const rel = workspaceRelativePath(path, metaRef.current.workdir);
      if (rel === null) {
        composerRef.current?.notifyError(t("chat.revealOutside"));
        return;
      }
      void repoReveal(metaRef.current.id, rel).catch((e: unknown) => {
        composerRef.current?.notifyError(t("chat.revealFailed", { reason: e instanceof Error ? e.message : String(e) }));
      });
    },
    [t],
  );
  const openPreviewMarkdownLink = useCallback((raw: string): boolean => {
    const url = normalizePreviewUrl(raw);
    if (!url) return false;
    openPreview(metaRef.current.id, { kind: "localhost", url });
    return true;
  }, [openPreview]);
  // 设计流程不输出 localhost URL，而是把 HTML 写进工作区：手动打开预览时
  // 退化为扫描工作区内可预览 HTML，取排序后第一个。
  const openArtifactPreview = useCallback(async () => {
    const sessionId = metaRef.current.id;
    const result = await repoPreviewFiles(sessionId);
    if (metaRef.current.id !== sessionId) return;
    const html = rankPreviewFiles(result.files).find((file) => file.kind === "html");
    if (html) openPreview(sessionId, targetForFile(html));
  }, [openPreview]);
  const uploadUrl = useCallback((p: string, expectedDigest?: string) => uploadFileURL(metaRef.current.id, p, expectedDigest), []);
  const loadDesignPreview = useCallback((p: string) => designTemplatePreviewRead(metaRef.current.id, p), []);
  const loadFullTool = useCallback((seq: number) => sessionFrame(metaRef.current.id, seq), []);

  // ==== 标题重命名(D4):h1 双击进输入态。提交只发 sessionPatch,不乐观
  // 改 meta——壳广播 session-event,App 的列表 patch 回写 title 后新 meta
  // 自然流回来。Enter 提交(IME 选字回车除外)/Esc 放弃/失焦提交。 ====
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleIme = useRef(createImeGuard());
  // 提交/放弃后置位:Enter 提交会卸载输入框,随之而来的 blur 不能再提交一次
  const renameDoneRef = useRef(false);
  const startRename = () => {
    setTitleDraft(meta.title);
    renameDoneRef.current = false;
    setEditingTitle(true);
  };
  const commitRename = () => {
    if (renameDoneRef.current) return;
    renameDoneRef.current = true;
    setEditingTitle(false);
    const next = titleDraft.trim();
    // 空转判定收口在 lib/util/rename(空提交=撤销自定义;旧版缺
    // title_custom 时原文确认也要发 patch 补标记,侧栏右键同一口径)。
    // 落盘后必须主动重拉:壳侧 session_patch 不广播 session-event,
    // 不拉就没有任何信号回流(标题看着「改了没反应」)
    if (!renameIsNoop(next, meta))
      void sessionPatch(meta.id, { title: next })
        .catch((e: unknown) => onActionError?.("notice.renameFailed", e instanceof Error ? e.message : String(e)))
        .then(() => onPatched?.());
  };
  const cancelRename = () => {
    renameDoneRef.current = true;
    setEditingTitle(false);
  };
  useEffect(() => {
    // 切会话丢弃编辑态(草稿属于上一个会话)
    setEditingTitle(false);
  }, [meta.id]);

  // ==== 头部 ⋯ 菜单(重命名/归档/删除):受控 dropdown,外点/Esc 即收
  // (pointerdown 判定,不吃 WebKitGTK 按钮不获焦的亏;Esc window capture
  // 截断,不落进全局审批链——手法与 Composer 两个 picker 一致,见
  // lib/util/useDismiss)。删除走二段确认(首点变「确认删除?」,再点才经
  // onDeleted 通知 App)。 ====
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuBoxRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmDelete(false);
  };
  useDismiss(menuOpen, menuBoxRef, closeMenu);
  useEffect(() => {
    // 切会话收起菜单(确认态属于上一个会话)
    closeMenu();
  }, [meta.id]);

  // ==== 子代理会话回放浮层(D2):工具卡「查看子会话」入口打开,只读 ====
  const [childId, setChildId] = useState<string | null>(null);
  useEffect(() => {
    setChildId(null); // 切会话关掉上一个会话的子回放
  }, [meta.id]);

  // ==== 后台子代理停止入口(background_stop → subagent/cancel 直通) ====
  // 能力门控:无 subagentControl 时入口整体隐藏(契约 2,不按版本猜)。
  // 挂载拉一次即可——引擎自愈会经 epoch 整格重建本组件,快照随之刷新
  const [canStopBg, setCanStopBg] = useState(false);
  useEffect(() => {
    let alive = true;
    void engineCaps().then((caps) => {
      if (alive && caps) setCanStopBg(caps.subagent_control);
    });
    return () => {
      alive = false;
    };
  }, []);
  // 停止是「已受理」瞬态:成功后行保持「停止中」,真正收卡等
  // task_notification 终态(卡关了行自然消失,集合残留无害);失败回弹
  // 并外显原因,可重试。切会话即作废。
  const [bgStopping, setBgStopping] = useState<ReadonlySet<string>>(new Set());
  const [bgStopError, setBgStopError] = useState<string | null>(null);
  useEffect(() => {
    setBgStopping(new Set());
    setBgStopError(null);
  }, [meta.id]);
  const onStopBackground = useCallback(
    (agentId: string) => {
      setBgStopError(null);
      setBgStopping((prev) => new Set(prev).add(agentId));
      void sessionBackgroundStop(metaRef.current.id, agentId).catch((e: unknown) => {
        setBgStopping((prev) => {
          const next = new Set(prev);
          next.delete(agentId);
          return next;
        });
        setBgStopError(
          t("chat.bg.stopFailed", { reason: e instanceof Error ? e.message : String(e) }),
        );
      });
    },
    [t],
  );

  // ==== 空闲态后台状态条取材:全部 run+background 派发卡(时间序) ====
  // 摘要优先 SendMessage 的 summary / Agent 的 description(rawInput),
  // 退回工具标题;入口复用子会话回放浮层。running 时状态条不渲染,跳过
  // 扫描;对象引用经签名 useMemo 钉在字段值上,不然每个帧批次都会击穿
  // Composer 的 memo。
  const bgCards = useMemo(() => {
    if (state.running) return [];
    // 断连门控:引擎不在了,"运行中"就是谎言(重启后的孤儿卡另有对账
    // 路径补终态);conn 为 null 是"还不知道",按乐观显示
    if (conn && !conn.connected) return [];
    const out: {
      key: string;
      title: string;
      startedAt?: number;
      childId?: string;
      agentId?: string;
      stopping?: boolean;
    }[] = [];
    for (const it of state.items) {
      if (it.kind === "tool" && it.status === "run" && it.background) {
        const input = (it.rawInput ?? {}) as { summary?: unknown; description?: unknown };
        const title =
          (typeof input.summary === "string" && input.summary) ||
          (typeof input.description === "string" && input.description) ||
          it.title;
        out.push({
          key: it.tcId,
          title,
          ...(it.startedAt !== undefined ? { startedAt: it.startedAt } : {}),
          ...(it.childSessionId ? { childId: it.childSessionId } : {}),
          ...(it.backgroundAgentId ? { agentId: it.backgroundAgentId } : {}),
          ...(it.backgroundAgentId && bgStopping.has(it.backgroundAgentId)
            ? { stopping: true }
            : {}),
        });
      }
    }
    return out;
  }, [state, conn, bgStopping]);
  const onOpenBackground = useCallback((childId: string) => setChildId(childId), []);
  const bgSignature = bgCards
    .map(
      (c) =>
        `${c.key}|${c.title}|${c.childId ?? ""}|${c.startedAt ?? 0}|${c.agentId ?? ""}|${c.stopping ? 1 : 0}`,
    )
    .join("\n");
  const backgroundInfo = useMemo(
    () =>
      bgCards.length === 0
        ? undefined
        : {
            tasks: bgCards,
            onOpen: onOpenBackground,
            ...(canStopBg ? { onStop: onStopBackground } : {}),
            ...(bgStopError !== null ? { stopError: bgStopError } : {}),
          },
    // bgSignature 覆盖 bgCards 的全部字段值:签名不变则内容必然逐字段相同,
    // 用它换引用稳定,避免逐批次新数组击穿 memo
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bgSignature, onOpenBackground, canStopBg, onStopBackground, bgStopError],
  );

  // pane 连接条的展开态(收/展是会话内瞬态;切会话回到收起)
  const [stripOpen, setStripOpen] = useState(false);
  useEffect(() => {
    setStripOpen(false);
  }, [meta.id]);

  // ==== 提问大纲:打开拉一次,轮结束(running 真→假)再拉(轮末才物化) ====
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  useEffect(() => {
    let alive = true;
    setOutline([]);
    outlineOffsetsRef.current = new Map();
    void sessionOutline(meta.id).then((items) => {
      if (alive) {
        outlineOffsetsRef.current = new Map(items.map((item) => [item.seq, item.offset]));
        setOutline(items);
      }
    });
    return () => {
      alive = false;
    };
  }, [meta.id]);
  const prevRunning = useRef(false);
  useEffect(() => {
    const was = prevRunning.current;
    prevRunning.current = state.running;
    if (!was || state.running) return;
    let alive = true;
    void sessionOutline(meta.id).then((items) => {
      if (alive) {
        outlineOffsetsRef.current = new Map(items.map((item) => [item.seq, item.offset]));
        setOutline(items);
      }
    });
    return () => {
      alive = false;
    };
  }, [state.running, meta.id]);
  const entries = useOutlineEntries(outline, state);

  // 切回一个停在早期历史的任务时,session_open 只给尾部窗口。等尾窗落地后
  // 用记忆里的稳定 user seq 找大纲 offset 并自动补页；补页提交后上方的
  // state.items layoutEffect + startRestore 轮询会把该 user 行挂载并对齐。
  // 同一锚只发起一次,会话切换由 metaIdRef/restoreLoadRef 双重作废旧续程。
  useEffect(() => {
    if (!historyLoaded) return;
    const anchor = restoreRef.current;
    if (!anchor || anchor.userSeq === undefined || anchor.userOffset === undefined) return;
    if (listRef.current?.ensureUserSeq(anchor.userSeq)) {
      align();
      return;
    }
    const historyOffset = anchor.historyOffset ?? outlineOffsetsRef.current.get(anchor.userSeq);
    if (historyOffset === undefined) return;
    anchor.historyOffset = historyOffset;
    const sid = meta.id;
    const token = `${sid}:${anchor.userSeq}:${historyOffset}`;
    if (restoreLoadRef.current === token) return;
    restoreLoadRef.current = token;
    void ensureLoaded(historyOffset).then(() => {
      if (metaIdRef.current === sid) align();
    });
    // align 只读 refs；outline 变化让尚未带 historyOffset 的旧记忆获得补页锚；
    // items 也必须入依赖:ensureLoaded 的 Promise 会早于 startTransition 的
    // DOM 提交结束；页真正挂载后靠 items 再查一次并完成精确对齐。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, meta.id, ensureLoaded, outline, state.items]);

  // ==== 当前项跟踪:视口顶所在的提问(rAF 节流——流式期间每批帧都重算
  // 会把点列刷成动画;判定纯函数在 lib/util/scrollAnchor,与跳转 INSET
  // 同一条线) ====
  const [activeSeq, setActiveSeq] = useState<number | null>(null);
  const activeRaf = useRef(0);
  const updateActive = () => {
    setActiveSeq(listRef.current?.activeUser()?.seq ?? null);
  };
  const scheduleActive = () => {
    if (activeRaf.current) return;
    activeRaf.current = window.requestAnimationFrame(() => {
      activeRaf.current = 0;
      updateActive();
    });
  };
   
  useEffect(scheduleActive, [state.items]);
  // 取消后必须把 id 清零:scheduleActive 以「非零 = 已排队」做节流,残留
  // 旧 id 会让它永远短路(StrictMode 双挂载即触发,当前项从此不再更新)
  useEffect(
    () => () => {
      window.cancelAnimationFrame(activeRaf.current);
      activeRaf.current = 0;
    },
    [],
  );

  // ==== 大纲跳转:offset 精确补页 + 目标气泡闪光 ====
  // (flashSeq/flashTimer/jumpTimer/metaIdRef 声明在会话边沿 effect 之前)
  useEffect(
    () => () => {
      window.clearTimeout(flashTimer.current);
      window.clearTimeout(jumpTimer.current);
    },
    [],
  );
  /** 定位到某次提问;锚还没渲染进 DOM 返回 false。 */
  const jumpToSeq = (seq: number): boolean => {
    const log = scrollRef.current;
    const node = log?.querySelector<HTMLElement>(`[data-user-seq="${seq}"]`);
    if (!log || !node) {
      listRef.current?.ensureUserSeq(seq);
      return false;
    }
    finishRestore(); // 跳转接管滚动:进行中的锚点恢复轮询不许再拽回去
    pinnedRef.current = false;
    // 明确只滚消息日志。scrollIntoView 会自行挑选可滚祖先，消息区新增
    // wrapper 后可能滚到 wrapper，后续点击便不再改变真正日志的 scrollTop。
    const top = log.scrollTop + node.getBoundingClientRect().top - log.getBoundingClientRect().top;
    setScrollTop(log, top);
    setFlashSeq(seq);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashSeq(null), FLASH_MS);
    return true;
  };
  // 补页后的锚要等 React 提交才进 DOM,短时重试兜时序(旧 chat.tsx
  // jumpWithRetry 随迁);重试耗尽 = 坏 seq/历史被清,放弃不空转。
  // 预算 ~3s:跳转补页的前插走 startTransition(useSessionFeed),大页
  // (50 轮)的时间切片提交可达一两秒——老预算 12×32ms 会在提交完成前
  // 放弃,表现成「点大纲没反应」。轮询本身是零成本空查。
  // 整条链锁定发起时的会话:切会话时定时器会被清(meta.id cleanup),但
  // ensureLoaded 的 promise 延续仍会重新挂链——sid 不再匹配即作废,不许
  // 旧会话的跳转落到新会话的同号 seq 上
  const jumpWithRetry = (seq: number, sid: string, tries = 90) => {
    if (metaIdRef.current !== sid) return;
    if (jumpToSeq(seq) || tries <= 0) return;
    jumpTimer.current = window.setTimeout(() => jumpWithRetry(seq, sid, tries - 1), 32);
  };
  // onJump 必须引用稳定:OutlineNav 是 memo 的，大纲上千条时流式批次不能
  // 因回调身份变化把整个面板重建——实现走 ref 取最新,外壳 useCallback 恒定
  const onJumpImpl = (seq: number, offset?: number) => {
    if (jumpToSeq(seq)) return;
    const sid = meta.id;
    // 更早的提问还没加载:按它那一轮的 offset 精确补页再定位(session_history
    // 以 offset 为终点);流内新条目无 offset(按理已在 DOM),只走重试兜底
    if (offset !== undefined) void ensureLoaded(offset).then(() => jumpWithRetry(seq, sid));
    else jumpWithRetry(seq, sid);
  };
  const onJumpRef = useRef(onJumpImpl);
  onJumpRef.current = onJumpImpl;
  const onJump = useCallback((seq: number, offset?: number) => onJumpRef.current(seq, offset), []);

  // ==== 拖拽附件:HTML5 事件(dragenter/leave 计数配对)+ Linux 壳原生事件 ====
  const [dragging, setDragging] = useState(false);
  const [changesToken, setChangesToken] = useState(0);
  const [changesCount, setChangesCount] = useState(0);
  const prevTurnEnded = useRef(false);
  const changesGeneration = useRef(0);
  const baselineRunning = useRef(false);
  const baselineSession = useRef<string | null>(null);
  const turnBaseline = useRef<{ sessionId: string; value: Promise<Awaited<ReturnType<typeof repoChanges>>> } | null>(null);
  useEffect(() => {
    const sessionChanged = baselineSession.current !== meta.id;
    if (sessionChanged) {
      baselineSession.current = meta.id;
      baselineRunning.current = false;
      prevTurnEnded.current = false;
      turnBaseline.current = null;
      changesGeneration.current += 1;
      // This render still carries useSessionFeed's previous-session state. Its
      // earlier effect resets that state before the new session replay lands.
      return;
    }
    const rising = state.running && !baselineRunning.current;
    baselineRunning.current = state.running;
    // repo_file_changes 是整棵工作区快照。只有设计意图轮需要在开轮时留
    // baseline；普通轮的改动徽标只在轮末查询一次，不能为自动预览白拉一份。
    if (rising && turnWarrantsArtifactPreview(currentTurnText.user, currentTurnText.agent, [])) {
      turnBaseline.current = { sessionId: meta.id, value: repoChanges(meta.id) };
    }
  }, [currentTurnText.agent, currentTurnText.user, meta.id, state.running]);
  useEffect(() => {
    const turnJustEnded = state.turnEnded && !prevTurnEnded.current;
    prevTurnEnded.current = state.turnEnded;
    if (!turnJustEnded) return;
    setChangesToken((n) => n + 1);
    const sessionId = meta.id;
    const generation = ++changesGeneration.current;
    if (currentTurnPreviewUrl) {
      openPreview(sessionId, { kind: "localhost", url: currentTurnPreviewUrl });
      setPreviewRefreshKey((key) => key + 1);
    }
    void repoChanges(sessionId).then(async (result) => {
      if (changesGeneration.current !== generation || metaRef.current.id !== sessionId) return;
      setChangesCount(result.changes.length);
      if (currentTurnPreviewUrl) return;
      const baseline = turnBaseline.current?.sessionId === sessionId
        ? await turnBaseline.current.value.catch(() => ({ changes: result.changes, isGitRepo: result.isGitRepo }))
        : { changes: result.changes, isGitRepo: result.isGitRepo };
      if (changesGeneration.current !== generation || metaRef.current.id !== sessionId) return;
      const lastUser = state.items.findLastIndex((item) => item.kind === "user");
      const tools = state.items.slice(lastUser + 1).filter((item) => item.kind === "tool");
      const touched = touchedTurnChanges(baseline.changes, result.changes, writtenToolPaths(tools), meta.workdir);
      let artifact = selectTurnPreviewArtifact(touched, currentTurnText.user, currentTurnText.agent);
      if (!artifact && hasDesignRelatedChanges(touched) && turnWarrantsArtifactPreview(currentTurnText.user, currentTurnText.agent, touched)) {
        const files = await repoPreviewFiles(sessionId);
        if (changesGeneration.current !== generation || metaRef.current.id !== sessionId) return;
        artifact = selectTurnPreviewArtifact(touched, currentTurnText.user, currentTurnText.agent, files.files);
      }
      if (artifact && changesGeneration.current === generation && metaRef.current.id === sessionId) {
        openPreview(sessionId, targetForFile(artifact));
        setPreviewRefreshKey((key) => key + 1);
      }
    }).catch(() => {
      if (changesGeneration.current === generation && metaRef.current.id === sessionId) setChangesCount(0);
    });
  }, [currentTurnPreviewUrl, currentTurnText, meta.id, openPreview, state.items, state.turnEnded]);
  // 改动数徽标与自动 artifact 选择共用上面的轮末查询，避免重复读取全工作区。
  useEffect(() => {
    changesGeneration.current += 1;
    prevTurnEnded.current = false;
    setChangesCount(0); // 徽标属于会话,切走清零
    // 侧边栏同属会话,切走一并收起(旧抽屉时代的口径随迁):ChatView 的 key
    // 只取 epoch,切会话走的是**同一实例**——面板内容(FilesPanel)虽按
    // meta.id 加 key 重挂,但开合态/当前 tab/git 判定都是上一个会话的,
    // 不复位就把旧会话的侧边栏姿势带进新会话。
    setSideOpen(false);
    setSideTab("files");
    setIsGitRepo(true);
    setTermMounted(false);
  }, [meta.id]);
  // FilesPanel 的改动探测回流:非 git 收走「变更」tab;计数与轮末徽标同源
  const onRepoInfo = useCallback((info: { isGitRepo: boolean; changesCount: number }) => {
    setIsGitRepo(info.isGitRepo);
    setChangesCount(info.changesCount);
  }, []);
  useEffect(() => {
    if (!isGitRepo && sideTab === "changes") setSideTab("files");
  }, [isGitRepo, sideTab]);
  /** header 开合钮(旧「会话文件」钮改造):打开时按旧抽屉口径选落点——
   *  有改动直达「变更」;上次停在无货的「预览」则回「文件」。 */
  const toggleSide = () => {
    if (!sideOpen) {
      if (changesCount > 0 && isGitRepo) setSideTab("changes");
      else if (sideTab === "preview" && !previewTarget) setSideTab("files");
    }
    setSideOpen((o) => !o);
  };
  /** 「预览」tab 空手激活时的取材链:先认 agent 输出的 localhost URL,
   *  再退化扫描工作区可预览 HTML(与旧 header 预览钮同一条链)。 */
  const selectSideTab = (id: string) => {
    if (id === "preview") {
      setSideTab("preview");
      if (!previewTarget) {
        if (detectedPreviewUrl) openPreview(meta.id, { kind: "localhost", url: detectedPreviewUrl });
        else void openArtifactPreview();
      }
      return;
    }
    if (id === "terminal") {
      setSideTab("terminal");
      setTermMounted(true); // 只挂面板;shell 等用户点「新建终端」
      return;
    }
    if (id === "files" || id === "changes") setSideTab(id);
  };
  const sideTabs: SidePanelTab[] = [
    { id: "files", label: t("side.tab.files"), icon: <IconFolder size={14} stroke={1.75} aria-hidden /> },
    ...(isGitRepo
      ? [{ id: "changes", label: t("side.tab.changes"), icon: <IconFileDiff size={14} stroke={1.75} aria-hidden />, badge: changesCount }]
      : []),
    { id: "terminal", label: t("side.tab.terminal"), icon: <IconTerminal2 size={14} stroke={1.75} aria-hidden /> },
    { id: "preview", label: t("side.tab.preview"), icon: <IconWorld size={14} stroke={1.75} aria-hidden /> },
  ];
  const dragDepth = useRef(0);
  const onDragEnter = (e: DragEvent<HTMLElement>) => {
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void composerRef.current?.addFiles(files);
  };
  // Linux 壳:WebKitGTK 的 HTML5 拖拽拿不到 File,走壳原生 tauri://drag-*
  // (mac/Windows 壳禁用原生处理器,监听永不触发)
  const nativeDropIsEnabled = useEffectEvent(() => nativeDropEnabled);
  useEffect(() => {
    if (!nativeDropEnabled) setDragging(false);
  }, [nativeDropEnabled]);
  useEffect(
    () =>
      onNativeFileDrop({
        enabled: nativeDropIsEnabled,
        onDragging: setDragging,
        onFiles: (files) => void composerRef.current?.addFiles(files),
        onError: (m) => composerRef.current?.notifyError(t("chat.uploadFailed", { reason: m })),
      }),
    // t 稳定(模块级函数);按会话重订阅即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meta.id],
  );

  // ==== 空态(旧 chat.tsx 同款信息设计:logo + 主句 + 副句):判定见上方
  // empty(滚动容器的 RO 要按它重挂,声明提前到 effect 之前);chat 会话
  // (无 workdir)与本地任务两版文案。本地版主句内嵌 mono workdir——模板
  // 留 {dir} 占位,渲染时拆开插 span。 ====
  const emptyChat = !meta.workdir;
  const [emptyTitlePre, emptyTitlePost] = t("chat.empty.taskTitle").split("{dir}");

  // header 之下那条内嵌条的文案(§3:会话连接状态唯一的法定位置)。打开失败
  // 压过连接态:它是终局,而"正在恢复"只是过程
  const skillRecoveryPending = !openError && !conn?.connected && conn?.code === "skill-recovery-pending";
  const stripText = openError
    ? t("chat.openFailed", { reason: openError })
    : skillRecoveryPending
      ? t("chat.skillRecoveryPending")
      : conn && !conn.connected
        ? conn.code === "skill-materialize-failed"
          ? t("chat.skillMaterializeFailed", { reason: conn.text })
          : conn.text
        : null;

  // pane 形态不当 <main>:分屏四格并存,页面只许一个 main 地标(SplitView
  // 自己是 main);格外壳的 section/aria 由 SplitView 提供,这里退成 div。
  // min-h-0:格是 flex 列(细头 + 本体),不加的话消息流把格撑破不出滚动
  const Root = pane ? "div" : "main";
  return (
    <div
      data-design-preview-open={sideOpen && sideTab === "preview" && previewTarget ? "true" : undefined}
      className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${pane ? "bg-transparent" : "mc-workbench-surface-100"}`}
    >
    <Root
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-transparent"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-box border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-primary">
          {t("chat.dropHint")}
        </div>
      )}

      {!pane && (
      <header data-view-header="" data-tauri-drag-region="" className="flex h-13 shrink-0 items-center gap-2 border-b border-base-300 px-4">
        <div data-tauri-drag-region="" className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              autoFocus
              aria-label={t("chat.rename.label")}
              // placeholder 只在清空时现身,正好是「清空会怎样」的说明位
              placeholder={t("chat.rename.clearHint")}
              className="input input-xs w-full max-w-xs text-sm font-semibold"
              value={titleDraft}
              maxLength={80}
              onChange={(e) => setTitleDraft(e.target.value)}
              // 进编辑态即全选(Finder 改名手感:直接打字整体覆盖)
              onFocus={(e) => e.currentTarget.select()}
              onCompositionEnd={(e) => titleIme.current.markEnd(e.timeStamp)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                // 输入态按键不外溢:Esc/Enter 属于改名交互,不能漏给全局
                // 审批热键(esc=deny 不可逆)
                e.stopPropagation();
                if (e.key === "Enter" && !titleIme.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) {
                  commitRename();
                } else if (e.key === "Escape") {
                  cancelRename();
                }
              }}
            />
          ) : (
            /* 单行标题(用户定案 2026-08-06,撤两行):用户改名 > 轮末摘要 >
               首句自动标题(title_custom 区分改名与自动,壳 sidecar 标记);
               双击改名改的始终是 title。悬停 tooltip 带全量(标题/摘要/目录) */
            /* w-fit 不可省:h1 是块级元素、父层又是 flex-1,不收窄的话它的盒子
               横跨整个 header,而 group/title 就挂在它身上——鼠标停在标题右侧
               那一大片空白上也会算作"悬停标题",铅笔莫名其妙浮出来(用户报障
               2026-08-06)。fit-content 让盒子贴合内容,长标题时仍回落到父宽,
               span 的 truncate 照常生效。悬停区因此 = 标题文字 + 铅笔自身的
               槽位(opacity-0 仍占位),正好是够得着按钮的最小范围 */
            <h1 data-tauri-drag-region="" className="group/title flex w-fit max-w-full min-w-0 items-center gap-1 text-sm leading-tight font-semibold">
              {/* 双击只挂在文字 span 上,且不带 data-tauri-drag-region:
                  Windows 壳把拖拽区双击吃成最大化,标题必须留在拖拽区之外 */}
              <span
                title={[meta.title, meta.summary, meta.workdir, t("chat.rename.hint")].filter(Boolean).join("\n")}
                className="min-w-0 cursor-text truncate"
                onDoubleClick={startRename}
              >
                {meta.title_custom ? meta.title : meta.summary || meta.title}
              </span>
              {/* 改名 affordance:双击是隐藏交互,光标形状不足以自明(用户
                  报障 2026-08-06「不知道可以改」)——hover 浮现铅笔钮,
                  单击即进编辑态;不占常驻视觉,不参与拖拽区 */}
              <button
                type="button"
                aria-label={t("chat.rename.label")}
                title={t("chat.rename.hint")}
                className="btn btn-ghost btn-square btn-xs shrink-0 text-base-content/40 opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
                onClick={startRename}
              >
                <IconPencil size={12} stroke={1.75} aria-hidden />
              </button>
            </h1>
          )}
        </div>
        {/* §7:indicator 壳与徽标是头部非交互子节点,必须各自带拖拽属性 */}
        {/* 旧「预览/会话文件」双钮 2026-08-30 收编为一颗侧边栏开合钮:
            文件/变更/预览都在右侧侧边栏里,header 只管开合 */}
        <div data-header-action="" data-tauri-drag-region="" className={changesCount > 0 ? "indicator shrink-0" : "shrink-0"}>
          {changesCount > 0 && (
            /* 与 rail 徽标同一处方(App.tsx SpaceRail):默认锚点在 32px 按钮的
               角上,16px 图标居中,徽标就飘出去了(用户报障 2026-08-10
               「太偏右上角」)。往内收 5px,徽标贴着图标的右上角。
               收进来之后它压在按钮上,故补 pointer-events-none——点数字要开
               侧边栏,不能变成「按住数字拖窗口」;拖拽属性照 §7 保留(命中落
               到按钮上,这块本就不再是空白拖拽区) */
            <span
              data-tauri-drag-region=""
              className="indicator-item badge badge-primary badge-xs pointer-events-none [--indicator-e:5px] [--indicator-t:5px]"
            >
              {changesCount}
            </span>
          )}
          <button
            type="button"
            aria-label={sideOpen ? t("side.hide") : t("side.show")}
            title={sideOpen ? t("side.hide") : t("side.show")}
            aria-pressed={sideOpen}
            className={`btn btn-ghost btn-square btn-sm text-base-content/60 ${sideOpen ? "btn-active" : ""}`}
            onClick={toggleSide}
          >
            <IconLayoutSidebarRight size={16} stroke={1.75} aria-hidden />
          </button>
        </div>
        <div data-header-action="" ref={menuBoxRef} className={`dropdown dropdown-end shrink-0 ${menuOpen ? "dropdown-open" : ""}`}>
          <button
            type="button"
            aria-label={t("chat.menu.label")}
            title={t("chat.menu.label")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="btn btn-ghost btn-square btn-sm text-base-content/60"
            onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
          >
            <IconDots size={16} stroke={1.75} aria-hidden />
          </button>
          {menuOpen && (
            <ul role="menu" aria-label={t("chat.menu.label")} className="dropdown-content menu z-40 w-44 flex-nowrap [&_li]:flex-nowrap rounded-box bg-base-100 p-2 shadow-sm">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    startRename();
                  }}
                >
                  {t("chat.menu.rename")}
                </button>
              </li>
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    void sessionPatch(meta.id, { archived: !meta.archived })
                      .catch((e: unknown) =>
                        onActionError?.("notice.archiveFailed", e instanceof Error ? e.message : String(e)),
                      )
                      .then(() => onPatched?.());
                  }}
                >
                  {meta.archived ? t("chat.menu.unarchive") : t("chat.menu.archive")}
                </button>
              </li>
              {/* 运行中不许删(壳/内核也会拒),置灰并说明原因——光是点不动
                  等于没有解释(旧 UI viewChrome.tsx DeleteMenuItem 的
                  title「运行中,请先停止」随迁)。title 挂 li 而非 disabled
                  按钮:多数 webview 不给 disabled 按钮弹 tooltip
                  (2026-08-06 用户报障「提示没了」的根因,同 pickers.tsx) */}
              <li
                role="none"
                className={state.running ? "menu-disabled" : ""}
                title={state.running ? t("chat.menu.deleteRunning") : undefined}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={state.running}
                  className={confirmDelete ? "text-error" : ""}
                  onClick={() => {
                    // 危险动作二段确认:首点只变文案,再点才执行(同 CloudTaskView 停止钮)
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    closeMenu();
                    onDeleted?.();
                  }}
                >
                  {confirmDelete ? t("chat.menu.deleteConfirm") : t("chat.menu.delete")}
                </button>
              </li>
            </ul>
          )}
        </div>
      </header>
      )}

      {/* 布局规范:header 只放身份与动作;会话连接状态是内容级信息,
          以内嵌条挂在 header 之下,恢复即消。形态 = 「header 的延长线」:
          同 px-4 内距(文字与标题同一竖线)、同 border-b 分隔线、微量
          warning 底,不用 alert 横幅(环境态是低声耳语,不是警报);
          文案由壳带来(恢复中/恢复失败),warning 点保持状态中立。
          session_open 失败共用这条内嵌条(§3:会话连接状态只有这一个法定
          位置):壳只在**成功**路径 emit conn-status,失败时 conn 恒为 null
          ——此前这一条整个不渲染,用户拿到的是没有任何解释的空会话。
          它不是"恢复中"而是已经落定的失败,故用 error 点且不呼吸 */}
      {/* pane 形态默认收成角落小图标(工作台降噪定案 2026-08-18:四格各铺
          一条几乎相同的长横幅是画面里最响的噪音):悬停看全文,点开展开成
          原横幅、再点收回。全文恒在 title/aria,信息不丢只是不喊。 */}
      {stripText !== null &&
        (pane && !stripOpen ? (
          <button
            type="button"
            aria-label={stripText}
            title={stripText}
            onClick={() => setStripOpen(true)}
            className={`absolute end-2 top-2 z-10 btn btn-ghost btn-square btn-xs ${openError ? "text-error" : "text-warning"}`}
          >
            <IconAlertTriangle size={14} stroke={1.75} aria-hidden />
          </button>
        ) : (
          <div
            role="status"
            className={`flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-1.5 text-xs text-base-content/70 ${openError ? "bg-error/5" : "bg-warning/5"} ${pane ? "cursor-pointer" : ""}`}
            onClick={pane ? () => setStripOpen(false) : undefined}
          >
            <span aria-hidden className={`status status-sm shrink-0 ${openError ? "status-error" : "status-warning motion-safe:animate-pulse"}`} />
            <span className="min-w-0 flex-1 truncate" title={stripText}>{stripText}</span>
            {skillRecoveryPending && (
              <button
                type="button"
                className="btn btn-warning btn-xs shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  openSettings("skills");
                }}
              >
                {t("chat.openSkillRecovery")}
              </button>
            )}
          </div>
        ))}

      {/* 大纲与消息/空态共用一个定位区域；footer 动态增高时该区域同步收缩，
          大纲不会侵入输入框。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {empty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <img src="/logo.png" alt="" aria-hidden className="h-13 w-13 rounded-2xl shadow-sm" />
          <p className="max-w-md text-center text-lg font-bold">
            {emptyChat ? (
              t("chat.empty.chatTitle")
            ) : (
              <>
                {emptyTitlePre}
                <span className="font-mono text-sm whitespace-nowrap">{meta.workdir}</span>
                {emptyTitlePost}
              </>
            )}
          </p>
          <p className="max-w-md text-center text-xs leading-relaxed text-base-content/60">
            {emptyChat ? t("chat.empty.chatDetail") : t("chat.empty.taskDetail")}
          </p>
        </div>
      ) : (
      <div
        ref={scrollRef}
        data-chat-log=""
        onScroll={onScroll}
        onWheel={onLogWheel}
        onMouseDown={onLogMouseDown}
        // scrollbar-gutter 两侧对称预留:经典滚动条(chrome.css 8px)只占
        // 右侧时,内部居中列会整体左偏 4px,与页脚 composer 列(无滚动条,
        // 真中线)对不齐——对称留槽让两列共享同一条中线
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 [scrollbar-gutter:stable_both-edges]"
      >
        <div className={`mx-auto flex ${pane ? "chat-measure-pane" : "chat-measure"} flex-col gap-3`}>
          {hasMore && (
            <button type="button" className="btn btn-ghost btn-xs self-center" disabled={loadingEarlier} onClick={() => void onLoadEarlier()}>
              {loadingEarlier && <span className="loading loading-spinner loading-xs" aria-hidden />}
              {t("chat.loadEarlier")}
            </button>
          )}
          {earlierError && (
            <p role="status" className="self-center text-xs text-error">
              {t("chat.loadEarlierFailed", { reason: earlierError })}
            </p>
          )}
          <LogList
            ref={listRef}
            state={state}
            sessionId={meta.id}
            flashSeq={flashSeq ?? undefined}
            onOpenChildSession={setChildId}
            uploadUrl={uploadUrl}
            loadDesignPreview={loadDesignPreview}
            onLocalLink={revealMarkdownLink}
            onPreviewUrl={openPreviewMarkdownLink}
            workdir={meta.workdir}
            loadFullTool={loadFullTool}
          />
        </div>
      </div>
      )}

      {/* 大纲导航格内同样在(2026-08-19 用户报障「大纲没了」:左缘浮轨,
          按格自适应) */}
      <OutlineNav entries={entries} activeSeq={activeSeq ?? undefined} onJump={onJump} />
      </div>

      {/* 无上边线(2026-08-13 用户定案):composer 卡自带边框已是分界,
          再压一条通栏线是双重描边;云端视图同款 */}
      <footer className="shrink-0 p-3">
        <div className={`mx-auto flex ${pane ? "chat-measure-pane" : "chat-measure"} flex-col gap-2`}>
          {(
            <>
              {state.plan.length > 0 && <TaskPanel entries={state.plan} />}
              <LocalComposerHost
                ref={composerRef}
                sessionId={meta.id}
                state={state}
                historyLoaded={historyLoaded}
                meta={meta}
                onAfterSend={followBottom}
                hotkeysActive={hotkeysActive}
                focusRequest={focusRequest}
                onFocusRequestHandled={onFocusRequestHandled}
                backgroundInfo={backgroundInfo}
              />
            </>
          )}
        </div>
      </footer>
      {pane &&
        headerSlot &&
        createPortal(
          <div className={changesCount > 0 ? "indicator" : undefined}>
            {changesCount > 0 && (
              <span
                aria-hidden
                className="indicator-item badge badge-primary badge-xs pointer-events-none [--indicator-e:5px] [--indicator-t:5px]"
              >
                {changesCount}
              </span>
            )}
            <button
              type="button"
              aria-label={sideOpen ? t("side.hide") : t("side.show")}
              title={sideOpen ? t("side.hide") : t("side.show")}
              aria-pressed={sideOpen}
              className={`btn btn-ghost btn-square btn-sm text-base-content/60 ${sideOpen ? "btn-active" : ""}`}
              onClick={toggleSide}
            >
              <IconLayoutSidebarRight size={16} stroke={1.75} aria-hidden />
            </button>
          </div>,
          headerSlot,
        )}
      {childId && <ChildSessionModal id={childId} workdir={meta.workdir} onClose={() => setChildId(null)} />}
    </Root>
    {/* 右侧侧边栏(2026-08-30 mockup 定案):主区的 flex 兄弟列。文件/变更
        共用 FilesPanel(常驻挂载,靠 display 切换保住树状态);预览 tab
        的工作台在 target 在场时同样常驻——切 tab 只藏不卸,原生预览
        webview 不必反复重建(obscured 驱动壳侧 hide/show)。 */}
    {sideOpen && (
      <SidePanel tabs={sideTabs} active={sideTab} onSelect={selectSideTab}>
        <div className={sideTab === "files" || sideTab === "changes" ? "flex min-h-0 min-w-0 flex-1" : "hidden"}>
          <FilesPanel
            key={meta.id}
            sessionId={meta.id}
            workdir={meta.workdir}
            tab={sideTab === "changes" ? "changes" : "files"}
            refreshToken={changesToken}
            onRepoInfo={onRepoInfo}
          />
        </div>
        {termMounted && (
          <div className={sideTab === "terminal" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
            <TerminalPanel key={meta.id} sessionId={meta.id} workdir={meta.workdir} />
          </div>
        )}
        {sideTab === "preview" && !previewTarget && (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <p className="text-sm text-base-content/50">{t("side.previewEmpty")}</p>
          </div>
        )}
        {previewTarget && composerRef.current && (
          <div className={sideTab === "preview" ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
            <DesignPreviewWorkbench
              key={meta.id}
              sessionId={meta.id}
              initialTarget={previewTarget}
              refreshKey={previewRefreshKey}
              composer={composerRef.current}
              obscured={sideTab !== "preview" || !!childId}
            />
          </div>
        )}
      </SidePanel>
    )}
    </div>
  );
}

/** 子代理会话只读回放浮层(D2):复用 useSessionFeed + LogList(readonly),
 * 无 composer、无审批热键;卸载即 session_close(useSessionFeed 清理)。
 * 尾部回放窗口够看完整过程,不做「加载更早」(与旧版 SessionViewer 同口径)。 */
function ChildSessionModal({ id, workdir, onClose }: { id: string; workdir?: string; onClose: () => void }) {
  const { t } = useI18n();
  const { state } = useSessionFeed(id);
  // useCallback 稳定引用:LogList 已 memo,浮层每收一批帧就重渲染,内联箭头
  // 会把整列消息(每张工具卡的 effect)一起拖着重跑——主路径为此早就用了
  // useCallback(见上方 uploadUrl/loadFullTool),这里此前漏了
  const uploadUrl = useCallback((p: string, expectedDigest?: string) => uploadFileURL(id, p, expectedDigest), [id]);
  const loadDesignPreview = useCallback((p: string) => designTemplatePreviewRead(id, p), [id]);
  const loadFullTool = useCallback((seq: number) => sessionFrame(id, seq), [id]);
  return (
    <DetailModal
      ariaLabel={t("chat.child.title")}
      title={
        <>
          {t("chat.child.title")} <span className="font-mono text-xs text-base-content/50">{id}</span>
        </>
      }
      onClose={onClose}
    >
      <div data-chat-log="" className="h-full">
        <LogList
          state={state}
          sessionId={id}
          readonly
          uploadUrl={uploadUrl}
          loadDesignPreview={loadDesignPreview}
          workdir={workdir}
          loadFullTool={loadFullTool}
        />
      </div>
    </DetailModal>
  );
}
