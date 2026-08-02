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
import { mcLogin, mcLogout, mcPasswordLogin, mcTaskDelete, mcTasks, mcTaskStop } from "./cloudapi";
import {
  getHostConfig,
  getHostInfo,
  inDesktopShell,
  isWindowsShell,
  onHostEvent,
  openLogDir,
  sessionIdFromUiIntent,
  setWindowTitle,
  takeUiIntent,
  updateCheck,
  updateInstall,
  workdirMatchesEnv,
} from "./host";
import {
  connect,
  deleteSession,
  engineRestart,
  listModels,
  listSessions,
  onEngineStatus,
  engineStatus as fetchEngineStatus,
  setSessionArchived,
  setSessionTitle,
  subscribeEvents,
} from "./session";
import { ChatView } from "./chat";
import { CloudTaskView } from "./cloudtask";
import { LogList, MONO } from "./components";
import { DownloadsBar } from "./downloadsBar";
import { CHANGE_KIND, changeTag, FilesDrawer, type FsAdapter } from "./filesdrawer";
import { IconFolder, IconX } from "./icons";
import { inspectMcAccount } from "./mcaccount";
import { workspaceRelativePath } from "./markdownPaths";
import { sameModelName } from "./modelMenu";
import { NewTaskView, type NewTaskPrefill } from "./newtask";
import { isProjectArchived, readArchivedProjects, updateArchivedProjects } from "./projectArchive";
import { initialChat, reduceBatch, type ChatState } from "./reduce";
import { noticeForSessionEvent } from "./sessionNotice";
import { groupByProject, Sidebar } from "./sidebar";
import { SettingsView } from "./settings";
import TitleBar from "./titlebar";
import { uploadFileURL } from "./uploads";
import { lastSessionId, useSession } from "./useSession";
import { updateGate } from "./updateGate";
import type { CloudProject, CloudProjectTasks, CloudTask, EngineStatus, HostInfo, LogItem, McConnectionState, ModelInfo, SessionMeta, UpdateStatus } from "./types";
import { engineBannerView, engineTransition } from "./engineBanner";

/** 内核与页面同机(serve 仅绑 loopback),浏览器 UA 即宿主平台 */
const IS_MAC = /Mac/.test(navigator.userAgent);

/** 引擎重启后的首个命令要能撞上壳的"配置应用中"闸门再退回来:Ready 事件
 * 在 adopt_engine 里就发出,而保存/重启命令持有的 DriverApplyGuard 要到
 * 命令返回时才落闸(main.rs restart_engine_locked),两者之间有微秒级窗口;
 * 连着两次重启(保存紧跟浏览器配对刷新)时窗口还会更长。退避重试几次抹平,
 * 全败也不外显——重连是后台自愈动作,调用方各自保留原状态。 */
