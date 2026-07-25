// 布局切换 + App 级浮层(改动抽屉/子会话回放/设置):侧栏常驻,主区在
// Chat / New Task / Settings 三屏间切换。会话协议状态(WS/帧归约/composer)
// 收口在 useSession 句柄里;视觉对照「MonkeyCode 桌面应用设计」。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fallbackView,
  isNewTaskView,
  modelMenuList,
  resolveKeyAction,
  windowContextLabel,
  type AppMainView,
} from "./appView";
import { mcLogin, mcLogout, mcTaskDelete, mcTaskStop } from "./cloudapi";
import {
  getHostInfo,
  inDesktopShell,
  isWindowsShell,
  onHostEvent,
  sessionIdFromUiIntent,
  takeUiIntent,
  updateCheck,
  updateInstall,
} from "./host";
import {
  connect,
  deleteSession,
  engineRestart,
  listModels,
  listSessions,
  onEngineCrashed,
  setSessionArchived,
  setSessionTitle,
  subscribeEvents,
} from "./session";
import { ChatView } from "./chat";
import { CloudTaskView } from "./cloudtask";
import { LogList, MONO } from "./components";
import { CHANGE_KIND, changeTag, FilesDrawer, type FsAdapter } from "./filesdrawer";
import { IconFolder, IconX } from "./icons";
import { inspectMcAccount } from "./mcaccount";
import { workspaceRelativePath } from "./markdownPaths";
import { NewTaskView, type NewTaskPrefill } from "./newtask";
import { isProjectArchived, readArchivedProjects, updateArchivedProjects } from "./projectArchive";
import { initialChat, reduceBatch, type ChatState } from "./reduce";
import { noticeForSessionEvent } from "./sessionNotice";
import { groupByProject, Sidebar } from "./sidebar";
import { SettingsView } from "./settings";
import TitleBar from "./titlebar";
import { uploadFileURL } from "./uploads";
import { lastSessionId, useSession } from "./useSession";
import type { CloudProject, CloudTask, EngineCrash, HostInfo, LogItem, McConnectionState, ModelInfo, SessionMeta, UpdateStatus } from "./types";

