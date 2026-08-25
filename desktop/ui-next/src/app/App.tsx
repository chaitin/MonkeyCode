// 壳层拼装:标题栏 + **工作台主壳**(2026-08-18 用户终案「工作台升级为
// 主界面」:旧 rail/侧栏/单会话主区三列壳退役——导航收进工作台任务列的
// 三 tab,设置/新建仍是覆盖视图,云端任务与本地任务/会话一样入格)。
// App 级职责剩五件事件驱动的"粘合":
// - D1 引擎重启自愈:engine-status 记住"曾不可用",Ready 后重拉列表并给
//   格内 ChatView 递 epoch 重开信号;
// - D3 后台会话提醒:不在任何可见格的会话等待审批/转终态 → 可点击 toast
//   (点击经 place 装格,人不离开工作台)+ 任务列行 attention;
// - D8 增量自愈:session-event/意图指向未知 id → 重拉全表再装载;
// - H9 意图消费:open-* 事件送达即 takeUiIntent 消费壳侧副本,防刷新重放;
// - 首开播种:槽位全空时把 mc.lastSession(旧壳契约键)带进首叶,升级
//   不丢"上次看的那个"。
import { IconAlertCircle, IconCircleCheck, IconHelpCircle, IconPlayerStop, IconSend, IconWorld, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCloudProjects, useCloudTasks } from "@/features/cloud/CloudTaskList";
import { CloudQueueCoordinatorProvider } from "@/features/cloud/CloudQueueCoordinator";
import { DownloadsDock } from "@/features/downloads/DownloadsDock";
import { EngineBanner } from "@/features/engine/EngineBanner";
import { SettingsView, type SettingsViewHandle } from "@/features/settings/SettingsView";
import { SplitView } from "@/features/split/SplitView";
import { cloudSlotId, isCloudSlotId } from "@/features/split/slots";
import { useSplitState } from "@/features/split/useSplitState";
import { useTodos } from "@/features/todo/useTodos";
import { ResizeEdges } from "@/features/titlebar/ResizeEdges";
import { MacWindowControls, TitleBar } from "@/features/titlebar/TitleBar";
import { useI18n, type MessageKey } from "@/lib/i18n";
import {
  isCustomChromeShell,
  isMacShell,
  sessionIdFromUiIntent,
  setWindowTitle,
  takeUiIntent,
} from "@/lib/ipc/host";
import { inDesktopShell, listen } from "@/lib/ipc/ipc";
import { afterEngineReady, engineRestart, engineStatus, onEngineStatus, type EngineStatus } from "@/lib/ipc/engine";
import { todoUploadsDir, type TodoItem } from "@/lib/ipc/todos";
import { pathBackedFile } from "@/lib/ipc/uploads";
import {
  modelsList,
  onSessionEvent,
  sessionDelete,
  sessionPatch,
  sessionsList,
  type SessionMeta,
} from "@/lib/ipc/sessions";
import { noticeForQueuedDelivery, noticeForSessionEvent, type NoticeKind, type SessionNotice } from "@/lib/notices";
import { deliverQueued, dropStash } from "@/features/chat/composer/stash";
import { readLastSession } from "@/lib/util/prefs";
import { projectKey, readArchivedProjects } from "@/lib/util/projects";
import { McTransportProvider } from "@/lib/mcTransport";
import { appShortcutOfEvent } from "./shortcuts";

const NOTICE_TONE: Record<NoticeKind, string> = {
  ask: "alert-warning",
  done: "alert-success",
  error: "alert-error",
  interrupted: "alert-warning",
  queued: "alert-success",
};

/** kind → 语义图标(与 composer 反馈条同一套视觉语言:14px tabler)。 */
const NOTICE_ICON: Record<NoticeKind, typeof IconHelpCircle> = {
  ask: IconHelpCircle,
  done: IconCircleCheck,
  error: IconAlertCircle,
  interrupted: IconPlayerStop,
  queued: IconSend,
};

