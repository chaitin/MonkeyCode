// 新建任务:主区整页视图(桌面客户端向导页,非网页式弹窗;组件名保留
// NewTaskModal 以稳住既有引用面)。契约(与壳一致):
// - 本地会话:workdir 必填;默认目录(本机 ~/MonkeyCode / WSL 家目录基座下的
//   MonkeyCode)允许静默创建(createDir);其他目录不存在时壳报「…目录不存在…」
//   (desktop/src/driver/session.rs / wsl.rs 的文案契约,壳侧单测钉死),就地
//   换成「创建并继续」确认钮,确认后带 createDir=true 重试
// - 普通对话:workdir 传空串,隐藏 cwd 由壳生成;createDir 恒 false
// - 首条消息(可空):创建成功后经 session_send(user-input, content=b64)发出;
//   发送失败只 console.warn 不阻断——会话已建,onCreated 正常进入,用户可在
//   会话里重发(取舍:失败极罕见,不值得为它加一条跨组件的草稿回传通道)
// - 附件(本地/对话可用,云端任务不支持):此处只**暂存 File**,上传要等
//   会话存在(upload_begin 按 sessionId 寻址),故在 sessionCreate 之后、
//   首条消息之前逐个上传,再把「[图片]/[文件] <相对路径>」附件行并进正文
//   (与 composer 同一条 attLine 约定)。单个附件上传失败与上面同一取舍:
//   console.warn 后带着其余附件继续,不把已建好的会话卡在弹窗里
// - think 档随 session_create 的 think 参数下发(""=跟随模型默认)
// - 最近目录来自 props.recentDirs(App 从 sessions 的 workdir 派生),按内核
//   运行环境过滤(lib/util/workdir);目录预填 = 过滤后首项,无则默认目录
// - 模型记忆 mc.lastTaskModel(本地/对话共用);旧工程无 lastDir 持久化键,
//   不发明新键
import { IconCheck, IconChevronDown, IconCloud, IconFile as FileIcon, IconFolder, IconFolderCode, IconFolderOpen, IconMessages, IconPaperclip, IconSend, IconX } from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { resolveShortcut } from "@/app/shortcuts";
import { useEscLayer } from "@/lib/util/escLayer";
import { useDismiss } from "@/lib/util/useDismiss";
import { useI18n } from "@/lib/i18n";
import { getConfig } from "@/lib/ipc/config";
import { afterEngineReady } from "@/lib/ipc/engine";
import { isWindowsShell, pickDirectory, workdirPickBase } from "@/lib/ipc/host";
import { sameModelName } from "@/lib/models/modelMenu";
import { modelsList, sessionCreate, sessionSend, type ModelInfo, type SessionKind, type SessionMeta } from "@/lib/ipc/sessions";
import {
  isImagePath,
  nativePathOf,
  onNativeFileDrop,
  pickAttachmentPaths,
  pathBackedFile,
  uploadFilePath,
  uploadFileStream,
} from "@/lib/ipc/uploads";
import { attLineOf } from "@/lib/protocol/attLine";
import { b64encode } from "@/lib/protocol/codec";
import { THINK_KEY } from "@/lib/protocol/reduce";
import { createImeGuard } from "@/lib/util/slash";
import { readLastTaskModel, rememberLastTaskModel } from "@/lib/util/prefs";
import { DEFAULT_DIR, workdirMatchesEnv } from "@/lib/util/workdir";
import { ModelMenu, ThinkMenu } from "@/features/chat/composer/pickers";
import { NewCloudTask } from "@/features/cloud/NewCloudTask";
import type { CloudProject, CloudTaskDetail } from "@/lib/ipc/cloudtasks";

export { DEFAULT_DIR };

/** 档位全集以 THINK_KEY(protocol/reduce)为准(""=跟随模型默认领跑)。 */
const THINK_OPTIONS = Object.keys(THINK_KEY);

/** 暂存的附件:File 本体 + 展示名 + 图片预览 URL(非图片/占位 File 无);
 *  上传发生在建会话之后。
 *
 *  `name` 单独存一份而不是各处读 `file.name`:占位 File 与剪贴板截图都可能
 *  空名(uploads.ts::pathBackedFile 头注、壳 uploads.rs 也为此备了落盘兜底),
 *  五处渲染各写一遍 `|| 兜底` 迟早漏一处——加进来时算一次,渲染只管用。 */
