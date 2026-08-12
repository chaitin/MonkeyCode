// 壳层拼装:标题栏 + 三栏(空间 rail / 侧栏 / 主区)+ 新建任务弹窗。
// 主区当前是欢迎卡/会话占位卡(P3 接聊天流);设置入口 P5 落位。
// App 级职责还有四件事件驱动的"粘合":
// - D1 引擎重启自愈:engine-status 记住"曾不可用",Ready 后重拉列表并给
//   ChatView 递 epoch 重开信号(保存设置/手动重启/崩溃自愈统一收敛,不分支);
// - D3 后台会话提醒:非当前会话等待审批/转终态 → 可点击跳转的 toast +
//   侧栏 attention 高亮;
// - D8 增量自愈:session-event/意图指向未知 id → 重拉全表再选中;
// - H9 意图消费:open-* 事件送达即 takeUiIntent 消费壳侧副本,防刷新重放。
import { IconAlertCircle, IconChartBar, IconCircleCheck, IconCloud, IconFolderCode, IconHelpCircle, IconMessages, IconPlayerStop, IconSend, IconSettings, IconWorld, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { ChatView } from "@/features/chat/ChatView";
import { CloudTaskView } from "@/features/cloud/CloudTaskView";
import { DownloadsDock } from "@/features/downloads/DownloadsDock";
import { EngineBanner } from "@/features/engine/EngineBanner";
import { NewTaskModal } from "@/features/newtask/NewTaskModal";
import { SettingsView } from "@/features/settings/SettingsView";
import { Sidebar } from "@/features/sidebar/Sidebar";
import { UsageStatsView } from "@/features/stats/UsageStatsView";
import { ResizeEdges } from "@/features/titlebar/ResizeEdges";
import { MacWindowControls, TitleBar } from "@/features/titlebar/TitleBar";
import { windowContextLabel } from "@/app/shellChrome";
import { useI18n, type MessageKey } from "@/lib/i18n";
import {
  hostInfo,
  isCustomChromeShell,
  isMacShell,
  sessionIdFromUiIntent,
  setWindowTitle,
  takeUiIntent,
  type HostInfo,
} from "@/lib/ipc/host";
import { inDesktopShell, listen } from "@/lib/ipc/ipc";
import { afterEngineReady, engineRestart, engineStatus, onEngineStatus, type EngineStatus } from "@/lib/ipc/engine";
import type { CloudProject, CloudTask } from "@/lib/ipc/cloudtasks";
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
import { readLastSession, writeLastSession, writeSpace, type Space } from "@/lib/util/prefs";
import { projectKey, readArchivedProjects } from "@/lib/util/projects";

// 统一图标族:@tabler/icons-react(2026-08-07 由 lucide 换过来;组件名
// 一律 Icon 前缀,线宽属性是 stroke 不是 strokeWidth)
const SPACE_ICONS: Record<Space, typeof IconFolderCode> = {
  local: IconFolderCode,
  cloud: IconCloud,
  chat: IconMessages,
  stats: IconChartBar,
};

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

/** 后台会话提醒的存活时长(旧 UI useSession 的 notice 同款 8s)。
 *  LAYOUT §1 把它归在「角落瞬态」——不设期限的话,三个后台任务就是三条
 *  永久钉在主区右上角的横幅,而且只能一条条手点关掉。
 *  注意只有 toast 到点消失:侧栏那一行的 attention 高亮**不跟着走**,
 *  「未读」是持久状态,打开会话才算读过(dismissSession)。 */
const SESSION_NOTICE_MS = 8000;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 壳侧 updated_at 的格式(config.rs::ms_to_rfc3339):秒精度 UTC。
 *  增量补丁要跟它同格式,列表排序才是同一坐标系上的字符串比较。 */
const nowStamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** 壳级提示(不属于任何会话,故不进 SessionNotice 通道):浏览器工具装载
 *  结果、会话操作失败等。三档语气:
 *  - info:成功类,6s 自灭;
 *  - error:操作失败(改名/归档/删除被壳拒、提醒指向的会话已不存在),
 *    8s 自灭(旧 UI notify 同款窗口),原因经 params 带出来;
 *  - warn:留到用户关掉——「工具没装上」不能一晃而过。 */
interface ShellNotice {
  id: number;
  key: MessageKey;
  kind: "info" | "warn" | "error";
  /** 文案插值(失败提示要把壳给的原因原样带出) */
  params?: Record<string, string>;
  /** 提示自带的出口动作:谁的提示指了哪条路,谁就把按钮给出来。
   *  "restart" = 重启引擎(mcpTimeout 那条文案里写的就是它) */
  action?: "restart";
}
const SHELL_NOTICE_MS = 6000;
const SHELL_ERROR_MS = 8000;

function SpaceRail({
  space,
  waiting,
  onChange,
  settingsOpen,
  onToggleSettings,
}: {
  space: Space;
  /** 各空间「等待确认」的会话数(0 不出徽标);云端任务不在壳的会话表里,恒 0 */
  waiting: Record<Space, number>;
  onChange: (s: Space) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const { t } = useI18n();
  const labels: Record<Space, string> = { local: t("rail.local"), cloud: t("rail.cloud"), chat: t("rail.chat"), stats: t("rail.stats") };
  return (
    <nav aria-label={t("rail.label")} className="flex w-rail shrink-0 flex-col items-center bg-base-300">
      {/* 头部基线上的 rail 角落格(h-13 = 52px,与各列头部同高,保证三列头部线
          对齐;LAYOUT §2)。**这一格恒存在**——曾对 Windows 开特例不留,让第一个
          空间图标顶上去占位,尺寸恰好凑得上(size-11 + py-1 = 52px)所以没露馅,
          但三个图标整体比其余平台高一格,契约里也没写过。2026-08-08 删除。

          格子里放什么按平台分:mac 是红绿灯的家(壳走 Overlay,窗控归 UI 自绘);
          其余平台窗控不在这儿,改放品牌标记——空着一整块深色方格在窗口左上角
          既浪费又难看(2026-08-09 用户报障),而标记原先摆在窗框条左端,挪下来
          正好两处空档一次填平,窗框条也回归 §1「只做 chrome」。
          Discord/Slack 的 rail 顶就是这个形态(标记 → 分隔 → 导航)。
          标记不可交互:系统菜单是标题栏的东西,挂到侧栏图标上会变成「双击侧栏
          图标把应用关了」的陷阱,那条留在窗框条右键上。整格可拖拽(与 mac 同)。 */}
      <div data-tauri-drag-region="" className="flex h-13 w-full shrink-0 items-center justify-center">
        {isMacShell() ? (
          <MacWindowControls compact />
        ) : (
          <img
            src="/logo.png"
            alt=""
            aria-hidden
            draggable={false}
            data-rail-brand=""
            data-tauri-drag-region=""
            /* 28px:明显大过下面 18px 的空间图标,才读得出"这是标记不是第四个
               导航项";62×52 的格子里左右各余 17px、上下各余 12px,不挤 */
            className="h-7 w-7 rounded-lg"
          />
        )}
      </div>
      <div className="flex flex-1 flex-col items-center gap-1 py-1">
        {(["local", "cloud", "chat", "stats"] as const).map((s) => {
          // 徽标不再只挂本地任务:本地会话同样会停在等待确认上(用户报障
          // 2026-08-10「本地会话的等待审批没有计数提示」),两个空间一个口径
          const count = waiting[s];
          return (
            <div key={s} className={count > 0 ? "indicator" : undefined}>
              {count > 0 && (
                /* indicator-item 默认钉在 44px 命中区的角上(translate 50%/-50%),
                   而图标只有 18px 居中——徽标于是飘在图标右上方 13px 开外,读起来
                   不像属于这个图标(用户报障 2026-08-10「太偏右上角、不靠近图标」)。
                   锚点往按钮内收 9px,徽标中心正落在图标自身的右上角外沿。
                   pointer-events-none:徽标此时压在按钮上,点它必须照样切空间 */
                <span className="indicator-item badge badge-warning badge-xs pointer-events-none [--indicator-e:9px] [--indicator-t:9px]">
                  {count}
                </span>
              )}
              {/* tooltip 按文档形态外包一层;size-11 是 rail 定宽下的结构尺寸
                  (44px 命中区,btn 默认档与 rail 宽不齐) */}
              <div className="tooltip tooltip-right" data-tip={labels[s]}>
                <button
                  type="button"
                  aria-label={labels[s]}
                  aria-pressed={space === s}
                  className={`btn btn-ghost btn-square size-11 ${space === s ? "btn-active" : ""}`}
                  onClick={() => onChange(s)}
                >
                  {(() => {
                    const Icon = SPACE_ICONS[s];
                    return <Icon size={18} stroke={1.75} aria-hidden />;
                  })()}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="pb-2">
        {/* tooltip 外包一层同上;size-11 为 rail 结构尺寸 */}
        <div className="tooltip tooltip-right" data-tip={t("rail.settings")}>
          <button
            type="button"
            aria-label={t("rail.settings")}
            aria-pressed={settingsOpen}
            className={`btn btn-ghost btn-square size-11 ${settingsOpen ? "btn-active" : ""}`}
            onClick={onToggleSettings}
          >
            <IconSettings size={18} stroke={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </nav>
  );
}

function MainArea({
  current,
  epoch,
  onDelete,
  onPatched,
  onActionError,
}: {
  current: SessionMeta | null;
  epoch: number;
  onDelete: (meta: SessionMeta) => void;
  /** 视图内改名/归档落盘后重拉列表(壳 session_patch 不广播事件) */
  onPatched: () => void;
  /** 视图内改名/归档**失败**时外显:与侧栏右键菜单共用角落提示栈 */
  onActionError: (key: "notice.renameFailed" | "notice.archiveFailed", reason: string) => void;
}) {
  const { t } = useI18n();
  const [info, setInfo] = useState<HostInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void hostInfo().then((v) => {
      if (alive) setInfo(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  // key={epoch}:引擎自愈信号一变就整棵重建。epoch 本身已经喂给 useSessionFeed
  // 做幂等重连,但**模型清单挂在 Composer 自己的挂载期 effect 上**(deps 是
  // []),不重建就永远是旧引擎那份——保存设置触发的重启碰巧自愈(SettingsView
  // 把 ChatView 整个卸掉了),崩溃自愈与浏览器扩展配对却不会,模型菜单一直
  // 停在旧内容,直到用户手动切一次会话。旧 UI 是在重连路径里直接重拉 models
  // (App.tsx reconnectRef),ui-next 的模型清单没有集中缓存,只能从挂载期
  // 重来。代价可控:epoch 只在引擎真的掉过之后自增(不是每帧),而那时
  // ChatView 的数据面本就要整份重放;草稿/排队/附件按会话存在 composer stash
  // 里,卸载即留档、重挂即恢复,不会丢。
  // 注意 key **只取 epoch**:切会话仍走同一实例(与此前行为一致),不牵连
  if (current)
    return (
      <ChatView
        key={epoch}
        meta={current}
        epoch={epoch}
        onDeleted={() => onDelete(current)}
        onPatched={onPatched}
        onActionError={onActionError}
      />
    );

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-base-100">
      <div data-tauri-drag-region="" className="h-13 shrink-0 border-b border-base-300" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-6">
      <img src="/logo.png" alt="" className="h-16 w-16 rounded-2xl shadow-sm" aria-hidden />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-lg font-bold tracking-tight">{t("main.welcome.title")}</h1>
        <p className="max-w-sm text-sm leading-relaxed text-base-content/60">{t("main.welcome.detail")}</p>
      </div>
      {info && (
        <p className="font-mono text-xs text-base-content/35 tabular-nums">
          {t("main.shellInfo", { version: info.version, engine: info.engine_version ?? t("main.engineNotReady") })}
        </p>
      )}
      </div>
    </main>
  );
}

export function App() {
  const { t } = useI18n();
  // 启动恒落本地任务(用户定案 2026-08-09),不恢复上次所在空间:云端可能
  // 未登录/断网,拿它当开机首屏每次都是一个坏屏幕;而且此前只要建过一次
  // 云端任务(onCloudCreated 里 setSpace("cloud")),启动空间就被永久改成
  // 云端,直到用户手动点回来——这个副作用没人预料得到。prefs 仍写
  // mc.sidebarSpace(与旧 UI 共用的契约键),只是不再读回。
  const [space, setSpaceState] = useState<Space>("local");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(readLastSession);
  // 新建任务视图:null=关;dir 携带「在此项目新建」的预填目录(本地),
  // cloudProject 携带云端项目组头的预选项目(直接落云端页签)
  const [creating, setCreating] = useState<{ dir?: string; cloudProject?: CloudProject } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudTask, setCloudTask] = useState<CloudTask | null>(null);
  const [cloudReload, setCloudReload] = useState(0);
  const [notices, setNotices] = useState<SessionNotice[]>([]);
  const [shellNotices, setShellNotices] = useState<ShellNotice[]>([]);
  // 提示内「重启引擎」的在途态(同一时刻只会有一条带动作的提示)
  const [shellRestarting, setShellRestarting] = useState(false);
  const [attentionIds, setAttentionIds] = useState<Set<string>>(new Set());
  // D1:引擎自愈的重开信号(ChatView 经 useSessionFeed 依赖幂等重建连接)
  const [epoch, setEpoch] = useState(0);

  // 事件回调挂一次,经 ref 读最新快照(闭包不攥旧状态)
  const sessionsRef = useRef<SessionMeta[]>(sessions);
  sessionsRef.current = sessions;
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;
  // 壳级提示的自增号与在途定时器(卸载时统一清)
  const shellSeq = useRef(0);
  const shellTimers = useRef<Set<number>>(new Set());
  // 会话提醒的到期定时器(按 sessionId 记账:同一会话来了新提醒就顶掉旧计时,
  // 免得旧计时把刚换上的那条提前撤走)
  const noticeTimers = useRef<Map<string, number>>(new Map());

  /** 壳级提示入栈:同一条 key 只留最新一份(连着配对两次不叠成两条)。
   *  info/error 自我了断,warn 留到用户关掉(定时器记账供卸载时清空)。 */
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

  const clearNoticeTimer = (id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    noticeTimers.current.delete(id);
  };

  /** 后台会话提醒入栈(每会话只留最新一条)+ 侧栏 attention + 到点自灭。 */
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

  // 过退避重试:引擎重启后这一拉也在壳的 apply 闸门窗口里(见 afterEngineReady
  // 头注)。**失败一定要保留现有列表**——sessionsList 现在如实抛错(此前它把
  // 拒绝吞成空数组,退避重试因此成了死代码),而空结果会被下游读成「会话都
  // 没了」:侧栏清空、current 变 null、开着的对话卸载回欢迎页
  const refresh = () => void afterEngineReady(sessionsList).then(setSessions).catch(() => {});

  const setSpace = (next: Space) => {
    setSpaceState(next);
    writeSpace(next);
    // 桌面客户端心智:点导航永远切走当前覆盖视图(设置/新建),不会"没反应"
    setSettingsOpen(false);
    setCreating(null);
  };

  /** 摘掉某会话的提醒与侧栏 attention(打开它即视为已读)。 */
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

  /** 按 id 打开会话(提醒点击/壳意图共用)。D8:不在本地快照的 id 先重拉
   *  全表再选中;找到 meta 时按 kind 切空间(chat→chat,其余→local)。 */
  const openSessionById = async (id: string) => {
    let meta = sessionsRef.current.find((m) => m.id === id);
    if (!meta) {
      // 这一拉可能撞上壳的 apply 闸门。**失败不能用空结果覆盖列表**
      // (旧 UI 原话:清空会话列表会被误判为"会话已删"),保留原样即可
      const list = await sessionsList().catch(() => null);
      if (list) {
        setSessions(list);
        meta = list.find((m) => m.id === id);
      }
    }
    if (!meta) {
      // 提醒/托盘意图指向的会话已经不在了(期间被删、或这一拉失败)。
      // 此前无条件 setCurrentId(id):选中一个列表里没有的 id,主区空白一片,
      // 既没内容也没解释。旧 UI 是「无法打开:对应的任务或会话可能已被删除」
      // 然后原地不动
      pushShell("notice.openMissing", "error");
      dismissSession(id); // 过期提醒点完就该消失,别赖在角落里
      return;
    }
    setCurrentId(id);
    writeLastSession(id);
    setSettingsOpen(false);
    setSpace(meta.kind === "chat" ? "chat" : "local");
    dismissSession(id);
  };
  const openSessionByIdRef = useRef(openSessionById);
  openSessionByIdRef.current = openSessionById;

  useEffect(() => {
    let alive = true;
    // 壳意图:启动补取一次(窗口唤起前托盘/桌宠塞的),再听后续推送
    void takeUiIntent().then((intent) => {
      if (!alive) return;
      if (intent === "open-settings") {
        setSettingsOpen(true);
        return;
      }
      const id = sessionIdFromUiIntent(intent);
      if (id) void openSessionByIdRef.current(id);
    });
    // H9:事件送达立即消费壳侧意图副本——不消费的话整页刷新会重放同一意图
    const offOpenSettings = listen<void>("open-settings", () => {
      void takeUiIntent();
      setSettingsOpen(true);
    });
    const offOpenSession = listen<string>("open-session", (id) => {
      void takeUiIntent();
      if (!id) return;
      void openSessionByIdRef.current(id);
    });
    // 浏览器扩展配对后壳会重启引擎换上带 browser_* 工具的配置。两条事件都
    // 必须外显:成功不说,用户不知道现在能用了;超时(壳等任务空闲放弃,见
    // main.rs BROWSER_MCP_REFRESH_DEADLINE)更不能静默——配好了却没工具会被
    // 当成配对失败。同一条只留最新一份,连着配对两次不叠成两条(见 pushShell)
    const offMcpReloaded = listen<void>("browser-mcp-reloaded", () => pushShell("browser.mcpReloaded", "info"));
    // 超时那条的文案里写着「保存设置或重启引擎即可生效」,就把重启按钮
    // 直接挂在提示上——引擎横幅只在崩溃/启动失败时出,正常跑着时用户在
    // 界面上找不到重启入口(2026-08-07 用户报障)
    const offMcpTimeout = listen<void>("browser-mcp-refresh-timeout", () =>
      pushShell("browser.mcpTimeout", "warn", { action: "restart" }),
    );
    refresh();
    // D5 首启向导:桌面壳里模型清单为空 → 自动打开设置页。只在挂载时判一次:
    // 用户关掉设置页不再纠缠,配好模型后自然不会再触发。
    // catch 必须有:models_list 会撞壳的 apply 闸门(引擎正在重启),而
    // modelsList 现在如实抛错。没有 catch 的话,一次瞬时失败 = 未处理拒绝;
    // 而按老写法把失败吞成 [],等于把设置页糊到一个模型配得好好的用户脸上
    if (inDesktopShell()) {
      // 同 refresh():挂载这一刻引擎可能正在起/正在应用配置,裸调会被闸门拒。
      // 拒掉虽只是"不弹向导"(安全方向),但对真·首启用户就是向导没出来
      void afterEngineReady(modelsList)
        .then((models) => {
          if (alive && models.length === 0) setSettingsOpen(true);
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
                  waiting_ask: e.type === "session-ask" ? e.open : m.waiting_ask,
                  // 侧栏项目组按「组内最近 updated_at」排序(util/projects
                  // groupSessions)。增量补丁此前只改状态不动时间戳,于是后台
                  // 任务跑起来,它所在的项目组不会浮上去——顺序永远停在事件
                  // 发生之前。旧 UI 是每来一条事件就重拉全表,顺序自然跟着走;
                  // 这里不能那么干(一帧一拉),所以按壳侧契约就地跟进:
                  // session-status 恒紧跟一次**刷新 updated_at** 的 write_sidecar
                  // (driver/normalize.rs、session.rs),而 session-ask /
                  // session-summary 走的是 write_sidecar_keep_updated,不动时间戳
                  updated_at: e.type === "session-status" ? nowStamp() : m.updated_at,
                }
              : m,
          ),
        );
      } else {
        // D8:未知 id = 本地增量快照已失真(别处新建/漏事件),重拉全表
        refresh();
      }
      // 后台会话轮结束 → 补投其暂存的排队消息(stash 模块状态机;成功走
      // queued toast + 侧栏 attention,§3 后台会话提醒的法定位置)
      if (e.type === "session-status" && e.status) {
        deliverQueued(e.id, e.status, (sid, text) => pushNotice(noticeForQueuedDelivery(sid, text)));
      }
      // D3:非当前会话的等待审批/终态提醒(文案取自事件本身,不依赖列表快照)
      const notice = noticeForSessionEvent(e, currentIdRef.current);
      if (notice) pushNotice(notice);
    });
    return () => {
      alive = false;
      off();
      offOpenSession();
      offOpenSettings();
      offMcpReloaded();
      offMcpTimeout();
      shellTimers.current.forEach(window.clearTimeout);
      shellTimers.current.clear();
      noticeTimers.current.forEach(window.clearTimeout);
      noticeTimers.current.clear();
    };
  }, []);

  // D1 引擎重启自愈:记住"曾不可用",Ready 后重拉会话列表并自增 epoch。
  // 保存设置/手动重启/崩溃自愈统一收敛于 engine-status,不做特殊分支;
  // 模型清单无缓存模块(composer/新建弹窗挂载即重拉),无需失效动作。
  const engineDownRef = useRef(false);
  useEffect(() => {
    let alive = true;
    // 事件与快照走同一条判定:页面可能恰好在退避窗口里加载,只靠事件会漏记 down
    const apply = (s: EngineStatus) => {
      if (s.phase === "ready") {
        if (engineDownRef.current) {
          engineDownRef.current = false;
          refresh();
          setEpoch((n) => n + 1);
        }
        return;
      }
      // stopped 不记也不清:它只是冷启动前与重启中途的正常过站
      if (s.phase !== "stopped") engineDownRef.current = true;
    };
    const off = onEngineStatus((s) => {
      if (alive) apply(s);
    });
    // 状态可能早于窗口存在(冷启动失败/崩溃),挂上监听后补拉一次快照
    void engineStatus().then((s) => {
      if (alive && s) apply(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const current = sessions.find((m) => m.id === currentId) ?? null;

  // 标题跟随**主区实际渲染的那个视图**,四个状态都要进依赖(见
  // shellChrome.windowContextLabel 头注:此前只认 current,切设置/新建/云端
  // 任务时窗口切换器里仍挂着上一个本地会话的标题)
  useEffect(() => {
    const label = windowContextLabel(
      { settingsOpen, creating: !!creating, cloudSpace: space === "cloud", statsSpace: space === "stats" },
      cloudTask,
      space === "cloud" || space === "stats" ? null : current,
      t,
    );
    setWindowTitle(`${label} — ${t("app.name")}`);
  }, [current, settingsOpen, creating, space, cloudTask, t]);

  const select = (meta: SessionMeta) => {
    setCurrentId(meta.id);
    writeLastSession(meta.id);
    dismissSession(meta.id);
    setSettingsOpen(false);
    setCreating(null);
  };

  /** 删除会话(侧栏右键与 ChatView ⋯ 菜单共用一套):成功才清 composer 留档、
   *  撤选中、重拉列表;失败外显原因并**就此打住**。
   *
   *  此前是 `.catch(() => {}).then(...)`:壳拒了(运行中的会话内核不许删)
   *  界面照样撤选中 + 重拉,于是"删成功了"的假象只维持到列表刷回来——会话
   *  又冒出来了,而全程没有一个字解释。旧 UI 是 notify 后直接 return。 */
  const removeSession = (meta: SessionMeta) => {
    void sessionDelete(meta.id)
      .then(() => {
        dropStash(meta.id); // 会话没了,composer 留档随之清除
        if (currentIdRef.current === meta.id) setCurrentId(null);
        refresh();
      })
      .catch((e: unknown) => pushShell("notice.deleteFailed", "error", { params: { reason: errText(e) } }));
  };

  // 空间导轨徽标:按空间分账。cloud 的数据不在壳的会话表里(CloudTaskView
  // 自己拉),没有等待确认这一态,恒 0
  const waiting: Record<Space, number> = {
    local: sessions.filter((m) => m.kind !== "chat" && m.waiting_ask).length,
    cloud: 0,
    chat: sessions.filter((m) => m.kind === "chat" && m.waiting_ask).length,
    stats: 0,
  };

  // 新建弹窗的最近目录:非 chat、未归档(会话与项目两级),按最近活跃排,项目 key 去重
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
    <div className="flex h-full flex-col text-base-content">
      {isCustomChromeShell() && <TitleBar />}
      <ResizeEdges />
      <EngineBanner />
      <div className="flex min-h-0 flex-1">
        <SpaceRail space={space} waiting={waiting} onChange={setSpace} settingsOpen={settingsOpen} onToggleSettings={() => { setCreating(null); setSettingsOpen((v) => !v); }} />
        <Sidebar
          space={space}
          sessions={sessions}
          currentId={currentId}
          attentionIds={attentionIds}
          cloud={{
            currentId: cloudTask?.id ?? null,
            // 与本地 select 同口径:点列表永远切走覆盖视图(设置/新建)。
            // 漏掉这两句 = 设置页开着时点云端任务毫无反应(用户报障
            // 2026-08-07),因为主区分支 settingsOpen/creating 优先级在前
            onSelect: (task) => {
              setCloudTask(task);
              setSettingsOpen(false);
              setCreating(null);
            },
            reloadKey: cloudReload,
            onDeleted: (id) => {
              if (cloudTask?.id === id) setCloudTask(null);
              setCloudReload((n) => n + 1);
            },
            onRefresh: () => setCloudReload((n) => n + 1),
            onOpenSettings: () => {
              setCreating(null);
              setSettingsOpen(true); // 设置初始分区即「账号」,直达连接入口
            },
            onNewTaskIn: (project) => {
              setSettingsOpen(false);
              setCreating({ cloudProject: project });
            },
          }}
          actions={{
            onSelect: select,
            onNewTask: () => {
              setSettingsOpen(false);
              setCreating({});
            },
            onNewTaskIn: (workdir) => {
              setSettingsOpen(false);
              setCreating({ dir: workdir });
            },
            // 改名/归档同理:成功才重拉,失败给原因(旧 UI「⚠ 重命名失败:
            // {原因}」)。原先 .catch(() => {}).then(refresh) 是"失败了也当
            // 没事发生":列表刷回旧标题,用户以为自己没点中
            onRename: (meta, title) => {
              void sessionPatch(meta.id, { title })
                .then(refresh)
                .catch((e: unknown) => pushShell("notice.renameFailed", "error", { params: { reason: errText(e) } }));
            },
            onDelete: removeSession,
            onToggleArchive: (meta) => {
              void sessionPatch(meta.id, { archived: !meta.archived })
                .then(refresh)
                .catch((e: unknown) => pushShell("notice.archiveFailed", "error", { params: { reason: errText(e) } }));
            },
          }}
        />
        {settingsOpen ? (
          <SettingsView onClose={() => setSettingsOpen(false)} hasRunningTask={sessions.some((s) => s.status === "running")} />
        ) : creating ? (
          <NewTaskModal
            open
            initialDir={creating.dir}
            initialCloudProject={creating.cloudProject}
            // 侧栏 ＋ 属于当前空间:rail 停在哪个空间,新建就默认开哪个页签。
            // stats 空间没有对应的新建页签,回退默认(本地)
            initialKind={space === "stats" ? undefined : space}
            recentDirs={recentDirs}
            // 云端页签未连接时的出口:与侧栏云端空态同一个动作(关掉新建、
            // 开设置页——设置页初始分区就是「账号」,直达连接入口)
            onOpenSettings={() => {
              setCreating(null);
              setSettingsOpen(true);
            }}
            onClose={() => setCreating(null)}
            onCreated={(meta) => {
              refresh();
              select(meta);
              if (meta.kind === "chat") setSpace("chat");
              else setSpace("local");
            }}
            onCloudCreated={(task) => {
              setSpace("cloud");
              setCloudTask(task);
              setCloudReload((n) => n + 1);
            }}
          />
        ) : space === "stats" ? (
          <UsageStatsView />
        ) : space === "cloud" && cloudTask ? (
          <CloudTaskView
            key={cloudTask.id}
            task={cloudTask}
            onTasksChanged={() => setCloudReload((n) => n + 1)}
            onDeleted={() => {
              setCloudTask(null);
              setCloudReload((n) => n + 1);
            }}
          />
        ) : (
          <MainArea
            current={space === "cloud" ? null : current}
            epoch={epoch}
            onDelete={removeSession}
            onPatched={refresh}
            onActionError={(key, reason) => pushShell(key, "error", { params: { reason } })}
          />
        )}
      </div>
      {/* D3 后台会话提醒:可叠多条(每会话取最新一条),点击跳转、可关闭。
          壳级提示(浏览器工具装载等)与会话提醒共用同一角落栈,只是不可跳转。
          纵向起点是算出来的:daisyUI .toast-top 自带 top:1rem(16px),头部基线
          下缘在 chrome + 52px 处,mt 补满这一段即落在基线下 16px,与 .toast 自带
          的 inset-inline-end:1rem 同值——右上角上下左右同一圈留白。
          **必须带 --chrome-h**:原先写死 mt-13(52px)是照 mac 算的,Windows/Linux
          有 32px 窗框条、基线在 84px,提醒从 68px 起就压住了主区头右侧的
          文件/⋯ 动作钮(z-50 还盖在上面)。凡 fixed 贴顶的一律读该变量(§1) */}
      {(notices.length > 0 || shellNotices.length > 0) && (
        <div
          // z 压过 daisyUI 模态(写死 z-index:999):LAYOUT §1 的 z 序里
          // toast 在最上。停在 z-50 的话,看图放大/子会话回放/未保存确认
          // 期间到的后台会话提醒与壳提示(含带「重启引擎」按钮的那条)会被
          // 遮罩压住点不到,点下去反而把弹层关了
          className="toast toast-top toast-end z-[1000] mt-[calc(var(--chrome-h)+52px)]"
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
              {/* 失败原因是壳给的任意串,break-all 免得长路径把提示撑爆 */}
              <span className="max-w-64 min-w-0 break-all">{t(n.key, n.params)}</span>
              {n.action === "restart" && (
                // 成功即撤这条提示(问题已解决);失败不撤,由引擎横幅接手外显
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
            // 整条可点跳转(图标/留白同文字一个语义),文字按钮仍是无障碍
            // 焦点位;关闭钮截断冒泡,不触发跳转
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
  );
}