/** 内核与页面同机(serve 仅绑 loopback),浏览器 UA 即宿主平台 */
const IS_MAC = /Mac/.test(navigator.userAgent);
export default function App() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Set<string>>(readArchivedProjects);
  const [view, setView] = useState<AppMainView>("new");
  // 页内设置视图的脏状态(浏览器回退模式;桌面走独立设置窗口):离开前确认
  const settingsDirty = useRef(false);
  const closeSettings = () => {
    if (settingsDirty.current && !window.confirm("有未保存的更改,确定离开设置?")) return;
    setView(fallbackView(session.id));
  };
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hostInfo, setHostInfo] = useState<HostInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  // 侧栏更新横幅:下载安装并重启(成功不返回;失败解除忙态并外显)
  const installUpdate = async () => {
    if (updateBusy) return;
    setUpdateBusy(true);
    try {
      await updateInstall();
    } catch (e) {
      setUpdateBusy(false);
      session.notify("⚠ 更新失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };
  // 引擎崩溃外显(engine-crashed 事件;重启成功后整页刷新复位)
  const [engineCrash, setEngineCrash] = useState<EngineCrash | null>(null);
  const [engineRestarting, setEngineRestarting] = useState(false);
  useEffect(() => onEngineCrashed(setEngineCrash), []);
  // App 级浮层;文件抽屉 = 工作区资源管理器(cwd 逐层导航 + 文件查看器)。
  // 渲染与树/预览状态整体收敛进共享 FilesDrawer(filesdrawer.tsx),App 只留
  // 开合与初始 tab(文件 / 改动)+ Esc 挂点(先关预览再关抽屉)
  const [drawer, setDrawer] = useState<"files" | "changes" | null>(null);
  const drawerEscRef = useRef<(() => boolean) | null>(null);
  const [childView, setChildView] = useState<string | null>(null);
  // 新建任务表单状态整体在 NewTaskView 内(随视图生命周期);App 只保留外部
  // 预填触发(侧栏本地/云端/对话 +、项目行 +)——每次触发都换新对象,同入口重复点击也生效
  const [newTaskPrefill, setNewTaskPrefill] = useState<NewTaskPrefill | null>(null);
  const setProjectArchived = (workdir: string, archived: boolean) => {
    setArchivedProjects((current) => updateArchivedProjects(current, workdir, archived));
  };

  // ===== MonkeyCode 云端账号与任务 =====
  // 百智云登录只用于显式桥接授权;这里独立持有 MonkeyCode 关联态。
  // 任务数组不再以 null 兼任账号状态,空列表只表示“已关联但暂无任务”。
  const [cloudTask, setCloudTaskOpen] = useState<CloudTask | null>(null);
  /** Web 同款三段数据：快速任务、历史任务、带最近任务的项目。 */
  const [cloudTasks, setCloudTasks] = useState<CloudTask[]>([]);
  const [cloudHistory, setCloudHistory] = useState<CloudTask[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [mcConnection, setMcConnection] = useState<McConnectionState>({
    phase: "checking",
    host: "monkeycode-ai.com",
  });
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudError, setCloudError] = useState("");
  // 聚焦刷新、手动连接/断开可能交叠;只允许最后一次操作回写状态。
  const cloudOp = useRef(0);
  const syncCloud = useCallback(async () => {
    const op = ++cloudOp.current;
    setCloudSyncing(true);
    setCloudError("");
    try {
      // 只探测既有会话;inspectMcAccount 的依赖面不包含登录操作。
      const snapshot = await inspectMcAccount();
      if (op !== cloudOp.current) return;
      const st = snapshot.status;
      const host = st.host || "monkeycode-ai.com";
      if (!st.logged_in) {
        setMcConnection({ phase: "disconnected", host });
        setCloudTasks([]);
        setCloudHistory([]);
        setCloudProjects([]);
        return;
      }
      setMcConnection({ phase: "connected", host, user: st.user });
      // 三个列表独立容错：失败的部分保留上次结果，成功的部分照常刷新。
      if (snapshot.tasks !== undefined) setCloudTasks(snapshot.tasks);
      if (snapshot.historicalTasks !== undefined) setCloudHistory(snapshot.historicalTasks);
      if (snapshot.projects !== undefined) setCloudProjects(snapshot.projects);
      if (snapshot.taskError) setCloudError(snapshot.taskError);
    } catch (e) {
      if (op !== cloudOp.current) return;
      setMcConnection((cur) => ({
        ...cur,
        phase: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
      setCloudTasks([]);
      setCloudHistory([]);
      setCloudProjects([]);
    } finally {
      if (op === cloudOp.current) setCloudSyncing(false);
    }
  }, []);

  const connectCloud = useCallback(async () => {
    const op = ++cloudOp.current;
    setCloudSyncing(false);
    setCloudError("");
    setMcConnection((cur) => ({ ...cur, phase: "connecting", error: undefined }));
    try {
      await mcLogin();
      if (op !== cloudOp.current) return;
      await syncCloud();
    } catch (e) {
      if (op !== cloudOp.current) return;
      setMcConnection((cur) => ({
        ...cur,
        phase: "disconnected",
        error: e instanceof Error ? e.message : String(e),
      }));
      setCloudTasks([]);
      setCloudHistory([]);
      setCloudProjects([]);
    }
  }, [syncCloud]);

  const disconnectCloud = useCallback(async () => {
    const op = ++cloudOp.current;
    setCloudSyncing(false);
    setCloudError("");
    setMcConnection((cur) => ({ ...cur, phase: "disconnecting", error: undefined }));
    try {
      await mcLogout();
      if (op !== cloudOp.current) return;
      setMcConnection((cur) => ({ phase: "disconnected", host: cur.host }));
      setCloudTasks([]);
      setCloudHistory([]);
      setCloudProjects([]);
      setCloudTaskOpen(null);
    } catch (e) {
      if (op !== cloudOp.current) return;
      setMcConnection((cur) => ({
        ...cur,
        phase: "connected",
        error: "断开失败: " + (e instanceof Error ? e.message : String(e)),
      }));
    }
  }, []);

  // 启动只恢复已有 MonkeyCode 会话;离开设置页也重查,但不再自动桥接登录。
  useEffect(() => {
    if (view !== "settings") void syncCloud();
  }, [view, syncCloud]);
  // 窗口重获焦点即刷新:网页/手机端刚派发的任务切回来就能看到(不等轮询)
  useEffect(() => {
    const onFocus = () => void syncCloud();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [syncCloud]);
  const cloudConnected = mcConnection.phase === "connected";
  useEffect(() => {
    if (!cloudConnected) return;
    const t = setInterval(() => void syncCloud(), 30_000);
    return () => clearInterval(t);
  }, [cloudConnected, syncCloud]);
  // 桌面内打开的云端任务(view === "cloud" 时渲染详情视图)
  const openCloudTask = (t: CloudTask) => {
    setCloudTaskOpen(t);
    setDrawer(null);
    setView("cloud");
  };
  const closeCloudTask = () => {
    setCloudTaskOpen(null);
    setView(fallbackView(session.id));
    void syncCloud();
  };

  const stopCloudTask = async (task: CloudTask) => {
    setCloudError("");
    try {
      await mcTaskStop(task.id);
      await syncCloud();
    } catch (e) {
      setCloudError("终止任务失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  const deleteCloudTask = async (task: CloudTask) => {
    setCloudError("");
    try {
      await mcTaskDelete(task.id);
      setCloudTasks((current) => current.filter((item) => item.id !== task.id));
      setCloudHistory((current) => current.filter((item) => item.id !== task.id));
      setCloudProjects((current) => current.map((project) => ({
        ...project,
        tasks: project.tasks?.filter((item) => item.id !== task.id),
      })));
      if (cloudTask?.id === task.id) {
        setCloudTaskOpen(null);
        setView(fallbackView(session.id));
      }
      await syncCloud();
    } catch (e) {
      setCloudError("删除任务失败：" + (e instanceof Error ? e.message : String(e)));
    }
  };

  const refreshSessions = useCallback(async () => {
    const metas = await listSessions();
    setSessions(metas);
    return metas;
  }, []);

  const session = useSession({ onSessionsChanged: () => void refreshSessions() });

  // 后台会话提醒:内核事件流推送状态变更(不轮询),非当前会话等待审批/
  // 到达终态时在 Composer 上方给带类型、可跳转的短暂提示。
  const [attention, setAttention] = useState<Set<string>>(new Set());
  const sessionIdRef = useRef(session.id);
  sessionIdRef.current = session.id;
  const notifyRef = useRef(session.notify);
  notifyRef.current = session.notify;
  const openNoticeSessionRef = useRef<(id: string) => Promise<void>>(async () => {});
  useEffect(
    () =>
      subscribeEvents((e) => {
        if (e.type !== "session-status" && e.type !== "session-ask") return;
        void refreshSessions(); // waiting_ask/status 都在列表快照里,任一事件都重拉
        if (e.id === sessionIdRef.current) return;
        const notice = noticeForSessionEvent(e);
        if (!notice) return;
        if (e.type === "session-status") setAttention((prev) => new Set(prev).add(e.id));
        notifyRef.current(notice.text, { tone: notice.tone, targetSessionId: notice.targetSessionId });
      }),
    [refreshSessions],
  );

  // 打开会话 = 接上句柄 + 复位 App 级浮层(无消费方需要稳定引用,不做 memo)
  const openSession = (m: { id: string; model?: string; mode?: string }, firstMessage?: string, firstFiles?: File[]) => {
    session.open(m.id, { model: m.model, mode: m.mode, firstMessage, firstFiles });
    setAttention((prev) => {
      if (!prev.has(m.id)) return prev;
      const next = new Set(prev);
      next.delete(m.id);
      return next;
    });
    setView("session");
    setDrawer(null);
  };

  // 点击后台会话提示:优先用现有侧栏快照,极小竞态下重拉一次再打开。
  const openNoticeSession = async (id: string) => {
    if (id === session.id) {
      session.dismissNotice();
      setView("session");
      setDrawer(null);
      return;
    }
    let target = sessions.find((m) => m.id === id);
    if (!target) {
      try {
        target = (await refreshSessions()).find((m) => m.id === id);
      } catch {
        // 下方统一给不可跳转提示
      }
    }
    if (!target) {
      session.notify("无法打开对应会话,它可能已被删除", { tone: "error" });
      return;
    }
    session.dismissNotice();
    openSession(target);
  };
  openNoticeSessionRef.current = openNoticeSession;

  // 归档/取消归档:仅列表位置变化,当前打开的会话不强制关闭
  const archiveSession = async (m: SessionMeta) => {
    try {
      await setSessionArchived(m.id, !m.archived);
      await refreshSessions();
    } catch (e) {
      session.notify("⚠ 归档失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // 重命名会话(标题非空;当前打开的会话头部随 sessions 刷新自动更新)
  const renameSession = async (m: SessionMeta, title: string) => {
    try {
      await setSessionTitle(m.id, title);
      await refreshSessions();
    } catch (e) {
      session.notify("⚠ 重命名失败: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  // 删除会话;若删的是当前打开的会话,复位回新建任务视图
  const removeSession = async (m: SessionMeta) => {
    try {
      await deleteSession(m.id);
    } catch (e) {
      session.notify("⚠ 删除失败: " + (e instanceof Error ? e.message : String(e)));
      return;
    }
    if (m.id === session.id) {
      session.close(true);
      setView("new");
      setDrawer(null);
    }
    void refreshSessions();
  };

  // 打开设置视图:先复位 App 级浮层(文件抽屉的遮罩不能盖在设置页上),
  // 与 openSession/removeSession 的复位语义对齐。侧栏齿轮与托盘事件共用。
  const latestUiIntentRef = useRef<string | null>(null); // 启动恢复会话不得覆盖托盘/桌宠请求
  const openSettings = () => {
    setDrawer(null);
    setView("settings");
  };

  // 启动:拉模型清单 + 恢复上次会话;桌面壳内无模型(首启/被清空)直接进设置向导。
  // 订阅壳的托盘"设置"事件(唤起页内设置视图),静默检查一次应用更新(齿轮小圆点)。
  useEffect(() => {
    const offSettings = onHostEvent("open-settings", () => {
      latestUiIntentRef.current = "open-settings";
      void takeUiIntent(); // 事件已送达:消费壳的待取副本,防下次整页加载重放
      openSettings();
    });
    const offSession = onHostEvent<string>("open-session", (id) => {
      if (!id) return;
      latestUiIntentRef.current = `open-session:${id}`;
      void takeUiIntent();
      void openNoticeSessionRef.current(id);
    });
    const offBrowserMcp = onHostEvent("browser-mcp-reloaded", () => {
      if (settingsDirty.current) {
        session.notify("浏览器工具已更新；请先保存当前设置，页面随后会重新连接 Agent");
        return;
      }
      location.reload();
    });
    // 壳等任务空闲重启引擎超时后放弃(见 main.rs BROWSER_MCP_REFRESH_DEADLINE)。
    // 不能静默:用户配对完扩展却发现模型没有 browser_* 工具会以为配对失败。
    const offBrowserMcpTimeout = onHostEvent("browser-mcp-refresh-timeout", () => {
      session.notify("浏览器工具尚未装载:等待任务空闲超时。任务结束后保存设置或在设置页重启引擎即可生效");
    });
    Promise.all([listModels().catch(() => [] as ModelInfo[]), refreshSessions()])
      .then(([ms, metas]) => {
        setModels(ms);
        const last = lastSessionId();
        const meta = metas.find((m) => m.id === last);
        if (meta) openSession(meta);
        if (ms.length === 0 && inDesktopShell()) setView("settings");
        // 托盘"设置"兜底:页面未就绪时事件会丢(壳侧发后不管),意图落在壳的
        // 待取状态,这里补取;启动期间事件先到、又被上面恢复会话覆盖的同理。
        void takeUiIntent().then((pendingIntent) => {
          const intent = pendingIntent ?? latestUiIntentRef.current;
          const requestedSession = sessionIdFromUiIntent(intent);
          if (requestedSession) void openNoticeSessionRef.current(requestedSession);
          else if (intent === "open-settings") openSettings();
        });
      })
      .catch((e) => session.notify("无法连接服务: " + (e instanceof Error ? e.message : e)));
    let updateTimer: ReturnType<typeof setInterval> | undefined;
    if (inDesktopShell()) {
      void getHostInfo().then(setHostInfo);
      const silentCheck = () =>
        updateCheck()
          .then(setUpdate)
          .catch(() => {}); // 静默:自动检查失败不打扰
      silentCheck();
      // 长驻应用不重启就永远发现不了新版:每 4 小时静默复查一次
      updateTimer = setInterval(silentCheck, 4 * 3600_000);
    }
    return () => {
      offSettings();
      offSession();
      offBrowserMcp();
      offBrowserMcpTimeout();
      clearInterval(updateTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新任务默认工作目录跟随最近会话:数据在这派生,跟随逻辑在 NewTaskView 内
  const lastDir =
    [...sessions]
      .filter((m) => m.kind !== "chat" && !isProjectArchived(archivedProjects, m.workdir))
      .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0]?.workdir ?? "";

  // 本地文件抽屉的数据适配:与云端同名协议(repo_file_list / repo_read_file /
  // repo_file_diff)经会话 WS(useSession 句柄);渲染在共享 FilesDrawer
  const localFs: FsAdapter = {
    listDir: async (dir) => {
      // 内核已按目录在前排好
      const r = await session.listFiles(dir);
      if (r.error) throw new Error(r.error);
      return (r.result ?? []).map((e) => ({ name: e.name, path: e.path, isDir: e.is_dir, size: e.size }));
    },
    readFile: async (en) => {
      const r = await session.readFile(en.path);
      if (r.error) throw new Error(r.error);
      return { content: r.result?.content ?? "" };
    },
    // 查询层错误并入 diff 文本(历史行为:错误占位也经 DiffPanel 渲染)
    diff: async (path) => {
      const r = await session.fileDiff(path);
      return r.error ? "✗ " + r.error : r.result?.diff || "(无差异)";
    },
    diffTransientKind: "diff",
  };

  // 工作区相对路径 → 绝对路径(Windows workdir 为反斜杠时统一分隔符)
  const absPath = (rel: string) => {
    const wd = currentMeta?.workdir ?? "";
    if (!rel) return wd;
    const sep = wd.includes("\\") ? "\\" : "/";
    const tail = sep === "\\" ? rel.split("/").join(sep) : rel;
    return wd.endsWith(sep) ? wd + tail : wd + sep + tail;
  };

  // 在系统文件管理器中定位:内核在本机执行(open/explorer/xdg-open),
  // 壳内与浏览器模式行为一致;失败时复制绝对路径兜底
  const revealPath = async (rel: string) => {
    try {
      const r = await session.reveal(rel);
      if (r.error) throw new Error(r.error);
    } catch (e) {
      const p = absPath(rel);
      try {
        await navigator.clipboard.writeText(p);
        session.notify("⚠ 无法打开文件夹,已复制路径: " + p);
      } catch {
        session.notify("⚠ 无法打开文件夹: " + (e instanceof Error ? e.message : String(e)));
      }
    }
  };

  // 打开抽屉(可指定视角:聊天区徽标直达「改动」);改动数据即刷,
  // 文件树由 FilesDrawer 挂载时自取(关闭即卸载,重开自然是全新状态)
  const openDrawer = (tab: "files" | "changes" = "files") => {
    setDrawer(tab);
    void session.refreshChanges();
  };

  // ===== 派生状态 =====
  const currentMeta = sessions.find((m) => m.id === session.id);
  const currentModel = session.model || models.find((m) => m.default)?.name || "";
  const menuModels: ModelInfo[] = modelMenuList(models, session.model); // 下线模型兜底,无 source 归「自定义」组
  const openPerm = [...session.chat.items].reverse().find((it) => it.kind === "perm" && it.state === "open") as
    | Extract<LogItem, { kind: "perm" }>
    | undefined;
  const isNewView = isNewTaskView(view, session.id);
  const changes = session.changes;
  // 文件抽屉预览头的改动标注:路径 → 状态(树/列表内的标注在 FilesDrawer)
  const changeMap = new Map((changes ?? []).map((c) => [c.path, c.status] as const));
  // 最近用过的项目目录(侧栏同款分组;当前目录补入/截断在 NewTaskView 内做)
  const recentDirs = groupByProject(
    sessions.filter((m) => !m.archived && m.kind !== "chat" && !isProjectArchived(archivedProjects, m.workdir)),
  ).map((g) => g.dir);

  // ===== 全局快捷键:⇧⇥ 权限模式、⏎/esc 应答审批、esc 关闭浮层 =====
  // 输入态 Esc(清空/取消输入法/关自动补全)只收敛焦点,不触发视图级动作
  // ——尤其不能当作审批拒绝(deny 不可逆);先 blur,想应答再按一次。
  // 优先级与守卫全在 appView.resolveKeyAction(纯函数,单测覆盖),这里只做
  // DOM 读取与动作派发。
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const action = resolveKeyAction({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.isComposing,
        targetTag: t?.tagName,
        inTerminal: view === "cloud" && !!t?.closest?.(".xterm"),
        view,
        sessionId: session.id,
        childOpen: !!childView,
        drawerOpen: !!drawer,
        openPermId: openPerm?.id ?? null,
        inputText: session.input,
      });
      if (action.preventDefault) e.preventDefault();
      switch (action.type) {
        case "toggle-yolo":
          return void session.toggleYolo();
        case "close-child":
          return setChildView(null);
        case "close-drawer":
          if (drawerEscRef.current?.()) return; // 先关文件查看器,再关抽屉
          return setDrawer(null);
        case "blur":
          return t?.blur();
        case "close-settings":
          return closeSettings();
        case "close-cloud":
          return closeCloudTask();
        case "answer-perm":
          return session.answerPerm(action.id, action.action);
        default:
          return;
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const windowContext = windowContextLabel(view, cloudTask, currentMeta);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        background: "var(--bg)",
        color: "var(--t1)",
        fontSize: 13,
        overflow: "hidden",
      }}
    >
      {/* Windows 壳:装饰栏已去除,自绘 36px 标题栏(品牌/上下文 + 拖拽 + 窗口按钮) */}
      {isWindowsShell() && <TitleBar context={windowContext} layout={view === "settings" ? "settings" : "sidebar"} />}
      {/* 引擎崩溃横幅:进程监视发现非正常退出时外显 + 一键重启
          (不外显的话会话流只会无限重连,表现为无提示的卡死) */}
      {engineCrash && (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background: "rgba(248,113,113,.1)",
            borderBottom: "1px solid var(--err)",
            fontSize: 12.5,
          }}
        >
          <span style={{ color: "var(--err)", fontWeight: 600, flex: "none" }}>⚠ {engineCrash.detail}</span>
          {engineCrash.log_tail && (
            <span className="ellipsis" style={{ color: "var(--t4)", fontSize: 11.5, minWidth: 0, font: `11.5px ${MONO}` }} title={engineCrash.log_tail}>
              {engineCrash.log_tail.trim().split("\n").pop()}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button
            className="hv-acc"
            disabled={engineRestarting}
            onClick={() => {
              setEngineRestarting(true);
              engineRestart()
                .then(() => location.reload())
                .catch((e) => {
                  setEngineRestarting(false);
                  setEngineCrash((c) => (c ? { ...c, detail: "重启失败: " + String(e) } : c));
                });
            }}
            style={{ height: 26, padding: "0 14px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, background: "var(--acc)", color: "var(--onAcc)" }}
          >
            {engineRestarting ? "重启中…" : "重启引擎"}
          </button>
        </div>
      )}
      {/* 原根容器降级为内容行:改动抽屉的 absolute 以此为锚,始终盖在标题栏之下 */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
      {/* 设置态:设置视图自带左导航,主侧栏隐藏,设置占满主窗口(单侧栏) */}
      {view !== "settings" && (
        <Sidebar
          sessions={sessions}
          archivedProjects={archivedProjects}
          currentId={session.id}
          attention={attention}
          sessionActive={view === "session"}
          connected={session.connected}
          status={session.status}
          update={update}
          updateBusy={updateBusy}
          onUpdate={() => void installUpdate()}
          mcConnection={mcConnection}
          cloudTasks={cloudTasks}
          cloudHistory={cloudHistory}
          cloudProjects={cloudProjects}
          activeCloudId={view === "cloud" ? cloudTask?.id ?? null : null}
          cloudSyncing={cloudSyncing}
          cloudError={cloudError}
          onConnectCloud={() => void connectCloud()}
          onRefreshCloud={() => void syncCloud()}
          onNewCloudTask={(project) => {
            setNewTaskPrefill({ mode: "cloud", cloudProject: project ?? null });
            setView("new");
          }}
          onOpenCloudTask={openCloudTask}
          onStopCloudTask={(task) => void stopCloudTask(task)}
          onDeleteCloudTask={(task) => void deleteCloudTask(task)}
          onSelect={(m) => openSession(m)}
          onNewTask={(dir) => {
            setNewTaskPrefill({ dir, mode: "local" });
            setView("new");
          }}
          onProjectArchive={setProjectArchived}
          onNewChat={() => {
            setNewTaskPrefill({ mode: "chat" });
            setView("new");
          }}
          onOpenSettings={openSettings}
          onArchive={(m) => void archiveSession(m)}
          onDelete={(m) => void removeSession(m)}
          onRename={(m, title) => void renameSession(m, title)}
        />
      )}

      {/* ============ 主区 ============ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {view === "settings" ? (
          <SettingsView
            onClose={closeSettings}
            onDirtyChange={(d) => {
              settingsDirty.current = d;
            }}
            hostVersion={hostInfo?.version ?? null}
            engineVersion={hostInfo?.engine_version ?? null}
            update={update}
            onUpdateStatus={setUpdate}
            mcConnection={mcConnection}
            onConnectMc={() => void connectCloud()}
            onRetryMc={() => void syncCloud()}
            onDisconnectMc={() => void disconnectCloud()}
          />
        ) : view === "cloud" && cloudTask ? (
          <CloudTaskView
            key={cloudTask.id}
            task={cloudTask}
            mcHost={mcConnection.host}
            onTasksChanged={() => void syncCloud()}
          />
        ) : isNewView ? (
          <NewTaskView
            models={models}
            lastDir={lastDir}
            recentDirs={recentDirs}
            prefill={newTaskPrefill}
            cloudReady={cloudConnected}
            onCloudCreated={(t) => {
              openCloudTask(t);
              void syncCloud();
            }}
            onCreated={async (meta, first, files) => {
              // 从任意入口在旧目录新建任务，都视为重新启用该项目。
              if (meta.kind !== "chat") setProjectArchived(meta.workdir, false);
              await refreshSessions();
              // 附件在会话连上后由 useSession 上传并随首条消息发出
              openSession(meta, first, files);
            }}
          />
        ) : (
          <ChatView
            meta={currentMeta}
            session={session}
            models={menuModels}
            currentModel={currentModel}
            chatMode={currentMeta?.kind === "chat"}
            onOpenDrawer={openDrawer}
            onOpenChild={setChildView}
            onOpenNoticeSession={(id) => void openNoticeSession(id)}
            onArchive={() => currentMeta && void archiveSession(currentMeta)}
            onDelete={() => currentMeta && void removeSession(currentMeta)}
          />
        )}
      </div>

      {/* ============ 文件抽屉:工作区资源管理器(标注本轮改动;共享 FilesDrawer) ============ */}
      {drawer && (
        <FilesDrawer
          adapter={localFs}
          onClose={() => setDrawer(null)}
          initialTab={drawer}
          changes={changes}
          showChangesTab={session.isGitRepo === true}
          externalErr={session.changesErr}
          resizable
          errPad="0 20px 8px"
          dirChangeBadges
          emptyRootState={
            <div style={{ padding: "36px 0 28px", display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
              <IconFolder size={22} color="var(--t6)" />
              <span style={{ fontSize: 12, color: "var(--t5)" }}>工作区是空的</span>
            </div>
          }
          changesEmptyText="本轮还没有文件改动"
          viewerCloseTitle="关闭,回到文件列表 (esc)"
          escRef={drawerEscRef}
          headerExtra={
            <button
              className="hv-acc"
              title={currentMeta?.workdir ?? ""}
              onClick={() => void revealPath("")}
              style={{ flex: "none", height: 26, border: "none", background: "var(--acc)", color: "var(--onAcc)", borderRadius: 7, padding: "0 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "var(--accSh)" }}
            >
              <IconFolder size={12} color="var(--onAcc)" />
              {IS_MAC ? "在访达中打开" : "打开文件夹"}
            </button>
          }
          viewerExtra={(path) => {
            const st = changeMap.get(path);
            const kind = st ? CHANGE_KIND[st] : undefined;
            return (
              <>
                {kind && <span style={{ ...changeTag, color: kind.fg, background: kind.bg }}>{kind.text}</span>}
                <button
                  className="hv"
                  title="在系统文件管理器中定位此文件(浏览器模式复制路径)"
                  onClick={() => void revealPath(path)}
                  style={{ marginLeft: "auto", flex: "none", height: 22, display: "flex", alignItems: "center", gap: 5, border: "none", background: "transparent", borderRadius: 6, padding: "0 8px", fontSize: 11.5, fontWeight: 600, color: "var(--t3)", cursor: "pointer" }}
                >
                  <IconFolder size={11} color="var(--t4)" />
                  {IS_MAC ? "在访达中显示" : "打开所在文件夹"}
                </button>
              </>
            );
          }}
        />
      )}

      {/* ============ 子代理会话回放 ============ */}
      {childView && (
        <div
          onClick={() => setChildView(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim2)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 92vw)",
              maxHeight: "84vh",
              background: "var(--pop)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              boxShadow: "var(--shadowLg)",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              animation: "mcin .2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12, whiteSpace: "nowrap" }}>
              <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>
                子代理会话 {childView}
              </span>
              <button className="hv2 icon-btn" onClick={() => setChildView(null)} style={{ marginLeft: "auto", width: 24, height: 24 }}>
                <IconX size={11} color="var(--t4)" />
              </button>
            </div>
            <SessionViewer id={childView} workdir={currentMeta?.workdir} />
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

/** 子会话只读回放/跟看:复用同一 WS 协议(服务端对子会话走观察者路径) */
function SessionViewer({ id, workdir }: { id: string; workdir?: string }) {
  const [chat, setChat] = useState<ChatState>(initialChat);
  const [status, setStatus] = useState("连接中…");
  const connRef = useRef<ReturnType<typeof connect> | null>(null);

  useEffect(() => {
    const conn = connect(id, {
      onFrames: (batch) => setChat((s) => reduceBatch(s, batch)),
      onStatus: (text) => setStatus(text),
    });
    connRef.current = conn;
    return () => {
      connRef.current = null;
      conn.close();
    };
  }, [id]);

  const revealLocalLink = (path: string) => {
    const rel = workspaceRelativePath(path, workdir ?? "");
    if (rel === null) {
      setStatus("只能打开当前工作区内的文件");
      return;
    }
    const conn = connRef.current;
    if (!conn) return;
    conn
      .call<{ error?: string }>("repo_reveal", { path: rel })
      .then((r) => r.error && setStatus("无法定位文件: " + r.error))
      .catch((e) => setStatus("无法定位文件: " + (e instanceof Error ? e.message : String(e))));
  };

  return (
    <div style={{ overflowY: "auto", flex: 1, paddingRight: 6, display: "flex", flexDirection: "column", gap: 14, lineHeight: 1.8 }}>
      <div style={{ color: "var(--t4)", fontSize: 12 }}>{status}</div>
      <LogList
        items={chat.items}
        onPermAnswer={() => {}}
        uploadUrl={(path) => uploadFileURL(id, path)}
        onLocalLink={revealLocalLink}
        workdir={workdir}
      />
    </div>
  );
}
