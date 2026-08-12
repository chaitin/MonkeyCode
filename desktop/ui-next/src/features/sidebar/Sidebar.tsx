// 侧栏:三空间(本地/云端/对话)+ 会话列表。
// 分层约定(tasks/lessons.md 2026-08-04):
// - 壳布局不动:h-13 品牌头(LAYOUT.md §2)→ 列表滚动区 → footer;
// - 信息布局(用户定案 2026-08-04「区块标签+安静行」,08-05 状态点化):
//   行单行 = 行首身份图标槽 + 摘要‖标题 + 行尾要紧态状态点(词进
//   title/aria;静默行无点,轮次进 tooltip);组头 = 区块小标签(项目图标 + 原大小写
//   名称,同名靠 tooltip 路径区分)+ 等待徽标 + 快捷「+」殿后;项目内「已归档任务
//   · N」小节、底部「已归档项目 · N」;
// - 组件一律 daisyUI 原生形态:menu(details 折叠)、status 状态点、badge、
//   btn、右键菜单走 lib/contextMenu(menu 皮相)。
// 行交互:右键 = 行菜单(重命名/归档/删除二段确认)。
// 行/组头/小节折叠的呈现件收口在 listKit(三列表统一,不做两套)。
import { IconArchive, IconFolder, IconFolderOpen, IconInbox, IconMessages, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { CloudTaskList, useCloudProjects, useCloudTasks, type CloudTasksFeed } from "@/features/cloud/CloudTaskList";
import { GroupLabel, levelPad, ListRow, NEST_NO_GUIDE, SectionFold } from "@/features/sidebar/listKit";
import { Brand } from "@/features/titlebar/TitleBar";
import { useUpdate } from "@/features/update/useUpdate";
import { openMenu, type MenuItem } from "@/lib/contextMenu";
import { useI18n } from "@/lib/i18n";
import type { SessionMeta } from "@/lib/ipc/sessions";
import {
  groupSessions,
  projectKey,
  readArchivedProjects,
  readCollapsedGroups,
  readProjectOrder,
  readSessionArchivesOpen,
  reorderKeys,
  writeArchivedProjects,
  writeCollapsedGroups,
  writeProjectOrder,
  writeSessionArchivesOpen,
  type ProjectGroup,
} from "@/lib/util/projects";
import type { Space } from "@/lib/util/prefs";

export interface SidebarActions {
  onSelect: (meta: SessionMeta) => void;
  onDelete: (meta: SessionMeta) => void;
  onToggleArchive: (meta: SessionMeta) => void;
  onRename: (meta: SessionMeta, title: string) => void;
  onNewTask: () => void;
  /** 项目组头「在此新建任务」:预填该项目目录 */
  onNewTaskIn: (workdir: string) => void;
}

type T = ReturnType<typeof useI18n>["t"];

/** 拖拽「移到末尾」的落区标记(项目 key 是目录路径,不会与之相撞)。 */
const END_DROP_KEY = "\0end";

/** 行尾状态点(用户定案 2026-08-05「文字换状态图标」):仅要紧态给彩点,
 * 静默态无点(轮次进 tooltip);状态词进点的 title/aria。attention(D3
 * 后台提醒未读)也在此:终态用警示点点出来,点开行即消。 */
function rowTrailing(meta: SessionMeta, t: T, attention: boolean): { tone: string; label: string; pulse?: boolean } | null {
  // pulse = 进行中的活态(点 + 扩散环);未读/出错是静态终态,给静点即可
  if (meta.waiting_ask) return { tone: "status-warning", label: t("status.waitingAsk"), pulse: true };
  if (attention) return { tone: "status-warning", label: t("status.attention") };
  if (meta.status === "running") return { tone: "status-primary", label: t("status.running"), pulse: true };
  if (meta.status === "error") return { tone: "status-error", label: t("status.error") };
  return null;
}

/** 行状态词(与旧 UI sidebar.rowStatus 同一张表):**每种状态都有词**,
 * 要紧态另由 rowTrailing 给一个彩点,静默态就只剩这个词——它进行 tooltip,
 * 不上行(LAYOUT §6.1「文字状态词不上行」、「终态词收进行 tooltip」)。
 *
 * 为什么补这个函数:§6.1 承诺的是「安静的状态词搬进 tooltip」,而实现里只有
 * status.turns 搬过去了,status.interrupted / idle / notStarted 三条在 zh.ts 里
 * 成了没人读的孤儿键——tooltip 只插值 trailing?.label,而这三种状态压根不给
 * trailing。结果是「已停止 / 可继续 / 尚未开始」在界面上无处可查:被引擎崩溃
 * 打断的后台任务,行上没点、tooltip 里也没词,彻底隐身。 */
function rowStatusLabel(meta: SessionMeta, t: T): string {
  if (meta.waiting_ask) return t("status.waitingAsk");
  switch (meta.status) {
    case "running":
      return t("status.running");
    case "error":
      return t("status.error");
    case "interrupted":
      return t("status.interrupted");
    case "idle":
    case "finished": // 旧版壳顶层会话的「一轮结束」;新壳一律回 idle
      return t("status.idle");
    default:
      return meta.turns > 0 ? t("status.idle") : t("status.notStarted");
  }
}

interface RowPlumbing {
  currentId: string | null;
  actions: SidebarActions;
  attentionIds?: Set<string>;
  renamingId: string | null;
  onRenameStart: (id: string) => void;
  onRenameEnd: () => void;
}

function SessionRow({ meta, p, level }: { meta: SessionMeta; p: RowPlumbing; level?: number }) {
  const { t } = useI18n();
  const attention = p.attentionIds?.has(meta.id) ?? false;

  if (p.renamingId === meta.id) {
    const commit = (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return; // IME 组字回车不提交
      if (e.key === "Escape") return p.onRenameEnd();
      if (e.key !== "Enter") return;
      const title = e.currentTarget.value.trim();
      // 空提交 = 撤销自定义、回落自动链(壳摘 title_custom 并重填首句);
      // 只有「本就没改过名又提交空」才是纯空转,与头部改名同一口径
      if (title !== meta.title && !(!title && !meta.title_custom)) p.actions.onRename(meta, title);
      p.onRenameEnd();
    };
    return (
      <li>
        <div className={`min-h-8 p-1 ${levelPad(level)}`}>
          <input
            type="text"
            aria-label={t("sidebar.row.rename")}
            placeholder={t("chat.rename.clearHint")}
            className="input input-xs w-full"
            defaultValue={meta.title}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={commit}
            onBlur={p.onRenameEnd}
          />
        </div>
      </li>
    );
  }

  const isChat = meta.kind === "chat";
  // 单行,优先级 用户改名 > 轮末摘要 > 首句自动标题(与 ChatView 头部
  // 同一口径,2026-08-06 用户定案:改过名的会话在哪儿都得显改的那个;
  // title_custom 由壳 sidecar 标记,区分改名与首句自动标题)
  const primary = meta.title_custom ? meta.title : meta.summary || meta.title;
  const trailing = rowTrailing(meta, t, attention);
  const turns = meta.turns > 0 ? t("status.turns", { n: String(Math.trunc(meta.turns)) }) : "";
  // 行 tooltip = 这一行的全部安静信息(§6.1):标题 / 摘要 / 目录 / 状态词 /
  // 未读 / 轮次 / 右键提示。状态词取 rowStatusLabel 而不是 trailing.label——
  // 后者只有要紧态才有,静默态原先整条不出词
  const tooltip = [
    meta.title,
    meta.summary,
    isChat ? t("sidebar.row.chatDetail") : meta.workdir,
    rowStatusLabel(meta, t),
    attention ? t("status.attention") : "",
    turns,
    t("sidebar.row.hint"),
  ]
    .filter(Boolean)
    .join("\n");
  const menuItems: MenuItem[] = [
    { label: t("sidebar.row.rename"), run: () => p.onRenameStart(meta.id) },
    { label: meta.archived ? t("sidebar.row.unarchive") : t("sidebar.row.archive"), run: () => p.actions.onToggleArchive(meta) },
    {
      label: t("sidebar.row.delete"),
      confirm: t("sidebar.row.deleteConfirm"),
      danger: true,
      // 运行中的会话壳/内核会拒删。旧 UI 直接把这一项置灰并写明
      // title="运行中,请先停止"(viewChrome.DeleteMenuItem);ui-next 此前
      // 压根没看 meta.status,点下去只会得到一条失败提示,而且不说为什么
      disabledReason: meta.status === "running" ? t("sidebar.row.deleteRunning") : undefined,
      run: () => p.actions.onDelete(meta),
    },
  ];
  return (
    <ListRow
      primary={primary}
      trailing={trailing}
      tooltip={tooltip}
      level={level}
      active={meta.id === p.currentId}
      archived={meta.archived}
      attention={attention}
      onSelect={() => p.actions.onSelect(meta)}
      menuItems={menuItems}
    />
  );
}

/** level:缩进级(listKit.LEVELS——层级缩进进行内、行底满宽,行左缘的警示条
 * 也跟着这一级走;嵌套 margin 会把 hover/选中底压窄错位,旧 UI 即行满宽 +
 * padding 阶梯)。 */
function rows(list: SessionMeta[], p: RowPlumbing, level?: number) {
  return list.map((meta) => <SessionRow key={meta.id} meta={meta} p={p} level={level} />);
}

/** 一个项目分组(daisyUI menu 的 details 折叠;含「已归档任务 · N」小节)。 */
function ProjectDetails({
  group,
  p,
  collapsed,
  onToggleCollapsed,
  archOpen,
  onToggleArchOpen,
  onProjectArchiveToggle,
  archivedProject,
  drag,
  dropTarget,
}: {
  group: ProjectGroup;
  p: RowPlumbing;
  collapsed: boolean;
  onToggleCollapsed: (key: string, open: boolean) => void;
  archOpen: boolean;
  onToggleArchOpen: (key: string) => void;
  onProjectArchiveToggle: (key: string) => void;
  archivedProject: boolean;
  drag?: {
    onDragStart: (key: string) => void;
    onDragOver: (key: string) => void;
    onDragEnd: () => void;
    onDropBefore: (key: string | null) => void;
  };
  dropTarget?: boolean;
}) {
  const { t } = useI18n();
  const waiting = group.sessions.filter((s) => s.waiting_ask).length;
  const menuItems: MenuItem[] = [
    ...(archivedProject ? [] : [{ label: t("sidebar.project.newTaskIn"), run: () => p.actions.onNewTaskIn(group.key) }]),
    {
      label: archivedProject ? t("sidebar.project.unarchive") : t("sidebar.project.archive"),
      run: () => onProjectArchiveToggle(group.key),
    },
  ];
  return (
    // 拖拽热区挂 **li**(整组:组头 + 展开后的任务行),不是只挂 summary。
    // 只挂 summary 的话,组一展开,组头上下的任务行区域全是死区——不
    // preventDefault 就是禁止光标 + 松手无效,用户得精准命中组头那一行。
    <li
      className="relative"
      onDragOver={(e: DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDragOver(group.key);
      }}
      onDrop={(e: DragEvent) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDropBefore(group.key);
      }}
    >
      <details
        open={!collapsed}
        onToggle={(e) => {
          // ⚠️ React 把原生不冒泡的 toggle 做成合成冒泡:内层「已归档任务」
          // details 的开合会冒到这里,不守卫 target 就会把项目一起折叠
          // (2026-08-05 用户报障根因)
          if (e.target !== e.currentTarget) return;
          onToggleCollapsed(group.key, e.currentTarget.open);
        }}
      >
        {/* 区块标签形态:summary 由 grid 覆写为 flex(名称伸展、徽标/＋殿后);
            原生折叠箭头整个去掉(用户定案 2026-08-04),开合只靠点击组头。
            行节奏全列统一,组间不加空白(2026-08-07 用户三轮报障后改按主流
            树组件的做法:VS Code 资源管理器 / Finder 列表 / JetBrains 项目树 /
            GitHub 文件树都是等距行 + 缩进,空白分组是 Slack 那种「少数固定
            分区」的手法,项目数一多就把列表撑散)。层级信号交给缩进与组头
            小标签,不再靠 mb/pb 调间距(引导竖线已撤,用户定案 2026-08-10) */}
        <summary
          className={`group relative flex items-center after:hidden ${archivedProject ? "ps-6" : ""}`}
          title={[group.key, t("sidebar.project.hint"), drag ? t("sidebar.project.dragHint") : ""].filter(Boolean).join("\n")}
          draggable={!!drag}
          onDragStart={() => drag?.onDragStart(group.key)}
          onDragEnd={() => drag?.onDragEnd()}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            openMenu({ x: e.clientX, y: e.clientY }, menuItems);
          }}
        >
          {/* 落点指示线**绝对定位**,不用 border-t-2:边框参与布局,高度 auto
              的 summary 加上它会把该行及下方整体顶下去 2px,指示线一出一进
              列表就上下跳 */}
          {dropTarget && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />}
          <GroupLabel icon={collapsed ? IconFolder : IconFolderOpen} name={group.name} />
          {waiting > 0 && <span className="badge badge-warning badge-xs">{waiting}</span>}
          {/* 快捷钮常驻占位、hover 只切可见性:插入式显隐会挤动项目名,鼠标一进一出就抖 */}
          {!archivedProject && (
            <button
              type="button"
              aria-label={t("sidebar.project.newTask")}
              title={t("sidebar.project.newTask")}
              className="btn btn-ghost btn-square btn-xs invisible group-hover:visible group-focus-within:visible"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                p.actions.onNewTaskIn(group.key);
              }}
            >
              <IconPlus size={14} stroke={1.75} aria-hidden />
            </button>
          )}
        </summary>
        {/* 缩进阶梯进行内(行底满宽,旧 UI 同款):嵌套 ul 一律拉平
            (ms-0 ps-0,margin 缩进会把行底压窄错位);L1 行 ps-6、L2 行
            ps-9(基准 item padding 12px,每级恰 = 图标宽 12px),行首标记
            统一 12px 定宽槽 → 同级文字对齐、跨级阶梯均匀 */}
        <ul className={`ms-0 min-w-0 ps-0 pb-1.5 ${NEST_NO_GUIDE}`}>
          {rows(group.sessions, p, archivedProject ? 2 : 1)}
          {group.archivedSessions.length > 0 && (
            <li>
              <details open={archOpen} onToggle={(e) => {
                if (e.target !== e.currentTarget) return; // toggle 合成冒泡守卫
                if (e.currentTarget.open !== archOpen) onToggleArchOpen(group.key);
              }}>
                {/* Archive 图标行首(与任务行状态槽同列),去 menu 默认尾箭头 */}
                <summary
                  className={`flex items-center gap-2 ${archivedProject ? "ps-9" : "ps-6"} text-xs text-base-content/40 after:hidden`}
                >
                  {/* 图标裸放 flex 行(与项目组头 Folder 同构):12px 图标不需要
                      定宽槽,多包一层反而竖向对不齐(用户报偏下) */}
                  <IconArchive size={10} stroke={1.75} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t("sidebar.archivedTasks")}</span>
                </summary>
                {/* 收起即卸载:details 收起后嵌套 ul 在部分 webview 里残留
                    占位空间(用户报障),条件渲染釜底抽薪 */}
                {archOpen && (
                  <ul className={`ms-0 min-w-0 ps-0 pb-1 ${NEST_NO_GUIDE}`}>
                    {rows(group.archivedSessions, p, archivedProject ? 3 : 2)}
                  </ul>
                )}
              </details>
            </li>
          )}
        </ul>
      </details>
    </li>
  );
}

