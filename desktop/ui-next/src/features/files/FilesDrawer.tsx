// 本地会话文件抽屉:右滑面板 + Scrim,文件树/改动两 tab(共用下方预览)。
// daisyUI 的 drawer 组件是 checkbox 驱动的整页布局原语,与受控开合 +
// 拖拽调宽不适配——面板自绘(fixed 定位),组件级仍用 daisyUI
// (tabs/badge/skeleton/loading/btn)。
//
// - 宽度左缘把手可拖,localStorage "mc.drawerWidth"(px,与旧 UI 同键互认);
//   预览打开后列表/预览上下分栏,分栏把手记 "mc.drawerSplit"。拖拽期间锁
//   body 选区与光标。
// - 数据面全部走 lib/ipc/repo(壳内 repo.rs 原生处理);改动列表挂载即拉,
//   refreshToken 自增(调用方在 ChatState.turnEnded 时递增)则重拉。
// - Esc:走全局层栈 lib/util/escLayer(抽屉开着即占一层),层内再分两级
//   ——预览开着先关预览,再一次才关抽屉;跨浮层的层级协调交给层栈本身。
import { IconFolderOpen, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useI18n } from "@/lib/i18n";
import { isMacShell } from "@/lib/ipc/host";
import { repoChanges, repoFileDiff, repoListDir, repoReadFile, repoReveal, type RepoChange, type RepoEntry } from "@/lib/ipc/repo";
import { uploadFileURL } from "@/lib/ipc/uploads";
import { copyText } from "@/lib/util/clipboard";
import { useEscLayer } from "@/lib/util/escLayer";
import { workspaceRelativePath } from "@/lib/util/markdownPaths";
import { Changes } from "./Changes";
import { Preview, type PreviewModel } from "./Preview";
import { Tree } from "./Tree";

const WIDTH_KEY = "mc.drawerWidth";
const SPLIT_KEY = "mc.drawerSplit";
const MIN_WIDTH = 420;
const DEFAULT_WIDTH = 600;
const MAX_STORED_WIDTH = 1200; // 存量值的静态上限;拖拽时上限是窗宽 90%
const MIN_SPLIT = 80;
const PREVIEW_MIN = 160; // 分栏拖拽时预览区至少保留的高度

interface ResizeGeometry {
  widthMin: number;
  widthMax: number;
  widthNow: number;
  splitMin: number;
  splitMax: number;
  splitNow: number;
}

type Tab = "files" | "changes";

function readWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    return Number.isFinite(v) ? Math.min(Math.max(v, MIN_WIDTH), MAX_STORED_WIDTH) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function readSplit(): number {
  try {
    const v = parseInt(localStorage.getItem(SPLIT_KEY) ?? "", 10);
    return Number.isFinite(v) && v > 0 ? Math.max(v, MIN_SPLIT) : 0; // 0 = 未设置,用默认 38%
  } catch {
    return 0;
  }
}