interface StagedAtt {
  file: File;
  name: string;
  preview?: string;
}

export function NewTaskModal({
  open,
  onClose,
  onCreated,
  onCloudCreated,
  recentDirs,
  initialDir,
  initialCloudProject,
  initialKind,
  initialText,
  initialFiles,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (meta: SessionMeta) => void;
  onCloudCreated?: (task: CloudTaskDetail) => void;
  /** 云端页签未连接 MonkeyCode 时的出口(空态里的「去设置连接」)。不传的话
   *  那颗按钮根本不渲染——空态只剩一句"请先连接",却不给路。 */
  onOpenSettings?: () => void;
  /** 最近项目目录(App 从 sessions 的 workdir 去重、按 updated_at 降序派生);
   *  环境过滤与截断在本组件内做 */
  recentDirs?: string[];
  /** 「在此项目新建任务」预填目录:定位 local 页签,且不被异步最近目录覆盖 */
  initialDir?: string;
  /** 云端项目组头「在此项目新建任务」:定位 cloud 页签并预选该项目 */
  initialCloudProject?: CloudProject | null;
  /** 默认落哪个页签 = 侧栏当前所在的空间(rail 选着「本地会话」时点 ＋,
   *  开出来就该是会话页签,而不是每次都退回本地任务)。带目录/带云端项目
   *  的预填是更强的意图,优先级在它之上 */
  initialKind?: SessionKind | "cloud";
  /** 首条消息预填(待办「派发成任务」把正文带进来);仅本地/会话页签消费,
   *  云端页签的描述住在 NewCloudTask 自己的 state 里,不受它影响 */
  initialText?: string;
  /** 附件预填(待办派发带图:path-backed File,建完会话后按路径直拷)。
   *  与 initialText 同命:仅本地/会话页签消费,云端任务不支持附件——落云端
   *  时图片不上行,留在待办条目上 */
  initialFiles?: File[];
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<SessionKind | "cloud">("local");
  // 云端面板一旦挂上就常驻(切页签不丢已填的描述/选项),但没点过就不挂
  // (省掉 mc_status + mc_task_options 两次请求)。渲染处有完整缘由。
  const [cloudMounted, setCloudMounted] = useState(false);
  useEffect(() => {
    if (kind === "cloud") setCloudMounted(true);
  }, [kind]);
  const [dir, setDir] = useState(DEFAULT_DIR);
  const [dirMenu, setDirMenu] = useState(false);
  // 「最近目录」下拉走 useDismiss 而不是容器 onBlur。两条理由:
  // ①**Esc 必须入 escLayer 层栈**——不入栈的话按 Esc 时栈顶只有本视图自己的
  //   层,它对非输入焦点一律 onClose(),于是「想收起下拉」变成「整个新建页
  //   退掉,已写的首条消息与暂存附件一起没,还不带确认」。这正是 2026-08-09
  //   报障、b6bda87b 收口过的失败模式(注释就在下面 escRef 那儿),当时只覆盖
  //   了走 useDismiss 的模型/思考档菜单,漏了这两处手写下拉。
  // ②onBlur+relatedTarget 在壳内核 WebKitGTK 上本就不可靠(点按钮不给焦点,
  //   relatedTarget 恒 null),见 useDismiss 头注。
  const dirBoxRef = useRef<HTMLDivElement | null>(null);
  const closeDirMenu = useCallback(() => setDirMenu(false), []);
  useDismiss(dirMenu, dirBoxRef, closeDirMenu);
  const [text, setText] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [think, setThink] = useState("");
  const [kernelEnv, setKernelEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offerCreate, setOfferCreate] = useState(false);
  // 附件暂存(本地/对话;云端任务不支持)。dragDepth:dragenter/leave 在
  // 子元素间反复触发,计数配对才不会一进子元素就把高亮闪掉
  const [atts, setAtts] = useState<StagedAtt[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  // 用户改过目录后,异步到达的预填不再覆盖
  const dirTouched = useRef(false);
  // Enter 直接创建(Shift+Enter 换行);IME 组合中的 Enter 是选字,不触发
  const ime = useRef(createImeGuard());
  // 预填只取"打开那一刻"的最近目录;App 侧列表刷新不重置用户输入
  const recentRef = useRef(recentDirs);
  recentRef.current = recentDirs;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // 每次打开都是一次全新的创建流:清掉上一次的草稿与错误态
    // (待办派发带 initialText 时以它起步,仍可改)
    dirTouched.current = false;
    setDirMenu(false);
    setText(initialText ?? "");
    setThink("");
    setError("");
    setOfferCreate(false);
    // 附件区从预填起步(待办派发带图;无预填即空):上一次的暂存连预览一起清
    setAtts((prev) => {
      for (const a of prev) if (a.preview) URL.revokeObjectURL(a.preview);
      return (initialFiles ?? []).map((file) => ({
        file,
        name: file.name || t("common.unnamedFile"),
        // path-backed 占位 File 是 0 字节,不建 objectURL(下面 addFiles 同注)
        preview: file.type.startsWith("image/") && file.size > 0 ? URL.createObjectURL(file) : undefined,
      }));
    });
    dragDepth.current = 0;
    setDragging(false);
    // 页签优先级:预填目录(项目组头「+」)> 预选云端项目 > 侧栏当前空间
    if (initialDir) {
      setKind("local");
      setDir(initialDir);
      dirTouched.current = true;
    } else if (initialCloudProject) {
      setKind("cloud");
    } else {
      setKind(initialKind ?? "local");
    }
    // 失败保留上一份、不清空(modelsList 现在会抛,见其头注):引擎重启期
    // 这一拉会撞上壳的「配置应用中」闸门,清空等于"重启一次就选不了模型";
    // 未处理拒绝还会被 index.html 的兜底画成满屏红框
    void afterEngineReady(modelsList)
      .then((list) => {
        if (!alive) return;
        setModels(list);
        const remembered = readLastTaskModel();
        // 记忆回查必须带 sameModelName 兜底(旧 UI newtask.tsx 同款):
        // mc.lastTaskModel 记的可能是**加来源后缀之前**的裸名,严格比对就
        // 匹配不上,无声换成默认模型;更糟的是**不会自愈**——下面创建时
        // rememberLastTaskModel(model) 会把回落后的默认模型写回记忆,把用户
        // 的偏好永久覆盖掉。用户不看模型行直接开跑,任务就跑在与预期不同的
        // 档位/计费模型上。sameModelName 的头注也点名要服务 lastTaskModel。
        const byMemory = remembered
          ? (list.find((m) => m.name === remembered && !m.locked) ??
            list.find((m) => sameModelName(m.name, remembered) && !m.locked))
          : undefined;
        const pick = byMemory || list.find((m) => m.default && !m.locked) || list.find((m) => !m.locked);
        if (pick) setModel(pick.name);
      })
      .catch(() => {});
    // 运行环境 → 最近目录过滤(默认目录恒为 DEFAULT_DIR:`~` 由壳按环境展开,
    // WSL 下就是 guest 家目录下的 MonkeyCode,见 lib/util/workdir 头注)
    void (async () => {
      const env = (await getConfig().catch(() => null))?.kernel_env ?? "";
      if (!alive) return;
      setKernelEnv(env);
      if (dirTouched.current) return;
      const recents = (recentRef.current ?? []).filter((p) => workdirMatchesEnv(p, env, isWindowsShell()));
      setDir(recents[0] ?? DEFAULT_DIR);
    })();
    return () => {
      alive = false;
    };
    // t 是模块级函数(useI18n 头注),身份恒稳,不会催动重置
  }, [open, initialDir, initialCloudProject, initialKind, initialText, initialFiles, t]);

  const pickDir = (p: string) => {
    dirTouched.current = true;
    setDir(p);
    setDirMenu(false);
    setError("");
    setOfferCreate(false);
  };

  // ==== 附件暂存 ====
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    setAtts((list) => [
      ...list,
      ...files.map((file) => ({
        file,
        name: file.name || t("common.unnamedFile"),
        // `size > 0` 不可省(旧 UI newtask.tsx 同款守卫):回形针选文件与 Linux
        // 原生拖入走的都是 **0 字节的 path-backed 占位 File**(uploads.ts
        // ::pathBackedFile,字节由壳按路径直拷,不进 webview),而它的 type 被
        // 写成 image/*——只看 type 就建 objectURL,渲染出来是个裂图框。
        // 上限不设:objectURL 不整读文件(旧 UI 那 8MB 是 FileReader→dataURL
        // 的内存限制,这里没有那笔开销)。
        preview: file.type.startsWith("image/") && file.size > 0 ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  };
  const removeAtt = (index: number) => {
    setAtts((list) => {
      const gone = list[index];
      if (gone?.preview) URL.revokeObjectURL(gone.preview); // 预览 URL 随移除释放
      return list.filter((_, i) => i !== index);
    });
  };
  // 卸载时释放尚未撤销的预览 URL(快照挂 ref,effect 只在卸载跑一次)
  const attsRef = useRef(atts);
  attsRef.current = atts;
  useEffect(
    () => () => {
      for (const a of attsRef.current) if (a.preview) URL.revokeObjectURL(a.preview);
    },
    [],
  );

  // 系统对话框选文件:拿到的是本地路径,包成 path-backed 占位 File 走同一
  // 条管线(上传时 nativePathOf 分流为路径直拷,不搬字节)
  const pickFiles = () => {
    void pickAttachmentPaths(t("create.attach")).then((paths) => {
      addFiles(
        paths.map((p) => {
          const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
          return pathBackedFile(p, name, isImagePath(p) ? "image/*" : "");
        }),
      );
    });
  };

  const onPaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    // 只吃剪贴板里的 file item(截图/复制的文件);纯文本粘贴照旧
    const files = [...(e.clipboardData?.items ?? [])]
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  };

  // 拖拽落区:云端页签不收(云端任务不支持附件)
  const dropEnabled = kind !== "cloud";
  const onDragEnter = (e: ReactDragEvent<HTMLElement>) => {
    if (!dropEnabled) return;
    if (![...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: ReactDragEvent<HTMLElement>) => {
    if (!dropEnabled) return;
    e.preventDefault();
    if (--dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };
  const onDrop = (e: ReactDragEvent<HTMLElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!dropEnabled) return;
    addFiles([...(e.dataTransfer?.files ?? [])]);
  };
  // Linux 壳:WebKitGTK 的 HTML5 拖拽拿不到 File,走壳原生 tauri://drag-*
  // (mac/Windows 壳禁用原生处理器,监听永不触发)。dropEnabled 判定放回调内:
  // 订阅始终挂着,切页签时不会漏掉拖拽中的事件
  const dropEnabledRef = useRef(dropEnabled);
  dropEnabledRef.current = dropEnabled;
  useEffect(
    () =>
      onNativeFileDrop({
        onDragging: (on) => setDragging(on && dropEnabledRef.current),
        onFiles: (files) => dropEnabledRef.current && addFiles(files),
        onError: (m) => setError(m),
      }),
    [],
  );

  /** 附件上传要等会话存在(upload_begin 按 sessionId 寻址):建完会话逐个上传,
   *  返回可并入首条消息的附件行。单个失败不阻断其余(理由见文件头注)。 */
  const uploadAtts = async (sessionId: string): Promise<string[]> => {
    const lines: string[] = [];
    for (const { file } of atts) {
      try {
        // 壳原生拖放给的是 path-backed 占位 File:走路径直拷,不搬字节
        const native = nativePathOf(file);
        const { path } = native
          ? await uploadFilePath(sessionId, native)
          : await uploadFileStream(sessionId, file);
        lines.push(attLineOf(path, file.type.startsWith("image/") || isImagePath(path)));
      } catch (e) {
        console.warn("附件上传失败(会话已创建,可在会话内重新拖入):", file.name, e);
      }
    }
    return lines;
  };

  const submit = async (forceCreateDir = false) => {
    if (kind === "cloud" || busy) return;
    const chat = kind === "chat";
    const workdir = chat ? "" : dir.trim();
    if (!chat && !workdir) {
      setError(t("create.error.workdirRequired"));
      return;
    }
    setBusy(true);
    setError("");
    setOfferCreate(false);
    try {
      const meta = await sessionCreate({
        workdir,
        model,
        // 默认目录恒为 DEFAULT_DIR,没被改过就静默创建(壳按环境展开 ~)
        createDir: !chat && (forceCreateDir || workdir === DEFAULT_DIR),
        kind: chat ? "chat" : "local",
        think,
      });
      if (model) rememberLastTaskModel(model);
      // 附件行与 composer 同口径并入正文(壳只解 content):正文在前、附件行在后
      const attLines = atts.length ? await uploadAtts(meta.id) : [];
      const first = [text.trim(), ...attLines].filter(Boolean).join("\n");
      if (first) {
        // 随建随发;失败不阻断打开会话(会话已建,用户可在会话内重发)
        try {
          await sessionSend(meta.id, "user-input", { content: b64encode(first) });
        } catch (e) {
          console.warn("首条消息发送失败(会话已创建,可在会话内重发):", e);
        }
      }
      onCreated(meta);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // 壳的文案契约:目录缺失的 Err 必含「目录不存在」(本机与 WSL 两条路径同款)
      if (!chat && msg.includes("目录不存在")) setOfferCreate(true);
    } finally {
      setBusy(false);
    }
  };

  // 视图级 Esc:走 escLayer 层栈而非自挂 window capture。同 target 同阶段的
  // 监听按**注册先后**触发,本视图打开即注册、浮层(useDismiss:模型菜单/
  // 思考档/最近目录)开时才注册,于是永远是本视图先吃掉这一下——开着模型
  // 菜单按 Esc 关掉的是整个新建页,连同已写的首条消息与暂存附件一起没
  // (2026-08-09 报障)。层栈按后进先出派发,后开的浮层天然压在上面。
  // handler 引用必须稳定(身份一变就重挂 effect、把本层顶到栈顶),故 ref
  // 读最新闭包;输入态只收敛焦点,不拿一下 Esc 换掉整篇草稿。
  const escRef = useRef<() => boolean>(() => false);
  escRef.current = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && resolveShortcut({ key: "Escape", targetTag: el.tagName, openPermId: null }).kind === "blur") {
      el.blur();
      return true;
    }
    onClose();
    return true;
  };
  useEscLayer(open, useCallback(() => escRef.current(), []));

  if (!open) return null;
  const recents = (recentDirs ?? []).filter((p) => workdirMatchesEnv(p, kernelEnv, isWindowsShell())).slice(0, 6);
  const dirName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  const KIND_META = [
    { k: "local" as const, icon: IconFolderCode, label: t("create.kind.local") },
    { k: "chat" as const, icon: IconMessages, label: t("create.kind.chat") },
    { k: "cloud" as const, icon: IconCloud, label: t("create.kind.cloud") },
  ];
  const onTextKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (ime.current.isImeEnter(e.timeStamp, e.nativeEvent.isComposing)) return;
    e.preventDefault();
    void submit();
  };
  return (
    <main
      className="relative flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-base-100"
      onDragEnter={onDragEnter}
      onDragOver={(e) => dropEnabled && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-box border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-primary">
          {t("chat.dropHint")}
        </div>
      )}
      <header data-view-header="" data-tauri-drag-region="" className="flex h-13 shrink-0 items-center gap-2 border-b border-base-300 px-4">
        <h1 data-tauri-drag-region="" className="min-w-0 flex-1 truncate text-sm font-semibold">{t("create.title")}</h1>
        <button
          type="button"
          aria-label={t("create.cancel")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onClose}
        >
          <IconX size={16} stroke={1.75} aria-hidden />
        </button>
      </header>
      {/* 向导列(对齐旧工程新建任务屏):logo+标语的 hero → 类型页签 → 一张
          大圆角输入卡承载全部配置——目录/描述/模型是"一件事",不拆散成表单 */}
      <div className="mx-auto w-full max-w-xl px-6 pt-[max(1.5rem,calc(11vh-3.25rem))] pb-10">
        <div className="flex flex-col gap-4">
          <div className="mb-1 flex flex-col items-center gap-1.5">
            <img src="/logo.png" alt="" aria-hidden draggable={false} className="h-13 w-13" />
            <h2 className="mt-1 text-lg font-bold">
              {kind === "chat" ? t("create.hero.chatTitle") : t("create.hero.taskTitle")}
            </h2>
            <p className="text-xs text-base-content/60">
              {kind === "chat" ? t("create.hero.chatDetail") : t("create.hero.taskDetail")}
            </p>
          </div>
          <div role="tablist" aria-label={t("create.title")} className="tabs-box tabs tabs-sm mx-auto">
            {KIND_META.map(({ k, icon: Icon, label }) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                className={`tab gap-1.5 px-4 font-semibold transition-colors duration-150 ${kind === k ? "tab-active" : ""}`}
                onClick={() => setKind(k)}
              >
                <Icon size={14} stroke={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex flex-col rounded-2xl border border-base-300 bg-base-100 shadow-lg transition-colors focus-within:border-base-content/25">
            {/* 云端面板**懒挂 + 常驻**,不做同位置三元。
                三元里两个分支类型不同,切页签 React 必然卸载 NewCloudTask ——
                它的任务描述/模型/宿主机/镜像/关联仓库全是组件内 state,一卸载
                就全丢,回来还要重跑一次 mc_status + mc_task_options。反方向
                (本地写的字切到云端)之所以安全,只是因为 text 住在本组件里,
                这层不对称本身就说明是拆组件时的副作用。
                懒挂:没点过云端页签就不挂,省掉那两次请求。 */}
            {cloudMounted && (
              <div className={kind === "cloud" ? "contents" : "hidden"}>
                <NewCloudTask
                  active={kind === "cloud"}
                  initialProject={initialCloudProject}
                  onOpenSettings={onOpenSettings}
                  onCreated={(task) => {
                    onCloudCreated?.(task);
                    onClose();
                  }}
                />
              </div>
            )}
            {kind !== "cloud" && (
              <>
                {/* 卡头:本地任务是「在 × 文件夹里工作」句式触发器(富下拉:
                    最近目录/系统选择/手输路径);本地会话是一行说明 */}
                {kind === "local" ? (
                  <div ref={dirBoxRef} className="relative px-2 pt-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm max-w-full justify-start gap-1.5 px-2 font-normal"
                      aria-label={t("create.recentDirs")}
                      aria-expanded={dirMenu}
                      onClick={() => setDirMenu(!dirMenu)}
                    >
                      <IconFolder size={14} stroke={1.75} aria-hidden className="shrink-0 text-base-content/60" />
                      {dir.trim() ? (
                        <>
                          <span className="shrink-0 text-xs text-base-content/50">{t("create.dirPre")}</span>
                          <span className="min-w-0 truncate text-xs font-semibold" title={dir}>{dirName(dir)}</span>
                          <span className="shrink-0 text-xs text-base-content/50">{t("create.dirPost")}</span>
                        </>
                      ) : (
                        <span className="text-xs text-base-content/50">{t("create.workdirPlaceholder")}</span>
                      )}
                      <IconChevronDown
                        size={12}
                        stroke={1.75}
                        aria-hidden
                        className={`shrink-0 text-base-content/50 transition-transform duration-150 ${dirMenu ? "rotate-180" : ""}`}
                      />
                    </button>
                    {dirMenu && (
                      <ul
                        aria-label={t("create.recentDirs")}
                        className="absolute start-2 top-full z-20 mt-1 flex w-96 max-w-[calc(100%-1rem)] flex-col rounded-box border border-base-300 bg-base-100 p-1.5 shadow-lg"
                      >
                        {recents.length > 0 && (
                          <li aria-hidden className="px-2 pt-1 pb-0.5 text-[10px] font-bold tracking-wider text-base-content/40">
                            {t("create.recentGroup")}
                          </li>
                        )}
                        {recents.map((p) => (
                          <li key={p}>
                            <button
                              type="button"
                              aria-label={p}
                              aria-current={p === dir ? "true" : undefined}
                              className={`btn btn-ghost btn-sm h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal ${p === dir ? "btn-active" : ""}`}
                              onClick={() => pickDir(p)}
                            >
                              <IconFolder size={13} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
                              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                                <span className="max-w-full truncate text-xs font-medium">{dirName(p)}</span>
                                <span className="max-w-full truncate font-mono text-[10px] text-base-content/50">{p}</span>
                              </span>
                              {p === dir && <IconCheck size={12} stroke={2} aria-hidden className="shrink-0 text-primary" />}
                            </button>
                          </li>
                        ))}
                        <li aria-hidden className="my-1 border-t border-base-300" />
                        <li>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm w-full justify-start gap-2 px-2 font-normal text-base-content/70"
                            onClick={() => {
                              setDirMenu(false);
                              // 起始目录跟当前运行环境走(WSL 模式开在发行版内,
                              // 不给的话对话框会开在 Windows 侧)
                              void workdirPickBase()
                                .then((base) => pickDirectory(base))
                                .then((picked) => {
                                  if (picked) pickDir(picked);
                                });
                            }}
                          >
                            <IconFolderOpen size={13} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
                            {t("create.pickOther")}
                          </button>
                        </li>
                        {/* 手输路径:浏览器模式没有原生目录选择;壳内也可直接粘贴 */}
                        <li className="flex items-center gap-1.5 px-2 pt-1.5 pb-1">
                          <input
                            className="input input-xs flex-1 font-mono"
                            aria-label={t("create.workdir")}
                            placeholder={t("create.workdirPlaceholder")}
                            value={dir}
                            onChange={(e) => {
                              dirTouched.current = true;
                              setDir(e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                setDirMenu(false);
                              }
                            }}
                          />
                          <button type="button" className="btn btn-xs" onClick={() => setDirMenu(false)}>
                            {t("create.dirConfirm")}
                          </button>
                        </li>
                      </ul>
                    )}
                  </div>
                ) : (
                  /* 与本地页文件夹触发器同高(mt-2 + h-8):切页签卡头不跳动 */
                  <div className="mx-2 mt-2 flex h-8 items-center gap-2 px-2 text-xs text-base-content/50">
                    <IconMessages size={13} stroke={1.75} aria-hidden />
                    {t("create.hint.chat")}
                  </div>
                )}
                <textarea
                  aria-label={t("create.firstMessage")}
                  autoFocus
                  className="textarea min-h-24 w-full resize-none border-0 bg-transparent px-4 text-sm leading-relaxed shadow-none focus:outline-none"
                  rows={4}
                  placeholder={t("create.firstMessagePlaceholder")}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onCompositionEnd={(e) => ime.current.markEnd(e.timeStamp)}
                  onPaste={onPaste}
                  onKeyDown={onTextKey}
                />
                {/* 附件 chips(与 composer 同款):图片出缩略图,其余出文件名条,
                    右上角小 × 移除。上传要等会话建好,这里只是暂存的可视回执 */}
                {atts.length > 0 && (
                  <ul aria-label={t("create.attachments")} className="flex flex-wrap gap-2 px-4 pb-1">
                    {atts.map((a, i) => (
                      <li key={`${a.name}-${i}`} className="relative flex">
                        {a.preview ? (
                          <img
                            src={a.preview}
                            alt={a.name}
                            title={a.name}
                            className="size-13 rounded-box border border-base-300 object-cover"
                          />
                        ) : (
                          <span
                            title={a.name}
                            className="flex h-8 max-w-56 items-center gap-1.5 rounded-box border border-base-300 bg-base-200 px-2.5 text-xs"
                          >
                            <FileIcon size={12} stroke={1.75} aria-hidden className="shrink-0 text-base-content/50" />
                            <span className="min-w-0 truncate">{a.name}</span>
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={t("create.attachRemove", { name: a.name })}
                          className="btn btn-circle btn-xs absolute -end-1.5 -top-1.5 size-4.5 min-h-0 border-base-300 bg-base-100 p-0"
                          onClick={() => removeAtt(i)}
                        >
                          <IconX size={10} stroke={2} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-1 px-2.5 pb-2.5">
                  <button
                    type="button"
                    aria-label={t("create.attach")}
                    title={t("create.attach")}
                    className="btn btn-ghost btn-square btn-sm text-base-content/60"
                    onClick={pickFiles}
                  >
                    <IconPaperclip size={15} stroke={1.75} aria-hidden />
                  </button>
                  {/* 模型/思考档与会话 composer 同一组件(features/chat/composer/
                      pickers):左置触发器,菜单向上首端对齐 */}
                  <ModelMenu
                    models={models}
                    current={model}
                    onPick={setModel}
                    ariaLabel={t("create.model")}
                    title={t("create.model")}
                    align="start"
                  />
                  <ThinkMenu
                    current={think}
                    display={think || models.find((m) => m.name === model)?.think || "low"}
                    levels={THINK_OPTIONS}
                    onPick={setThink}
                    ariaLabel={t("create.think")}
                    title={t("create.think")}
                    align="start"
                  />
                  <span className="flex-1" />
                  <button type="button" className="btn btn-primary btn-sm gap-1.5" disabled={busy} onClick={() => void submit()}>
                    {busy && <span className="loading loading-spinner loading-xs" aria-hidden />}
                    {t("create.submit")}
                    {!busy && <IconSend size={12} stroke={2} aria-hidden />}
                  </button>
                </div>
              </>
            )}
          </div>
          {kind !== "cloud" &&
            (offerCreate ? (
              <div role="alert" className="flex items-center gap-2 px-2 text-xs text-error">
                <span>{t("create.dirMissing")}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-warning"
                  disabled={busy}
                  onClick={() => void submit(true)}
                >
                  {t("create.dirCreate")}
                </button>
              </div>
            ) : error ? (
              <div role="alert" className="px-2 text-xs leading-relaxed text-error">
                {error}
              </div>
            ) : null)}
        </div>
      </div>
    </main>
  );
}
