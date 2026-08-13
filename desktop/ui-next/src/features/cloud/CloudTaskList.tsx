// 侧栏云端空间的任务列表。呈现与交互与本地/对话列表同一套(listKit,
// 用户定案 2026-08-05「统一风格和交互,不要做两套」,后续并入同 tab 的
// 横向双 tab):进行中任务裸行置顶(同 chat 平铺行)→ 项目组(Folder
// 区块标签)→ 底部「历史任务」小节(History 图标、无计数)。
// 行 = 安静行:行首 12px Cloud 身份图标槽 + 标题 + 行尾要紧态状态点
// (状态词进点 title/aria 与行 tooltip);行菜单 = 右键(终止
// 仅运行中 / 删除,均二段确认)。历史开合持久化 mc.cloudHistoryOpen(旧
// UI 契约键);query 非空过滤并强制展开(未拉过的组顺势懒拉)。
// 数据 hook(useCloudTasks/useCloudProjects)由 Sidebar 顶层调用后注入
// props——概览统计与列表共用同一份 feed,enabled 仅云端空间为真。
import { IconCloud, IconFolder, IconHistory, IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { GroupLabel, ListRow, NEST_NO_GUIDE, SectionFold } from "@/features/sidebar/listKit";
import type { MenuItem } from "@/lib/contextMenu";
import { useI18n } from "@/lib/i18n";
import { inDesktopShell } from "@/lib/ipc/ipc";
import { mcStatus } from "@/lib/ipc/account";
import { mcProjects, mcTaskDelete, mcTasks, mcTaskStop, type CloudProject, type CloudTask } from "@/lib/ipc/cloudtasks";

const PAGE_SIZE = 20;

/** 后台轮询节拍(旧 UI App.tsx:336-340 同值):任务状态在云端自己走,
 * 不轮询的话 pending→processing→finished 一路都要靠用户手动刷新才可见。 */
const POLL_MS = 30_000;

const ACTIVE = new Set(["pending", "processing"]);

export interface CloudTasksFeed {
  /** null = 首屏加载中 */
  tasks: CloudTask[] | null;
  active: CloudTask[];
  history: CloudTask[];
  loading: boolean;
  /** 真故障(网络/服务端);未连接另走 unauthorized——那不是错误是状态 */
  error: string;
  /** 未连接云端(未登录或会话失效):恢复动作是去设置连接,不是重试
   * (用户报障 2026-08-06:红底报错 + 没用的「重试」) */
  unauthorized: boolean;
  total: number | null;
  hasMore: boolean;
  loadMore(): void;
  refresh(): void;
}

/** 一次取数怎么并进现有列表。
 * - replace:整表重来(手动刷新 / reloadKey / 进入云端空间);
 * - append:续页(loadMore),按 id 去重;
 * - merge:后台刷新首页——首页数据覆盖同 id 的旧条目并置前,**保留已经翻
 *   出来的深层页**。后台刷新若用 replace,用户翻了三页历史会被 30s 一次的
 *   轮询悄悄收回去。 */
type PageMode = "replace" | "append" | "merge";

/** 云端任务列表数据源:分页合并,active/history 由状态派生。
 * reloadKey 变化触发整表重拉(App 在任务创建/终止后 bump)。
 * enabled=false 时不拉取(Sidebar 只在云端空间供数;数据跨空间切换留存,
 * 重新进入云端经 enabled 翻转刷新)。
 * 自动刷新:窗口重获焦点 + 30s 轮询(仅 enabled 时挂,离开即拆)。 */
export function useCloudTasks(reloadKey = 0, enabled = true): CloudTasksFeed {
  const [tasks, setTasks] = useState<CloudTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const pageRef = useRef(0); // 已加载的最后一页(0 = 尚未加载)
  // 取数互斥分两条:前台(首屏/翻页/手动刷新)与后台刷新各占各的。
  // 合成一条会让后台刷新**吃掉**用户刚点的「加载更多」——焦点/轮询的时机
  // 与点击撞车是常态,静默丢一次用户操作比多发一个请求坏得多。
  // 反向则让路:前台在跑时后台这一拍直接跳过(下一拍还会来)。
  const inFlight = useRef(false);
  const bgFlight = useRef(false);

  const fetchPage = useCallback(async (page: number, mode: PageMode) => {
    if (!inDesktopShell()) {
      // 浏览器模式:与 sessionsList 同约定,查询类降级为空列表而非报错
      setTasks((prev) => prev ?? []);
      return;
    }
    const bg = mode === "merge";
    const busy = bg ? bgFlight : inFlight;
    if (busy.current || (bg && inFlight.current)) return;
    busy.current = true;
    // 后台刷新不点亮 loading:30s 一次的 spinner 闪烁是纯噪音,
    // 「加载更多」按钮也会因此莫名其妙地禁用一下
    if (!bg) setLoading(true);
    setError("");
    try {
      const r = await mcTasks(page, PAGE_SIZE);
      setUnauthorized(false); // 连上了(设置里刚连接完再回来)
      const batch = r.tasks ?? [];
      setTotal(r.page_info?.total ?? r.page_info?.total_count ?? null);
      // merge 不动分页水位:它刷的是首页,已翻出来的深层页仍在列表里
      if (!bg) pageRef.current = page;
      setTasks((prev) => {
        if (!prev || mode === "replace") return batch;
        if (mode === "append") {
          // 续页去重(以**已有**为准):置顶任务状态翻转会跨页重复出现
          const seen = new Set(prev.map((task) => task.id));
          return [...prev, ...batch.filter((task) => !seen.has(task.id))];
        }
        // merge 去重以**首页新数据**为准:同 id 用新的那份并置前,其余(深层页)原序保留
        const fresh = new Set(batch.map((task) => task.id));
        return [...batch, ...prev.filter((task) => !fresh.has(task.id))];
      });
    } catch (e) {
      // 会话失效/未登录不是"加载失败":回查一次登录态确证(壳的 401 文案
      // 是中文串,按串匹配太脆),据此分流成「未连接」状态而非红底报错
      // 只认**明确**的未登录信号:拿不到状态/字段缺失时不许吞掉原错误
      // (否则一切故障都被粉饰成「未连接」,真问题无从诊断)
      const st = await mcStatus().catch(() => null);
      if (st?.logged_in === false) {
        setUnauthorized(true);
        setError("");
        setTasks((prev) => prev ?? []); // 收掉首屏 spinner,交给未连接空态
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      busy.current = false;
      if (!bg) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void fetchPage(1, "replace");
  }, [fetchPage, reloadKey, enabled]);

  // 自动刷新(旧 UI App.tsx:329-340 的两条,ui-next 此前整个漏掉):
  // ① 窗口重获焦点即刷——网页/手机端刚派发的任务,切回桌面就该看得见;
  // ② 30s 轮询——任务状态在云端自己走,不轮询的话 pending→processing→
  //    finished 全程静止,侧栏概览的运行中/排队中计数跟着一起冻住。
  // 两条都只在云端空间(enabled)挂,离开即拆;fetchPage 自带在途互斥,
  // 与手动刷新/翻页撞车是安全的。
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => void fetchPage(1, "merge");
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [enabled, fetchPage]);

  const loaded = tasks?.length ?? 0;
  const hasMore = total !== null ? loaded < total : loaded >= pageRef.current * PAGE_SIZE && loaded > 0;

  return {
    tasks,
    active: (tasks ?? []).filter((task) => ACTIVE.has(task.status ?? "")),
    history: (tasks ?? []).filter((task) => !ACTIVE.has(task.status ?? "")),
    loading,
    error,
    unauthorized,
    total,
    hasMore,
    loadMore: () => void fetchPage(pageRef.current + 1, "append"),
    refresh: () => void fetchPage(1, "replace"),
  };
}

/** 项目列表(mc_projects;每项目捎带 ≤3 条运行中任务)。失败降级为空
 * (列表退回平铺形态,任务本身不受影响),但必须留痕便于诊断。 */
export function useCloudProjects(reloadKey = 0, enabled = true): CloudProject[] {
  const [projects, setProjects] = useState<CloudProject[]>([]);
  useEffect(() => {
    if (!inDesktopShell() || !enabled) return;
    let alive = true;
    mcProjects()
      .then((r) => {
        if (alive) setProjects((r.projects ?? []).filter((p) => !!p.id));
      })
      .catch((e: unknown) => {
        console.warn("[cloud-projects] 项目列表拉取失败:", e);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey, enabled]);
  return projects;
}

export function cloudTaskLabel(task: CloudTask, fallback: string): string {
  return task.title || task.summary || task.content || fallback;
}

type T = ReturnType<typeof useI18n>["t"];

/** 行尾状态点(安静行同构):仅「需要用户介入」级别给点——云端任务的
 * pending(VM 排队数分钟)/processing(执行数小时)是**常态**不是要紧态,
 * 每行常亮脉动点是噪音不是信号(用户定案 2026-08-06,对齐本地行的按需
 * 口径);运行/排队的一眼可见由概览统计行承担,状态词全量进行 tooltip。 */
function cloudState(status: string | undefined, t: T): { tone: string; label: string } | null {
  switch (status) {
    case "error":
      return { tone: "status-error", label: t("cloud.status.error") };
    default:
      return null;
  }
}

/** 行 tooltip 的状态词(点已收敛,词仍全量可查)。 */
function cloudStateWord(status: string | undefined, t: T): string {
  switch (status) {
    case "pending":
      return t("cloud.status.pending");
    case "processing":
      return t("cloud.status.processing");
    case "error":
      return t("cloud.status.error");
    case "finished":
      return t("cloud.status.finished");
    default:
      return "";
  }
}

function TaskRow({
  task,
  currentId,
  level,
  onSelect,
  onDelete,
  onStop,
}: {
  task: CloudTask;
  currentId: string | null;
  /** 缩进级(listKit.LEVELS):项目组内的任务行 = 1 */
  level?: number;
  onSelect: (task: CloudTask) => void;
  onDelete: (task: CloudTask) => void;
  onStop: (task: CloudTask) => void;
}) {
  const { t } = useI18n();
  const label = cloudTaskLabel(task, t("cloud.list.untitled"));
  const st = cloudState(task.status, t);
  // tooltip 保留状态词:点已收敛(仅 error),排队/运行/完成在这里仍可查
  const stateWord = cloudStateWord(task.status, t);
  const running = ACTIVE.has(task.status ?? "");
  const menuItems: MenuItem[] = [
    ...(running ? [{ label: t("cloud.view.stop"), confirm: t("cloud.view.stopConfirm"), danger: true, run: () => onStop(task) }] : []),
    { label: t("cloud.list.delete"), confirm: t("cloud.list.deleteConfirm"), danger: true, run: () => onDelete(task) },
  ];
  return (
    <ListRow
      primary={label}
      trailing={st}
      tooltip={`${label}\n${stateWord ? `${stateWord}\n` : ""}${t("sidebar.row.hint")}`}
      level={level}
      active={task.id === currentId}
      onSelect={() => onSelect(task)}
      menuItems={menuItems}
    />
  );
}

/** 分组懒拉三态(互斥;都缺省 = 还没拉过,展开时才拉)。 */
interface GroupTasksState {
  loading?: boolean;
  tasks?: CloudTask[];
  error?: string;
}

export function CloudTaskList({
  feed,
  projects,
  currentId,
  onSelect,
  reloadKey = 0,
  onDeleted,
  query = "",
  onOpenSettings,
  onNewTaskIn,
}: {
  /** 列表数据源(useCloudTasks;Sidebar 供数——概览统计与列表同一份) */
  feed: CloudTasksFeed;
  /** 项目列表(useCloudProjects;同上) */
  projects: CloudProject[];
  currentId: string | null;
  onSelect: (task: CloudTask) => void;
  /** App 在任务创建/终止后 bump(feed 重拉在 hook 侧;这里作废分组缓存) */
  reloadKey?: number;
  /** 任务删除成功后回调(带任务 id);App 据此清空当前打开的同 id 视图 */
  onDeleted?: (id: string) => void;
  /** 侧栏搜索词(已 trim/lowercase);非空时过滤行并强制展开折叠段 */
  query?: string;
  /** 未连接空态的「去设置连接」入口(App 打开设置页) */
  onOpenSettings?: () => void;
  /** 项目组头「在此项目新建任务」:App 打开新建视图并预选该云端项目 */
  onNewTaskIn?: (project: CloudProject) => void;
}) {
  const { t } = useI18n();
  const forceOpen = query !== "";

  // 分组懒拉缓存(键 = 项目 id);重拉键翻转即作废
  const [groupTasks, setGroupTasks] = useState<Record<string, GroupTasksState>>({});
  useEffect(() => setGroupTasks({}), [reloadKey]);
  // 组开合(历史小节的契约键持久化在 SectionFold 内)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // 行动作(删除/终止)失败原因,已格式化;新动作发起时清空
  const [actionErr, setActionErr] = useState("");

  const loadGroup = useCallback(
    (projectId: string) => {
      if (groupTasks[projectId]) return; // 拉过/在途
      setGroupTasks((prev) => ({ ...prev, [projectId]: { loading: true } }));
      mcTasks(1, PAGE_SIZE, "", { projectId })
        .then((r) => setGroupTasks((prev) => ({ ...prev, [projectId]: { tasks: r.tasks ?? [] } })))
        .catch((e: unknown) =>
          setGroupTasks((prev) => ({ ...prev, [projectId]: { error: e instanceof Error ? e.message : String(e) } })),
        );
    },
    [groupTasks],
  );

  // 搜索强制展开:未拉过的组顺势懒拉(命中不能藏在没拉过的组里)
  useEffect(() => {
    if (!forceOpen) return;
    for (const project of projects) loadGroup(project.id ?? "");
  }, [forceOpen, projects, loadGroup]);

  const handleDelete = (task: CloudTask) => {
    setActionErr("");
    void mcTaskDelete(task.id)
      .then(() => {
        // 分组缓存就地剔除(展开着的组不必等重拉),整表重拉刷新置顶/历史
        setGroupTasks((prev) => {
          const next: Record<string, GroupTasksState> = {};
          for (const [key, state] of Object.entries(prev)) {
            next[key] = state.tasks ? { ...state, tasks: state.tasks.filter((x) => x.id !== task.id) } : state;
          }
          return next;
        });
        feed.refresh();
        onDeleted?.(task.id);
      })
      .catch((e: unknown) => {
        // 服务端会拒绝仍在运行/虚拟机尚在线的任务:原因外显,不静默
        setActionErr(t("cloud.list.deleteFailed", { reason: e instanceof Error ? e.message : String(e) }));
      });
  };

  const handleStop = (task: CloudTask) => {
    setActionErr("");
    void mcTaskStop(task.id)
      .then(() => {
        // 状态翻转(active→history),分组缓存作废,整表重拉
        setGroupTasks({});
        feed.refresh();
      })
      .catch((e: unknown) => {
        setActionErr(t("cloud.err.stopFailed", { reason: e instanceof Error ? e.message : String(e) }));
      });
  };

  const hit = (task: CloudTask) => !query || cloudTaskLabel(task, "").toLowerCase().includes(query);

  // 未连接:恢复动作是去设置连接,不是重试——给空态形态(图标+标题+辅助+
  // 动作),与其他空态同构;红底 alert 留给真故障
  if (feed.unauthorized) {
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
        <IconCloud size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
        <div className="text-sm font-semibold">{t("cloud.list.offline.title")}</div>
        <div className="text-xs text-base-content/60">{t("cloud.list.offline.detail")}</div>
        {onOpenSettings && (
          <button type="button" className="btn btn-primary btn-xs mt-1.5" onClick={onOpenSettings}>
            {t("cloud.list.offline.action")}
          </button>
        )}
      </div>
    );
  }

  if (feed.tasks === null) {
    return feed.error ? (
      <div role="alert" className="alert alert-error alert-soft flex flex-col items-start gap-1 py-2 text-xs">
        <span className="break-all">{t("cloud.list.error", { reason: feed.error })}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={feed.refresh}>
          {t("cloud.list.retry")}
        </button>
      </div>
    ) : (
      <div className="flex justify-center py-6">
        <span className="loading loading-spinner loading-sm text-base-content/40" aria-label={t("cloud.list.loading")} />
      </div>
    );
  }

  if (feed.tasks.length === 0 && projects.length === 0) {
    // 空态统一形态:图标 + 标题档 + 辅助档,居中
    return (
      <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
        <IconCloud size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
        <div className="text-sm font-semibold">{t("cloud.list.empty.title")}</div>
        <div className="text-xs text-base-content/60">{t("cloud.list.empty.detail")}</div>
      </div>
    );
  }

  const activeRows = feed.active.filter(hit);
  const historyRows = feed.history.filter(hit);

  const groupBody = (key: string) => {
    const state = groupTasks[key];
    const rowsHit = (state?.tasks ?? []).filter(hit);
    return (
      // 缩进进行内、行底满宽(与本地组同构,2026-08-05 定案):组内行 ps-6
      <ul className={`ms-0 min-w-0 ps-0 pb-1.5 ${NEST_NO_GUIDE}`}>
        {state?.loading && (
          <li className="flex justify-center py-2">
            <span className="loading loading-spinner loading-xs text-base-content/40" aria-label={t("cloud.list.loading")} />
          </li>
        )}
        {state?.error && <li className="py-1 ps-6 pe-2 text-xs text-warning">{t("cloud.list.groupError", { reason: state.error })}</li>}
        {state?.tasks && rowsHit.length === 0 && (
          <li className="py-1 ps-6 pe-2 text-xs text-base-content/40">{t("cloud.list.groupEmpty")}</li>
        )}
        {rowsHit.map((task) => (
          <TaskRow key={task.id} task={task} currentId={currentId} level={1} onSelect={onSelect} onDelete={handleDelete} onStop={handleStop} />
        ))}
      </ul>
    );
  };

  const projectGroup = (project: CloudProject, projectId: string, name: string) => {
    const isOpen = forceOpen || openGroups.has(projectId);
    return (
    // 与本地列表同一套(三列表一套件,§6.2):等距行 + 缩进引导竖线,零组间空白
    <li key={projectId}>
      <details
        open={isOpen}
        onToggle={(e) => {
          if (e.target !== e.currentTarget) return; // toggle 合成冒泡守卫
          if (forceOpen) return;
          const open = e.currentTarget.open;
          setOpenGroups((prev) => {
            if (open === prev.has(projectId)) return prev;
            const next = new Set(prev);
            if (open) next.add(projectId);
            else next.delete(projectId);
            return next;
          });
          if (open) loadGroup(projectId);
        }}
      >
        {/* 区块标签形态(与本地组头同一件):无折叠箭头,开合只靠点击组头。
            快捷「+」与本地组头同构:常驻占位、hover 只切可见性(插入式显隐
            会挤动项目名) */}
        <summary title={name} className="group flex items-center after:hidden">
          <GroupLabel icon={IconFolder} name={name} />
          {onNewTaskIn && (
            <button
              type="button"
              aria-label={t("cloud.list.newTaskIn")}
              title={t("cloud.list.newTaskIn")}
              className="btn btn-ghost btn-square btn-xs invisible group-hover:visible group-focus-within:visible"
              onClick={(e) => {
                e.preventDefault(); // summary 的默认动作是开合,新建不该顺带折叠
                e.stopPropagation();
                onNewTaskIn(project);
              }}
            >
              <IconPlus size={14} stroke={1.75} aria-hidden />
            </button>
          )}
        </summary>
        {groupBody(projectId)}
      </details>
    </li>
    );
  };

  return (
    <ul className="menu menu-sm w-full flex-nowrap p-0 [&_li]:flex-nowrap">
      {/* 进行中任务裸行置顶(同 chat 平铺行,不设区标签):彩点/尾注已自带
          「正在进行」语义,区标签反而多一层杂讯 */}
      {activeRows.map((task) => (
        <TaskRow key={task.id} task={task} currentId={currentId} onSelect={onSelect} onDelete={handleDelete} onStop={handleStop} />
      ))}
      {projects.map((project) =>
        projectGroup(project, project.id ?? "", project.name || project.full_name || t("cloud.list.untitledProject")),
      )}
      {/* 历史置底(与本地「已归档项目」同位同构):History 小节头、无计数 */}
      {historyRows.length > 0 && (
        <SectionFold label={t("cloud.list.history")} icon={IconHistory} foldKey="mc.cloudHistoryOpen" forceOpen={forceOpen}>
          {historyRows.map((task) => (
            <TaskRow key={task.id} task={task} currentId={currentId} level={1} onSelect={onSelect} onDelete={handleDelete} onStop={handleStop} />
          ))}
          {feed.hasMore && (
            <li>
              <button type="button" className="ps-6 text-base-content/50" disabled={feed.loading} onClick={feed.loadMore}>
                {feed.loading && <span className="loading loading-spinner loading-xs" aria-hidden />}
                {t("cloud.list.loadMore")}
              </button>
            </li>
          )}
        </SectionFold>
      )}
      {/* 行动作(删除/终止)失败留在列表内:它属于某一行的操作。
          整表加载故障不在这儿——那是列表级状态,挂尾巴像个条目
          (用户报障 2026-08-06),已上移到列表区顶部的提示条 */}
      {actionErr && <li className="px-2 py-1 text-xs text-error">{actionErr}</li>}
    </ul>
  );
}
