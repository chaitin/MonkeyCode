// 文件抽屉共享件:右侧浮层(scrim + 面板)、文件/改动两个 tab、树形浏览、
// 下方预览三态(diff/code/plain)。原先 App.tsx(本地)与 cloudfiles.tsx(云端)
// 各持一份九成相同的实现、靠注释对表,现收敛于此;两侧数据协议同名
// (repo_file_list / repo_read_file / repo_file_diff / repo_file_changes),
// 载荷细节(base64 解码、超时参数、离线文案)与两侧的历史差异
// (调宽/分栏拖拽、目录改动计数、预览头扩展位)走 FsAdapter 与 props。
import { Fragment, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { basename } from "./chat";
import { CodeView, DiffPanel, MONO } from "./components";
import { IconChevronRight, IconDownload, IconFile, IconFolder, IconUpload, IconX } from "./icons";

/** 改动状态 → 普通用户可读的中文标签与配色(git 的 A/M/D 不外显)。
 * 云端词汇是本地(A/M/D)的超集,对齐 web/移动端:M/A/D/R/RM/?? */
export const CHANGE_KIND: Record<string, { text: string; fg: string; bg: string }> = {
  A: { text: "新增", fg: "var(--addT)", bg: "var(--addBg)" },
  "??": { text: "新增", fg: "var(--addT)", bg: "var(--addBg)" },
  M: { text: "修改", fg: "var(--warn)", bg: "var(--warnBg)" },
  D: { text: "删除", fg: "var(--delT)", bg: "var(--delBg)" },
  RM: { text: "删除", fg: "var(--delT)", bg: "var(--delBg)" },
  R: { text: "重命名", fg: "var(--warn)", bg: "var(--warnBg)" },
};

export const fmtSize = (n?: number) =>
  n == null ? "" : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + " MB" : n >= 1024 ? (n / 1024).toFixed(1) + " KB" : n + " B";

// ---- 文件抽屉的行/标签样式 ----
const fileRow: CSSProperties = {
  height: 32,
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "0 10px",
  borderRadius: 8,
  cursor: "pointer",
  minWidth: 0,
  flex: "none",
};
export const changeTag: CSSProperties = {
  flex: "none",
  fontSize: 10.5,
  fontWeight: 600,
  borderRadius: 9,
  padding: "2px 8px",
  lineHeight: 1.4,
};
const drawerTabStyle = (active: boolean): CSSProperties => ({
  border: "none",
  background: "transparent",
  height: 34,
  padding: "0 3px",
  marginBottom: -1, // 激活下划线压在头部 hairline 上
  borderBottom: `2px solid ${active ? "var(--acc)" : "transparent"}`,
  fontSize: 13,
  fontWeight: active ? 700 : 500,
  color: active ? "var(--t1)" : "var(--t5)",
  cursor: active ? "default" : "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
  flex: "none",
});

/** 归一化目录项(本地 FileEntry / 云端 CloudRepoFile 在适配层转换) */
export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
}

/** 归一化改动项(additions/deletions 仅云端有,有则展示 +N/-N) */
export interface FsChange {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
}

/** 数据适配层:两侧协议 kind 同名,差异(载荷编解码、超时参数、错误约定)收在这。
 * 约定:listDir 抛错 → 列表区错误行;readFile/diff 抛错 → 预览 "✗ …"。 */
export interface FsAdapter {
  listDir(dir: string): Promise<FsEntry[]>;
  /** 读文件全文({ plain } = 直接以纯文本态展示的提示,如云端超限文案) */
  readFile(entry: FsEntry): Promise<{ content: string } | { plain: string }>;
  /** diff 文本(空 diff 的"(无差异)"占位由适配层给) */
  diff(path: string): Promise<string>;
  /** diff 的加载中/出错占位用哪种视图渲染(历史行为:本地走 DiffPanel,云端走纯文本) */
  diffTransientKind: "diff" | "plain";
  /** 列表拉取成功后清除错误行(云端历史行为;本地保留错误) */
  clearErrOnListSuccess?: boolean;
  /** 上传能力(云端 VM 工作区;缺省无上传入口):把一批文件传到目录
   * (dir "" = 工作区根),抛错 → 错误行外显。完成后抽屉自行强刷该目录。 */
  upload?(dir: string, files: File[]): Promise<void>;
  /** 下载能力(缺省无下载入口):实现里弹保存对话框并把下载登记到全局
   * 下载管理(downloads.ts)即返回,进度/结果在右下角下载条外显,关抽屉
   * 不中断;目录由服务端打成 zip。返回 false = 用户取消保存;抛错 →
   * 错误行外显。 */
  download?(entry: FsEntry): Promise<boolean>;
}

