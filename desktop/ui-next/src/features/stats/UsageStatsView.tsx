// 本地会话 token 用量统计面板(侧栏「用量统计」空间主视图)。
//
// 数据来自壳侧 usage 事件记账(按天/会话/模型聚合),挂载时取一次,之后
// 手动刷新——统计面板不常驻轮询,与设置页的账号权益面板同理念。
//
// 布局:汇总卡(今日/近7天/累计)→ 每日趋势(最近 14 天,输入/输出堆叠条)
// → 按模型表 → 按任务/会话表(顶层任务行可展开看该任务的按模型/按天明细,
// 子代理会话以「子代理」标记挂在父任务行下)。
import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { usageStats, type Bucket, type DayRow, type SessionRow, type UsageStats } from "@/lib/ipc/usageStats";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const total = (b: Bucket): number => b.input_tokens + b.output_tokens;

const fmt = (n: number): string => n.toLocaleString("en-US");

/** 浏览器本地时区的今天 `YYYY-MM-DD`,与壳侧 `stats::today()` 同口径 */
const todayKey = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const zeroBucket: Bucket = { input_tokens: 0, output_tokens: 0, calls: 0 };

/** 汇总卡:大号总计 + 「输入 X · 输出 Y · N 次调用」副行 */
function SumCard({ label, bucket }: { label: string; bucket: Bucket }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-box border border-base-300 bg-base-100 px-4 py-3">
      <span className="text-xs text-base-content/50">{label}</span>
      <span className="text-2xl font-semibold tabular-nums leading-none">{fmt(total(bucket))}</span>
      <span className="text-xs tabular-nums text-base-content/50">
        ↑{fmt(bucket.input_tokens)} · ↓{fmt(bucket.output_tokens)} · {fmt(bucket.calls)} 次
      </span>
    </div>
  );
}

/** 每日趋势:最近 14 天,每天一行,输入(主色)+输出(次色)横向堆叠条 */
function DailyChart({ days }: { days: UsageStats["days"] }) {
  const { t } = useI18n();
  const recent = days.slice(0, 14).reverse();
  if (recent.length === 0) return <p className="px-4 py-6 text-center text-sm text-base-content/40">{t("stats.noData")}</p>;
  const max = Math.max(...recent.map((d) => total(d)), 1);
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      {recent.map((d) => {
        const inW = Math.round((d.input_tokens / max) * 100);
        const outW = Math.round((d.output_tokens / max) * 100);
        return (
          <div key={d.date} className="flex items-center gap-3 text-xs tabular-nums">
            <span className="w-11 shrink-0 text-base-content/50">{d.date.slice(5)}</span>
            <div className="flex h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-base-200">
              <div className="h-full shrink-0 bg-primary" style={{ width: `${inW}%` }} title={`in ${fmt(d.input_tokens)}`} />
              <div className="h-full shrink-0 bg-primary/40" style={{ width: `${outW}%` }} title={`out ${fmt(d.output_tokens)}`} />
            </div>
            <span className="w-16 shrink-0 text-end">{fmt(total(d))}</span>
          </div>
        );
      })}
      <div className="mt-1 flex items-center gap-3 text-[11px] text-base-content/40">
        <span className="w-11 shrink-0" />
        <span className="flex items-center gap-3">
          <span className="inline-block size-2 rounded-sm bg-primary" /> {t("stats.input")}
          <span className="inline-block size-2 rounded-sm bg-primary/40" /> {t("stats.output")}
        </span>
      </div>
    </div>
  );
}

/** GitHub 提交图风格按天热力图:列=周(周日为首),行=周日~周六,色阶=当天调用次数。
 *  有 usage 事件的天按相对强度着色,其余灰底;悬停看当天 calls + input/output tokens。 */
