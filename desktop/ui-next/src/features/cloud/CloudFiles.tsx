// 云端任务文件页:经控制流(Control WS 内核代理)浏览 VM 工作区
// (repo_file_list / repo_read_file / repo_file_changes / repo_file_diff,与
// web 控制台 task-file-explorer 同一套 kind 与字段),上传走 REST
// mc_file_upload、下载走全局下载 store(startDownload,内含 dl-progress 先
// 监听后命令的铁律;目录由服务端打成 zip)。
// 文件/变动双 tab 与本地 FilesDrawer 同构(Changes/Preview 组件直接复用,
// additions/deletions 云端超集字段有则展示);变动挂载拉一次,刷新钮与
// 上传落地后重拉。控制流优先向宿主借常驻那条(borrowControl;后端每条控制
// 连接都会另起一份 TaskLive 上游订阅),借不到才自建 + call() 懒重连:
// 连不上时不无限拨号刷屏,操作时再试。
import { IconDownload, IconFolder, IconFolderOpen, IconFolderUp, IconRefresh, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Changes, type ChangeItem } from "@/features/files/Changes";
import { fileIconOf } from "@/features/files/fileIcon";
import { Preview, type PreviewModel } from "@/features/files/Preview";
import { connectCloudControl, WAKE_CALL_TIMEOUT_MS, type CloudControl } from "@/lib/cloud/control";
import { useI18n } from "@/lib/i18n";
import { mcFileUpload, pickSaveFile, readFileBase64 } from "@/lib/ipc/cloudtasks";
import { startDownload } from "@/lib/ipc/downloads";
import { b64decode } from "@/lib/protocol/codec";
import { useEscLayer } from "@/lib/util/escLayer";

/** repo_file_list 条目;entry_mode 4=目录 5=子模块(对齐 web task-shared.ts)。 */
export interface CloudRepoFile {
  name: string;
  path: string;
  entry_mode: number;
  size?: number;
  modified_at?: number;
}

const isDir = (f: CloudRepoFile) => f.entry_mode === 4 || f.entry_mode === 5;

type Tab = "files" | "changes";

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 上传上限 10MB(对齐 web 控制台文件树)

/** 预览读取上限 1MB(对齐 web/mobile 与旧 UI cloudfiles.tsx:17)。超限不请求:
 * 整包 base64 要穿两层(云端 → 控制流 → WebView),大文件预览既慢又没用。 */
const MAX_PREVIEW_SIZE = 1 << 20;

/** 借控制流:宿主没给就自建一条,release 负责收尾(自建才真关)。 */
type Borrowed = { ctrl: CloudControl; release: () => void };

const ownControl = (taskId: string): Borrowed => {
  const ctrl = connectCloudControl(taskId);
  return { ctrl, release: () => ctrl.close() };
};

/** 树内相对路径 → VM 内绝对路径(与 web 同一约定:工作区固定挂 /workspace)。 */
const vmPath = (rel: string) => "/workspace" + (rel ? "/" + rel : "");