function persist(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    // 只丢持久化
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 工作区相对路径 → 绝对路径(Windows workdir 用反斜杠时统一分隔符);
 *  定位失败的兜底复制用它。rel 为空即工作区根。 */
function absPath(workdir: string, rel: string): string {
  if (!rel) return workdir;
  if (!workdir) return rel;
  const sep = workdir.includes("\\") ? "\\" : "/";
  const tail = sep === "\\" ? rel.split("/").join(sep) : rel;
  return workdir.endsWith(sep) ? workdir + tail : workdir + sep + tail;
}

export function FilesDrawer({
  sessionId,
  workdir = "",
  variant = "global",
  onClose,
  initialTab = "files",
  refreshToken = 0,
}: {
  sessionId: string;
  /** 会话工作目录:定位失败时兜底复制的绝对路径由它拼(缺省则只复制相对路径) */
  workdir?: string;
  /** pane = 格内 absolute(参照格 relative 根);global = 旧全局 fixed。 */
  variant?: "global" | "pane";
  onClose: () => void;
  /** 打开时落在哪个 tab(聊天区改动徽标可直达「改动」) */
  initialTab?: Tab;
  /** 改动列表刷新信号:调用方在轮次结束(ChatState.turnEnded)时自增 */
  refreshToken?: number;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(initialTab);
  // Tree 一旦挂上就**不再卸载**(见下面渲染处的注释:同位置三元会把展开层级
  // 与子项缓存全丢掉),但也不能一上来就挂——initialTab="changes"(点改动
  // 徽标直达)时树是看不见的,挂了就白发一次 repo_file_list。
  // 故:懒挂 + 常驻。首次切到「文件」页才挂,此后只切 display。
  const [treeMounted, setTreeMounted] = useState(initialTab !== "changes");
  useEffect(() => {
    if (tab !== "changes") setTreeMounted(true);
  }, [tab]);
  const [changes, setChanges] = useState<RepoChange[] | null>(null);
  const [isGitRepo, setIsGitRepo] = useState(true); // 未知先按 git 算,探测后收敛
  const [changesErr, setChangesErr] = useState("");
  const [preview, setPreview] = useState<PreviewModel | null>(null);
  const [width, setWidth] = useState(readWidth);
  const [split, setSplit] = useState(readSplit);
  const [draggingW, setDraggingW] = useState(false);
  const [draggingS, setDraggingS] = useState(false);
  const [resizeGeometry, setResizeGeometry] = useState<ResizeGeometry | null>(null);
  // 定位失败的兜底提示(成功无声——文件管理器窗口自己会跳出来)
  const [revealMsg, setRevealMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null); // 分栏拖拽的定位基准
  const reqRef = useRef(0); // 切文件/tab/关闭时使旧异步读取结果失效

  // 改动列表:挂载即拉;refreshToken(轮次结束)自增时重拉
  useEffect(() => {
    let alive = true;
    setChangesErr("");
    repoChanges(sessionId).then(
      (r) => {
        if (alive) {
          setChanges(r.changes);
          setIsGitRepo(r.isGitRepo);
        }
      },
      (e: unknown) => {
        if (alive) {
          setChanges([]);
          setChangesErr(errText(e));
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [sessionId, refreshToken]);

  // 非 git 工作区没有「改动」页;异步探测出 false 时从 changes 收敛回 files
  useEffect(() => {
    if (!isGitRepo && tab === "changes") {
      reqRef.current++;
      setPreview(null);
      setTab("files");
    }
  }, [isGitRepo, tab]);

  // Esc:抽屉挂载期间在全局层栈里占一层(escLayer 只有一条 window capture
  // 监听,后 push 的先拿到)。层内自己再分两级:预览开着先关预览,再一次
  // 才关抽屉——这是抽屉内部的语义,层栈管不到,所以留在这里。
  //
  // 为什么不再自己 addEventListener(2026-08-09 收口):同 target 同阶段按
  // 注册先后触发,而视图级 Esc 挂载即注册、浮层只在打开时注册,谁先吃掉这
  // 一下取决于挂载时序而非语义(见 escLayer 头注)。返回 true 即消费,
  // escLayer 会 preventDefault + stopImmediatePropagation —— 审批热键
  // (app/shortcuts.ts)挂 bubble 阶段,这一下就到不了它;esc = deny 不可逆,
  // 同一下按键绝不允许"关抽屉 + 拒绝审批"双消费。
  const previewOpenRef = useRef(false);
  previewOpenRef.current = preview !== null;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 稳定引用(useEscLayer 以 handler 身份为依赖):最新闭包经上面两个 ref 读
  const onEsc = useCallback(() => {
    if (previewOpenRef.current) {
      reqRef.current++;
      setPreview(null);
      return true;
    }
    onCloseRef.current();
    return true;
  }, []);
  useEscLayer(true, onEsc);

  const closePreview = () => {
    reqRef.current++;
    setPreview(null);
  };

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    closePreview();
    setTab(next);
  };

  const openFile = (entry: RepoEntry) => {
    const req = ++reqRef.current;
    setPreview({ path: entry.path, mode: "file", state: "loading", text: "" });
    repoReadFile(sessionId, entry.path).then(
      (content) => {
        if (req === reqRef.current) setPreview({ path: entry.path, mode: "file", state: "ready", text: content });
      },
      (e: unknown) => {
        if (req === reqRef.current) setPreview({ path: entry.path, mode: "file", state: "error", text: errText(e) });
      },
    );
  };

  const openDiff = (path: string) => {
    const req = ++reqRef.current;
    setPreview({ path, mode: "diff", state: "loading", text: "" });
    repoFileDiff(sessionId, path).then(
      (diff) => {
        if (req === reqRef.current) setPreview({ path, mode: "diff", state: "ready", text: diff });
      },
      (e: unknown) => {
        if (req === reqRef.current) setPreview({ path, mode: "diff", state: "error", text: errText(e) });
      },
    );
  };

  // 拖拽跟踪:mousedown 后接管 window 的 move/up,期间锁光标与选区。
  // WebKitGTK 与旧 WKWebView 只认带前缀的 user-select 写法,两个都写。
  //
  // ⚠️ 收尾必须**两条路都有**(2026-08-09):此前只挂在 mouseup 上,而
  // mouseup 并不保证会来——抽屉在按住把手期间被卸载(它自己的 Esc 就能关掉
  // 自己)、或鼠标拖出 webview 才松开,收尾便永远不执行。泄漏的不只是
  // window 上那两条监听:`document.body` 上的 `cursor: col-resize` 与
  // `user-select: none` 是**全局副作用**,留下就是整个应用从此选不中任何
  // 文字、光标恒为调宽箭头。现在收尾函数记进 ref,卸载 effect 兜底再调一次。
  const stopDragRef = useRef<(() => void) | null>(null);
  const trackPointer = (cursor: string, onMove: (ev: MouseEvent) => void, onDone: () => void) => {
    stopDragRef.current?.(); // 上一场没收干净就先收(正常路径下恒为 null)
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.body.style.setProperty("-webkit-user-select", "none");
    const finish = () => {
      if (stopDragRef.current !== finish) return; // 幂等:mouseup 与卸载兜底只生效一次
      stopDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.removeProperty("-webkit-user-select");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      onDone();
    };
    stopDragRef.current = finish;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finish);
  };
  // 卸载兜底:拖拽中途被卸载时把 window 监听与 body 全局样式收回来
  useEffect(() => () => stopDragRef.current?.(), []);

  /** pane 抽屉的坐标系是其定位父级（当前 ChatView 格），不能拿整个窗口算；
   * global 形态仍以 viewport 为界。jsdom/尚未布局时退回 viewport。 */
  const containingBounds = useCallback(() => {
    if (variant === "pane") {
      const rect = panelRef.current?.parentElement?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    }
    return {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }, [variant]);

  const widthLimits = useCallback(() => {
    const bounds = containingBounds();
    const max = Math.max(1, Math.round(bounds.width * (variant === "pane" ? 0.85 : 0.9)));
    // 窄 pane 里 CSS 的 max-w-[85%] 优先于桌面抽屉的 420px 常规下限。
    return { min: Math.min(MIN_WIDTH, max), max };
  }, [containingBounds, variant]);

  // 左缘拖拽调宽,松手落盘记忆
  const startWidthDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const bounds = containingBounds();
    const { min, max } = widthLimits();
    setDraggingW(true);
    trackPointer(
      "col-resize",
      (ev) => {
        setWidth(Math.min(Math.max(bounds.right - ev.clientX, min), max));
      },
      () => {
        setDraggingW(false);
        setWidth((w) => {
          persist(WIDTH_KEY, w);
          return w;
        });
      },
    );
  };

  const splitLimits = useCallback(() => {
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    const bounds = containingBounds();
    return { min: MIN_SPLIT, max: Math.max(bounds.bottom - top - PREVIEW_MIN, MIN_SPLIT), top };
  }, [containingBounds]);

  // separator 的 ARIA 数值必须描述当前 pane 的真实几何，而不是整个窗口或
  // localStorage 中尚未被 CSS max-width 夹取的目标值。ResizeObserver 让
  // 分屏拖动、内容增减和预览开合后都同步更新；layout effect 保证首帧发布
  // 给无障碍树前先完成一次测量。
  useLayoutEffect(() => {
    const sync = () => {
      const widthRange = widthLimits();
      const splitRange = splitLimits();
      const panelWidth = panelRef.current?.getBoundingClientRect().width || Math.min(Math.max(width, widthRange.min), widthRange.max);
      const measuredList = listRef.current?.getBoundingClientRect().height || split || splitRange.min;
      const naturalSplitMin = split > 0 ? splitRange.min : Math.min(splitRange.min, Math.max(1, Math.round(measuredList)));
      const next: ResizeGeometry = {
        widthMin: widthRange.min,
        widthMax: widthRange.max,
        widthNow: Math.min(Math.max(Math.round(panelWidth), widthRange.min), widthRange.max),
        splitMin: naturalSplitMin,
        splitMax: splitRange.max,
        splitNow: Math.min(Math.max(Math.round(measuredList), naturalSplitMin), splitRange.max),
      };
      setResizeGeometry((current) =>
        current && Object.keys(next).every((key) => current[key as keyof ResizeGeometry] === next[key as keyof ResizeGeometry])
          ? current
          : next,
      );
    };
    sync();
    const targets = [panelRef.current?.parentElement, panelRef.current, listRef.current].filter(
      (target): target is HTMLElement => target instanceof HTMLElement,
    );
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
    targets.forEach((target) => observer?.observe(target));
    window.addEventListener("resize", sync);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [preview, split, splitLimits, width, widthLimits]);

  // 列表/预览分栏拖拽:以列表顶为基准算高度,预览区至少保留 PREVIEW_MIN
  const startSplitDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const { min, max, top } = splitLimits();
    setDraggingS(true);
    trackPointer(
      "row-resize",
      (ev) => {
        setSplit(Math.min(Math.max(ev.clientY - top, min), max));
      },
      () => {
        setDraggingS(false);
        setSplit((h) => {
          persist(SPLIT_KEY, h);
          return h;
        });
      },
    );
  };

  const changeStatus = useMemo(() => new Map((changes ?? []).map((c) => [c.path, c.status] as const)), [changes]);
  const listDir = useCallback((dir: string) => repoListDir(sessionId, dir), [sessionId]);

  // 在系统文件管理器中定位(rel "" = 工作区根):壳内 open/explorer/xdg-open。
  // 失败兜底复制绝对路径——「打不开」时用户至少还能自己粘过去(旧 UI 同口径)。
  // 结果留在抽屉自己的提示行:抽屉是浮层,没有会话内的提示条可借
  const reveal = useCallback(
    async (rel: string) => {
      setRevealMsg(null);
      try {
        await repoReveal(sessionId, rel);
      } catch (e) {
        const p = absPath(workdir, rel);
        copyText(p);
        setRevealMsg({ text: t("files.revealFailed", { reason: errText(e), path: p }), error: true });
      }
    },
    [sessionId, workdir, t],
  );

  const markdownResources = useMemo(
    () => ({
      localImageUrl: (path: string) => {
        const rel = workspaceRelativePath(path, workdir);
        if (rel === null) return Promise.reject(new Error(t("chat.revealOutside")));
        return uploadFileURL(sessionId, rel);
      },
      onLocalLink: (path: string) => {
        const rel = workspaceRelativePath(path, workdir);
        if (rel === null) {
          setRevealMsg({ text: t("chat.revealOutside"), error: true });
          return;
        }
        void reveal(rel);
      },
    }),
    [reveal, sessionId, t, workdir],
  );

  // [scrollbar-gutter:stable]:LAYOUT §5——内容量可变的纵滚容器一律预留滚条
  // 槽位。chrome.css 的 `*{scrollbar-width:thin}` 在 Chromium(= Windows 的
  // WebView2)下吃 10px 布局宽,不留槽的话「展开目录让文件树越过面板高度」
  // 那一刻,右侧改动徽标与文件名截断位一起左移约 10px,折叠回去又跳回来。
  const SCROLL = "overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]";
  // 预览开着时列表让位:**拖过分栏**走显式高度(inline style,受 calc 上限
  // 护住预览可见区);**没拖过**则内容多高就多高、38% 只作上限(旧 UI
  // filesdrawer.tsx `flex:"none"` + `maxHeight:"38%"`,不写 height)。
  // 写死 h-[38%] 的后果:改动只有一两行、或根目录只有三五项时,上半区仍
  // 钉死占满 38%(600px 抽屉里约 230px)只放两行,余下一大片空白,diff 被
  // 白白挤进下面 62%。
  const listClass = preview
    ? `min-h-0 shrink-0 py-1 ${SCROLL} ${split > 0 ? "max-h-[calc(100%-190px)]" : "max-h-[38%]"}`
    : `min-h-0 flex-1 py-1 ${SCROLL}`;
  // 自绘窗框条(Windows/Linux)不入 z 层竞赛:抽屉整组(scrim + 面板)从窗框
  // 下缘起,结构性避让——三键与拖拽区恒可点,scrim 也不压暗窗框。高度读
  // --chrome-h(app.css,按 data-platform 落值),不在这儿手算平台偏移
  const TOP = "top-[var(--chrome-h)]";

  return (
    <>
      {/* pane 变体(2026-08-19 用户报障「云端在格内,本地为啥全局」):
          scrim/面板改 absolute 挂在格里(参照格的 relative 根),与云端
          CloudFiles 面板同构;global 形态留给整页 ChatView(壳内留档路径) */}
      <div
        aria-hidden
        className={variant === "pane" ? "absolute inset-0 z-10 bg-base-content/20" : `fixed ${TOP} inset-x-0 bottom-0 z-30 bg-base-content/20`}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        aria-label={t("files.label")}
        style={{ width }}
        className={
          variant === "pane"
            ? "absolute inset-y-0 right-0 z-20 flex max-w-[85%] flex-col border-l border-base-300 bg-base-100 shadow-xl"
            : `fixed ${TOP} right-0 bottom-0 z-40 flex max-w-[90vw] flex-col border-l border-base-300 bg-base-100 shadow-xl`
        }
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={resizeGeometry?.widthMin}
          aria-valuemax={resizeGeometry?.widthMax}
          aria-valuenow={resizeGeometry?.widthNow}
          tabIndex={0}
          title={t("files.resizeWidth")}
          onMouseDown={startWidthDrag}
          onKeyDown={(e) => {
            const delta = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
            if (delta === 0) return;
            e.preventDefault();
            e.stopPropagation();
            const { min, max } = widthLimits();
            const measured = panelRef.current?.getBoundingClientRect().width ?? 0;
            setWidth((current) => {
              // pane 缩窄后 CSS max-width 可能已把可见宽度夹到 state 以下；
              // 键盘必须从用户眼前的实际宽度起步，不能先空耗一次来归一化 state。
              const base = measured > 0 ? Math.min(Math.max(Math.round(measured), min), max) : Math.min(Math.max(current, min), max);
              const next = Math.min(Math.max(base + delta, min), max);
              persist(WIDTH_KEY, next);
              return next;
            });
          }}
          className={`absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset ${draggingW ? "bg-primary/40" : "hover:bg-primary/20 focus-visible:bg-primary/20"}`}
        />
        <header className="flex shrink-0 items-center gap-2 border-b border-base-300 pl-2 pr-2">
          <div role="tablist" className="tabs tabs-border">
            <button
              type="button"
              role="tab"
              className={`tab transition-colors duration-150 ${tab === "files" ? "tab-active" : ""}`}
              onClick={() => selectTab("files")}
            >
              {t("files.tab.files")}
            </button>
            {isGitRepo && (
              <button
                type="button"
                role="tab"
                className={`tab gap-1.5 transition-colors duration-150 ${tab === "changes" ? "tab-active" : ""}`}
                onClick={() => selectTab("changes")}
              >
                {t("files.tab.changes")}
                {changes && changes.length > 0 && <span className="badge badge-soft badge-primary badge-xs">{changes.length}</span>}
              </button>
            )}
          </div>
          {/* 工作区根定位:抽屉是「工作区资源管理器」,跳出去接着用系统
              文件管理器是它的份内出口(旧 UI 头部同款按钮) */}
          <button
            type="button"
            title={workdir || t("files.revealRoot")}
            onClick={() => void reveal("")}
            className="btn btn-ghost btn-xs ml-auto gap-1.5 text-base-content/70"
          >
            <IconFolderOpen size={13} stroke={1.75} aria-hidden />
            {isMacShell() ? t("files.revealRootMac") : t("files.revealRoot")}
          </button>
          <button
            type="button"
            aria-label={t("files.close")}
            title={t("files.close")}
            onClick={onClose}
            className="btn btn-ghost btn-square btn-xs"
          >
            <IconX size={14} stroke={1.75} aria-hidden />
          </button>
        </header>
        {changesErr && (
          <p role="alert" className="shrink-0 px-4 py-2 text-xs text-error">
            {changesErr}
          </p>
        )}
        {revealMsg && (
          <p role="alert" className="shrink-0 px-4 py-2 text-xs break-all text-error">
            {revealMsg.text}
          </p>
        )}
        <div ref={listRef} className={listClass} style={preview && split > 0 ? { height: split } : undefined}>
          {/* Tree **常驻挂载**、靠 display 切换,不做同位置三元。
              两个组件类型不同,摆在同一位置的三元里 React 必然卸载重建——
              而 Tree 的全部状态(子项缓存 / 展开集合 / loadedRef 去重)都在
              组件内,一卸载就全没:翻到 src/features/chat/cards/ 后去「改动」
              页看一眼 diff 再点回来,展开层级清零、回到只剩根目录一层(还闪
              一次骨架屏),并白白多发一次 repo_file_list。
              Tree.tsx:68 的注释「抽屉关闭整体卸载,重开自然是全新状态」在旧 UI
              的单组件结构里成立(tree/expanded 与 tab 同级),拆开后不成立了。
              Changes 是纯 props 投影、无内部状态,照旧条件渲染即可。 */}
          {tab === "changes" && <Changes changes={changes} activePath={preview?.path ?? null} onOpen={openDiff} />}
          {treeMounted && (
            <div className={tab === "changes" ? "hidden" : "contents"}>
              <Tree listDir={listDir} onOpenFile={openFile} activePath={preview?.path ?? null} changeStatus={changeStatus} />
            </div>
          )}
        </div>
        {preview && (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-valuemin={resizeGeometry?.splitMin}
              aria-valuemax={resizeGeometry?.splitMax}
              aria-valuenow={resizeGeometry?.splitNow}
              tabIndex={0}
              title={t("files.resizeSplit")}
              onMouseDown={startSplitDrag}
              onKeyDown={(e) => {
                const delta = e.key === "ArrowUp" ? -16 : e.key === "ArrowDown" ? 16 : 0;
                if (delta === 0) return;
                e.preventDefault();
                e.stopPropagation();
                const { min, max } = splitLimits();
                const measured = listRef.current?.getBoundingClientRect().height ?? 0;
                setSplit((current) => {
                  const base = current > 0 ? current : measured || Math.round(max * 0.38);
                  // 默认自适应高度可以低于拖拽模式的 80px 下限；此时 ArrowUp
                  // 已经没有向上的可调空间，不能反而把列表跳大到 80px。
                  if (current === 0 && e.key === "ArrowUp" && base <= min) return current;
                  const next = Math.min(Math.max(base + delta, min), max);
                  if (next === current) return current;
                  persist(SPLIT_KEY, next);
                  return next;
                });
              }}
              className={`h-1.5 shrink-0 cursor-row-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset ${draggingS ? "bg-primary/40" : "hover:bg-primary/20 focus-visible:bg-primary/20"}`}
            />
            <Preview
              model={preview}
              status={changeStatus.get(preview.path)}
              resources={markdownResources}
              onReveal={() => void reveal(preview.path)}
              onClose={closePreview}
            />
          </>
        )}
      </section>
    </>
  );
}
