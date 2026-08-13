// 云端任务详情视图(纯视图层):回放/跟看/操作 monkeycode 云端任务。
// 连接编排在 useCloudTask,协议状态机在 lib/cloud/stream;渲染复用本地
// 会话的帧归约链(reduceBatch → LogList,云端帧与本地 Frame 同构)。
// 形态与本地 ChatView 同构(LAYOUT §4「云端任务视图与会话视图同构」):
// header(标题+副标题 / 图标钮 + ⋯ 菜单)→ 连接条(header 之下内嵌条)→
// 消息流(居中 chat-measure,gutter 对称)→ TaskPanel + composer(输入卡)。
// - pending:整屏启动时间线(StartupTimeline),此时必然还没有对话;
// - processing:attach 跟看 + CloudComposer + 中断/终止;
// - finished/error:REST rounds 只读回放(LogList readonly),更早轮次按 cursor
//   往前翻:滚近顶部自动补拉(懒加载),「加载更早」按钮兜底(内容不满一屏时
//   没有滚动事件可触发)。
// 提问大纲:数据 = REST 提问索引(全量目录)+ 已回放窗口的用户消息按时间锚
// 合并(lib/cloud/outline),渲染复用本地 OutlineNav;跳转目标未加载时经
// loadEarlier 大步长补页——effect 驱动(每页提交后重查),上限防死循环。
import { IconDots, IconFolderOpen, IconTerminal2, IconWorld, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import { useApprovalHotkeys } from "@/app/shortcuts";
import { ErrorBar } from "@/features/chat/composer/composerKit";
import { LogList } from "@/features/chat/LogList";
import { OutlineNav, outlineEntriesOf } from "@/features/chat/OutlineNav";
import { TaskPanel } from "@/features/chat/TaskPanel";
import { useI18n } from "@/lib/i18n";
import { mcStatus } from "@/lib/ipc/account";
import { openExternal } from "@/lib/ipc/host";
import { mcTaskDelete, type CloudTask } from "@/lib/ipc/cloudtasks";
import type { OutlineItem } from "@/lib/ipc/controls";
import { cloudAnchorIndex, cloudOutlineAnchor, fetchCloudOutline, withCloudAnchors } from "@/lib/cloud/outline";
import type { StreamStatus } from "@/lib/cloud/stream";
import { onNativeFileDrop } from "@/lib/ipc/uploads";
import { outlineActiveSeq } from "@/lib/util/scrollAnchor";
import { useEscLayer } from "@/lib/util/escLayer";
import { useDismiss } from "@/lib/util/useDismiss";
import { CloudComposer } from "./CloudComposer";
import { CloudFiles } from "./CloudFiles";
import { CloudTerminal } from "./CloudTerminal";
import { StartupTimeline } from "./StartupTimeline";
import { useCloudTask } from "./useCloudTask";

const PIN_THRESHOLD = 40; // 距底多少像素内算"贴底"
const SCROLLBAR_EDGE = 18; // 右缘滚动条带宽(mousedown 落点判定,与 ChatView 同值)
const AUTO_EARLIER_PX = 48; // 滚进距顶多少像素内自动补拉更早轮次(懒加载)
const JUMP_MAX_PAGES = 80; // 大纲跳转补页上限(坏锚/游标不前进时不空转)
const JUMP_STEP = 10; // 补页步长(轮/页;壳侧 mc_task_rounds 的 limit 上限)
const FLASH_MS = 1100; // 与 chrome.css mc-flash 动画时长对齐(略长于 1s)

/** 连接状态 → 外显文案;健康态(已连接/本轮结束)返回 null 不渲染——
 * 常驻"已连接云端"是噪音,异常/过渡态才值得占一行。 */
/** 发送中的用户气泡(与 LogList 的 UserBubble 同形,降透明 + 转圈脚注)。
 *  云端回显到达即由真气泡取代(useCloudTask.sending 在首批帧到达时清空)。 */
function PendingBubble({ content, waking }: { content: string; waking: boolean }) {
  const { t } = useI18n();
  return (
    <div className="chat chat-end opacity-60" data-pending-send="">
      <div className="chat-bubble max-w-[85%] bg-primary/10 text-sm whitespace-pre-wrap wrap-anywhere select-text">
        {content}
      </div>
      <div className="chat-footer flex items-center gap-1.5 pt-1 text-xs text-base-content/60">
        <span className="loading loading-spinner loading-xs" aria-hidden />
        <span>{t(waking ? "cloud.send.waking" : "cloud.send.pending")}</span>
      </div>
    </div>
  );
}

function statusText(
  t: ReturnType<typeof useI18n>["t"],
  status: StreamStatus | null,
  vm: { waking: boolean; failed: boolean; notReady: boolean; failReason: string; ctrlOffline: boolean },
): string | null {
  // 机器态压过连接态:同样是 connecting,休眠机器的等待以分钟计,拿
  // 「连接中…」糊过去会让用户以为卡死了(2026-08-06 用户报障)
  if (vm.waking) return t("cloud.conn.waking");
  // 离线不是唤醒:后端只对 hibernated 做 Resume(task_control.go),
  // offline 的机器没人会去救,说成「正在唤醒」就是骗人干等。
  // 但 offline 也**不都是终态**——见 useCloudTask 里 vmFailed/vmNotReady 的
  // 注释,只有拿到 Failed 条件才敢说"失败",否则只报"尚未上线"
  if (vm.failed) return t("cloud.conn.vmFailed", { reason: vm.failReason || t("cloud.conn.vmFailedNoReason") });
  if (vm.notReady) return t("cloud.conn.vmNotReady");
  switch (status?.kind) {
    case "connecting":
      return t("cloud.conn.connecting");
    case "reconnecting":
      return t("cloud.conn.reconnecting", { seconds: Math.round(status.delayMs / 1000) }) + (status.reason ? `(${status.reason})` : "");
    case "sendFailed":
      return t("cloud.conn.sendFailed");
    case "dialGaveUp":
      return t("cloud.conn.dialGaveUp") + (status.reason ? `(${status.reason})` : "");
    case "dropGaveUp":
      return t("cloud.conn.dropGaveUp");
    default:
      // 任务流健康时才轮到控制流:它一断保活与唤醒就都没了(机器会照常
      // 休眠、且没人去叫醒),属于用户该知道的后台故障
      return vm.ctrlOffline ? t("cloud.conn.ctlOffline") : null;
  }
}

/** 空态五选一(结束 / 启动失败 / 尚未上线 / 唤醒中 / 连接中)的文案键。 */
function emptyKey(
  s: { ended: boolean; waking: boolean; failed: boolean; notReady: boolean },
  part: "title" | "detail",
) {
  if (s.ended) return `cloud.empty.ended.${part}` as const;
  if (s.waking) return `cloud.empty.waking.${part}` as const;
  if (s.failed) return `cloud.empty.vmFailed.${part}` as const;
  if (s.notReady) return `cloud.empty.vmNotReady.${part}` as const;
  return `cloud.empty.connecting.${part}` as const;
}

export function CloudTaskView({
  task,
  onTasksChanged,
  onDeleted,
}: {
  /** 侧栏/新建入口带进来的任务(至少含 id;详情异步补全)。
   * 契约:App 以 task.id 为 key 挂载本视图(id 在一次挂载内不变)。 */
  task: CloudTask;
  /** 状态变化(停止/结束)后让 App 刷新侧栏列表 */
  onTasksChanged?: () => void;
  /** 视图内删除成功后回调:App 关闭本视图并刷新侧栏 */
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const h = useCloudTask(task, { onTasksChanged });
  const [termOpen, setTermOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  // 云端主机名:「在浏览器打开」拼控制台 URL 用。挂载拉一次(登录态本就
  // 在设置页维护,这里只借 host);拿不到就不出这一项,不给死链
  const [mcHost, setMcHost] = useState("");
  useEffect(() => {
    let alive = true;
    // catch 不能省:mc_status 会把网络故障抛成 Err(壳 baizhi/mod.rs),
    // 未捕获的 rejection 被 index.html 画成盖住整个应用的红色遮罩
    void mcStatus()
      .then((st) => {
        if (alive && st?.host) setMcHost(st.host);
      })
      .catch(() => undefined); // 拿不到 host 就不出「在浏览器打开」,不给死链
    return () => {
      alive = false;
    };
  }, []);

  // ==== 头部 ⋯ 菜单(终止/删除):受控 dropdown,外点/Esc 即收;危险动作
  // 二段确认(首点换文案,再点才执行)——手法与 ChatView 头部菜单一致 ====
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuBoxRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmStop(false);
    setConfirmDelete(false);
  };
  useDismiss(menuOpen, menuBoxRef, closeMenu);

  const doDelete = () => {
    closeMenu();
    void mcTaskDelete(h.id)
      .then(() => onDeleted?.())
      .catch((e: unknown) => {
        // 服务端会拒绝仍在运行/虚拟机尚在线的任务:原因外显,不静默
        h.notifyErr(t("cloud.list.deleteFailed", { reason: e instanceof Error ? e.message : String(e) }));
      });
  };

  // 键盘审批(⏎ 允许 / esc 拒绝)经云端 WS 上行;终端聚焦时由 shortcuts
  // 的 inTerminal 守卫整体让路
  useApprovalHotkeys(h.chat, h.id, h.sendFrame);

  // ==== 拖拽附件(与 ChatView 同构):HTML5 计数配对 + 落区浮层;结束态
  // 只读不收 ====
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hRef = useRef(h);
  hRef.current = h;
  const onDragEnter = (e: DragEvent<HTMLElement>) => {
    if (h.ended || ![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) return;
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
    if (files.length && !h.ended) h.addFiles(files);
  };
  // Linux 壳:WebKitGTK 的 HTML5 拖拽拿不到 File,走壳原生 tauri://drag-*
  // (mac/Windows 壳禁用原生处理器,监听永不触发)。经 ref 取最新 handle
  useEffect(
    () =>
      onNativeFileDrop({
        // 云端附件要把字节上行对象存储(mc_upload),必须真读内容:默认的
        // path-backed 占位 File 是 0 字节,到 uploadCloudFile 会一律以
        // 「是空文件」告吹(旧 UI cloudtask.tsx:94 同一处 wantContent)
        wantContent: true,
        onDragging: (v) => setDragging(v && !hRef.current.ended),
        onFiles: (files) => {
          if (!hRef.current.ended) hRef.current.addFiles(files);
        },
        onError: (m) => hRef.current.notifyErr(t("cloud.attach.uploadFailed", { reason: m })),
      }),
    // t 稳定(hook 返回的翻译函数按 locale 变化,重订阅无害)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [h.id],
  );

  // Esc 关文件抽屉走 escLayer 层栈(全应用唯一一条 window capture,后开的
  // 浮层先拿到):抽屉里的预览是更晚入栈的一层,Esc 先关预览再关抽屉。
  // 消费即截断——window 上还挂着审批热键(app/shortcuts.ts,esc = deny
  // 不可逆),同一下按键绝不能"关抽屉 + 拒绝审批"双消费
  const escFiles = useCallback(() => {
    setFilesOpen(false);
    return true;
  }, []);
  useEscLayer(filesOpen, escFiles);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // ==== 提问大纲:REST 全量目录(挂载拉一次;运行中新增的提问靠实时合并) ====
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  useEffect(() => {
    setOutline([]);
    let alive = true;
    fetchCloudOutline(h.id)
      .then((items) => {
        if (alive) setOutline(items);
      })
      .catch((e: unknown) => {
        // 大纲缺席可接受(降级为只有流内条目),但失败必须留痕:命令没进
        // ACL 白名单这类故障,静默吞掉就只剩"点了没反应"
        console.warn("[cloud-outline] 提问索引拉取失败:", e);
      });
    return () => {
      alive = false;
    };
  }, [h.id]);
  const entries = useMemo(() => outlineEntriesOf(outline, withCloudAnchors(h.chat.items)), [outline, h.chat.items]);

  // ==== 当前项跟踪(与 ChatView 同法,rAF 节流):大纲条目的 seq 是 10ms
  // 时间锚(见 lib/cloud/outline),DOM 的 data-user-seq 是帧原生 seq,两套
  // 坐标对不上号——按 LogList 结构契约(直接子元素 ↔ items 下标)从条目
  // 几何反查锚,判定纯函数与本地共用(outlineActiveSeq) ====
  const [activeAnchor, setActiveAnchor] = useState<number | null>(null);
  const activeRaf = useRef(0);
  const itemsRef = useRef(h.chat.items);
  itemsRef.current = h.chat.items;
  const scheduleActive = () => {
    if (activeRaf.current) return;
    activeRaf.current = window.requestAnimationFrame(() => {
      activeRaf.current = 0;
      const el = scrollRef.current;
      const col = listRef.current?.firstElementChild;
      if (!el || !col) return;
      const seqTops: Array<{ seq: number; top: number }> = [];
      itemsRef.current.forEach((it, i) => {
        if (it.kind !== "user") return;
        const anchor = cloudOutlineAnchor(it.timestamp);
        if (anchor === undefined) return;
        const node = col.children.item(i);
        if (node) seqTops.push({ seq: anchor, top: node.getBoundingClientRect().top });
      });
      setActiveAnchor(outlineActiveSeq(seqTops, el.getBoundingClientRect().top));
    });
  };
   
  useEffect(scheduleActive, [h.chat.items]);
  // 取消后必须把 id 清零:scheduleActive 以「非零 = 已排队」做节流,残留
  // 旧 id 会让它永远短路(StrictMode 双挂载即触发,与 ChatView 同教训)
  useEffect(
    () => () => {
      window.cancelAnimationFrame(activeRaf.current);
      activeRaf.current = 0;
    },
    [],
  );

  // ==== 大纲跳转:effect 驱动的补页循环(锚 = 10ms 时间锚,见 lib/cloud/outline) ====
  const [jumpAnchor, setJumpAnchor] = useState<number | null>(null);
  const [flashSeq, setFlashSeq] = useState<number | null>(null);
  const jumpTries = useRef(0);
  const flashTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  useEffect(() => {
    if (jumpAnchor === null) return;
    const idx = cloudAnchorIndex(h.chat.items, jumpAnchor);
    if (idx >= 0) {
      setJumpAnchor(null);
      // LogList 结构契约:根节点直接子元素与 items 一一对应
      const node = listRef.current?.firstElementChild?.children.item(idx);
      (node as HTMLElement | null)?.scrollIntoView?.({ block: "start" });
      // 闪光走 LogList 的 flashSeq(按帧原生 seq 对表);云端旧帧可缺 seq,
      // 那就只滚动不闪,定位本身不受影响
      const it = h.chat.items[idx];
      const seq = it?.kind === "user" ? it.seq : undefined;
      if (seq !== undefined) {
        setFlashSeq(seq);
        window.clearTimeout(flashTimer.current);
        flashTimer.current = window.setTimeout(() => setFlashSeq(null), FLASH_MS);
      }
      return;
    }
    if (!h.cursor || jumpTries.current >= JUMP_MAX_PAGES) {
      setJumpAnchor(null); // 锚不存在(坏数据/已翻到头):放弃,不空转
      return;
    }
    if (h.loadingEarlier) return; // 本页落地(items 变化)后 effect 重跑再查
    jumpTries.current += 1;
    void h.loadEarlier(JUMP_STEP);
    // h.loadEarlier 每渲染新引用但行为稳定,刻意不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpAnchor, h.chat.items, h.cursor, h.loadingEarlier]);
  const onJumpOutline = (anchor: number) => {
    // 云端流为跟看场景:先解除贴底,否则下一批帧立刻拽回底部
    pinnedRef.current = false;
    jumpTries.current = 0;
    setJumpAnchor(anchor);
  };

  // 贴底跟随:items 变化后,若此前贴底则滚到底(useLayoutEffect 赶在绘制前)。
  // h.running 同为依赖:发出消息后运行条(RunBar)才挂进 composer 卡,footer
  // 长高多少,flex-1 的日志视口就被压矮多少——items 已经贴过底了,不重贴的话
  // 刚发出的那条正好被顶到 composer 后面(用户报障 2026-08-06)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [h.chat.items, h.running]);

  // scroll 事件只做「贴底 → 跟随」的单向判定(与 ChatView 同法):程序滚动
  // 同样发 scroll 事件,回放中一批内容长高就会把跟随误判成用户离底。
  // 离底判定只认用户真实输入(onWheel 上滚/右缘 mousedown)
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD) pinnedRef.current = true;
    scheduleActive();
    maybeLoadEarlier();
  };
  const onLogWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      pinnedRef.current = false; // 向上滚 = 离开底部去看历史
      maybeLoadEarlier(); // 已顶到 0 时 scroll 不再发事件,wheel 兜住继续往前翻
    }
  };
  const onLogMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // 按在右缘滚动条带上 = 准备拖动定位,解除跟随(拖回底部经 scroll 事件重新贴上)
    const el = scrollRef.current;
    if (el && e.clientX > el.getBoundingClientRect().right - SCROLLBAR_EDGE) pinnedRef.current = false;
  };

  const onLoadEarlier = async () => {
    // 解除贴底:前插保位后若仍是"贴底"态,下一批实时帧会立刻把视口拽回底
    pinnedRef.current = false;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    await h.loadEarlier();
    // 前插保位:新内容把 scrollHeight 撑高多少,scrollTop 就补多少
    requestAnimationFrame(() => {
      const now = scrollRef.current;
      if (now) now.scrollTop = prevTop + (now.scrollHeight - prevHeight);
    });
  };

  // 懒加载:滚进距顶阈值内自动补拉(与按钮同一条 onLoadEarlier 链;数据层
  // loadEarlier 自带在途守卫,滚动高频触发安全)。补拉落地后前插保位会把
  // 视口推离顶部,链式触发自然停
  const maybeLoadEarlier = () => {
    const el = scrollRef.current;
    if (!el || !h.cursor || h.loadingEarlier) return;
    if (el.scrollTop < AUTO_EARLIER_PX) void onLoadEarlier();
  };

  const send = () => {
    pinnedRef.current = true;
    h.send();
  };

  const pending = h.taskStatus === "pending";
  const connText = statusText(t, h.status, {
    waking: h.waking,
    failed: h.vmFailed,
    notReady: h.vmNotReady,
    failReason: h.vmFailReason,
    ctrlOffline: h.ctrlOffline,
  });
  const emptyState = { ended: h.ended, waking: h.waking, failed: h.vmFailed, notReady: h.vmNotReady };
  // 空态带 !cursor 守卫:结束态首轮可能没有帧但仍有更早可翻,
  // 此时要保住「加载更早」入口,不能整屏换成空态
  // 发送在途时不走空态:那条占位气泡就是当前唯一的内容,空态会把它盖掉
  const showEmpty = !pending && h.chat.items.length === 0 && !h.cursor && !h.sending;

  // 尺寸兜底(与 ChatView 同法,两处口径必须一致):能改变高度的来源两头都要盯——
  // 视口(footer 长高:运行条/附件 chips/终端卡 h-64/textarea 自适应,顶部连接
  // 横幅,窗口缩放)与内容轨(图片解码、字体加载、工具卡挂载后异步取回的正文,
  // 这类不经过 items 变化也不改变视口尺寸)。align 语义即「贴底则贴底,否则不动」。
  // scrollTop 不改变元素尺寸,不会与 RO 自激
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const repin = () => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    };
    const ro = new ResizeObserver(repin);
    ro.observe(el);
    const track = el.firstElementChild;
    if (track) ro.observe(track);
    return () => ro.disconnect();
    // 分支翻面时滚动容器整棵换掉,要重新 observe
  }, [pending, showEmpty]);

  // 副标题:摘要(与标题同句时跳过——label 回退链会把 summary 顶成标题)
  // → 仓库 · 分支(mono)→ 「云端」身份词;与 ChatView 副标题同构
  const summary = task.summary || h.meta?.summary || "";
  const repoLine = [h.meta?.full_name, h.meta?.branch].filter(Boolean).join(" · ");

  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col bg-base-100"
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
      {/* §7 拖拽区铁律:头部每个非交互子节点单独带 data-tauri-drag-region
          (云端无双击改名,h1 整个在拖拽区内) */}
      <header data-view-header="" data-tauri-drag-region="" className="flex h-13 shrink-0 items-center gap-2 border-b border-base-300 px-4">
        <div data-tauri-drag-region="" className="min-w-0 flex-1">
          <h1 data-tauri-drag-region="" className="truncate text-sm leading-tight font-semibold" title={h.label}>
            {h.label}
          </h1>
          {summary && summary !== h.label ? (
            <p data-tauri-drag-region="" className="truncate text-xs leading-tight text-base-content/50">{summary}</p>
          ) : repoLine ? (
            <p data-tauri-drag-region="" title={repoLine} className="truncate font-mono text-xs leading-tight text-base-content/45">
              {repoLine}
            </p>
          ) : (
            <p data-tauri-drag-region="" className="truncate text-xs leading-tight text-base-content/45">{t("cloud.view.badge")}</p>
          )}
        </div>
        {/* 文件浏览走控制流(按 taskId 寻址,CloudFiles 懒建),不依赖 vmId
            ——结束态浏览最终快照、运行中即便详情未捎带 VM 也能看;vmId 只
            决定面板内上传/下载入口。仅 pending(VM 未建)禁用 */}
        <button
          type="button"
          aria-label={t("cloud.view.filesOpen")}
          title={pending ? t("cloud.view.filesPending") : t("cloud.view.filesOpen")}
          className={`btn btn-ghost btn-square btn-sm text-base-content/60 ${filesOpen ? "btn-active" : ""}`}
          disabled={pending}
          onClick={() => setFilesOpen((o) => !o)}
        >
          <IconFolderOpen size={16} stroke={1.75} aria-hidden />
        </button>
        {h.vmId && !h.ended && (
          <button
            type="button"
            aria-label={termOpen ? t("cloud.view.terminalClose") : t("cloud.view.terminalOpen")}
            title={termOpen ? t("cloud.view.terminalClose") : t("cloud.view.terminalOpen")}
            className={`btn btn-ghost btn-square btn-sm text-base-content/60 ${termOpen ? "btn-active" : ""}`}
            onClick={() => setTermOpen((o) => !o)}
          >
            <IconTerminal2 size={16} stroke={1.75} aria-hidden />
          </button>
        )}
        <div ref={menuBoxRef} className={`dropdown dropdown-end ${menuOpen ? "dropdown-open" : ""}`}>
          <button
            type="button"
            aria-label={t("cloud.view.menu")}
            title={t("cloud.view.menu")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="btn btn-ghost btn-square btn-sm text-base-content/60"
            onClick={() => {
              if (menuOpen) return closeMenu();
              setMenuOpen(true);
              h.fetchPorts(); // 在线预览分节:开菜单即检测开放端口
            }}
          >
            <IconDots size={16} stroke={1.75} aria-hidden />
          </button>
          {menuOpen && (
            <ul role="menu" aria-label={t("cloud.view.menu")} className="dropdown-content menu z-40 w-56 flex-nowrap [&_li]:flex-nowrap rounded-box bg-base-100 p-2 shadow-sm">
              {/* 在浏览器打开:完整控制台(共享终端/文件下载/预览等桌面端
                  没做的部分都在那边)。拿不到 host 就不出这项,不给死链 */}
              {mcHost && (
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    title={t("cloud.view.openConsoleTip")}
                    onClick={() => {
                      closeMenu();
                      openExternal(`https://${mcHost}/console/task/${h.id}`);
                    }}
                  >
                    <IconWorld size={14} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
                    {t("cloud.view.openConsole")}
                  </button>
                </li>
              )}
              {/* 在线预览:VM 里跑起来的服务,access_url 直接在浏览器打开。
                  开菜单即拉端口(fetchPorts),三态各有交代不留悬空 */}
              {!h.ended && h.vmId && (
                <>
                  <li className="menu-title px-2 py-1 text-xs">{t("cloud.view.preview")}</li>
                  {h.ports === null && (
                    <li className="menu-disabled">
                      <span className="text-xs">{t("cloud.view.previewLoading")}</span>
                    </li>
                  )}
                  {h.ports !== null && h.ports.filter((p) => p.access_url).length === 0 && (
                    <li className="menu-disabled">
                      <span className="text-xs">{t("cloud.view.previewEmpty")}</span>
                    </li>
                  )}
                  {(h.ports ?? [])
                    .filter((p) => p.access_url)
                    .map((p) => (
                      <li key={p.port} role="none">
                        <button
                          type="button"
                          role="menuitem"
                          title={p.access_url}
                          onClick={() => {
                            closeMenu();
                            openExternal(p.access_url!);
                          }}
                        >
                          <IconWorld size={14} stroke={1.75} aria-hidden className="shrink-0 text-primary" />
                          <span className="min-w-0 flex-1 truncate">
                            :{p.port} {p.label || p.process || ""}
                          </span>
                        </button>
                      </li>
                    ))}
                </>
              )}
              {!h.ended && (
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    title={t("cloud.view.stopHint")}
                    className={confirmStop ? "text-error" : ""}
                    onClick={() => {
                      // 危险动作二段确认:第一次点变文案,再点才停
                      if (!confirmStop) {
                        setConfirmStop(true);
                        return;
                      }
                      closeMenu();
                      void h.stopTask();
                    }}
                  >
                    {confirmStop ? t("cloud.view.stopConfirm") : t("cloud.view.stop")}
                  </button>
                </li>
              )}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className={confirmDelete ? "text-error" : ""}
                  onClick={() => {
                    if (!confirmDelete) {
                      setConfirmDelete(true);
                      return;
                    }
                    doDelete();
                  }}
                >
                  {confirmDelete ? t("cloud.list.deleteConfirm") : t("cloud.list.delete")}
                </button>
              </li>
            </ul>
          )}
        </div>
      </header>

      {/* 布局规范(LAYOUT §3):连接状态是内容级信息,以内嵌条挂在 header
          之下,恢复即消。形态 = 「header 的延长线」:同 px-4 内距、同
          border-b 分隔线、微量 warning 底,不用 alert 横幅 */}
      {connText && !h.ended && (
        <div role="status" className="flex shrink-0 items-center gap-2 border-b border-base-300 bg-warning/5 px-4 py-1.5 text-xs text-base-content/70">
          <span aria-hidden className="status status-warning status-sm animate-pulse shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={connText}>{connText}</span>
        </div>
      )}

      {/* 大纲的 absolute 包含块只覆盖消息/空态；header/footer 均在区域外。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {pending ? (
        // 启动页:VM 准备是以分钟计的过程,整屏让给时间线(此时必无对话)。
        // 居中用 m-auto 而**不是** items-center/justify-center(LAYOUT §5):
        // 后者在内容高过容器时会向两端等量溢出,顶端那截滚不回去——步骤多、
        // 窗口矮时正好看不到最前面几步。auto margin 在没有余量时归零,退化成
        // 顶端对齐,滚动照旧可达。overflow-x-hidden 是 §5 的硬性搭配
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto p-6">
          <div className="m-auto">
            <StartupTimeline meta={h.meta} />
          </div>
        </div>
      ) : showEmpty ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6">
          <img src="/logo.png" alt="" aria-hidden className="h-13 w-13 rounded-2xl shadow-sm" />
          {/* 唤醒期的空态单独说:等待量级(分钟)与「连接中」不是一回事,
              且要讲清「现在就能输入,连上自动发」。机器离线是第三种:
              它不会自己回来,不能拿唤醒动画吊着 */}
          {!h.ended && h.waking && <span className="loading loading-spinner loading-sm text-base-content/40" aria-hidden />}
          <p className="max-w-md text-center text-base font-bold">
            {t(emptyKey(emptyState, "title"))}
          </p>
          <p className="max-w-md text-center text-xs leading-relaxed text-base-content/60">
            {t(emptyKey(emptyState, "detail"), { reason: h.vmFailReason })}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-chat-log=""
          onScroll={onScroll}
          onWheel={onLogWheel}
          onMouseDown={onLogMouseDown}
          // gutter 两侧对称预留:与页脚 composer 列(无滚动条)共享同一条中线
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 [scrollbar-gutter:stable_both-edges]"
        >
          <div className="mx-auto flex chat-measure flex-col gap-3">
            {h.cursor && (
              <button
                type="button"
                className="btn btn-ghost btn-xs self-center"
                disabled={h.loadingEarlier}
                onClick={() => void onLoadEarlier()}
              >
                {h.loadingEarlier && <span className="loading loading-spinner loading-xs" aria-hidden />}
                {t("chat.loadEarlier")}
              </button>
            )}
            {/* 审批/提问答复经 stream WS 上行(h.sendFrame),不走本地 session_send;
                包一层 div 做大纲跳转的定位根(LogList 直接子元素 ↔ items 下标);
                结束态只读回放:卡片不再渲染交互按钮 */}
            <div ref={listRef}>
              <LogList state={h.chat} sessionId={h.id} sendFrame={h.sendFrame} flashSeq={flashSeq ?? undefined} readonly={h.ended} />
            </div>
            {/* 发送中的占位气泡:云端要等 WS 连上才回显这条(休眠机器先唤醒,
                以分钟计)。不占位的话输入框一清、日志毫无变化,用户只能猜
                消息是不是丢了(2026-08-06 用户报障) */}
            {h.sending && <PendingBubble content={h.sending.content} waking={h.waking} />}
          </div>
        </div>
      )}

      {!pending && <OutlineNav entries={entries} activeSeq={activeAnchor ?? undefined} onJump={onJumpOutline} />}
      </div>

      {/* 云端文件:右滑抽屉,受控开合手法与 FilesDrawer 统一(scrim 点击关 +
          Esc 关,见上方 effect);面板挂在主区内(absolute,参照 relative main),
          CloudFiles 自带头部与关闭;下载走全局 downloads */}
      {filesOpen && (
        <>
          <div aria-hidden className="absolute inset-0 z-10 bg-base-content/20" onClick={() => setFilesOpen(false)} />
          <aside className="absolute inset-y-0 right-0 z-20 flex w-[26rem] max-w-[85%] flex-col border-l border-base-300 bg-base-100 shadow-xl">
            {/* 控制流复用常驻那条(h.borrowControl):每条控制连接在后端都会
                另起一份 TaskLive 上游订阅(task_control.go),各开各的既费
                上游、又多一条与保活语义纠缠的连接 */}
            <CloudFiles
              taskId={h.id}
              vmId={h.ended ? undefined : h.vmId || undefined}
              borrowControl={h.borrowControl}
              onClose={() => setFilesOpen(false)}
            />
          </aside>
        </>
      )}

      {/* 无上边线:与 ChatView composer 同款(2026-08-13 用户定案) */}
      <footer className="shrink-0 p-3">
        <div className="mx-auto flex chat-measure flex-col gap-2">
          {/* 终端卡:外壳走 card card-border 官方形态,头部条普通 base 底 +
              结构线;深色只留给 xterm 本体(term.css 白名单) */}
          {termOpen && h.vmId && !h.ended && (
            <div className="card card-border h-64 min-h-0 overflow-hidden bg-base-100">
              <div className="flex h-8 shrink-0 items-center gap-2 border-b border-base-300 px-3">
                <span aria-hidden className="status status-success" />
                <span className="text-xs font-semibold">{t("cloud.view.terminalTitle")}</span>
                <span className="text-xs text-base-content/60">{t("cloud.view.terminalSub")}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  className="btn btn-ghost btn-square btn-xs"
                  aria-label={t("cloud.view.terminalClose")}
                  onClick={() => setTermOpen(false)}
                >
                  <IconX size={14} stroke={1.75} aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <CloudTerminal vmId={h.vmId} />
              </div>
            </div>
          )}

          {h.ended ? (
            <>
              {/* 结束态 composer 不渲染,错误通道(如删除被拒)另给一条 */}
              {h.err && <ErrorBar text={h.err} onDismiss={h.clearErr} />}
              <div className="py-1 text-center text-xs text-base-content/50">{t("cloud.view.readonly")}</div>
            </>
          ) : (
            <>
              {h.chat.plan.length > 0 && <TaskPanel entries={h.chat.plan} />}
              <CloudComposer h={h} pending={pending} onSend={send} />
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