const NOTICE_TEXT: Record<NoticeKind, MessageKey> = {
  ask: "notice.ask",
  done: "notice.done",
  error: "notice.error",
  interrupted: "notice.interrupted",
  queued: "notice.queued",
};

/** 后台会话提醒的存活时长(8s,LAYOUT §1 角落瞬态)。toast 到点消失;
 *  任务列行的 attention 高亮**不跟着走**——「未读」是持久状态,装进格
 *  并**落焦**才算读过(dismissSession;多格下装着 ≠ 看着,2026-08-20)。 */
const SESSION_NOTICE_MS = 8000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 壳侧 updated_at 的格式(config.rs::ms_to_rfc3339):秒精度 UTC。
 *  增量补丁要跟它同格式,列表排序才是同一坐标系上的字符串比较。 */
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** 壳级提示(不属于任何会话):浏览器工具装载结果、会话操作失败等。 */
interface ShellNotice {
  id: number;
  key: MessageKey;
  kind: "info" | "warn" | "error";
  params?: Record<string, string>;
  /** 提示自带的出口动作:"restart" = 重启引擎 */
  action?: "restart";
}
const SHELL_NOTICE_MS = 6000;
const SHELL_ERROR_MS = 8000;

/** transport generation 必须在消费云 hooks 的组件外提供；若 Provider 只包在
 * AppShell 的 return 里，AppShell 自己的 useCloudTasks 仍会读到 fallback。 */
export function App() {
  const [generation, setGeneration] = useState(0);
  // 壳事件回调先同步推进 ref，再排 React render：同一 tick 落地的旧请求
  // 也会立刻被判 stale，不能钻进状态提交窗口。
  const generationRef = useRef(0);
  const isCurrent = useCallback((candidate: number) => generationRef.current === candidate, []);
  const advance = useCallback((incoming: number): boolean => {
    const next = Number.isFinite(incoming) ? incoming : generationRef.current + 1;
    if (next <= generationRef.current) return false;
    generationRef.current = next;
    setGeneration(next);
    return true;
  }, []);

  return (
    <McTransportProvider generation={generation} isCurrent={isCurrent}>
      <AppShell onTransportChanged={advance} />
    </McTransportProvider>
  );
}