function UsageHeatmap({ days }: { days: UsageStats["days"] }) {
  const { t } = useI18n();
  const byDate = new Map<string, DayRow>();
  for (const d of days) byDate.set(d.date, d);

  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7); // 一年窗口(GitHub 提交图风格)
  start.setDate(start.getDate() - start.getDay()); // 对齐到周日

  const weeks: { date: Date; bucket: DayRow | null }[][] = [];
  const cur = new Date(start);
  let maxCalls = 0;
  while (cur <= today) {
    const week: { date: Date; bucket: DayRow | null }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cur);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const b = byDate.get(key) ?? null;
      if (b && b.calls > maxCalls) maxCalls = b.calls;
      week.push({ date: d, bucket: b });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  const weeksShown = weeks.length;

  const level = (calls: number): number => {
    if (calls <= 0 || maxCalls <= 0) return 0;
    if (maxCalls === 1) return 4;
    const rel = calls / maxCalls;
    if (rel > 0.75) return 4;
    if (rel > 0.5) return 3;
    if (rel > 0.25) return 2;
    return 1;
  };
  const cellCls = ["bg-base-200", "bg-success/30", "bg-success/50", "bg-success/75", "bg-success"];
  const dowLabel = ["", "Mon", "", "Wed", "", "Fri", ""]; // 0=周日

  const monthOf = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  const monthCells = weeks.map((w) => monthOf(w[0]!.date));

  return (
    <section className="rounded-box border border-base-300 bg-base-100">
      <h2 className="px-4 pt-3 text-sm font-medium">
        {t("stats.heatmap.title")}
        <span className="ms-2 text-xs font-normal text-base-content/40">{t("stats.heatmap.period", { weeks: weeksShown })}</span>
      </h2>
      <div className="px-4 pb-3 pt-1">
        <div className="flex gap-2">
          <div className="flex shrink-0 flex-col gap-[3px] pt-[17px]">
            {dowLabel.map((l, r) => (
              <span key={r} className={`flex h-[11px] items-center text-[9px] leading-none text-base-content/50 ${l ? "" : "opacity-0"}`}>
                {l}
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <div className="flex h-[14px] gap-[3px]">
              {monthCells.map((m, i) => {
                const label = m ?? "";
                const prev = monthCells[i - 1] ?? "";
                return (
                  <span
                    key={i}
                    className={`min-w-0 flex-1 overflow-visible whitespace-nowrap text-[9px] leading-[14px] text-base-content/50 ${i > 0 && label === prev ? "invisible" : ""}`}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
            {[0, 1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="flex gap-[3px]">
                {weeks.map((w, wi) => {
                  const cell = w[row]!;
                  const b = cell.bucket;
                  const dateLabel = cell.date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" });
                  return (
                    <span
                      key={wi}
                      title={
                        b
                          ? `${dateLabel} · ${t("stats.calls")} ${fmt(b.calls)} · ${t("stats.input")} ${fmt(b.input_tokens)} · ${t("stats.output")} ${fmt(b.output_tokens)}`
                          : `${dateLabel} · ${t("stats.calls")} 0`
                      }
                      className={`h-[11px] min-w-0 flex-1 rounded-[2px] ${cellCls[b ? level(b.calls) : 0]}`}
                    />
                  );
                })}
              </div>
            ))}
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-base-content/40">
              <span>{t("stats.heatmap.less")}</span>
              {cellCls.map((c, i) => (
                <span key={i} className={`h-[11px] w-[11px] rounded-[2px] ${c}`} />
              ))}
              <span>{t("stats.heatmap.more")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 按模型表 */
function ModelTable({ models }: { models: UsageStats["models"] }) {
  const { t } = useI18n();
  if (models.length === 0) return <p className="px-4 py-6 text-center text-sm text-base-content/40">{t("stats.noData")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table table-xs">
        <thead>
          <tr className="text-base-content/50">
            <th>{t("stats.model")}</th>
            <th className="text-end">{t("stats.input")}</th>
            <th className="text-end">{t("stats.output")}</th>
            <th className="text-end">{t("stats.card.total")}</th>
            <th className="text-end">{t("stats.calls")}</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model}>
              <td className="font-mono text-xs">{m.model}</td>
              <td className="text-end tabular-nums">{fmt(m.input_tokens)}</td>
              <td className="text-end tabular-nums">{fmt(m.output_tokens)}</td>
              <td className="text-end font-medium tabular-nums">{fmt(total(m))}</td>
              <td className="text-end tabular-nums">{fmt(m.calls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 单个会话的展开明细:按模型 + 按天 */
function SessionDetail({ session }: { session: SessionRow }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4 px-8 py-2">
      <div>
        <div className="mb-1 text-[11px] text-base-content/50">{t("stats.byModel")}</div>
        <table className="table table-xs">
          <tbody>
            {session.models.map((m) => (
              <tr key={m.model}>
                <td className="font-mono text-xs">{m.model}</td>
                <td className="text-end tabular-nums">{fmt(m.input_tokens)}</td>
                <td className="text-end tabular-nums">{fmt(m.output_tokens)}</td>
                <td className="text-end font-medium tabular-nums">{fmt(total(m))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-base-content/50">{t("stats.daily")}</div>
        <table className="table table-xs">
          <tbody>
            {session.days.map((d) => (
              <tr key={d.date}>
                <td className="tabular-nums">{d.date}</td>
                <td className="text-end tabular-nums">{fmt(d.input_tokens)}</td>
                <td className="text-end tabular-nums">{fmt(d.output_tokens)}</td>
                <td className="text-end font-medium tabular-nums">{fmt(total(d))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 按任务/会话表:顶层任务行 + 挂在父行下的子代理行,均可展开看明细 */
function SessionTable({ sessions }: { sessions: UsageStats["sessions"] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (sessions.length === 0) return <p className="px-4 py-6 text-center text-sm text-base-content/40">{t("stats.noData")}</p>;

  const childrenByParent = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    if (!s.parent) continue;
    const list = childrenByParent.get(s.parent) ?? [];
    list.push(s);
    childrenByParent.set(s.parent, list);
  }
  const topLevel = sessions.filter((s) => !s.parent);
  const orphaned = sessions.filter((s) => s.parent && !childrenByParent.has(s.parent) && !topLevel.some((t2) => t2.session_id === s.parent));

  const Row = ({ s, child }: { s: SessionRow; child?: boolean }) => {
    const expanded = !!open[s.session_id];
    const kids = child ? [] : (childrenByParent.get(s.session_id) ?? []);
    return (
      <>
        <tr
          className={`cursor-pointer hover:bg-base-200/60 ${child ? "text-base-content/70" : ""}`}
          onClick={() => setOpen((m) => ({ ...m, [s.session_id]: !expanded }))}
        >
          <td className="flex min-w-0 items-center gap-1.5">
            <IconChevronDown
              size={12}
              className={`shrink-0 text-base-content/40 transition-transform ${expanded ? "rotate-0" : "-rotate-90"}`}
              aria-hidden
            />
            <span className="truncate">{s.title || s.session_id}</span>
            {child && (
              <span className="badge badge-ghost badge-xs shrink-0 text-base-content/50">{t("stats.parentTask")}</span>
            )}
          </td>
          <td className="text-end tabular-nums">{fmt(s.input_tokens)}</td>
          <td className="text-end tabular-nums">{fmt(s.output_tokens)}</td>
          <td className="text-end font-medium tabular-nums">{fmt(total(s))}</td>
          <td className="text-end tabular-nums">{fmt(s.calls)}</td>
        </tr>
        {expanded && (
          <tr className="bg-base-200/40">
            <td colSpan={5}>
              <SessionDetail session={s} />
            </td>
          </tr>
        )}
        {!child &&
          kids.map((k) => (
            <Row key={k.session_id} s={k} child />
          ))}
      </>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="table table-xs">
        <thead>
          <tr className="text-base-content/50">
            <th>{t("stats.session")}</th>
            <th className="text-end">{t("stats.input")}</th>
            <th className="text-end">{t("stats.output")}</th>
            <th className="text-end">{t("stats.card.total")}</th>
            <th className="text-end">{t("stats.calls")}</th>
          </tr>
        </thead>
        <tbody>
          {topLevel.map((s) => (
            <Row key={s.session_id} s={s} />
          ))}
          {orphaned.map((s) => (
            <Row key={s.session_id} s={s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageStatsView() {
  const { t } = useI18n();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    setError("");
    try {
      setStats(await usageStats());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      if (!silent) setBusy(false);
    }
  }, []);

  // 挂载时取一次;此后每 60s 静默轮询 + 窗口回到前台时刷新,保证跨天/后台
  // 任务消耗能被面板看到,不必手动点刷新
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const byDate = new Map<string, UsageStats["days"][number]>();
  for (const d of stats?.days ?? []) byDate.set(d.date, d);

  // 「今日」按真实日历日取;今天还没有用量时显示 0,而不是回退到最近有数据的那天
  const todayBucket = byDate.get(todayKey()) ?? zeroBucket;

  // 「近 7 天」按最近 7 个自然日累加(含今天),中间空档也算 0
  const last7: Bucket = { ...zeroBucket };
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const b = byDate.get(key);
    if (b) {
      last7.input_tokens += b.input_tokens;
      last7.output_tokens += b.output_tokens;
      last7.calls += b.calls;
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-6 py-5">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{t("stats.title")}</h1>
            <p className="mt-0.5 text-xs text-base-content/50">{t("stats.subtitle")}</p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs shrink-0"
            onClick={() => void load()}
            disabled={busy}
            title={t("stats.refresh")}
            aria-label={t("stats.refresh")}
          >
            <IconRefresh size={14} className={busy ? "animate-spin" : ""} aria-hidden />
            {t("stats.refresh")}
          </button>
        </div>

        {error ? (
          <div className="rounded-box border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">
            {t("stats.loadFailed", { reason: error })}
          </div>
        ) : stats === null ? (
          <div className="flex items-center justify-center gap-2 rounded-box border border-base-300 bg-base-100 px-4 py-8 text-sm text-base-content/50">
            <span className="loading loading-spinner loading-sm" aria-hidden />
            {t("stats.loading")}
          </div>
        ) : stats.totals.calls === 0 ? (
          <div className="rounded-box border border-base-300 bg-base-100 px-4 py-10 text-center">
            <p className="text-sm font-medium">{t("stats.empty.title")}</p>
            <p className="mt-1 text-xs text-base-content/50">{t("stats.empty.detail")}</p>
          </div>
        ) : (
          <>
            <div className="flex gap-3">
              <SumCard label={t("stats.card.today")} bucket={todayBucket} />
              <SumCard label={t("stats.card.last7d")} bucket={last7} />
              <SumCard label={t("stats.card.total")} bucket={stats.totals} />
            </div>

            <section className="rounded-box border border-base-300 bg-base-100">
              <h2 className="px-4 pt-3 text-sm font-medium">
                {t("stats.daily")}
                <span className="ms-2 text-xs font-normal text-base-content/40">{t("stats.daily.last14")}</span>
              </h2>
              <DailyChart days={stats.days} />
            </section>

            <UsageHeatmap days={stats.days} />

            <section className="rounded-box border border-base-300 bg-base-100">
              <h2 className="px-4 pt-3 text-sm font-medium">{t("stats.byModel")}</h2>
              <div className="pt-1">
                <ModelTable models={stats.models} />
              </div>
            </section>

            <section className="rounded-box border border-base-300 bg-base-100">
              <h2 className="px-4 pt-3 text-sm font-medium">{t("stats.bySession")}</h2>
              <div className="pt-1">
                <SessionTable sessions={stats.sessions} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