/** 概览块(固定,品牌头之下、列表之上):空间标题 + 一句描述 + 统计。
 *  统计只给现况:总量低调,运行中/等待确认(云端:排队中)着色浮出
 *  (与行状态词同色语);云端 feed 由 Sidebar 注入,与列表同一份数据。 */
function Overview({
  space,
  sessions,
  archivedProjects,
  cloud,
  onRefresh,
}: {
  space: Space;
  sessions: SessionMeta[];
  /** 已归档项目 key 集:统计口径必须与看得见的列表一致(见 pool) */
  archivedProjects: ReadonlySet<string>;
  cloud?: { feed: CloudTasksFeed; projects: import("@/lib/ipc/cloudtasks").CloudProject[] };
  /** 云端列表刷新(概览块右上;整表故障条也用它重试) */
  onRefresh?: () => void;
}) {
  const { t } = useI18n();
  const title = t(
    space === "cloud" ? "rail.cloud" : space === "chat" ? "rail.chat" : space === "stats" ? "rail.stats" : "rail.local",
  );
  const desc = t(
    space === "cloud"
      ? "sidebar.overview.cloud.desc"
      : space === "chat"
        ? "sidebar.overview.chat.desc"
        : space === "stats"
          ? "sidebar.overview.stats.desc"
          : "sidebar.overview.local.desc",
  );
  // 统计口径 = **看得见的列表**。项目级归档也要排除(旧 UI sidebar.tsx 先
  // activeLocalAll = 过滤掉 isProjectArchived 再统计):只按会话级 m.archived
  // 过滤的话,右键归档几个项目后列表里只剩未归档的组、概览却仍写着归档前的
  // 「5 项目 · 23 任务」;更糟的是彩色统计——归档项目里有任务在跑或卡在审批
  // 时概览亮「1 运行中 / 1 等待确认」,而底部「已归档项目」小节默认收起,
  // 用户在可见列表里一行都找不到它。chat 空间无项目概念,不受影响。
  const pool = sessions
    .filter((m) => (space === "chat" ? m.kind === "chat" : m.kind !== "chat"))
    .filter((m) => !m.archived)
    .filter((m) => space === "chat" || !archivedProjects.has(projectKey(m.workdir)));
  const stats: { text: string; cls?: string }[] = [];
  if (space === "local") {
    const projects = new Set(pool.map((m) => projectKey(m.workdir))).size;
    stats.push({ text: t("sidebar.overview.projects", { n: String(projects) }) });
    stats.push({ text: t("sidebar.overview.tasks", { n: String(pool.length) }) });
  } else if (space === "chat") {
    stats.push({ text: t("sidebar.overview.chats", { n: String(pool.length) }) });
  } else if (space === "cloud" && cloud && cloud.feed.tasks !== null) {
    // 云端与本地同构:总量低调 + 要紧态着色;首屏加载中(tasks=null)不出
    // 统计行,避免闪「0 项目/0 任务」。任务总数以服务端 total 为准(含未
    // 加载的历史页);运行中/排队中取自已加载页(active 服务端置顶,首页全)
    stats.push({ text: t("sidebar.overview.projects", { n: String(cloud.projects.length) }) });
    stats.push({ text: t("sidebar.overview.tasks", { n: String(cloud.feed.total ?? cloud.feed.tasks.length) }) });
    const running = cloud.feed.tasks.filter((x) => x.status === "processing").length;
    const queued = cloud.feed.tasks.filter((x) => x.status === "pending").length;
    if (running > 0) stats.push({ text: t("sidebar.overview.running", { n: String(running) }), cls: "text-primary" });
    if (queued > 0) stats.push({ text: t("sidebar.overview.queued", { n: String(queued) }), cls: "text-warning" });
  }
  if (space === "local" || space === "chat") {
    const running = pool.filter((m) => m.status === "running").length;
    const waiting = pool.filter((m) => m.waiting_ask).length;
    if (running > 0) stats.push({ text: t("sidebar.overview.running", { n: String(running) }), cls: "text-primary" });
    if (waiting > 0) stats.push({ text: t("sidebar.overview.waiting", { n: String(waiting) }), cls: "text-warning" });
  }
  const feedErr = space === "cloud" ? cloud?.feed.error : "";
  return (
    <div className="shrink-0 px-5 pt-3 pb-1">
      {/* 标题行**恒留一个 btn-xs 的高度**,不管这个空间有没有刷新钮:
          btn-xs 是 24px(--size-field × 6),text-xs 的行盒只有 16px,
          于是「有钮的云端」比「没钮的本地/对话」整整高 8px,切空间时概览块
          往下一跳(2026-08-09 用户报障)。高度写成与 btn-xs 同一个表达式,
          而不是写死 h-6——自定义主题里「控件尺寸」可调 --size-field,
          写死了换个尺寸又会错开。
          同 LAYOUT §6.2 的 hover 显隐铁律一个道理:**行高不许由"这行恰好有
          没有那个元素"决定**。 */}
      <div className="flex min-h-[calc(var(--size-field,0.25rem)*6)] items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</div>
        {/* 刷新是**列表级**操作,归概览块;品牌头只放品牌与新建
            (用户报障 2026-08-06:刷新钮不该在 header) */}
        {space === "cloud" && onRefresh && (
          <button
            type="button"
            aria-label={t("cloud.list.refresh")}
            title={t("cloud.list.refresh")}
            className="btn btn-ghost btn-square btn-xs -me-1 shrink-0 text-base-content/50"
            onClick={onRefresh}
          >
            <IconRefresh size={13} stroke={1.75} aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-base-content/45">{desc}</div>
      {stats.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs tabular-nums text-base-content/60">
          {stats.map((s) => (
            <span key={s.text} className={s.cls}>
              {s.text}
            </span>
          ))}
        </div>
      )}
      {/* 整表加载故障:概览块内一行低调告警 + 就地重试。此前挂在列表
          末尾,混在条目里读不出「这是整个列表的状态」(用户报障 2026-08-06) */}
      {feedErr && (
        <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-error">
          <span className="min-w-0 flex-1 break-all">{t("cloud.list.error", { reason: feedErr })}</span>
          {onRefresh && (
            <button type="button" className="btn btn-ghost btn-xs shrink-0" onClick={onRefresh}>
              {t("cloud.list.retry")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptySlate({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
      {icon}
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-base-content/60">{detail}</div>
    </div>
  );
}

export function Sidebar({
  space,
  sessions,
  currentId,
  actions,
  attentionIds,
  cloud,
}: {
  space: Space;
  sessions: SessionMeta[];
  currentId: string | null;
  actions: SidebarActions;
  /** 后台提醒未读的会话 id 集(D3):命中行状态点转警示色 + 行高亮 */
  attentionIds?: Set<string>;
  /** 云端空间的数据接线(App 提供;缺省时云端页为空列表) */
  cloud?: {
    currentId: string | null;
    onSelect: (task: import("@/lib/ipc/cloudtasks").CloudTask) => void;
    reloadKey: number;
    onDeleted?: (id: string) => void;
    onRefresh?: () => void;
    /** 未连接空态的「去设置连接」:App 打开设置页(默认落账号分区) */
    onOpenSettings?: () => void;
    /** 项目组头「在此项目新建任务」:App 打开新建视图并预选该云端项目 */
    onNewTaskIn?: (project: import("@/lib/ipc/cloudtasks").CloudProject) => void;
  };
}) {
  const { t } = useI18n();
  const [order, setOrder] = useState<string[]>(readProjectOrder);
  const [archivedProjects, setArchivedProjects] = useState<Set<string>>(readArchivedProjects);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedGroups);
  const [sessionArchOpen, setSessionArchOpen] = useState<Set<string>>(readSessionArchivesOpen);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  // dragOverKey 取此值 = 悬停在列表末尾的收尾落区(项目 key 是路径,不会撞)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // 云端数据源(hook 无条件调用;非云端空间 enabled=false 不拉取):
  // 概览统计与列表共用同一份 feed,重新进入云端经 enabled 翻转刷新
  const cloudEnabled = space === "cloud";
  const cloudFeed = useCloudTasks(cloud?.reloadKey ?? 0, cloudEnabled);
  const cloudProjects = useCloudProjects(cloud?.reloadKey ?? 0, cloudEnabled);

  const p: RowPlumbing = {
    currentId,
    actions,
    attentionIds,
    renamingId,
    onRenameStart: setRenamingId,
    onRenameEnd: () => setRenamingId(null),
  };

  const toggleCollapsed = (key: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(key);
      else next.add(key);
      writeCollapsedGroups(next);
      return next;
    });
  };

  const toggleSessionArchOpen = (key: string) => {
    setSessionArchOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSessionArchivesOpen(next);
      return next;
    });
  };

  const toggleProjectArchive = (key: string) => {
    setArchivedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeArchivedProjects(next);
      return next;
    });
  };

  const body = () => {
    if (space === "stats") {
      // 用量统计空间没有会话列表,侧栏只留概览块
      return null;
    }

    if (space === "cloud") {
      return (
        <CloudTaskList
          feed={cloudFeed}
          projects={cloudProjects}
          currentId={cloud?.currentId ?? null}
          onSelect={(task) => cloud?.onSelect(task)}
          reloadKey={cloud?.reloadKey ?? 0}
          onDeleted={cloud?.onDeleted}
          onOpenSettings={cloud?.onOpenSettings}
          onNewTaskIn={cloud?.onNewTaskIn}
        />
      );
    }

    const pool = sessions.filter((m) => (space === "chat" ? m.kind === "chat" : m.kind !== "chat"));
    if (pool.length === 0) {
      const chat = space === "chat";
      const EmptyIcon = chat ? IconMessages : IconInbox;
      return (
        <EmptySlate
          icon={<EmptyIcon size={20} stroke={1.75} className="text-base-content/30" aria-hidden />}
          title={t(chat ? "sidebar.empty.chat.title" : "sidebar.empty.local.title")}
          detail={t(chat ? "sidebar.empty.chat.detail" : "sidebar.empty.local.detail")}
        />
      );
    }

    if (space === "chat") {
      const active = pool.filter((m) => !m.archived);
      const archived = pool.filter((m) => m.archived);
      return (
        <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
          {rows(active, p)}
          {archived.length > 0 && (
            <SectionFold label={t("sidebar.archivedChats")} foldKey="mc.archivedOpen">
              {rows(archived, p, 1)}
            </SectionFold>
          )}
        </ul>
      );
    }

    const grouped = groupSessions(pool, order, archivedProjects);
    const visibleKeys = grouped.projects.map((g) => g.key);
    const drag = {
      onDragStart: (key: string) => setDraggedKey(key),
      onDragOver: (key: string) => setDragOverKey((prev) => (prev === key ? prev : key)),
      onDragEnd: () => {
        setDraggedKey(null);
        setDragOverKey(null);
      },
      /** before=null → 移到末尾(列表底部的收尾落区)。 */
      onDropBefore: (before: string | null) => {
        setDragOverKey(null);
        if (!draggedKey || draggedKey === before) return;
        const next = reorderKeys(visibleKeys, draggedKey, before);
        setDraggedKey(null);
        // 结果与原序相同就什么都不做:拖到自己正下方那个组头时,
        // 「移到它之前」恰好等于原位——落点线照画、松手却不动,看起来像坏了
        // (旧 UI 有专门的 settled 判定,注释原话「避免『看起来会动其实不动』」)
        if (next.length === visibleKeys.length && next.every((k, i) => k === visibleKeys[i])) return;
        setOrder(next);
        writeProjectOrder(next);
      },
    };
    /** 落点是否**真的会改变顺序**(不会就不画线)。 */
    const willMove = (before: string | null): boolean => {
      if (!draggedKey || draggedKey === before) return false;
      const next = reorderKeys(visibleKeys, draggedKey, before);
      return !(next.length === visibleKeys.length && next.every((k, i) => k === visibleKeys[i]));
    };
    return (
      <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
        {grouped.projects.map((group) => (
          <ProjectDetails
            key={group.key}
            group={group}
            p={p}
            collapsed={collapsed.has(group.key)}
            onToggleCollapsed={toggleCollapsed}
            archOpen={sessionArchOpen.has(group.key)}
            onToggleArchOpen={toggleSessionArchOpen}
            onProjectArchiveToggle={toggleProjectArchive}
            archivedProject={false}
            drag={drag}
            dropTarget={dragOverKey === group.key && willMove(group.key)}
          />
        ))}
        {/* 收尾落区:拖拽中才出现的一条 12px 空行。没有它就**排不到末位**——
            每个组头表达的都是「放到我之前」,列表最后一位之后没有任何锚点,
            reorderKeys 的 before=null 分支在 UI 侧压根没有调用方,用户想把
            项目挪到最下面得反过来把别人一个个往上拖 */}
        {draggedKey && grouped.projects.length > 0 && (
          <li
            aria-hidden
            className="relative"
            onDragOver={(e: DragEvent) => {
              e.preventDefault();
              setDragOverKey(END_DROP_KEY);
            }}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              drag.onDropBefore(null);
            }}
          >
            <div className="pointer-events-none h-3 p-0">
              {dragOverKey === END_DROP_KEY && willMove(null) && (
                <span className="absolute inset-x-0 top-1 h-0.5 bg-primary" />
              )}
            </div>
          </li>
        )}
        {grouped.archivedProjects.length > 0 && (
          <SectionFold
            label={t("sidebar.archivedProjects")}
            foldKey="mc.projectArchiveOpen"
          >
            {grouped.archivedProjects.map((group) => (
              <ProjectDetails
                key={group.key}
                group={group}
                p={p}
                collapsed={collapsed.has(group.key)}
                onToggleCollapsed={toggleCollapsed}
                archOpen={sessionArchOpen.has(group.key)}
                onToggleArchOpen={toggleSessionArchOpen}
                onProjectArchiveToggle={toggleProjectArchive}
                archivedProject
              />
            ))}
          </SectionFold>
        )}
      </ul>
    );
  };

  return (
    <aside aria-label={t("sidebar.label")} className="flex w-side shrink-0 flex-col border-e border-base-300 bg-base-200">
      {/* 列头部:与 rail 角落/主区视图头部同一 h-13(52px)基线;空白处可拖拽窗口。
          左内距对齐下方内容竖线:概览块 px-5 = 列表区 p-2 + menu 行内距 12px = 20px */}
      <div data-tauri-drag-region="" className="flex h-13 shrink-0 items-center gap-1.5 border-b border-base-300 ps-5 pe-3">
        <Brand />
        <span data-tauri-drag-region="" className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label={t("sidebar.newTask")}
          title={t("sidebar.newTask")}
          className="btn btn-primary btn-square btn-xs"
          onClick={actions.onNewTask}
          disabled={space === "stats"}
        >
          <IconPlus size={14} stroke={2} aria-hidden />
        </button>
      </div>
      {/* 四段式(LAYOUT.md):头部固定 → 概览块固定 → 列表 = 唯一滚动区 → footer 钉底。
          scrollbar-gutter 预留滚条槽位:滚条挤占布局,auto 下出现/消失会让
          整列内容横移抖动;常驻滚道(overflow-y-scroll)会在壳内露白条,
          gutter 只留空间不绘制,透容器底(§5) */}
      <Overview
        space={space}
        sessions={sessions}
        archivedProjects={archivedProjects}
        cloud={{ feed: cloudFeed, projects: cloudProjects }}
        onRefresh={cloud?.onRefresh}
      />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 [scrollbar-gutter:stable]">{body()}</div>
      <div className="shrink-0 empty:hidden">
        <UpdateFooter />
      </div>
    </aside>
  );
}

function UpdateFooter() {
  const { t } = useI18n();
  const { update, installing, error, install } = useUpdate();
  if (!update?.available) return null;
  // 安装失败:忙态已由 useUpdate 复位,这里换错误形态外显原因,按钮可重试
  return (
    <div
      role={error ? "alert" : "status"}
      className={`alert ${error ? "alert-error" : ""} alert-soft m-2 mt-0 flex items-center py-1.5 text-xs`}
    >
      <span className="min-w-0 flex-1 truncate" title={error ?? undefined}>
        {error ? t("update.failed", { reason: error }) : t("update.available", { version: update.latest ?? "" })}
      </span>
      <button type="button" className={`btn ${error ? "btn-error" : "btn-primary"} btn-xs`} disabled={installing} onClick={install}>
        {installing && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {t("update.install")}
      </button>
    </div>
  );
}