export function FilesDrawer({
  adapter,
  onClose,
  initialTab = "files",
  changes,
  showChangesTab = true,
  externalErr,
  resizable,
  errPad,
  dirChangeBadges,
  emptyRootState,
  changesEmptyText,
  changesLoadingText,
  headerExtra,
  viewerExtra,
  viewerCloseTitle,
  escRef,
}: {
  adapter: FsAdapter;
  onClose: () => void;
  initialTab?: "files" | "changes";
  /** 改动列表(null = 未加载;数据归属在调用方——本地随会话轮次刷新) */
  changes: FsChange[] | null;
  /** 非 Git 工作区关闭此项，仅保留文件浏览。 */
  showChangesTab?: boolean;
  /** 适配层外部渠道的错误(本地: 改动查询失败;云端: 控制流放弃重连) */
  externalErr?: string;
  /** 抽屉宽度 + 列表/预览分栏可拖拽调整并记忆(本地;云端固定 600) */
  resizable?: boolean;
  /** 错误行内边距(两侧历史几何不同,原样保留) */
  errPad: string;
  /** 树中目录行显示其下改动计数「N 处改动」(本地) */
  dirChangeBadges?: boolean;
  /** 根目录为空时的整块空态(本地「工作区是空的」;缺省用「(空)」行) */
  emptyRootState?: ReactNode;
  changesEmptyText: string;
  /** changes 尚未加载(null)时的空态文案(云端「加载中…」;缺省同 changesEmptyText) */
  changesLoadingText?: string;
  /** 抽屉 header 的扩展动作位(本地:在系统文件管理器中打开工作区) */
  headerExtra?: ReactNode;
  /** 预览头部在路径与关闭钮之间的扩展位(本地:改动标签 + 文件管理器定位按钮) */
  viewerExtra?: (path: string) => ReactNode;
  viewerCloseTitle: string;
  /** Esc 处理挂点:预览打开时关预览并返回 true,否则返回 false(调用方关抽屉) */
  escRef?: MutableRefObject<(() => boolean) | null>;
}) {
  const [tab, setTab] = useState<"files" | "changes">(
    initialTab === "changes" && !showChangesTab ? "files" : initialTab,
  );
  // 树形浏览:目录 → 子项缓存("" = 工作区根),展开集合,按目录粒度的加载中标记
  const [tree, setTree] = useState<Map<string, FsEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [fsErr, setFsErr] = useState("");
  const [viewer, setViewer] = useState<{ path: string; kind: "diff" | "code" | "plain"; text: string } | null>(null);
  // 抽屉宽度可拖拽调整(记忆);拖动中置 dragging 显示把手强调色
  const [drawerW, setDrawerW] = useState(() => {
    if (!resizable) return 600;
    const v = parseInt(localStorage.getItem("mc.drawerWidth") ?? "", 10);
    return Number.isFinite(v) ? Math.min(Math.max(v, 420), 1200) : 600;
  });
  const [dragging, setDragging] = useState(false);
  // 列表/预览分栏高度(px;0 = 未设置,用默认 38%),同样可拖拽并记忆
  const [splitH, setSplitH] = useState(() => {
    if (!resizable) return 0;
    const v = parseInt(localStorage.getItem("mc.drawerSplit") ?? "", 10);
    return Number.isFinite(v) && v > 0 ? Math.max(v, 80) : 0;
  });
  const [splitDragging, setSplitDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null); // 分栏拖拽的定位基准
  const previewRequest = useRef(0); // 切文件/Tab/关闭时使旧异步读取结果失效

  // 适配层经 ref 转接:调用方每次渲染的新对象不搅动 mount effect
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const closeViewer = () => {
    previewRequest.current++;
    setViewer(null);
  };
  const selectTab = (next: "files" | "changes") => {
    if (next === tab || (next === "changes" && !showChangesTab)) return;
    closeViewer();
    setTab(next);
  };

  // Git 状态异步探测完成后，非 Git 工作区可能从“未知”变为 false。
  useEffect(() => {
    if (showChangesTab || tab !== "changes") return;
    previewRequest.current++;
    setViewer(null);
    setTab("files");
  }, [showChangesTab, tab]);

  // Esc 挂点:先关预览再关抽屉(闭包取最新 viewer,卸载时清挂点)
  if (escRef)
    escRef.current = () => {
      if (viewer) {
        closeViewer();
        return true;
      }
      return false;
    };
  useEffect(
    () => () => {
      if (escRef) escRef.current = null;
    },
    [escRef],
  );

  // 拉取目录子项(空串 = 工作区根);已缓存/在途则跳过。
  // force:挂载时的根目录拉取无条件发起——StrictMode 的双重挂载会让首次
  // 调用作废(云端侧连接随首轮 cleanup 关闭),在途守卫不能挡住第二次
  const loadChildren = async (dir: string, force = false) => {
    if (!force && (tree.has(dir) || loadingDirs.has(dir))) return;
    setLoadingDirs((s) => new Set(s).add(dir));
    try {
      const items = await adapterRef.current.listDir(dir);
      setTree((m) => new Map(m).set(dir, items));
      if (adapterRef.current.clearErrOnListSuccess) setFsErr("");
    } catch (e) {
      setFsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDirs((s) => {
        const n = new Set(s);
        n.delete(dir);
        return n;
      });
    }
  };

  // 打开即拉根目录(抽屉关闭时整体卸载,重开自然是全新状态)
  useEffect(() => {
    void loadChildren("", true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 上传(adapter.upload 存在才有入口):header 传根目录,目录行悬停
  // 按钮传该目录;完成后强刷目标目录并展开让结果可见 =====
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef(""); // 点击入口时锁定的目标目录(input 异步回调里读)
  const [uploadingTo, setUploadingTo] = useState<string | null>(null);
  const canUpload = !!adapter.upload;
  const pickUpload = (dir: string) => {
    if (uploadingTo !== null) return; // 一次一批,避免并发写同目录交错
    uploadDirRef.current = dir;
    uploadInputRef.current?.click();
  };
  const onUploadPicked = async (files: File[]) => {
    const dir = uploadDirRef.current;
    if (!files.length || !adapterRef.current.upload) return;
    setUploadingTo(dir);
    try {
      await adapterRef.current.upload(dir, files);
      setFsErr("");
    } catch (e) {
      // 批量顺序上传中途失败:已传上去的部分随下方强刷可见,不算静默
      setFsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingTo(null);
    }
    if (dir) setExpanded((s) => new Set(s).add(dir));
    await loadChildren(dir, true);
  };

  // ===== 下载(adapter.download 存在才有入口):行悬停按钮。spinner 只盖
  // "保存对话框 + 登记"阶段,落盘进度在全局下载条;守卫防同时开两个对话框 =====
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const canDownload = !!adapter.download;
  const startDownload = async (en: FsEntry) => {
    if (downloadingPath !== null || !adapterRef.current.download) return;
    setDownloadingPath(en.path);
    try {
      await adapterRef.current.download(en);
      setFsErr("");
    } catch (e) {
      setFsErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloadingPath(null);
    }
  };

  // 展开/收起文件夹(展开时懒加载子项,已缓存的即时展开)
  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        void loadChildren(dir);
      }
      return next;
    });
  };

  const showDiff = async (path: string) => {
    const request = ++previewRequest.current;
    setViewer({ path, kind: adapter.diffTransientKind, text: "加载中…" });
    try {
      const text = await adapterRef.current.diff(path);
      if (request === previewRequest.current) setViewer({ path, kind: "diff", text });
    } catch (e) {
      if (request === previewRequest.current) {
        setViewer({ path, kind: adapterRef.current.diffTransientKind, text: "✗ " + (e instanceof Error ? e.message : e) });
      }
    }
  };

  const showFile = async (en: FsEntry) => {
    const request = ++previewRequest.current;
    setViewer({ path: en.path, kind: "plain", text: "加载中…" });
    try {
      const r = await adapterRef.current.readFile(en);
      if (request !== previewRequest.current) return;
      if ("plain" in r) {
        setViewer({ path: en.path, kind: "plain", text: r.plain });
        return;
      }
      const content = r.content;
      if (!content) setViewer({ path: en.path, kind: "plain", text: "(空文件)" });
      else if (content.includes("\0")) setViewer({ path: en.path, kind: "plain", text: "二进制文件,不支持预览" });
      else setViewer({ path: en.path, kind: "code", text: content });
    } catch (e) {
      if (request === previewRequest.current) {
        setViewer({ path: en.path, kind: "plain", text: "✗ " + (e instanceof Error ? e.message : e) });
      }
    }
  };

  // 拖拽跟踪:mousedown 后接管 move/up,期间锁定光标与选区,松手时收尾
  // WebKitGTK(Linux 宿主)与旧 WKWebView 都只认带前缀的写法,实测无前缀声明
  // 会被整条丢弃(computed 值仍是 text),锁不住选区——两个都写。
  const trackPointer = (cursor: string, onMove: (ev: MouseEvent) => void, onDone: () => void) => {
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.body.style.setProperty("-webkit-user-select", "none");
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.body.style.removeProperty("-webkit-user-select");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      onDone();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 抽屉左缘拖拽调宽,松手落盘记忆
  const startDrawerResize = (e: { preventDefault(): void }) => {
    e.preventDefault();
    setDragging(true);
    trackPointer(
      "col-resize",
      (ev) => {
        const max = Math.round(window.innerWidth * 0.9);
        setDrawerW(Math.min(Math.max(window.innerWidth - ev.clientX, 420), max));
      },
      () => {
        setDragging(false);
        setDrawerW((w) => {
          localStorage.setItem("mc.drawerWidth", String(w));
          return w;
        });
      },
    );
  };

  // 列表/预览分栏拖拽:以列表顶为基准算高度,预览区至少保留 160px
  const startSplitResize = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const top = listRef.current?.getBoundingClientRect().top ?? 0;
    setSplitDragging(true);
    trackPointer(
      "row-resize",
      (ev) => {
        const max = Math.max(window.innerHeight - top - 160, 80);
        setSplitH(Math.min(Math.max(ev.clientY - top, 80), max));
      },
      () => {
        setSplitDragging(false);
        setSplitH((h) => {
          localStorage.setItem("mc.drawerSplit", String(h));
          return h;
        });
      },
    );
  };

  // 改动标注:路径 → 状态;目录行显示其下改动计数
  const changeMap = new Map((changes ?? []).map((c) => [c.path, c.status] as const));
  const changedUnder = (dir: string) => (changes ?? []).filter((c) => c.path.startsWith(dir + "/")).length;
  const viewerSt = viewer ? changeMap.get(viewer.path) : undefined;
  const viewerKind = viewerSt ? CHANGE_KIND[viewerSt] : undefined;

  // 树形文件列表:展开的文件夹原地铺开子项,层级用缩进表达(每层 16px)。
  // 已删除文件只属于“改动”页；文件页仅展示当前真实存在的文件。
  const renderTree = (dir: string, depth: number): ReactNode[] => {
    const pad = 10 + depth * 16;
    const rows: ReactNode[] = [];
    const items = tree.get(dir);
    if (!items) {
      if (loadingDirs.has(dir)) {
        for (let i = 0; i < (dir === "" ? 4 : 1); i++) {
          rows.push(
            <div key={`ld:${dir}:${i}`} style={{ ...fileRow, cursor: "default", paddingLeft: pad + 21 }}>
              <span className="skeleton" style={{ width: 14, height: 14, borderRadius: 4 }} />
              <span className="skeleton" style={{ height: 10, width: 110 + (i % 3) * 52 }} />
            </div>,
          );
        }
      }
      return rows;
    }
    for (const en of items) {
      const st = en.isDir ? undefined : changeMap.get(en.path);
      const kind = st ? CHANGE_KIND[st] : undefined;
      const subCount = en.isDir && dirChangeBadges ? changedUnder(en.path) : 0;
      const open = en.isDir && expanded.has(en.path);
      const active = viewer?.path === en.path;
      const rowUpload = en.isDir && canUpload;
      const rowActs = rowUpload || canDownload;
      rows.push(
        <div
          key={en.path}
          className={[active ? "" : "hv", rowActs ? "hrow" : ""].filter(Boolean).join(" ") || undefined}
          title={en.path}
          onClick={() => (en.isDir ? toggleDir(en.path) : void showFile(en))}
          style={{ ...fileRow, paddingLeft: pad, background: active ? "var(--hov)" : "transparent" }}
        >
          <span style={{ width: 12, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {en.isDir && (
              <IconChevronRight
                size={8}
                color="var(--t5)"
                style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease" }}
              />
            )}
          </span>
          {en.isDir ? <IconFolder size={14} color="var(--accTx)" /> : <IconFile color={kind ? kind.fg : "var(--t4)"} />}
          <span className="ellipsis" style={{ flex: 1, fontSize: 12.5, color: "var(--t1)" }}>
            {en.name}
          </span>
          {en.isDir && subCount > 0 && (
            <span style={{ ...changeTag, color: "var(--accTx)", background: "var(--accBg)" }}>{subCount} 处改动</span>
          )}
          {rowUpload && (
            <button
              // 上传中 spinner 要常显,不能被 row-acts 的悬停显隐藏掉
              className={"hv2 icon-btn" + (uploadingTo === en.path ? "" : " row-acts")}
              title={`上传文件到 ${en.name}/`}
              onClick={(e) => {
                e.stopPropagation(); // 别顺手展开/收起目录
                pickUpload(en.path);
              }}
              style={{ width: 22, height: 22, flex: "none" }}
            >
              {uploadingTo === en.path ? (
                <span className="spinner" style={{ width: 10, height: 10 }} />
              ) : (
                <IconUpload size={11} color="var(--t4)" />
              )}
            </button>
          )}
          {canDownload && (
            <button
              // 同上:下载中 spinner 常显
              className={"hv2 icon-btn" + (downloadingPath === en.path ? "" : " row-acts")}
              title={en.isDir ? `下载 ${en.name}/(打包为 zip)` : `下载 ${en.name}`}
              onClick={(e) => {
                e.stopPropagation(); // 别顺手展开目录/打开预览
                void startDownload(en);
              }}
              style={{ width: 22, height: 22, flex: "none" }}
            >
              {downloadingPath === en.path ? (
                <span className="spinner" style={{ width: 10, height: 10 }} />
              ) : (
                <IconDownload size={11} color="var(--t4)" />
              )}
            </button>
          )}
          {!en.isDir && kind && <span style={{ ...changeTag, color: kind.fg, background: kind.bg }}>{kind.text}</span>}
          {!en.isDir && !kind && (
            <span style={{ flex: "none", width: 60, textAlign: "right", font: "10.5px " + MONO, color: "var(--t6)" }}>
              {fmtSize(en.size)}
            </span>
          )}
        </div>,
      );
      if (open) rows.push(...renderTree(en.path, depth + 1));
    }
    if (items.length === 0) {
      if (dir === "" && emptyRootState) {
        rows.push(<Fragment key="empty-root">{emptyRootState}</Fragment>);
      } else {
        rows.push(
          <div key={"empty:" + dir} style={{ ...fileRow, cursor: "default", paddingLeft: pad + 21 }}>
            <span style={{ fontSize: 11.5, color: "var(--t6)" }}>(空)</span>
          </div>,
        );
      }
    }
    return rows;
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "var(--scrim)", zIndex: 35 }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: drawerW,
          maxWidth: "90vw",
          background: "var(--pop)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow)",
          zIndex: 36,
          display: "flex",
          flexDirection: "column",
          animation: "mcslide .22s ease",
        }}
      >
        {resizable && (
          <div className={dragging ? "resize-handle dragging" : "resize-handle"} title="拖动调整宽度" onMouseDown={startDrawerResize} />
        )}
        {/* 头部:文件/改动下划线 tab(共用下方预览窗格),hairline 与主体分层 */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, padding: "6px 14px 0 20px", borderBottom: "1px solid var(--line2)", flex: "none", whiteSpace: "nowrap" }}>
          <button className={tab === "files" ? undefined : "hv-t1"} style={drawerTabStyle(tab === "files")} onClick={() => selectTab("files")}>
            文件
          </button>
          {showChangesTab && (
            <button className={tab === "changes" ? undefined : "hv-t1"} style={drawerTabStyle(tab === "changes")} onClick={() => selectTab("changes")}>
              改动
              {changes && changes.length > 0 && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accTx)", background: "var(--accBg)", borderRadius: 8, padding: "0 6px", lineHeight: "15px" }}>
                  {changes.length}
                </span>
              )}
            </button>
          )}
          <span style={{ marginLeft: "auto", alignSelf: "center", display: "flex", alignItems: "center", gap: 4 }}>
            {canUpload && tab === "files" && (
              <button
                className="hv2 icon-btn"
                title="上传文件到工作区根目录(目录行悬停可传到该目录)"
                onClick={() => pickUpload("")}
                style={{ width: 24, height: 24 }}
              >
                {uploadingTo !== null ? (
                  <span className="spinner" style={{ width: 11, height: 11 }} />
                ) : (
                  <IconUpload size={12} color="var(--t4)" />
                )}
              </button>
            )}
            {headerExtra}
            <button className="hv2 icon-btn" title="关闭 (esc)" onClick={onClose} style={{ width: 24, height: 24 }}>
              <IconX size={11} color="var(--t4)" />
            </button>
          </span>
        </div>
        {canUpload && (
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = ""; // 允许重复选同一文件
              void onUploadPicked(files);
            }}
          />
        )}

        {(fsErr || externalErr) && (
          <div style={{ padding: errPad, fontSize: 12, color: "var(--err)", flex: "none" }}>{fsErr || externalErr}</div>
        )}

        {/* 文件树 / 改动平铺:查看器打开时列表收拢为上方窗口 */}
        <div
          ref={listRef}
          style={{
            flex: viewer ? "none" : 1,
            height: viewer && splitH ? splitH : undefined,
            maxHeight: viewer ? (splitH ? "calc(100% - 190px)" : "38%") : undefined,
            overflowY: "auto",
            padding: "6px 12px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          {tab === "changes" ? (
            <>
              {[...(changes ?? [])]
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((c) => {
                  const kind = CHANGE_KIND[c.status] ?? { text: c.status, fg: "var(--t4)", bg: "var(--hov)" };
                  const sep = c.path.lastIndexOf("/");
                  const dir = sep > 0 ? c.path.slice(0, sep) : "";
                  const active = viewer?.path === c.path;
                  return (
                    <div
                      key={c.path}
                      className={active ? undefined : "hv"}
                      title={c.path}
                      onClick={() => void showDiff(c.path)}
                      style={{ ...fileRow, background: active ? "var(--hov)" : "transparent" }}
                    >
                      <IconFile color={kind.fg} />
                      <span
                        style={{
                          flex: "none",
                          fontSize: 12.5,
                          color: c.status === "D" ? "var(--t5)" : "var(--t1)",
                          textDecoration: c.status === "D" ? "line-through" : "none",
                        }}
                      >
                        {basename(c.path)}
                      </span>
                      <span className="ellipsis" style={{ flex: 1, fontSize: 11, fontFamily: MONO, color: "var(--t5)" }}>
                        {dir}
                      </span>
                      {(c.additions ?? 0) > 0 && <span style={{ flex: "none", fontSize: 11, color: "var(--addT)" }}>+{c.additions}</span>}
                      {(c.deletions ?? 0) > 0 && <span style={{ flex: "none", fontSize: 11, color: "var(--delT)" }}>-{c.deletions}</span>}
                      <span style={{ ...changeTag, color: kind.fg, background: kind.bg }}>{kind.text}</span>
                    </div>
                  );
                })}
              {(changes ?? []).length === 0 && (
                <div style={{ padding: "36px 0 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
                  <IconFile size={22} color="var(--t6)" />
                  <span style={{ fontSize: 12, color: "var(--t5)" }}>
                    {changes ? changesEmptyText : changesLoadingText ?? changesEmptyText}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>{renderTree("", 0)}</>
          )}
        </div>

        {/* 文件查看器:文件页看当前内容，改动页看 diff；✕/esc 回到列表 */}
        {viewer && (
          <>
            {resizable && (
              <div
                className={splitDragging ? "resize-handle-h dragging" : "resize-handle-h"}
                title="拖动调整列表/预览高度"
                onMouseDown={startSplitResize}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px 9px 20px", borderTop: "1px solid var(--line2)", background: "var(--bg)", flex: "none", whiteSpace: "nowrap", overflow: "hidden" }}>
              <IconFile color={viewerKind?.fg ?? "var(--t4)"} />
              <span style={{ font: "600 12.5px " + MONO, color: "var(--t1)", flex: "none" }}>{basename(viewer.path)}</span>
              <span className="ellipsis" style={{ fontSize: 11, fontFamily: MONO, color: "var(--t5)" }}>{viewer.path}</span>
              {viewerExtra?.(viewer.path)}
              <button
                className="hv2 icon-btn"
                title={viewerCloseTitle}
                onClick={closeViewer}
                style={{ marginLeft: viewerExtra ? undefined : "auto", width: 22, height: 22 }}
              >
                <IconX size={10} color="var(--t4)" />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 20px" }}>
              {viewer.kind === "diff" ? (
                <DiffPanel text={viewer.text} />
              ) : viewer.kind === "code" ? (
                <CodeView path={viewer.path} text={viewer.text} />
              ) : (
                <pre style={{ margin: 0, padding: "10px 24px", font: "12px/1.9 " + MONO, color: "var(--t4)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {viewer.text}
                </pre>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
