// 新建任务视图:居中卡片(任务输入 + 本地/云端/对话模式 + 模型 + 开始)。
// 本地模式选择工作目录；云端模式选择仓库(可不选=快速开始)+ 模型/宿主机/镜像，
// 经内核代理真实创建 monkeycode 云端任务,成功后进桌面内详情视图跟看。
// 表单状态(目录/文本/模型/错误/busy + 附件/云端选项)整体收口在本组件:
// 状态随视图挂载与卸载,App 只注入数据(models/recentDirs/lastDir)与编排回调
// (onCreated/onCloudCreated)及外部预填(prefill)。
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { basename, effectiveThink, isImeEnter, markImeEnd, ModelMenuItem, ModelPicker, ThinkPicker } from "./chat";
import { CloudModelGroups } from "./cloudModelMenu";
import { MONO } from "./components";
import { mcTaskCreate, mcTaskOptions } from "./cloudapi";
import { inDesktopShell, pickDirectory, workdirPickBase } from "./host";
import { useUpwardMenuHeight } from "./menuPosition";
import { useNativeFileDrop } from "./nativeDrop";
import { readLastTaskModel, rememberLastTaskModel, sameModelName } from "./modelMenu";
import { createSession } from "./session";
import type { CloudTask } from "./types";
import {
  cloudHostLabel,
  cloudImageLabel,
  cloudRepoLabel,
  groupedCloudModelLabel,
  groupCloudModels,
  pickDefaultCloudImage,
  pickDefaultCloudHost,
  pickDefaultCloudModel,
  PUBLIC_CLOUD_HOST_ID,
  usableCloudHosts,
  validCloudRepoUrl,
  type McCloudProject,
  type McTaskOptions,
} from "./cloud";
import {
  IconCheck,
  IconChat,
  IconChevronDown,
  IconCloud,
  IconFolder,
  IconInfo,
  IconMonitor,
  IconPlus,
  IconSend,
  IconX,
} from "./icons";
import logoUrl from "./logo.png";
import type { ModelInfo, SessionMeta } from "./types";

/** 首启默认工作目录(内核解析 ~,不存在时自动创建);老用户默认沿用最近会话的目录 */
export const DEFAULT_DIR = "~/MonkeyCode";

export type NewTaskMode = "local" | "cloud" | "chat";

export interface NewTaskPrefill {
  dir?: string | null;
  mode?: NewTaskMode;
  /** 云端项目行的 + 号可直接预选项目；null 表示快速任务。 */
  cloudProject?: McCloudProject | null;
}

