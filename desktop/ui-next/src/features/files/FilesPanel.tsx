// 本地会话文件面板(2026-08-30 用户 mockup 定案,自 FilesDrawer 抽屉改造):
// 侧边栏「文件/变更」两个扁平 tab 的共同内容体——左列(文件树或变更列表,
// 可拖宽)+ 右区预览(未选中时占位空态)。浮层形态退役:scrim/fixed 定位/
// 整体宽度拖拽都上收到 SidePanel;tab 由侧边栏扁平 tab 控制(受控 prop)。
//
// - 数据面全部走 lib/ipc/repo(壳内 repo.rs 原生处理);改动列表挂载即拉,
//   refreshToken 自增(调用方在 ChatState.turnEnded 时递增)则重拉。
// - 非 git 工作区经 onRepoInfo 上报,由调用方隐藏「变更」tab(旧抽屉是
//   内部收敛,tab 上收后判定也跟着上收)。
// - Esc 只保留「关预览」一级(escLayer):面板已是常驻侧边栏而非浮层,
//   「关面板」不再吃 Esc——收起走 header 开合钮/侧边栏收起钮。
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { IconFolderOpen, IconRefresh } from "@tabler/icons-react";

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

const TREE_WIDTH_KEY = "mc.filesTreeWidth";
const TREE_MIN = 160;
const TREE_MAX = 480;
const TREE_DEFAULT = 224;

export type FilesPanelTab = "files" | "changes";

function readTreeWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(TREE_WIDTH_KEY) ?? "", 10);
    return Number.isFinite(v) ? Math.min(Math.max(v, TREE_MIN), TREE_MAX) : TREE_DEFAULT;
  } catch {
    return TREE_DEFAULT;
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

export function FilesPanel({
  sessionId,
  workdir = "",
  tab,
  refreshToken = 0,
  onRepoInfo,
}: {
  sessionId: string;
  /** 会话工作目录:定位失败时兜底复制的绝对路径由它拼(缺省则只复制相对路径) */
  workdir?: string;
  /** 「文件/变更」由侧边栏扁平 tab 控制(受控;切换时预览随之关闭)。 */
  tab: FilesPanelTab;
  /** 改动列表刷新信号:调用方在轮次结束(ChatState.turnEnded)时自增 */
  refreshToken?: number;
  /** 改动探测上报(挂载/刷新后):非 git 工作区调用方要把「变更」tab 收走。 */
  onRepoInfo?: (info: { isGitRepo: boolean; changesCount: number }) => void;
}) {
  const { t } = useI18n();
  // Tree 一旦挂上就**不再卸载**(同位置三元会把展开层级与子项缓存全丢掉),
  // 但也不能一上来就挂——落在「变更」tab 时树看不见,挂了就白发一次
  // repo_file_list。故:懒挂 + 常驻,首次切到「文件」页才挂,此后只切 display。
  const [treeMounted, setTreeMounted] = useState(tab !== "changes");
  useEffect(() => {
    if (tab !== "changes") setTreeMounted(true);
  }, [tab]);
  const [changes, setChanges] = useState<RepoChange[] | null>(null);
  const [changesErr, setChangesErr] = useState("");
  const [preview, setPreview] = useState<PreviewModel | null>(null);
  // 手动刷新信号(左列头刷新钮):树与改动一起重拉——改动徽标标在树行上,
  // 只刷一边另一边就是陈旧的(CloudFiles 刷新钮同一口径)
  const [manualRefresh, setManualRefresh] = useState(0);
  const [treeWidth, setTreeWidth] = useState(readTreeWidth);
  const [draggingTree, setDraggingTree] = useState(false);
  // 定位失败的兜底提示(成功无声——文件管理器窗口自己会跳出来)
  const [revealMsg, setRevealMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const reqRef = useRef(0); // 切文件/tab 时使旧异步读取结果失效
  const onRepoInfoRef = useRef(onRepoInfo);
  onRepoInfoRef.current = onRepoInfo;

  // 改动列表:挂载即拉;refreshToken(轮次结束)自增时重拉。isGitRepo 与
  // 计数上报给调用方(扁平 tab 的显隐/徽标住在侧边栏,不在本组件)
  useEffect(() => {
    let alive = true;
    setChangesErr("");
    repoChanges(sessionId).then(
      (r) => {
        if (!alive) return;
        setChanges(r.changes);
        onRepoInfoRef.current?.({ isGitRepo: r.isGitRepo, changesCount: r.changes.length });
      },
      (e: unknown) => {
        if (!alive) return;
        setChanges([]);
        setChangesErr(errText(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [sessionId, refreshToken, manualRefresh]);

  const closePreview = useCallback(() => {
    reqRef.current++;
    setPreview(null);
  }, []);

  // tab 由侧边栏控制:切换时旧预览随之关闭(文件正文与 diff 不共形)
  const prevTab = useRef(tab);
  useEffect(() => {
    if (prevTab.current !== tab) {
      prevTab.current = tab;
      closePreview();
    }
  }, [tab, closePreview]);

  // Esc 只保留「关预览」一级(escLayer 层栈,消费即截断——审批热键
  // esc=deny 不可逆,同一下按键绝不允许双消费);面板本身常驻,不吃 Esc
  const escPreview = useCallback(() => {
    reqRef.current++;
    setPreview(null);
    return true;
  }, []);
  useEscLayer(preview !== null, escPreview);

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

  // 拖拽跟踪(FilesDrawer::trackPointer 收尾纪律随迁):mousedown 后接管
  // window 的 move/up,期间锁光标与选区;收尾两条路都有——正常 mouseup
  // 之外,卸载兜底再收一次,否则 body 全局 cursor/user-select 永久留下
  const stopDragRef = useRef<(() => void) | null>(null);
  const trackPointer = (cursor: string, onMove: (ev: MouseEvent) => void, onDone: () => void) => {
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
      onDone();
    };
    stopDragRef.current = finish;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finish);
  };
  useEffect(() => () => stopDragRef.current?.(), []);

  const listStartRef = useRef<HTMLDivElement>(null);
  const startTreeDrag = (e: ReactMouseEvent) => {
    e.preventDefault();
    const left = listStartRef.current?.getBoundingClientRect().left ?? 0;
    setDraggingTree(true);
    trackPointer(
      "col-resize",
      (ev) => setTreeWidth(Math.min(Math.max(ev.clientX - left, TREE_MIN), TREE_MAX)),
      () => {
        setDraggingTree(false);
        setTreeWidth((w) => {
          try {
            localStorage.setItem(TREE_WIDTH_KEY, String(w));
          } catch {
            /* 只丢持久化 */
          }
          return w;
        });
      },
    );
  };

  const changeStatus = useMemo(() => new Map((changes ?? []).map((c) => [c.path, c.status] as const)), [changes]);
  const listDir = useCallback((dir: string) => repoListDir(sessionId, dir), [sessionId]);

  // 在系统文件管理器中定位(rel "" = 工作区根):壳内 open/explorer/xdg-open。
  // 失败兜底复制绝对路径——「打不开」时用户至少还能自己粘过去(旧 UI 同口径)
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
  // 槽位,免得展开目录让滚条挤入时右侧徽标/截断位左跳
  const SCROLL = "overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]";

  return (
    <section aria-label={t("files.label")} className="flex min-h-0 min-w-0 flex-1">
      {/* 左列:文件树/变更列表(拖宽把手在右缘) */}
      <div ref={listStartRef} style={{ width: treeWidth }} className="flex max-w-[60%] shrink-0 flex-col">
        <header className="flex h-9 shrink-0 items-center gap-1 border-b border-base-300 px-3">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-base-content/70">
            {tab === "changes" ? t("side.tab.changes") : t("files.treeTitle")}
          </span>
          {/* 刷新:树(已加载目录全量重拉,展开保留)与改动列表一起走 */}
          <button
            type="button"
            aria-label={t("files.refresh")}
            title={t("files.refresh")}
            onClick={() => setManualRefresh((n) => n + 1)}
            className="btn btn-ghost btn-square btn-xs text-base-content/60"
          >
            <IconRefresh size={13} stroke={1.75} aria-hidden />
          </button>
          {/* 工作区根定位:面板是「工作区资源管理器」,跳出去接着用系统
              文件管理器是它的份内出口 */}
          <button
            type="button"
            aria-label={isMacShell() ? t("files.revealRootMac") : t("files.revealRoot")}
            title={workdir || t("files.revealRoot")}
            onClick={() => void reveal("")}
            className="btn btn-ghost btn-square btn-xs text-base-content/60"
          >
            <IconFolderOpen size={13} stroke={1.75} aria-hidden />
          </button>
        </header>
        {changesErr && (
          <p role="alert" className="shrink-0 px-3 py-2 text-xs text-error">
            {changesErr}
          </p>
        )}
        {revealMsg && (
          <p role="alert" className="shrink-0 px-3 py-2 text-xs break-all text-error">
            {revealMsg.text}
          </p>
        )}
        <div className={`min-h-0 flex-1 py-1 ${SCROLL}`}>
          {/* Tree **常驻挂载**、靠 display 切换,不做同位置三元(卸载即丢
              展开层级与子项缓存,还白发一次 repo_file_list;Changes 是纯
              props 投影、无内部状态,照旧条件渲染) */}
          {tab === "changes" && <Changes changes={changes} activePath={preview?.path ?? null} onOpen={openDiff} />}
          {treeMounted && (
            <div className={tab === "changes" ? "hidden" : "contents"}>
              <Tree
                listDir={listDir}
                onOpenFile={openFile}
                activePath={preview?.path ?? null}
                changeStatus={changeStatus}
                refreshToken={manualRefresh}
              />
            </div>
          )}
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={TREE_MIN}
        aria-valuemax={TREE_MAX}
        aria-valuenow={Math.round(treeWidth)}
        tabIndex={0}
        title={t("files.resizeTree")}
        onMouseDown={startTreeDrag}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
          if (delta === 0) return;
          e.preventDefault();
          e.stopPropagation();
          setTreeWidth((w) => {
            const next = Math.min(Math.max(w + delta, TREE_MIN), TREE_MAX);
            try {
              localStorage.setItem(TREE_WIDTH_KEY, String(next));
            } catch {
              /* 只丢持久化 */
            }
            return next;
          });
        }}
        className={`relative z-10 -mx-0.5 w-1.5 shrink-0 cursor-col-resize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset ${
          draggingTree ? "bg-primary/40" : "hover:bg-primary/20 focus-visible:bg-primary/20"
        }`}
      >
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-base-300" />
      </div>
      {/* 右区:预览(mockup 空态「选择要预览的文件」) */}
      <div className="flex min-w-0 flex-1 flex-col">
        {preview ? (
          <Preview
            model={preview}
            status={changeStatus.get(preview.path)}
            resources={markdownResources}
            onReveal={() => void reveal(preview.path)}
            onClose={closePreview}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <p className="text-sm text-base-content/50">{t("files.preview.placeholder")}</p>
          </div>
        )}
      </div>
    </section>
  );
}