async function afterEngineReady<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

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
  // 内核运行环境("" 本机 / "wsl:<发行版>"):新任务的最近目录/默认目录按它
  // 过滤,切换运行环境后不预填另一环境的路径。挂载读一次,此后随引擎重启
  // 的重连重拉(改运行环境必经保存,保存必重启引擎)。
  const [kernelEnv, setKernelEnv] = useState("");
  useEffect(() => {
    void getHostConfig()
      .then((c) => setKernelEnv(c?.kernel_env ?? ""))
      .catch(() => {});
  }, []);
  // 引擎生命周期外显(engine-status 事件;契约 6)。
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [engineRestarting, setEngineRestarting] = useState(false);
  // 引擎重启后壳内会话表是全新的,UI 手里的会话句柄已失效。免整页刷新:
  // Ready 时经 reconnectRef 重拉模型/会话列表并幂等重开当前会话(重连闭包
  // 每次渲染重赋,effect 只挂一次也不会攥着旧 session 句柄)。保存/手动
  // 重启/崩溃自愈/浏览器配对四条重启路径统一收敛到这一处。
  const engineWasDown = useRef(false);
  const reconnectRef = useRef<() => void>(() => {});
  useEffect(() => {
    let un: (() => void) | null = null;
    let dropped = false;
    // 事件与快照走同一条判定(记忆语义与理由见 engineTransition)
    const apply = (s: EngineStatus) => {
      const t = engineTransition(engineWasDown.current, s.phase);
      engineWasDown.current = t.wasDown;
      if (t.clearRestarting) setEngineRestarting(false);
      if (t.reconnect) reconnectRef.current();
      setEngine(s);
    };
    // 监听先于命令:补拉快照前必须先挂上监听,否则两者之间到达的状态会丢
    void onEngineStatus(apply)
      .then((off) => {
        if (dropped) off();
        else un = off;
        // 冷启动失败/启动期崩溃的状态早于窗口存在,只靠监听必然错过
        return fetchEngineStatus().then(apply);
      })
      .catch(() => {});
    return () => {
      dropped = true;
      un?.();
    };
  }, []);
  const engineBanner = engineBannerView(engine);

  // 顶部横幅与侧栏引擎卡共用的重启动作:Ready 后经统一重连路径复位
  //(engine-status 事件驱动,见上方 apply;忙态也在 Ready 时复位)
  const restartEngine = useCallback(() => {
    setEngineRestarting(true);
    engineRestart().catch((e) => {
      setEngineRestarting(false);
      setEngine({ phase: "failed", error: "重启失败: " + String(e) });
    });
  }, []);
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
  /** 项目行展开时按需拉取的任务(按项目 id 缓存)。项目列表接口只捎带每个
   * 项目最多 3 条**运行中**的任务,历史任务在里面一条都没有——想在项目下看
   * 到任务,只能展开时按 project_id 单独拉一次。 */
  const [cloudProjectTasks, setCloudProjectTasks] = useState<Record<string, CloudProjectTasks>>({});
  const loadCloudProjectTasks = useCallback(async (project: CloudProject) => {
    const id = project.id;
    if (!id) return;
    let skip = false;
    setCloudProjectTasks((cur) => {
      // 在途/已到的不重拉;要刷新走下面的清缓存(整体同步时)
      if (cur[id]?.loading || cur[id]?.tasks) {
        skip = true;
        return cur;
      }
      return { ...cur, [id]: { loading: true } };
    });
    if (skip) return;
    try {
      const resp = await mcTasks(1, 20, "", { projectId: id });
      const tasks = [...(resp.tasks ?? [])].sort((a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0));
      setCloudProjectTasks((cur) => ({ ...cur, [id]: { tasks } }));
    } catch (e) {
      setCloudProjectTasks((cur) => ({ ...cur, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }, []);
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
      // 整体刷新连带清掉项目任务缓存:仍展开着的项目由侧栏的按需拉取补回,
      // 收起的等下次展开——不在这里替所有项目预拉
      setCloudProjectTasks({});
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

  /** 账号密码直连登录(壳内自动完成 PoW 验证码;凭证不出内核)。返回
   * null=成功、string=错误文案——错误交由设置卡表单本地展示,不写
   * mcConnection.error:全局 error 会让侧栏出现「连接失败+重试连接」,
   * 而那个按钮跑的是百智桥接,语义错位。 */
  const connectCloudWithPassword = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const op = ++cloudOp.current;
      setCloudSyncing(false);
      setCloudError("");
      setMcConnection((cur) => ({ ...cur, phase: "connecting", error: undefined }));
      try {
        await mcPasswordLogin(email, password);
        // invoke 成功即会话已建立;竞态被顶掉时全局状态交给下次 syncCloud 兜底
        if (op === cloudOp.current) await syncCloud();
        return null;
      } catch (e) {
        if (op === cloudOp.current) {
          setMcConnection((cur) => ({ ...cur, phase: "disconnected", error: undefined }));
        }
        return e instanceof Error ? e.message : String(e);
      }
    },
    [syncCloud],
  );

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
  const deliverQueuedRef = useRef(session.deliverQueued);
  deliverQueuedRef.current = session.deliverQueued;
  const openNoticeSessionRef = useRef<(id: string) => Promise<void>>(async () => {});
  useEffect(
    () =>
      subscribeEvents((e) => {
        if (e.type !== "session-status" && e.type !== "session-ask" && e.type !== "session-summary") return;
        void refreshSessions(); // waiting_ask/status/summary 都在列表快照里,任一事件都重拉
        // 后台会话轮结束:补投其暂存的排队消息(当前会话由 flushQueued 负责,核心内自甄别)
        if (e.type === "session-status" && e.status) deliverQueuedRef.current(e.id, e.status);
        // 摘要是模型异步吐出来的,与用户的等待无关:只刷列表,不进提醒/未读
        if (e.type === "session-summary") return;
        if (e.id === sessionIdRef.current) return;
        const notice = noticeForSessionEvent(e);
        if (!notice) return;
        if (e.type === "session-status") setAttention((prev) => new Set(prev).add(e.id));
        notifyRef.current(notice.text, { tone: notice.tone, targetSessionId: notice.targetSessionId });
      }),
    [refreshSessions],
  );

  // 打开会话 = 接上句柄 + 复位 App 级浮层(无消费方需要稳定引用,不做 memo)
  // 引擎重启(保存/手动/自愈/浏览器配对)后的免整页刷新重连:重拉受引擎
  // 进程约束的状态(模型清单随 spawn 解析、会话列表磁盘权威、kernelEnv 随
  // 保存变化),并幂等重开当前会话——session.open 自带 stash 暂存,排队
  // 消息不丢;子会话回放浮层的连接随旧引擎死亡,直接关闭。每次渲染重赋,
  // 挂一次的 engine-status effect 经 ref 调用拿到的闭包恒新鲜。
  reconnectRef.current = () => {
    const cur = session.id;
    setChildView(null);
    void getHostConfig()
      .then((c) => setKernelEnv(c?.kernel_env ?? ""))
      .catch(() => {});
    // 各自容错:任一项拉取失败都保留现有状态,不能用空结果覆盖
    //(清空模型列表会让 composer 无模型可选,清空会话列表会被误判为"会话已删")
    void afterEngineReady(listModels)
      .then(setModels)
      .catch(() => {});
    const reopen = (meta?: SessionMeta) => {
      if (!cur) return;
      // 重开接新引擎:壳侧对未登记 sid 会懒登记并后台 resume 回放历史。
      // model/mode/think 用最新 meta,拉取失败则退回内存里的上一份快照
      const m = meta ?? sessions.find((s) => s.id === cur);
      session.open(cur, { model: m?.model, mode: m?.mode, think: m?.think });
    };
    void afterEngineReady(refreshSessions)
      .then((metas) => {
        const meta = metas.find((m) => m.id === cur);
        if (meta || !cur) return reopen(meta);
        // 会话确已不在磁盘上(重启期间被删):只在正看着它时才回落视图,
        // 免得把停在设置页/新建页的用户莫名踢走
        if (view === "session") setView(fallbackView(null));
      })
      .catch(() => reopen()); // 列表拉取失败多为瞬时:照常重连,别把用户晾在断线态
  };

  const openSession = (m: { id: string; model?: string; mode?: string; think?: string }, firstMessage?: string, firstFiles?: File[]) => {
    // 重复点开当前会话不重开连接:open 会复位状态、丢掉排队中的消息
    // (openNoticeSession 已有同语义去重,侧栏 onSelect 此前没有)
    if (m.id !== session.id || firstMessage || firstFiles?.length) {
      session.open(m.id, { model: m.model, mode: m.mode, think: m.think, firstMessage, firstFiles });
    }
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
      session.notify("无法打开:对应的任务或会话可能已被删除", { tone: "error" });
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
    session.dropStash(m.id); // 删非当前打开的会话不走 close(forget),排队暂存在此清
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
    // 壳已按新配置重启引擎:engine-status Ready 会走统一重连路径(重拉
    // 模型/会话+重开当前会话),这里只留一句可见反馈;设置页脏态也不再
    // 是障碍——不整页刷新,未保存的表单原地保留
    const offBrowserMcp = onHostEvent("browser-mcp-reloaded", () => {
      session.notify("浏览器工具已装载,内核已按新配置重连");
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
    let offForeground = () => {};
    if (inDesktopShell()) {
      void getHostInfo().then(setHostInfo);
      // 静默:自动检查失败不打扰。三个触发点共用 updateGate,30 分钟内只查一次
      const silentCheck = () => {
        if (!updateGate.tryTake()) return;
        updateCheck()
          .then(setUpdate)
          .catch(() => {});
      };
      silentCheck();
      // 切回前台就顺手看一眼:长驻应用最常见的"用了一阵子回来"就是这个时刻。
      // 前台信号沿用上面云端刷新那处的 window focus(最小化恢复、点任务栏、
      // 从桌宠唤起都会触发);桌宠是另一个 webview(pet.html),不会走到这里。
      // 密集触发全由闸门吸收,不必再听 visibilitychange。
      window.addEventListener("focus", silentCheck);
      offForeground = () => window.removeEventListener("focus", silentCheck);
      // 兜底:窗口一直开着没失去过焦点(挂着跑任务)就等不到前台事件,
      // 仍按 4 小时复查一次——被闸门挡掉也只是顺延到下一次 tick。
      updateTimer = setInterval(silentCheck, 4 * 3600_000);
    }
    return () => {
      offSettings();
      offSession();
      offBrowserMcp();
      offBrowserMcpTimeout();
      offForeground();
      clearInterval(updateTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新任务默认工作目录跟随最近会话:数据在这派生,跟随逻辑在 NewTaskView 内。
  // 只跟随当前运行环境的目录,否则切到 WSL 后仍预填 Windows 路径(反之亦然)
  const lastDir =
    [...sessions]
      .filter((m) => m.kind !== "chat" && !isProjectArchived(archivedProjects, m.workdir))
      .filter((m) => workdirMatchesEnv(m.workdir, kernelEnv))
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
  // 会话记的名字可能是加来源后缀之前的裸名:先落到当下的真实条目上,
  // 选择器高亮、思考档回查、切模型才不会齐齐落空(壳侧 model_id_of 同款兜底)
  const sessionModelEntry = session.model
    ? models.find((m) => m.name === session.model) ?? models.find((m) => sameModelName(m.name, session.model))
    : undefined;
  const currentModel = sessionModelEntry?.name || session.model || models.find((m) => m.default && !m.locked)?.name || "";
  const menuModels: ModelInfo[] = modelMenuList(models, session.model); // 下线模型兜底,无 source 归「自定义」组
  const openPerm = [...session.chat.items].reverse().find((it) => it.kind === "perm" && it.state === "open") as
    | Extract<LogItem, { kind: "perm" }>
    | undefined;
  const isNewView = isNewTaskView(view, session.id);
  const changes = session.changes;
  // 文件抽屉预览头的改动标注:路径 → 状态(树/列表内的标注在 FilesDrawer)
  const changeMap = new Map((changes ?? []).map((c) => [c.path, c.status] as const));
  // 最近用过的项目目录(侧栏同款分组;当前目录补入/截断在 NewTaskView 内做)
  // 同 lastDir:只列当前运行环境的目录
  const recentDirs = groupByProject(
    sessions.filter(
      (m) =>
        !m.archived &&
        m.kind !== "chat" &&
        !isProjectArchived(archivedProjects, m.workdir) &&
        workdirMatchesEnv(m.workdir, kernelEnv),
    ),
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
  // 页面上下文只进原生窗口标题(Alt-Tab/任务栏/Mission Control 可见);
  // 窗口内不复述——任务标题的唯一归属是 ViewHeader
  useEffect(() => {
    setWindowTitle(`${windowContext} - MonkeyCode`);
  }, [windowContext]);

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
      {isWindowsShell() && <TitleBar layout={view === "settings" ? "settings" : "sidebar"} />}
      {/* 右下角全局下载条:云端文件下载的进度/结果,跨页面常显(fixed 定位不占布局) */}
      <DownloadsBar />
      {/* 引擎生命周期横幅(契约 6):崩溃/退避中/熔断/启动失败都在这里外显。
          不外显的话会话流只会无限重连,表现为无提示的卡死 */}
      {engineBanner && (
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            background: "var(--errBg)",
            borderBottom: "1px solid var(--err)",
            fontSize: 12.5,
          }}
        >
          <span style={{ color: "var(--err)", fontWeight: 600, flex: "none" }}>⚠ {engineBanner.text}</span>
          {engineBanner.detail && (
            <span className="ellipsis selectable" style={{ color: "var(--t4)", fontSize: 11.5, minWidth: 0, font: `11.5px ${MONO}` }} title={engineBanner.detail}>
              {engineBanner.detail}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {engineBanner.canRestart && (
            <button
              className="hv-acc"
              disabled={engineRestarting || engineBanner.busy}
              onClick={restartEngine}
              style={{ height: 26, padding: "0 14px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, background: "var(--acc)", color: "var(--onAcc)" }}
            >
              {engineRestarting ? "重启中…" : "重启引擎"}
            </button>
          )}
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
          engine={engine}
          engineBusy={engineRestarting}
          onEngineRestart={restartEngine}
          onOpenLogDir={() => {
            openLogDir().catch((e) => console.error("打开日志目录失败", e));
          }}
          update={update}
          updateBusy={updateBusy}
          onUpdate={() => void installUpdate()}
          mcConnection={mcConnection}
          cloudTasks={cloudTasks}
          cloudHistory={cloudHistory}
          cloudProjects={cloudProjects}
          cloudProjectTasks={cloudProjectTasks}
          onLoadCloudProjectTasks={(project) => void loadCloudProjectTasks(project)}
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
            onPasswordLoginMc={connectCloudWithPassword}
            onRetryMc={() => void syncCloud()}
            onDisconnectMc={() => void disconnectCloud()}
            hasRunningTask={sessions.some((s) => s.status === "running")}
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
            onRename={(title) => currentMeta && void renameSession(currentMeta, title)}
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
      // 子会话只读回放:尾部窗口够看完整过程,不做"加载更早"
      onHistory: (page) => setChat((s) => reduceBatch(s, page.frames)),
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