/** 云端运行配置使用轻量文字触发器；自然排布、窄宽度换行，避免做成三列表单。 */
function CloudConfigField({
  label,
  value,
  open,
  align = "start",
  onToggle,
  onClose,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  align?: "start" | "end";
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const hasValue = !!value && value !== label;
  const { anchorRef, menuMaxHeight } = useUpwardMenuHeight<HTMLSpanElement>(open, 360);
  return (
    <span ref={anchorRef} style={{ position: "relative", display: "inline-flex", minWidth: 0, maxWidth: "100%" }}>
      <button
        className="hv"
        title={`选择云端${label}：${value}`}
        onClick={onToggle}
        style={{
          maxWidth: "100%",
          minWidth: 0,
          height: 27,
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "0 8px",
          border: "none",
          borderRadius: 7,
          background: open ? "var(--hov2)" : "transparent",
          color: "var(--t2)",
          cursor: "pointer",
        }}
      >
        <span style={{ flex: "none", fontSize: 11.5, color: hasValue ? "var(--t5)" : "var(--t3)", fontWeight: hasValue ? 450 : 550 }}>{label}</span>
        {hasValue && (
          <>
            <span style={{ flex: "none", color: "var(--t7)", fontSize: 10 }}>·</span>
            <span className="ellipsis" style={{ minWidth: 0, textAlign: "left", fontSize: 12, fontWeight: 550 }}>{value}</span>
          </>
        )}
        <IconChevronDown size={8} color="var(--t6)" style={{ flex: "none", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
      </button>
      {open && (
        <>
          <div className="backdrop" onClick={onClose} />
          <div
            className="pop model-menu"
            style={{
              position: "absolute",
              bottom: 32,
              ...(align === "end" ? { right: 0 } : { left: 0 }),
              maxHeight: menuMaxHeight,
              overflowY: "auto",
            }}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}

export function NewTaskView({
  models,
  lastDir,
  recentDirs,
  prefill,
  cloudReady,
  onCreated,
  onCloudCreated,
}: {
  models: ModelInfo[];
  /** 最近会话的工作目录(空 = 还没有会话);用户没改过目录时跟随它 */
  lastDir: string;
  /** 侧栏同款项目分组目录(App 从 sessions 派生;当前目录不在其中时头部补入) */
  recentDirs: string[];
  /** 外部触发的预填(侧栏本地/云端/对话 +、项目行 +):每次触发都是新对象,
   * 同入口重复点击也能生效;mode 直达对应模式,dir 预填目录并停止跟随 */
  prefill: NewTaskPrefill | null;
  /** MonkeyCode 云端账号已显式关联(云端派发的前提) */
  cloudReady: boolean;
  /** 本地任务/独立对话创建成功:App 刷新列表并进入会话;first/files 随首条消息发出
   * (附件由 useSession 在会话连上后上传并拼接) */
  onCreated: (meta: SessionMeta, first?: string, files?: File[]) => Promise<void> | void;
  /** 云端任务创建成功:App 打开桌面内详情视图跟看 */
  onCloudCreated: (t: CloudTask) => void;
}) {
  const [folderOpen, setFolderOpen] = useState(false);
  const [mode, setMode] = useState<NewTaskMode>(() => prefill?.mode ?? "local");
  const [manualDir, setManualDir] = useState("");

  // ===== 本地表单主状态(此前拆在 App 里经 15 个 props 注入,现随视图生命周期)=====
  const dirTouchedRef = useRef(!!prefill?.dir); // 用户改过工作目录后不再跟随最近会话
  const [dir, setDir] = useState(() => prefill?.dir || lastDir || DEFAULT_DIR);
  const [text, setText] = useState("");
  // 模型:预选「上次开任务用的」(mc.lastTaskModel),没有/已下线/被锁定
  // 回落默认。校验放在派生处而非初始化:models 是异步到达的 props,挂载
  // 时常为空,初始化时校验会让记忆永远失效。locked(超会员档展示专用)
  // 条目全链路跳过——它不在引擎 settings 里,派生到它会话建不起来
  const [pickedModel, setPickedModel] = useState(() => readLastTaskModel());
  // 记忆里的名字可能是加来源后缀之前的裸名:精确没中按宽松口径再找一次,
  // 找到就用**当下条目的真名**(记忆值本身已不是有效的引擎寻址键)
  const rememberedEntry = pickedModel
    ? models.find((m) => m.name === pickedModel) ?? models.find((m) => sameModelName(m.name, pickedModel))
    : undefined;
  const model =
    (rememberedEntry && !rememberedEntry.locked ? rememberedEntry.name : "") ||
    models.find((m) => m.default && !m.locked)?.name ||
    models.find((m) => !m.locked)?.name ||
    "";
  // 思考深度(本地/会话):""=未显式选,创建时跟随模型设置的默认档;
  // composer 上直接显示生效档位(模型是啥就显示啥),选了就随创建下发
  const [think, setThink] = useState("");
  const modelThink = models.find((m) => m.name === model)?.think;
  const [err, setErr] = useState("");
  const [offerCreate, setOfferCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  // 目录跟随最近会话:没有会话则用默认目录(用户改过/预填过则不再跟随)
  useEffect(() => {
    if (dirTouchedRef.current) return;
    setDir(lastDir || DEFAULT_DIR);
  }, [lastDir]);

  // 外部预填:切换目标模式并清掉上一次的本地错误态;带目录则预填并停止跟随
  useEffect(() => {
    if (!prefill) return;
    setErr("");
    setOfferCreate(false);
    if (prefill.mode) setMode(prefill.mode);
    if (prefill.dir) {
      dirTouchedRef.current = true;
      setDir(prefill.dir);
    }
  }, [prefill]);

  // ===== 附件暂存(本地/普通对话可用;云端任务不支持附件)=====
  // 此刻会话还没创建,File 只能留在内存;createTask 成功后随 onCreated 交给
  // App,会话建好、WS 连上时由 useSession 上传落盘并随首条消息发出
  const [atts, setAtts] = useState<{ file: File; preview?: string }[]>([]);
  const [attErr, setAttErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const addFiles = (files: File[]) => {
    setAttErr("");
    for (const f of files) {
      // 大小不设限(上传经分块/路径直拷,见 uploads.ts);预览只为小图整读,
      // 大图整读 dataURL 会撑爆 webview 内存
      if (f.type.startsWith("image/") && f.size > 0 && f.size <= 8 * 1024 * 1024) {
        const r = new FileReader();
        r.onload = () => setAtts((a) => [...a, { file: f, preview: r.result as string }]);
        r.readAsDataURL(f);
      } else {
        setAtts((a) => [...a, { file: f }]);
      }
    }
  };

  // 粘贴附件:剪贴板里的 file item(截图/复制的文件),文本粘贴不受影响
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (mode === "cloud") return;
    const files: File[] = [];
    for (const item of e.clipboardData.items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  // 拖拽文件进页面(与 ChatView 同款热区交互)
  const onDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (mode === "cloud" || ![...e.dataTransfer.items].some((i) => i.kind === "file")) return;
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
    if (mode === "cloud") return;
    const files = [...e.dataTransfer.files];
    if (files.length) addFiles(files);
  };
  // Linux 壳走原生拖放事件(HTML5 拖拽在 WebKitGTK 拿不到文件,见 nativeDrop.ts)
  useNativeFileDrop({
    enabled: mode !== "cloud",
    onDragging: setDragging,
    onFiles: addFiles,
    onError: setAttErr,
  });

  // ===== 云端模式:选项数据(模型/宿主机/镜像/项目)+ 选择态 =====
  const [cloudOpts, setCloudOpts] = useState<McTaskOptions | null>(null);
  const [cloudErr, setCloudErr] = useState("");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudModelId, setCloudModelId] = useState("");
  const [cloudHostId, setCloudHostId] = useState("");
  const [cloudImageId, setCloudImageId] = useState("");
  const [cloudProject, setCloudProject] = useState<McCloudProject | null>(() => prefill?.cloudProject ?? null);
  const [cloudRepoUrl, setCloudRepoUrl] = useState("");
  const [cloudRepoDraft, setCloudRepoDraft] = useState("");
  const [cloudRepoErr, setCloudRepoErr] = useState("");
  const [repoOpen, setRepoOpen] = useState(false);
  const [cloudPicker, setCloudPicker] = useState<"model" | "host" | "image" | null>(null);

  useEffect(() => {
    if (mode !== "cloud" || !cloudReady || cloudOpts) return;
    let alive = true;
    mcTaskOptions()
      .then((o) => {
        if (!alive) return;
        const modelId = pickDefaultCloudModel(o.models, o.plan);
        const publicModel = o.models.find((model) => model.id === modelId)?.owner?.type === "public";
        setCloudOpts(o);
        setCloudModelId(modelId);
        setCloudHostId(pickDefaultCloudHost(o.hosts ?? [], o.task_defaults?.host_id, publicModel));
        setCloudImageId(pickDefaultCloudImage(o.images));
      })
      .catch((e) => alive && setCloudErr("云端选项加载失败: " + (e instanceof Error ? e.message : String(e))));
    return () => {
      alive = false;
    };
  }, [mode, cloudReady, cloudOpts]);

  useEffect(() => {
    if (!prefill || !("cloudProject" in prefill)) return;
    setCloudRepoUrl("");
    setCloudRepoDraft("");
    setCloudRepoErr("");
  }, [prefill]);

  useEffect(() => {
    if (!prefill || !("cloudProject" in prefill)) return;
    const requested = prefill.cloudProject ?? null;
    if (!requested?.id || !cloudOpts) {
      setCloudProject(requested);
      return;
    }
    setCloudProject(cloudOpts.projects.find((project) => project.id === requested.id) ?? requested);
  }, [prefill, cloudOpts]);

  const cloudModelGroups = cloudOpts ? groupCloudModels(cloudOpts.models, cloudOpts.plan) : [];
  const selectedCloudModel = cloudOpts?.models.find((model) => model.id === cloudModelId);
  const selectedCloudModelGroup = cloudModelGroups.find((group) => group.models.some((model) => model.id === cloudModelId));
  const publicCloudModel = selectedCloudModel?.owner?.type === "public";
  const cloudHosts = cloudOpts ? usableCloudHosts(cloudOpts.hosts ?? [], publicCloudModel) : [];
  const cloudImages = cloudOpts?.images.filter((image) => image.id) ?? [];
  const cloudModelName = selectedCloudModel
    ? [selectedCloudModelGroup?.label, groupedCloudModelLabel(selectedCloudModel)].filter(Boolean).join(" / ")
    : "模型";
  const cloudHostName = cloudHostLabel(cloudHosts.find((host) => host.id === cloudHostId)) || "宿主机";
  const cloudImageName = cloudImageLabel(cloudImages.find((image) => image.id === cloudImageId)) || "镜像";
  const cloudRepoName = cloudProject
    ? cloudProject.name || cloudProject.full_name || cloudProject.repo_url || "云端项目"
    : cloudRepoUrl ? cloudRepoLabel(cloudRepoUrl) : "不关联仓库(快速开始)";

  // 公共模型只能使用公共宿主机；宿主列表刷新后也不能保留已离线选项。
  useEffect(() => {
    if (!cloudOpts) return;
    const modelIsPublic = cloudOpts.models.find((model) => model.id === cloudModelId)?.owner?.type === "public";
    const allowed = usableCloudHosts(cloudOpts.hosts ?? [], modelIsPublic);
    if (!allowed.some((host) => host.id === cloudHostId)) setCloudHostId(PUBLIC_CLOUD_HOST_ID);
  }, [cloudOpts, cloudModelId, cloudHostId]);

  const commitCloudRepoUrl = () => {
    const value = cloudRepoDraft.trim();
    if (!value) {
      setCloudRepoErr("请输入仓库地址");
      return;
    }
    if (!validCloudRepoUrl(value)) {
      setCloudRepoErr("请输入有效的 Git 地址（http(s)://、ssh:// 或 git@）");
      return;
    }
    setCloudProject(null);
    setCloudRepoUrl(value);
    setCloudRepoDraft(value);
    setCloudRepoErr("");
    setRepoOpen(false);
  };

  const createCloud = async () => {
    const content = text.trim();
    if (cloudBusy) return;
    if (!cloudReady) {
      setCloudErr("请先连接 MonkeyCode（设置 → 账号与云端）");
      return;
    }
    if (!content) {
      setCloudErr("云端任务需要先描述要做的事");
      return;
    }
    if (!cloudModelId || !cloudHostId || !cloudImageId) {
      setCloudErr(cloudOpts ? "云端模型/宿主机/镜像不可用,请稍后重试" : "云端选项还没加载好,请稍候");
      return;
    }
    setCloudBusy(true);
    setCloudErr("");
    try {
      const task = await mcTaskCreate({
        content,
        model_id: cloudModelId,
        host_id: cloudHostId,
        image_id: cloudImageId,
        repo_url: cloudProject?.repo_url || cloudRepoUrl || undefined,
        project_id: cloudProject?.id || undefined,
      });
      if (!task?.id) throw new Error("云端未返回任务 ID");
      setText("");
      onCloudCreated({ ...task, content: task.content ?? content, status: task.status ?? "pending" });
    } catch (e) {
      setCloudErr("云端任务创建失败: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setCloudBusy(false);
    }
  };

  // 本地任务/普通对话创建:对话的独立隐藏 cwd 由桌面壳生成，并用持久化 kind 与项目会话区分。
  // 成功后交给 App 编排(刷新列表 + 进入会话);项目目录不存在时给确认入口。
  const createTask = async (createDir = false, files?: File[]) => {
    const chatMode = mode === "chat";
    const d = chatMode ? "" : dir.trim();
    if ((!chatMode && !d) || busy) return;
    setBusy(true);
    setErr("");
    setOfferCreate(false);
    try {
      // 默认项目目录可静默创建；对话目录完全由壳管理，UI 不传内部路径。
      const meta = await createSession(d, model, !chatMode && (createDir || d === DEFAULT_DIR), chatMode ? "chat" : "local", think);
      rememberLastTaskModel(model); // 本地/对话共用记忆;云端是独立 id 体系不记
      const first = text.trim();
      setText("");
      await onCreated(meta, first || undefined, files);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr("创建失败: " + msg);
      if (!chatMode && msg.includes("目录不存在")) setOfferCreate(true);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === "cloud") void createCloud();
    else void createTask(undefined, atts.map((a) => a.file));
  };

  const pick = (p: string) => {
    dirTouchedRef.current = true;
    setDir(p);
    setErr("");
    setOfferCreate(false);
    setFolderOpen(false);
  };

  const browse = async () => {
    // WSL 模式:对话框定位到发行版文件系统,选出的目录才在内核所在环境
    const p = await pickDirectory(await workdirPickBase());
    if (p) pick(p);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isImeEnter(e)) {
      e.preventDefault();
      submit();
    }
  };

  // 当前目录不在最近列表时补到头部,最多展示 6 条
  const shownDirs = (recentDirs.includes(dir) ? recentDirs : [dir, ...recentDirs]).slice(0, 6);

  const segItem = (active: boolean, fg: string): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 5,
    height: 22,
    padding: "0 10px",
    borderRadius: 11,
    background: active ? "var(--card)" : "transparent",
    boxShadow: active ? "var(--segSh)" : "none",
    fontSize: 11.5,
    fontWeight: 700,
    color: active ? fg : "var(--t5)",
    cursor: "pointer",
    userSelect: "none",
  });
  const cloudDisconnected = mode === "cloud" && !cloudReady;
  const submitDisabled = busy || cloudBusy || cloudDisconnected;

  return (
    <div
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}
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
      {/* macOS Overlay 标题栏带:本页没有 chat 那样的头栏,补一条拖拽热区
          (data-tauri-drag-region 不被子元素继承,必须有专属元素;高度同
          MacWindowControls,已从下方 14vh 顶距中扣除,视觉位置不变) */}
      <div data-menu-boundary="" data-tauri-drag-region="" style={{ height: 50, flex: "none" }} />
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ margin: "0 auto", width: "100%", maxWidth: 640, padding: "max(0px, 14vh - 50px) 36px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <img src={logoUrl} alt="" draggable={false} style={{ width: 52, height: 52 }} />
          <div style={{ fontSize: 18, fontWeight: 750, letterSpacing: 0.1, marginTop: 6 }}>
            {mode === "chat" ? "开始一段新会话" : "开始一个新任务"}
          </div>
          <div style={{ fontSize: 12, color: "var(--t5)" }}>
            {mode === "chat" ? "不绑定项目，随时记录、讨论或梳理想法" : "告诉我要做什么，剩下的交给我"}
          </div>
        </div>

        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 16,
            boxShadow: "var(--panelShLg)",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <div style={{ padding: "8px 8px 0", position: "relative" }}>
            {mode === "cloud" ? (
              <>
                <button
                  title={cloudProject?.repo_url || cloudRepoUrl || "云端任务可关联代码仓库,也可不关联直接对话"}
                  className="hv"
                  onClick={() => {
                    const next = !repoOpen;
                    if (next) {
                      setCloudRepoDraft(cloudRepoUrl);
                      setCloudRepoErr("");
                    }
                    setRepoOpen(next);
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 9px", border: "none", borderRadius: 8, background: repoOpen ? "var(--hov)" : "transparent", cursor: "pointer", maxWidth: "100%" }}
                >
                  <IconCloud size={13} color="var(--t3)" />
                  <span className="ellipsis" style={{ fontSize: 12, fontWeight: cloudProject || cloudRepoUrl ? 600 : 400, color: cloudProject || cloudRepoUrl ? "var(--t2)" : "var(--t5)" }}>
                    {cloudRepoName}
                  </span>
                  <IconChevronDown color="var(--t5)" style={{ transform: repoOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                </button>
                {repoOpen && (
                  <>
                    <div className="backdrop" onClick={() => setRepoOpen(false)} />
                    <div className="pop" style={{ position: "absolute", top: 34, left: 8, borderRadius: 10, minWidth: 280, maxWidth: 400, maxHeight: 320, overflowY: "auto" }}>
                      <button className="hv menu-item" onClick={() => { setCloudProject(null); setCloudRepoUrl(""); setCloudRepoDraft(""); setCloudRepoErr(""); setRepoOpen(false); }} style={{ gap: 9 }}>
                        <IconCloud size={12} color="var(--t5)" />
                        <span style={{ flex: 1, fontSize: 12.5, color: "var(--t2)" }}>不关联仓库(快速开始)</span>
                        {!cloudProject && !cloudRepoUrl && <IconCheck size={11} color="var(--accTx)" strokeWidth={1.6} />}
                      </button>
                      <span style={{ height: 1, background: "var(--line2)", margin: "4px 6px" }} />
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--t6)", padding: "5px 9px 3px" }}>
                        手动输入仓库地址
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px 5px" }}>
                        <input
                          autoFocus
                          value={cloudRepoDraft}
                          onChange={(event) => { setCloudRepoDraft(event.target.value); setCloudRepoErr(""); }}
                          onCompositionEnd={markImeEnd}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Enter" && !isImeEnter(event)) commitCloudRepoUrl();
                          }}
                          placeholder="https://github.com/owner/repo.git"
                          style={{ flex: 1, minWidth: 0, height: 28, padding: "0 8px", border: `1px solid ${cloudRepoErr ? "var(--err)" : "var(--inputBd)"}`, borderRadius: 6, outline: "none", background: "var(--bg)", color: "var(--t2)", font: `11px ${MONO}` }}
                        />
                        <button
                          className="hv-acc"
                          disabled={!cloudRepoDraft.trim()}
                          onClick={commitCloudRepoUrl}
                          style={{ height: 28, padding: "0 10px", border: "none", borderRadius: 6, background: "var(--acc)", color: "var(--onAcc)", fontSize: 11.5, fontWeight: 650, cursor: cloudRepoDraft.trim() ? "pointer" : "default", opacity: cloudRepoDraft.trim() ? 1 : 0.55 }}
                        >
                          使用
                        </button>
                      </div>
                      {cloudRepoErr && <span style={{ padding: "0 8px 6px", color: "var(--err)", fontSize: 10.5 }}>{cloudRepoErr}</span>}
                      {(cloudOpts?.projects.length ?? 0) > 0 && (
                        <>
                          <span style={{ height: 1, background: "var(--line2)", margin: "4px 6px" }} />
                          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--t6)", padding: "5px 9px 3px" }}>
                            云端项目
                          </span>
                          {cloudOpts!.projects.map((p) => (
                            <button key={p.id || p.repo_url} className="hv menu-item" onClick={() => { setCloudProject(p); setCloudRepoUrl(""); setCloudRepoDraft(""); setCloudRepoErr(""); setRepoOpen(false); }} style={{ gap: 9 }}>
                              <IconFolder color="var(--t5)" />
                              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                                <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--t2)" }}>
                                  {p.name || p.full_name || "项目"}
                                </span>
                                {p.repo_url && (
                                  <span className="ellipsis" style={{ fontSize: 10.5, fontFamily: MONO, color: "var(--t6)" }}>{p.repo_url}</span>
                                )}
                              </span>
                              {cloudProject?.id === p.id && <IconCheck size={11} color="var(--accTx)" strokeWidth={1.6} />}
                            </button>
                          ))}
                        </>
                      )}
                      {cloudOpts && cloudOpts.projects.length === 0 && (
                        <span style={{ fontSize: 11, color: "var(--t6)", padding: "3px 9px 6px" }}>还没有绑定项目，也可以直接填写仓库地址</span>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : mode === "local" ? (
              <>
                <button
                  className="hv"
                  onClick={() => setFolderOpen(!folderOpen)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    height: 28,
                    padding: "0 9px",
                    border: "none",
                    borderRadius: 8,
                    background: folderOpen ? "var(--hov)" : "transparent",
                    cursor: "pointer",
                    maxWidth: "100%",
                  }}
                >
                  <IconFolder />
                  <span style={{ fontSize: 12, color: "var(--t5)", flex: "none" }}>在</span>
                  <span className="ellipsis" style={{ fontSize: 12, fontWeight: 600, color: "var(--t2)" }}>
                    {basename(dir)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--t5)", flex: "none" }}>文件夹里工作</span>
                  <IconChevronDown color="var(--t5)" style={{ transform: folderOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
                </button>
                {folderOpen && (
                  <>
                    <div className="backdrop" onClick={() => setFolderOpen(false)} />
                    <div className="pop" style={{ position: "absolute", top: 34, left: 8, borderRadius: 10, minWidth: 280, maxWidth: 380 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--t6)", padding: "5px 9px 3px" }}>
                        最近用过的文件夹
                      </span>
                      {shownDirs.map((p) => (
                        <button key={p} className="hv menu-item" onClick={() => pick(p)} style={{ gap: 9 }}>
                          <IconFolder color="var(--t5)" />
                          <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                            <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--t2)" }}>
                              {basename(p)}
                            </span>
                            <span className="ellipsis" style={{ fontSize: 10.5, fontFamily: MONO, color: "var(--t6)" }}>
                              {p}
                            </span>
                          </span>
                          {p === dir && <IconCheck size={11} color="var(--accTx)" strokeWidth={1.6} />}
                        </button>
                      ))}
                      <span style={{ height: 1, background: "var(--line2)", margin: "4px 6px" }} />
                      {inDesktopShell() && (
                        <button className="hv menu-item" onClick={() => void browse()} style={{ gap: 9 }}>
                          <IconPlus size={12} color="var(--t3)" />
                          <span style={{ fontSize: 12, color: "var(--t3)" }}>选择其他文件夹…</span>
                        </button>
                      )}
                      {/* 手动输入(浏览器模式没有原生目录选择;壳内也可直接粘贴路径) */}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 9px" }}>
                        <input
                          value={manualDir}
                          onChange={(e) => setManualDir(e.target.value)}
                          onCompositionEnd={markImeEnd}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !isImeEnter(e) && manualDir.trim()) pick(manualDir.trim());
                          }}
                          placeholder="或输入路径,如 ~/dev/project"
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: "1px solid var(--line)",
                            borderRadius: 6,
                            padding: "5px 8px",
                            font: "11px " + MONO,
                            color: "var(--t1)",
                            outline: "none",
                            background: "var(--card)",
                          }}
                        />
                        <button
                          className="hv2"
                          onClick={() => manualDir.trim() && pick(manualDir.trim())}
                          style={{ border: "none", background: "var(--hov)", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, color: "var(--t2)", cursor: "pointer", flex: "none" }}
                        >
                          确定
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div
                style={{
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "0 9px",
                  color: "var(--t4)",
                  fontSize: 12,
                }}
              >
                <IconChat size={13} color="var(--accTx)" />
                独立会话 · 不关联本地项目
              </div>
            )}
          </div>

          {mode !== "cloud" && atts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "10px 12px 0" }}>
              {atts.map((a, i) => (
                <span key={i} style={{ position: "relative", display: "flex" }}>
                  {a.preview ? (
                    <img
                      src={a.preview}
                      alt={a.file.name}
                      title={a.file.name}
                      style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, border: "1px solid var(--cardBd)" }}
                    />
                  ) : (
                    <span
                      title={a.file.name}
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
                      <span className="ellipsis">{a.file.name}</span>
                    </span>
                  )}
                  <button
                    className="icon-btn"
                    title="移除"
                    onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}
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
            </div>
          )}
          <textarea
            value={text}
            autoFocus
            rows={4}
            onChange={(e) => setText(e.target.value)}
            onCompositionEnd={markImeEnd}
            onKeyDown={onKey}
            onPaste={onPaste}
            placeholder={
              mode === "chat"
                ? "想聊点什么？也可以粘贴或拖入图片、文件…"
                : mode === "local"
                  ? "描述要做的事…粘贴或拖入图片、文件可作为附件，留空则先创建任务"
                  : "描述要做的事…"
            }
            style={{
              border: "none",
              outline: "none",
              resize: "none",
              background: "transparent",
              color: "var(--t1)",
              padding: "9px 17px 4px",
              fontSize: 13.5,
              lineHeight: 1.55,
              width: "100%",
            }}
          />

          {mode === "cloud" && (
            <div
              data-cloud-runtime-controls=""
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "1px 2px",
                padding: "5px 10px 1px",
                borderTop: "1px solid var(--line2)",
              }}
            >
              <CloudConfigField
                label="模型"
                value={cloudModelName}
                open={cloudPicker === "model"}
                onToggle={() => setCloudPicker((current) => current === "model" ? null : "model")}
                onClose={() => setCloudPicker(null)}
              >
                <CloudModelGroups
                  groups={cloudModelGroups}
                  selectedId={cloudModelId}
                  onPick={(cloudModel) => {
                    if (cloudModel.locked) return;
                    setCloudModelId(cloudModel.id!);
                    if (cloudModel.owner?.type === "public") setCloudHostId(PUBLIC_CLOUD_HOST_ID);
                    setCloudPicker(null);
                  }}
                />
                {cloudModelGroups.length === 0 && (
                  <span style={{ fontSize: 11.5, color: "var(--t6)", padding: "6px 9px" }}>{cloudOpts ? "没有可用的云端模型" : "加载中…"}</span>
                )}
              </CloudConfigField>

              <CloudConfigField
                label="宿主机"
                value={cloudHostName}
                open={cloudPicker === "host"}
                onToggle={() => setCloudPicker((current) => current === "host" ? null : "host")}
                onClose={() => setCloudPicker(null)}
              >
                {cloudHosts.map((host) => (
                  <ModelMenuItem
                    key={host.id}
                    label={cloudHostLabel(host)}
                    hint={host.id === PUBLIC_CLOUD_HOST_ID ? "免费" : undefined}
                    selected={host.id === cloudHostId}
                    onClick={() => {
                      setCloudHostId(host.id!);
                      setCloudPicker(null);
                    }}
                  />
                ))}
                {publicCloudModel && cloudOpts && (
                  <span style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--t6)", padding: "5px 10px 7px", whiteSpace: "normal" }}>公共模型仅支持公共宿主机</span>
                )}
                {cloudHosts.length === 0 && (
                  <span style={{ fontSize: 11.5, color: "var(--t6)", padding: "6px 9px" }}>{cloudOpts ? "没有可用的宿主机" : "加载中…"}</span>
                )}
              </CloudConfigField>

              <CloudConfigField
                label="镜像"
                value={cloudImageName}
                open={cloudPicker === "image"}
                align="end"
                onToggle={() => setCloudPicker((current) => current === "image" ? null : "image")}
                onClose={() => setCloudPicker(null)}
              >
                {cloudImages.map((image) => (
                  <ModelMenuItem
                    key={image.id}
                    label={cloudImageLabel(image)}
                    hint={image.owner?.type === "public" ? "公共" : undefined}
                    selected={image.id === cloudImageId}
                    onClick={() => {
                      setCloudImageId(image.id!);
                      setCloudPicker(null);
                    }}
                  />
                ))}
                {cloudImages.length === 0 && (
                  <span style={{ fontSize: 11.5, color: "var(--t6)", padding: "6px 9px" }}>{cloudOpts ? "没有可用的云端镜像" : "加载中…"}</span>
                )}
              </CloudConfigField>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px 11px", minWidth: 0 }}>
            <span style={{ display: "flex", background: "var(--segBg)", borderRadius: 13, padding: 2, flex: "none" }}>
              <span onClick={() => setMode("local")} title="跑在这台电脑上,直接读写本地文件,每步权限逐一确认" style={segItem(mode === "local", "var(--accTx)")}>
                <IconMonitor size={11} color={mode === "local" ? "var(--accTx)" : "var(--t5)"} strokeWidth={1.4} />
                本地
              </span>
              <span onClick={() => setMode("cloud")} title="跑在云上服务器,关掉客户端也继续" style={segItem(mode === "cloud", "var(--warn)")}>
                <IconCloud size={11} color={mode === "cloud" ? "var(--warn)" : "var(--t5)"} />
                云端
              </span>
              <span onClick={() => setMode("chat")} title="不绑定项目的普通会话" style={segItem(mode === "chat", "var(--accTx)")}>
                <IconChat size={11} color={mode === "chat" ? "var(--accTx)" : "var(--t5)"} />
                会话
              </span>
            </span>
            {mode !== "cloud" && (
              <>
                <ModelPicker models={models} current={model} onPick={setPickedModel} />
                <ThinkPicker current={effectiveThink(think, modelThink)} onPick={setThink} />
              </>
            )}
            <span style={{ flex: 1 }} />
            <button
              className="hv-acc"
              disabled={submitDisabled}
              title={cloudDisconnected ? "请先连接 MonkeyCode 后再创建云端任务" : undefined}
              onClick={submit}
              style={{
                height: 30,
                border: "none",
                borderRadius: 9,
                background: "var(--acc)",
                color: "var(--onAcc)",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: submitDisabled ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 15px",
                flex: "none",
                boxShadow: "var(--accSh)",
                opacity: submitDisabled ? 0.6 : 1,
              }}
            >
              {busy || cloudBusy ? "创建中…" : cloudDisconnected ? "请先连接" : mode === "chat" ? "开始会话" : "开始任务"}
              <IconSend size={11} />
            </button>
          </div>

          {mode === "cloud" && !cloudReady && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 10px 10px", padding: "8px 11px", borderRadius: 9, background: "var(--warnBg)", border: "1px solid var(--warnBd2)" }}>
              <IconInfo color="var(--warn)" />
              <span style={{ fontSize: 12, color: "var(--warnT)", lineHeight: 1.5 }}>
                云端任务需要先连接 MonkeyCode（设置 → 账号与云端）。
              </span>
            </div>
          )}
          {mode === "cloud" && cloudReady && cloudErr && (
            <div style={{ margin: "0 10px 10px", padding: "8px 11px", borderRadius: 9, background: "var(--warnBg)", border: "1px solid var(--warnBd2)", fontSize: 12, color: "var(--warnT)", lineHeight: 1.5 }}>
              {cloudErr}
            </div>
          )}
        </div>

        {attErr && <div style={{ fontSize: 12, color: "var(--err)", lineHeight: 1.6 }}>⚠ {attErr}</div>}
        {err && (
          <div style={{ fontSize: 12, color: "var(--err)", lineHeight: 1.6 }}>
            {err}
            {offerCreate && (
              <span
                className="hv-t1"
                onClick={() => void createTask(true, atts.map((a) => a.file))}
                style={{ cursor: "pointer", color: "var(--warn)", marginLeft: 8 }}
              >
                创建该目录并继续 →
              </span>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