function AppShell({ onTransportChanged }: { onTransportChanged: (generation: number) => boolean }) {
  const { locale, t } = useI18n();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  // 创建意图(待办派发「启动任务」):送进工作台走「新建即新格」;整页
  // 新建覆盖视图已退役(2026-08-18 用户定案「那个页面没用了」——创建
  // 就是一个格,云端页签也在格内)
  const [createRequest, setCreateRequest] = useState<{
    seq: number;
    kind: "local" | "chat" | "cloud";
    dir?: string;
    text?: string;
    todoId?: string;
    files?: File[];
  } | null>(null);
  const createSeq = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(false);
  const settingsRef = useRef<SettingsViewHandle>(null);
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null);
  const [cloudReload, setCloudReload] = useState(0);
  // 工作台状态机(槽位/布局树/焦点;toast 路由与通知抑制要在渲染分支之外读)
  const split = useSplitState();
  // 云端数据源(任务列云端 tab 与格内 CloudTaskView 同一份;工作台即主壳,
  // 恒启用)
  const cloudFeed = useCloudTasks(cloudReload, true);
  const cloudProjects = useCloudProjects(cloudReload, true);

  // Windows/Linux 自绘标题栏左端的寄宿位(TitleBar leading → SplitView
  // 列收起时 portal ☰/新建;mac/浏览器恒 null)
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLElement | null>(null);
  // composer 聚焦意图(跨覆盖视图重挂仍送达;消费后清零)
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const focusSeqRef = useRef(0);
  const requestComposerFocus = () => setComposerFocusRequest(++focusSeqRef.current);
  const openSettings = useCallback(() => {
    if (settingsOpenRef.current) return;
    settingsOpenRef.current = true;
    const active = document.activeElement;
    settingsReturnFocusRef.current =
      active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : null;
    setSettingsOpen(true);
  }, []);
  const closeSettings = useCallback((restoreFocus = true) => {
    settingsOpenRef.current = false;
    setSettingsOpen(false);
    if (!restoreFocus) return;
    window.requestAnimationFrame(() => {
      const target = settingsReturnFocusRef.current;
      if (target?.isConnected) target.focus();
      if (!target || document.activeElement !== target) requestComposerFocus();
    });
  }, []);
  const afterSettingsClosed = (action: () => void) => {
    if (!settingsOpenRef.current) {
      action();
      return;
    }
    const settings = settingsRef.current;
    if (settings) settings.requestClose(action);
    else {
      closeSettings(false);
      action();
    }
  };
  const handleComposerFocus = useCallback(
    (request: number) => setComposerFocusRequest((current) => (current === request ? 0 : current)),
    [],
  );
  const [notices, setNotices] = useState<SessionNotice[]>([]);
  const [shellNotices, setShellNotices] = useState<ShellNotice[]>([]);
  const [shellRestarting, setShellRestarting] = useState(false);
  const [attentionIds, setAttentionIds] = useState<Set<string>>(new Set());
  // D1:引擎自愈的重开信号(格内 ChatView 经 useSessionFeed 依赖幂等重建连接)
  const [epoch, setEpoch] = useState(0);

  // 应用级动作留在设置状态所有者；工作台与会话动作由各自组件处理。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (appShortcutOfEvent(e) !== "open-settings") return;
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);

  // 事件回调挂一次,经 ref 读最新快照(闭包不攥旧状态)
  const sessionsRef = useRef<SessionMeta[]>(sessions);
  sessionsRef.current = sessions;
  // 工作台快照(active = 工作台未被设置模态遮挡;visibleIds = 可见格里的
  // 槽位条目):设置在场时子树仍挂载，但不视为用户正在查看。
  const splitRef = useRef({ active: true, visibleIds: new Set<string>(), focusedId: null as string | null });
  const shellSeq = useRef(0);
  const shellTimers = useRef<Set<number>>(new Set());
  const noticeTimers = useRef<Map<string, number>>(new Map());

  /** 壳级提示入栈:同一条 key 只留最新一份;info/error 自我了断,warn 留人关。 */
  const pushShell = (
    key: MessageKey,
    kind: ShellNotice["kind"],
    opts: { params?: Record<string, string>; action?: ShellNotice["action"] } = {},
  ) => {
    const id = ++shellSeq.current;
    setShellNotices((list) => [...list.filter((n) => n.key !== key), { id, key, kind, ...opts }]);
    if (kind === "warn") return;
    const timer = window.setTimeout(() => {
      shellTimers.current.delete(timer);
      setShellNotices((list) => list.filter((n) => n.id !== id));
    }, kind === "error" ? SHELL_ERROR_MS : SHELL_NOTICE_MS);
    shellTimers.current.add(timer);
  };

  // 待办清单(任务列待办组消费;载入/落盘/图片上传失败走壳级提示外显原因)
  const todoOps = useTodos((kind, reason) =>
    pushShell(
      kind === "load"
        ? "notice.todoLoadFailed"
        : kind === "upload"
          ? "notice.todoUploadFailed"
          : "notice.todoSaveFailed",
      "error",
      { params: { reason } },
    ),
  );

  /** 待办「启动任务」:创建意图送进工作台(新建即新格)预填正文,todoId
   *  供创建成功后回链。 */
  const dispatchTodo = (item: TodoItem) => {
    afterSettingsClosed(() => {
      const openView = (files?: File[]) =>
        setCreateRequest({ seq: ++createSeq.current, kind: "local", text: item.content, todoId: item.id, files });
      const names = item.images ?? [];
      if (!names.length) return openView();
      void todoUploadsDir().then(
        (dir) => openView(names.map((n) => pathBackedFile(`${dir}/${n}`, n, "image/*"))),
        () => openView(),
      );
    });
  };

  const clearNoticeTimer = (id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    noticeTimers.current.delete(id);
  };

  /** 后台会话提醒入栈(每会话只留最新一条)+ 任务列 attention + 到点自灭。 */
  const pushNotice = (n: SessionNotice) => {
    setNotices((list) => [...list.filter((x) => x.sessionId !== n.sessionId), n]);
    setAttentionIds((prev) => (prev.has(n.sessionId) ? prev : new Set(prev).add(n.sessionId)));
    clearNoticeTimer(n.sessionId);
    const timer = window.setTimeout(() => {
      noticeTimers.current.delete(n.sessionId);
      setNotices((list) => list.filter((x) => x.sessionId !== n.sessionId));
    }, SESSION_NOTICE_MS);
    noticeTimers.current.set(n.sessionId, timer);
  };

  // 过退避重试:引擎重启后这一拉也在壳的 apply 闸门窗口里。**失败一定要
  // 保留现有列表**;分屏槽位剪枝挂在**成功分支**同一条链上(slots.prune
  // 铁律:失败的空表拿来剪 = 槽位全清)
  const refresh = () =>
    void afterEngineReady(sessionsList)
      .then((list) => {
        setSessions(list);
        split.pruneTo(new Set(list.map((m) => m.id)));
      })
      .catch(() => {});

  /** 摘掉某会话的提醒与任务列 attention(装进格即视为已读)。 */
  const dismissSession = (id: string) => {
    clearNoticeTimer(id);
    setNotices((list) => list.filter((n) => n.sessionId !== id));
    setAttentionIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  /** 装载路由(任务列点行/toast 点击/壳意图共用):place 语义(在场定位/
   *  空格装载)+ 已读 + composer 聚焦。设置模态在场时先走其脏状态守卫。 */
  const loadEntry = (entry: string) => {
    afterSettingsClosed(() => {
      split.place(entry);
      dismissSession(entry);
      requestComposerFocus();
    });
  };

  /** 按 id 打开本地会话(提醒点击/壳意图):D8——不在本地快照的 id 先重拉
   *  全表再装载;确实没有就外显并摘掉过期提醒。 */
  const openSessionById = async (id: string) => {
    let meta = sessionsRef.current.find((m) => m.id === id);
    if (!meta) {
      const list = await sessionsList().catch(() => null);
      if (list) {
        setSessions(list);
        meta = list.find((m) => m.id === id);
      }
    }
    if (!meta) {
      pushShell("notice.openMissing", "error");
      dismissSession(id);
      return;
    }
    loadEntry(id);
  };
  const openSessionByIdRef = useRef(openSessionById);
  openSessionByIdRef.current = openSessionById;

  useEffect(() => {
    let alive = true;
    // 壳意图:启动补取一次(窗口唤起前托盘/桌宠塞的),再听后续推送
    void takeUiIntent().then((intent) => {
      if (!alive) return;
      if (intent === "open-settings") {
        openSettings();
        return;
      }
      const id = sessionIdFromUiIntent(intent);
      if (id) void openSessionByIdRef.current(id);
    });
    // H9:事件送达立即消费壳侧意图副本——不消费的话整页刷新会重放同一意图
    const offOpenSettings = listen<void>("open-settings", () => {
      void takeUiIntent();
      openSettings();
    });
    const offOpenSession = listen<string>("open-session", (id) => {
      void takeUiIntent();
      if (!id) return;
      void openSessionByIdRef.current(id);
    });
    // MonkeyCode transport 切换(设置页换服务/登出):先同步推进 generation
    // 守卫，再清掉旧服务/账号命名空间的持久化云槽并重拉 feed。
    const offTransport = listen<number>("monkeycode-transport-changed", (generation) => {
      if (!onTransportChanged(generation)) return;
      split.clearCloud();
      setCloudReload((n) => n + 1);
    });
    const offMcpReloaded = listen<void>("browser-mcp-reloaded", () => pushShell("browser.mcpReloaded", "info"));
    const offMcpTimeout = listen<void>("browser-mcp-refresh-timeout", () =>
      pushShell("browser.mcpTimeout", "warn", { action: "restart" }),
    );
    refresh();
    // D5 首启向导:桌面壳里模型清单为空 → 自动打开设置页(只在挂载时判一次)
    if (inDesktopShell()) {
      void afterEngineReady(modelsList)
        .then((models) => {
          if (alive && models.length === 0) openSettings();
        })
        .catch(() => {});
    }
    // 后台会话状态/摘要/审批等待:全局事件驱动,不轮询
    const off = onSessionEvent((e) => {
      if (sessionsRef.current.some((m) => m.id === e.id)) {
        setSessions((list) =>
          list.map((m) =>
            m.id === e.id
              ? {
                  ...m,
                  title: e.title || m.title,
                  status: e.status ?? m.status,
                  summary: e.summary ?? m.summary,
                  archived: e.archived ?? m.archived,
                  waiting_ask: e.type === "session-ask" ? e.open : m.waiting_ask,
                  // 任务列项目组按「组内最近 updated_at」排序:session-status
                  // 恒紧跟一次刷新 updated_at 的 write_sidecar(壳侧契约)
                  updated_at: e.type === "session-status" ? nowStamp() : m.updated_at,
                }
              : m,
          ),
        );
      } else {
        // D8:未知 id = 本地增量快照已失真(别处新建/漏事件),重拉全表
        refresh();
      }
      // 后台会话轮结束 → 补投其暂存的排队消息
      if (e.type === "session-status" && e.status) {
        deliverQueued(e.id, e.status, (sid, text) => pushNotice(noticeForQueuedDelivery(sid, text)));
      }
      // D3:可见格不出 toast(格里的会话就在眼前,角落弹窗是噪音);
      // 设置/新建盖着时格子已卸载,可见集为空 → 一律提醒
      const sv = splitRef.current;
      const notice = noticeForSessionEvent(e, null, sv.active ? sv.visibleIds : new Set());
      if (notice) pushNotice(notice);
      // 「在场」只对**焦点格**成立(2026-08-20 用户「多格下一轮结束/审批/
      // 提问得让人知道」;此前可见即在场,非焦点格的这些事件被整个静默):
      // 可见非焦点格的值得提醒事件落 attention——格头警示条与任务列行高亮
      // 同源,落焦即消(下方 effect)——toast 仍免
      else if (sv.active && sv.visibleIds.has(e.id) && e.id !== sv.focusedId && noticeForSessionEvent(e, null)) {
        setAttentionIds((prev) => (prev.has(e.id) ? prev : new Set(prev).add(e.id)));
      }
    });
    return () => {
      alive = false;
      off();
      offOpenSession();
      offOpenSettings();
      offTransport();
      offMcpReloaded();
      offMcpTimeout();
      shellTimers.current.forEach(window.clearTimeout);
      shellTimers.current.clear();
      noticeTimers.current.forEach(window.clearTimeout);
      noticeTimers.current.clear();
    };
  }, []);

  // 首开播种:槽位全空时把 mc.lastSession(旧壳契约键)带进首叶——从旧
  // 三列壳升级上来,"上次看的那个"不丢。只在挂载时做一次
  useEffect(() => {
    split.seedWith(readLastSession());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // D1 引擎重启自愈:记住"曾不可用",Ready 后重拉会话列表并自增 epoch
  const engineDownRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const apply = (s: EngineStatus) => {
      if (s.phase === "ready") {
        if (engineDownRef.current) {
          engineDownRef.current = false;
          refresh();
          setEpoch((n) => n + 1);
        }
        return;
      }
      if (s.phase !== "stopped") engineDownRef.current = true;
    };
    const off = onEngineStatus((s) => {
      if (alive) apply(s);
    });
    void engineStatus().then((s) => {
      if (alive && s) apply(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  // 工作台渲染态与可见集(通知抑制/toast 路由经 ref 读)
  const splitActive = !settingsOpen;
  splitRef.current = {
    active: splitActive,
    visibleIds: new Set(split.visibleIndices.map((i) => split.slots[i]).filter(Boolean) as string[]),
    focusedId: split.slots[split.focused] ?? null,
  };

  // 落焦即已读:焦点格会话的 attention 摘除(格头警示条/任务列行高亮同源)。
  // attentionIds 也在依赖里:事件回调读的 splitRef 是上一帧快照,若误标了
  // 刚落焦的格,下一渲染在此自愈
  const focusedSlotEntry = split.slots[split.focused] ?? null;
  useEffect(() => {
    if (focusedSlotEntry && attentionIds.has(focusedSlotEntry)) dismissSession(focusedSlotEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSlotEntry, attentionIds]);

  const handleCloudQueueAttention = useCallback((taskId: string) => {
    const entry = cloudSlotId(taskId);
    const current = splitRef.current;
    if (current.active && current.focusedId === entry) return;
    setAttentionIds((previous) => (previous.has(entry) ? previous : new Set(previous).add(entry)));
  }, []);

  // 设置是工作台上的模态，原生窗口标题继续跟随焦点格。
  useEffect(() => {
    const focusedEntry = split.slots[split.focused];
    const focusedTitle = focusedEntry
      ? isCloudSlotId(focusedEntry)
        ? cloudFeed.tasks?.find((c) => cloudSlotId(c.id) === focusedEntry)?.title || t("split.title")
        : (() => {
            const m = sessions.find((x) => x.id === focusedEntry);
            return m ? (m.title_custom ? m.title : m.summary || m.title) : t("split.title");
          })()
      : t("split.title");
    setWindowTitle(`${focusedTitle} — ${t("app.name")}`);
  }, [split.slots, split.focused, sessions, cloudFeed.tasks, t, locale]);

  /** 删除会话(任务列右键/格内共用):成功才清 composer 留档、剪槽位、
   *  重拉列表;失败外显原因并就此打住。 */
  const removeSession = (meta: SessionMeta) => {
    void sessionDelete(meta.id)
      .then(() => {
        dropStash(meta.id);
        refresh();
      })
      .catch((e: unknown) => pushShell("notice.deleteFailed", "error", { params: { reason: errText(e) } }));
  };

  /** 装载收口(装载卡点选/拖行落格/新建落格共用):落**指定槽** + 已读 +
   *  composer 聚焦意图。 */
  const assignToSlot = (slot: number, entry: string) => {
    split.assignTo(slot, entry);
    dismissSession(entry);
    requestComposerFocus();
  };

  /** 格内内嵌新建的落地:先乐观入表(refresh 是异步的,不入表的话格子按
   *  未知 id 渲染成装载卡闪一下),再重拉对表,最后装载进发起的那个格。 */
  const createdInSlot = (slot: number, meta: SessionMeta) => {
    setSessions((list) => (list.some((m) => m.id === meta.id) ? list : [meta, ...list]));
    refresh();
    assignToSlot(slot, meta.id);
  };

  // 新建弹窗的最近目录:非 chat、未归档(会话与项目两级),按最近活跃排
  const recentDirs = (() => {
    const archivedProjects = readArchivedProjects();
    const seen = new Set<string>();
    const dirs: string[] = [];
    for (const m of [...sessions]
      .filter((s) => s.kind !== "chat" && !s.archived && s.workdir)
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))) {
      const key = projectKey(m.workdir);
      if (seen.has(key) || archivedProjects.has(key)) continue;
      seen.add(key);
      dirs.push(m.workdir);
    }
    return dirs;
  })();

  return (
    <CloudQueueCoordinatorProvider onAttention={handleCloudQueueAttention}>
      {(cloudQueue) => (
      <div className="flex h-full flex-col text-base-content">
      {/* leading = 标题栏左端寄宿位:任务列收起时 SplitView 把 ☰/新建
          portal 进来,免开一行 h-10 顶条(2026-08-20 用户报障「空一行」) */}
      {isCustomChromeShell() && <TitleBar leading={<span ref={setTitlebarSlot} className="contents" />} />}
      {/* mac 自绘小灯:固定浮在窗口左上(h-10 行内垂直居中),工作台各
          形态与设置覆盖视图共用一份;贴角 chrome 经 data-mac-lights-clear
          让位 64px(app.css)。2026-08-20 回归:原生尺寸不可调、用户嫌大 */}
      {isMacShell() && (
        <div data-tauri-drag-region="" className="fixed top-0 left-1 z-[var(--z-window-overlay)] flex h-10 items-center">
          <MacWindowControls compact />
        </div>
      )}
      <ResizeEdges />
      <EngineBanner />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div
          className="flex min-h-0 min-w-0 flex-1"
          inert={settingsOpen ? true : undefined}
          aria-hidden={settingsOpen ? "true" : undefined}
        >
          <SplitView
            active={!settingsOpen}
            sessions={sessions}
            split={split}
            epoch={epoch}
            focusRequest={composerFocusRequest}
            onFocusRequestHandled={handleComposerFocus}
            onAssign={assignToSlot}
            onLoadSession={loadEntry}
            onComposerIntent={requestComposerFocus}
            titlebarSlot={titlebarSlot}
            onCreatedInSlot={(slot, meta, todoId) => {
              // 待办派发链:创建成功即回链去向(状态词回显靠会话表回查)
              if (todoId) todoOps.markDispatched(todoId, meta.kind === "chat" ? "chat" : "local", meta.id);
              createdInSlot(slot, meta);
            }}
            onCloudCreatedInSlot={(slot, task, todoId) => {
              if (todoId) todoOps.markDispatched(todoId, "cloud", task.id);
              setCloudReload((n) => n + 1);
              assignToSlot(slot, cloudSlotId(task.id));
            }}
            createRequest={createRequest}
            onCreateRequestHandled={() => setCreateRequest(null)}
            onOpenSettings={openSettings}
            recentDirs={recentDirs}
            cloud={{
              feed: cloudFeed,
              projects: cloudProjects,
              reloadKey: cloudReload,
              onDeleted: (id) => {
                // CloudTaskList 只在服务端删除成功后触发；此时再停 runtime 并删
                // lane/index。失败路径不会触碰协调器和用户待发送内容。
                cloudQueue.dropTask(id);
                setCloudReload((n) => n + 1);
                // prune 只认本地全表、特意跳过云端条目——列表侧删除要显式
                // 弹格,否则格里留幽灵任务(2026-08-20 审计)
                const at = split.slots.indexOf(cloudSlotId(id));
                if (at >= 0) split.ejectAt(at);
              },
              onChanged: () => setCloudReload((n) => n + 1),
            }}
            admin={{
              attentionIds,
              // 改名/归档:成功才重拉,失败给原因(壳 session_patch 不广播
              // session-event,不主动拉就没有任何信号回流)
              onRename: (meta, title) => {
                void sessionPatch(meta.id, { title })
                  .then(refresh)
                  .catch((e: unknown) => pushShell("notice.renameFailed", "error", { params: { reason: errText(e) } }));
              },
              onToggleArchive: async (meta) => {
                try {
                  await sessionPatch(meta.id, { archived: !meta.archived });
                  await refresh();
                  return true;
                } catch (e: unknown) {
                  pushShell("notice.archiveFailed", "error", { params: { reason: errText(e) } });
                  return false;
                }
              },
              onDelete: removeSession,
              todo: {
                todos: todoOps.todos,
                ops: todoOps,
                onDispatch: dispatchTodo,
                onOpenSession: (id) => void openSessionById(id),
                // 云端派发件的跳转:装载入格(工作台即主壳,没有"云端空间"
                // 可切了;无 id 的存量件退化为无动作)
                onOpenCloud: (id) => id && loadEntry(cloudSlotId(id)),
              },
            }}
          />
        </div>
        {settingsOpen && (
          <SettingsView
            ref={settingsRef}
            onClose={closeSettings}
            hasRunningTask={sessions.some((s) => s.status === "running")}
          />
        )}
      </div>
      {/* D3 后台会话提醒 + 壳级提示:共用角落栈(§3 法定位置) */}
      {(notices.length > 0 || shellNotices.length > 0) && (
        <div
          className="toast toast-top toast-end z-[var(--z-window-overlay)] mt-[calc(var(--chrome-h)+52px)]"
          aria-label={t("notice.label")}
        >
          {shellNotices.map((n) => (
            <div
              key={n.id}
              role={n.kind === "info" ? "status" : "alert"}
              className={`alert ${n.kind === "info" ? "alert-success" : n.kind === "warn" ? "alert-warning" : "alert-error"} alert-soft py-2 text-xs shadow-sm`}
            >
              {n.kind === "info" ? (
                <IconWorld size={14} stroke={1.75} aria-hidden className="shrink-0" />
              ) : (
                <IconAlertCircle size={14} stroke={1.75} aria-hidden className="shrink-0" />
              )}
              <span className="max-w-64 min-w-0 break-all">{t(n.key, n.params)}</span>
              {n.action === "restart" && (
                <button
                  type="button"
                  className="btn btn-warning btn-xs shrink-0"
                  disabled={shellRestarting}
                  onClick={() => {
                    setShellRestarting(true);
                    void engineRestart()
                      .then(() => setShellNotices((list) => list.filter((x) => x.id !== n.id)))
                      .catch(() => {})
                      .finally(() => setShellRestarting(false));
                  }}
                >
                  {shellRestarting ? t("engine.restarting") : t("engine.restart")}
                </button>
              )}
              <button
                type="button"
                aria-label={t("notice.dismiss")}
                className="btn btn-ghost btn-square btn-xs"
                onClick={() => setShellNotices((list) => list.filter((x) => x.id !== n.id))}
              >
                <IconX size={14} stroke={1.75} aria-hidden />
              </button>
            </div>
          ))}
          {notices.map((n) => {
            const Icon = NOTICE_ICON[n.kind];
            return (
              <div
                key={n.sessionId}
                role="alert"
                className={`alert ${NOTICE_TONE[n.kind]} alert-soft cursor-pointer py-2 text-xs shadow-sm`}
                onClick={() => void openSessionById(n.sessionId)}
              >
                <Icon size={14} stroke={1.75} aria-hidden className="shrink-0" />
                <button
                  type="button"
                  className="link link-hover max-w-64 min-w-0 truncate text-left"
                  onClick={(e) => {
                    e.stopPropagation();
                    void openSessionById(n.sessionId);
                  }}
                >
                  {t(NOTICE_TEXT[n.kind], { title: n.title || t("notice.untitled") })}
                </button>
                <button
                  type="button"
                  aria-label={t("notice.dismiss")}
                  className="btn btn-ghost btn-square btn-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearNoticeTimer(n.sessionId);
                    setNotices((list) => list.filter((x) => x.sessionId !== n.sessionId));
                  }}
                >
                  <IconX size={14} stroke={1.75} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <DownloadsDock />
      </div>
      )}
    </CloudQueueCoordinatorProvider>
  );
}