export function fmtSize(size?: number): string {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function CloudFiles({
  taskId,
  vmId,
  onClose,
  borrowControl,
}: {
  taskId: string;
  /** 任务 VM id(REST 上传/下载按它寻址);空 = 无上传/下载入口(VM 未就绪/已结束) */
  vmId?: string;
  onClose?: () => void;
  /** 向宿主借控制流(CloudTaskView 给的是常驻那条;测试注入假的)。
   * 缺省自建一条并在卸载时关掉——独立使用/结束态仍然成立。 */
  borrowControl?: () => Borrowed;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("files");
  const [dir, setDir] = useState(""); // 当前目录(相对工作区;"" = 根)
  const [files, setFiles] = useState<CloudRepoFile[] | null>(null);
  const [changes, setChanges] = useState<ChangeItem[] | null>(null); // null = 加载中
  const [preview, setPreview] = useState<PreviewModel | null>(null); // 文件正文 / diff 预览
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const heldRef = useRef<Borrowed | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reqRef = useRef(0); // 切文件/tab 时使旧异步读取/diff 结果失效
  const borrowRef = useRef(borrowControl);
  borrowRef.current = borrowControl;

  // 控制流惰性借用;卸载即归还(自建的那条真关,云端据此开始空闲倒计时;
  // 借来的常驻连接不能关——那是宿主的保活与唤醒通道)。
  //
  // **每次都校验 closed,不能用 `??=` 一次缓存到卸载**:借来的那条是宿主
  // (useCloudTask)自己的常驻控制流,宿主的 effect 依赖 [id, ended, vmId],
  // 任务一结束(finished/error,10s 轮询或 onEnded 驱动)cleanup 就 close() 它。
  // 而 CloudControl 一旦 closed 就**不可复活**:call() 一律 reject "closed",
  // revive() 也被挡死。攥着不放的结果是——正跑着的任务开着「云端文件」看产出,
  // 任务一跑完,点刷新/进目录/点文件全部清空 + 红条「连接已关闭」,恰好是最
  // 想翻产出的那一刻。而结束态本该照常可看快照(commit ec0bd419「文件浏览按
  // taskId 走控制流,不再拿 vmId 当门槛(结束态可看快照)」)。
  // 死了就重借一条:宿主 ended 后 borrowControl 不再给常驻连接,自然回落
  // ownControl(taskId) 自建一条只读快照通道。
  const ensureCtrl = () => {
    const held = heldRef.current;
    if (held && !held.ctrl.isClosed()) return held.ctrl;
    held?.release();
    const next = borrowRef.current?.() ?? ownControl(taskId);
    heldRef.current = next;
    return next.ctrl;
  };
  useEffect(
    () => () => {
      heldRef.current?.release();
      heldRef.current = null;
    },
    [taskId],
  );

  // 控制流 call 默认 15s 超时,但拨号会触发休眠 VM 唤醒(以分钟计):
  // 全部调用给足唤醒余量,免得唤醒期间必然超时
  const wakeOpts = { timeoutMs: WAKE_CALL_TIMEOUT_MS, timeoutMsg: t("cloud.ctl.wakeTimeout") };

  const list = (target: string) => {
    setFiles(null);
    setErr("");
    ensureCtrl()
      .call<{ files?: CloudRepoFile[] }>(
        "repo_file_list",
        { path: target, glob_pattern: "*", include_hidden: true },
        wakeOpts,
      )
      .then((r) => {
        setFiles(
          (r.files ?? [])
            .filter((f) => f.name !== ".git")
            .sort((a, b) => (isDir(b) ? 1 : 0) - (isDir(a) ? 1 : 0) || a.name.localeCompare(b.name)),
        );
      })
      .catch((e: unknown) => {
        setFiles([]);
        setErr(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    list(dir);
    // list 依赖的 ensureCtrl/t 均稳定;dir/taskId 变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, taskId]);

  // 变动列表:挂载即拉(tab 徽标计数要它;与列目录同一条 WS,无额外唤醒
  // 成本),刷新钮/上传落地后重拉;失败降级空列表 + 错误条外显
  const loadChanges = () => {
    setChanges(null);
    ensureCtrl()
      .call<{ changes?: ChangeItem[] }>("repo_file_changes", {}, wakeOpts)
      .then((r) => setChanges(r.changes ?? []))
      .catch((e: unknown) => {
        setChanges([]);
        setErr(e instanceof Error ? e.message : String(e));
      });
  };
  useEffect(() => {
    loadChanges();
    // 同上:依赖均稳定,taskId 变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const closePreview = () => {
    reqRef.current++;
    setPreview(null);
  };

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    closePreview();
    setTab(next);
  };

  const openDiff = (path: string) => {
    const req = ++reqRef.current;
    setPreview({ path, mode: "diff", state: "loading", text: "" });
    ensureCtrl()
      .call<{ diff?: string }>("repo_file_diff", { path, unified: true, context_lines: 20 }, wakeOpts)
      .then((r) => {
        if (req === reqRef.current) setPreview({ path, mode: "diff", state: "ready", text: r.diff ?? "" });
      })
      .catch((e: unknown) => {
        if (req === reqRef.current) setPreview({ path, mode: "diff", state: "error", text: e instanceof Error ? e.message : String(e) });
      });
  };

  /** 点文件行看正文(repo_read_file;content 是 []byte,JSON 里即 base64)。
   * 超限文件不发请求,直接给一句人话——整包要穿云端 → 控制流 → WebView
   * 两层,大文件既慢又没意义(旧 UI cloudfiles.tsx:83-90 同一口径)。 */
  const openFile = (f: CloudRepoFile) => {
    const req = ++reqRef.current;
    const path = f.path;
    if ((f.size ?? 0) > MAX_PREVIEW_SIZE) {
      setPreview({ path, mode: "file", state: "error", text: t("cloud.files.previewTooLarge", { size: fmtSize(f.size) }) });
      return;
    }
    setPreview({ path, mode: "file", state: "loading", text: "" });
    ensureCtrl()
      .call<{ content?: string }>("repo_read_file", { path, offset: 0, length: MAX_PREVIEW_SIZE }, wakeOpts)
      .then((r) => {
        if (req === reqRef.current) setPreview({ path, mode: "file", state: "ready", text: r.content ? b64decode(r.content) : "" });
      })
      .catch((e: unknown) => {
        if (req === reqRef.current) setPreview({ path, mode: "file", state: "error", text: e instanceof Error ? e.message : String(e) });
      });
  };

  // Esc 走 escLayer 层栈:预览是比「文件面板」更晚打开的一层,后进先出天然
  // 归它,消费即截断——CloudTaskView 那层负责关整个面板,审批热键(esc =
  // 不可逆的拒绝)在冒泡阶段,一下按键绝不能双消费
  const escPreview = useCallback(() => {
    reqRef.current++;
    setPreview(null);
    return true;
  }, []);
  useEscLayer(preview !== null, escPreview);

  const download = async (f: CloudRepoFile) => {
    if (!vmId) return;
    const filename = isDir(f) ? f.name + ".zip" : f.name;
    const dest = await pickSaveFile(filename);
    if (!dest) return; // 用户取消
    // 登记到全局下载条即返回:进度/结果在下载 dock 外显,关页面不中断
    void startDownload({ vmId, path: vmPath(f.path), filename, dest });
  };

  const upload = async (picked: File[]) => {
    if (!vmId || picked.length === 0) return;
    setUploading(true);
    setErr("");
    try {
      // 顺序进行、失败即止:已传成功的部分随刷新可见
      for (const f of picked) {
        if (f.size === 0) throw new Error(t("cloud.files.uploadEmpty", { name: f.name }));
        if (f.size > MAX_UPLOAD_SIZE) throw new Error(t("cloud.files.uploadTooLarge", { name: f.name }));
        const b64 = await readFileBase64(f);
        await mcFileUpload(vmId, vmPath(dir ? dir + "/" + f.name : f.name), b64);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      list(dir);
      loadChanges(); // 上传即产生改动,变动列表同步刷新
    }
  };

  const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";

  // 预览打开后列表/预览上下分栏(与本地 FilesDrawer 同构,免拖拽版:
  // 列表**内容高、38% 只作上限**,预览吃剩余)。写死 h-[38%] 会让只有三五
  // 个文件的目录也钉满 38% 高、余下一片空白(与 FilesDrawer 同款修正)。
  // [scrollbar-gutter:stable] 见 LAYOUT §5(内容量可变的纵滚容器留槽位)。
  const listClass = preview
    ? "min-h-0 max-h-[38%] shrink-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] p-1"
    : "min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] p-1";

  return (
    <section aria-label={t("cloud.files.title")} className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 px-2">
        {/* 文件/变动双 tab(与本地 FilesDrawer 同形态);变动带计数徽标 */}
        <div role="tablist" className="tabs tabs-border shrink-0">
          <button
            type="button"
            role="tab"
            className={`tab transition-colors duration-150 ${tab === "files" ? "tab-active" : ""}`}
            onClick={() => selectTab("files")}
          >
            {t("files.tab.files")}
          </button>
          <button
            type="button"
            role="tab"
            className={`tab gap-1.5 transition-colors duration-150 ${tab === "changes" ? "tab-active" : ""}`}
            onClick={() => selectTab("changes")}
          >
            {t("files.tab.changes")}
            {changes && changes.length > 0 && <span className="badge badge-soft badge-primary badge-xs">{changes.length}</span>}
          </button>
        </div>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-base-content/50">
          {tab === "files" ? `/${["workspace", dir].filter(Boolean).join("/")}` : ""}
        </span>
        <button
          type="button"
          aria-label={t("cloud.files.refresh")}
          title={t("cloud.files.refresh")}
          className="btn btn-ghost btn-square btn-xs"
          onClick={() => {
            list(dir);
            loadChanges();
          }}
        >
          <IconRefresh size={14} stroke={1.75} aria-hidden />
        </button>
        {vmId && tab === "files" && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              aria-label={t("cloud.files.upload")}
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = ""; // 允许重复选同一文件
                void upload(picked);
              }}
            />
            <button type="button" className="btn btn-ghost btn-xs" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading && <span className="loading loading-spinner loading-xs" aria-hidden />}
              {uploading ? t("cloud.files.uploading") : t("cloud.files.upload")}
            </button>
          </>
        )}
        {onClose && (
          <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("cloud.files.close")} onClick={onClose}>
            <IconX size={14} stroke={1.75} aria-hidden />
          </button>
        )}
      </header>

      {err && (
        <div role="alert" className="alert alert-error alert-soft m-2 py-1.5 text-xs">
          <span className="break-all">{err}</span>
        </div>
      )}

      {tab === "changes" ? (
        <div className={listClass}>
          <Changes changes={changes} activePath={preview?.path ?? null} onOpen={openDiff} />
        </div>
      ) : (
      <div className={listClass}>
        {files === null ? (
          <div className="flex justify-center py-8">
            <span className="loading loading-spinner loading-sm text-base-content/40" aria-label={t("cloud.files.loading")} />
          </div>
        ) : (
          // menu 截断铁律(LAYOUT §6.2):daisyUI 给 .menu **和 .menu li** 都
          // 上了 flex-flow: column wrap,wrap 列的行宽跟内容走,文件名那条
          // truncate 链拿不到约束宽度,长名字直接冲出面板
          <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
            {dir && (
              <li>
                <button type="button" onClick={() => setDir(parent)}>
                  <IconFolderUp size={14} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
                  {t("cloud.files.up")}
                </button>
              </li>
            )}
            {files.length === 0 && (
              // 空态统一形态:图标 + 标题档,居中
              <li className="pointer-events-none flex flex-col items-center gap-1.5 px-3 py-8 text-center">
                <IconFolderOpen size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
                <span className="text-sm font-semibold">{t("cloud.files.empty")}</span>
              </li>
            )}
            {/* menu 文档形态:主行是 li 的直接子交互件(目录下钻 / 文件看正文,
                都是 button);下载钮是 li 内绝对定位的 .btn(menu.css 里 li 自带
                relative、.btn 被排除在菜单行样式之外),hover 只切可见性不插入布局 */}
            {files.map((f) => (
              <li key={f.path} className="group">
                {isDir(f) ? (
                  <button type="button" className={vmId ? "pe-9" : undefined} onClick={() => setDir(f.path)}>
                    <IconFolder size={14} stroke={1.75} aria-hidden className="shrink-0 text-primary/60" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  </button>
                ) : (
                  // 点行看正文(repo_read_file):浏览工作区却只能下载不能看,
                  // 面板就只剩半个用途(旧 UI filesdrawer.tsx:428 点行即预览)
                  <button
                    type="button"
                    className={`${vmId ? "pe-9 " : ""}${preview?.path === f.path && preview.mode === "file" ? "menu-active" : ""}`}
                    onClick={() => openFile(f)}
                  >
                    {/* 类型图标与本地文件树同一份 fileIcon,不做两套 */}
                    {(() => {
                      const spec = fileIconOf(f.name);
                      return <spec.icon size={14} stroke={1.75} aria-hidden className={`shrink-0 ${spec.tone}`} />;
                    })()}
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="font-mono text-2xs text-base-content/40 tabular-nums">{fmtSize(f.size)}</span>
                  </button>
                )}
                {vmId && (
                  <button
                    type="button"
                    aria-label={t("cloud.files.download")}
                    title={t("cloud.files.download")}
                    className="btn btn-ghost btn-square btn-xs absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => void download(f)}
                  >
                    <IconDownload size={14} stroke={1.75} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
      {preview && (
        <Preview model={preview} status={(changes ?? []).find((c) => c.path === preview.path)?.status} onClose={closePreview} />
      )}
    </section>
  );
}
