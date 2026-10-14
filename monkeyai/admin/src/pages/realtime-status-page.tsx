import {
  Activity01Icon,
  AiChat02Icon,
  ArrowDownRight01Icon,
  Clock01Icon,
  Coins01Icon,
  DashboardSpeed01Icon,
  Database02Icon,
  GaugeIcon,
  Loading03Icon,
  Task01Icon,
  TaskAdd01Icon,
  TaskDaily01Icon,
  TaskDone01Icon,
  TokenCircleIcon,
  User02Icon,
  UserAdd01Icon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Bar, BarChart, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useStatistics } from "@/hooks/use-statistics"
import {
  periodChange,
  type ModelOverview,
  type TaskOverview,
  type UserStatistics,
} from "@/lib/statistics"
import { cn } from "@/lib/utils"

const metricColors = {
  good: "text-green-600 dark:text-green-400",
  warning: "text-yellow-600 dark:text-yellow-400",
  bad: "text-red-600 dark:text-red-400",
}

function rateColor(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return undefined
  if (value > 90) return metricColors.good
  if (value > 70) return metricColors.warning
  return metricColors.bad
}

function durationColor(
  value: number | null | undefined,
  goodThroughMs: number,
  warningThroughMs: number
) {
  if (value == null || !Number.isFinite(value)) return undefined
  if (value <= goodThroughMs) return metricColors.good
  if (value <= warningThroughMs) return metricColors.warning
  return metricColors.bad
}

function formatCompactAmount(value: number, formatter: Intl.NumberFormat) {
  const absolute = Math.abs(value)
  const precision =
    10 ** -(formatter.resolvedOptions().maximumFractionDigits ?? 0)
  const fits = (scale: number) =>
    value < 0
      ? absolute < 1_000 * scale
      : absolute <= (1_000 - precision) * scale
  if (fits(1)) return formatter.format(value)
  if (fits(1_000)) return `${formatter.format(value / 1_000)}K`
  if (fits(1_000_000)) return `${formatter.format(value / 1_000_000)}M`
  return `${formatter.format(value / 1_000_000_000)}B`
}

const METRICS = [
  { key: "model_calls", labelKey: "modelCalls", icon: Activity01Icon },
  { key: "input_tokens", labelKey: "inputTokens", icon: TokenCircleIcon },
  { key: "output_tokens", labelKey: "outputTokens", icon: AiChat02Icon },
  { key: "tpm", labelKey: "tpm", icon: DashboardSpeed01Icon },
  { key: "rpm", labelKey: "rpm", icon: GaugeIcon },
  { key: "cache_hit_rate", labelKey: "cacheHitRate", icon: Database02Icon },
  { key: "p95_response_time", labelKey: "p95ResponseTime", icon: Clock01Icon },
  {
    key: "p95_first_token_time",
    labelKey: "p95FirstTokenTime",
    icon: Clock01Icon,
  },
  {
    key: "model_success_rate",
    labelKey: "modelSuccessRate",
    icon: TaskDone01Icon,
  },
  { key: "total_users", labelKey: "totalUsers", icon: UserMultiple02Icon },
  { key: "new_users_24h", labelKey: "newUsers", icon: UserAdd01Icon },
  { key: "active_users_24h", labelKey: "activeUsers", icon: User02Icon },
  { key: "total_tasks", labelKey: "totalTasks", icon: Task01Icon },
  { key: "new_tasks_24h", labelKey: "newTasks", icon: TaskAdd01Icon },
  {
    key: "active_tasks_24h",
    labelKey: "activeTasks",
    icon: TaskDaily01Icon,
  },
] as const satisfies readonly {
  key:
    | keyof ModelOverview["last_24h"]
    | keyof ModelOverview["last_30m"]
    | keyof UserStatistics
    | keyof TaskOverview
  labelKey: string
  icon: IconSvgElement
}[]

type MetricKey = (typeof METRICS)[number]["key"]

const PERIOD_METRICS = new Set<MetricKey>([
  "model_calls",
  "input_tokens",
  "output_tokens",
  "new_users_24h",
  "active_users_24h",
  "new_tasks_24h",
  "active_tasks_24h",
])
const SHORT_METRICS = new Set<MetricKey>([
  "tpm",
  "rpm",
  "cache_hit_rate",
  "p95_response_time",
  "p95_first_token_time",
  "model_success_rate",
])
const OVERVIEW_METRICS = new Set<MetricKey>([
  "total_users",
  "new_users_24h",
  "active_users_24h",
  "total_tasks",
  "new_tasks_24h",
  "active_tasks_24h",
])

type TrendPoint = { date: string; count: number }

function StatisticsLoader() {
  const { t } = useTranslation()
  return (
    <span
      role="status"
      aria-label={t("statistics.loading")}
      className="inline-flex items-center justify-center text-muted-foreground"
    >
      <HugeiconsIcon
        icon={Loading03Icon}
        className="animate-spin motion-reduce:animate-none"
        size={20}
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </span>
  )
}

function TrendCard({
  icon,
  title,
  periodLabel,
  points,
  color,
  barClassName,
  loading,
  formatValue,
}: {
  icon: IconSvgElement
  title: string
  periodLabel: string
  points?: TrendPoint[]
  color: string
  barClassName: string
  loading: boolean
  formatValue?: (value: number) => string
}) {
  const config = { count: { label: title, color } } satisfies ChartConfig
  return (
    <Card className="gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70">
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={icon}
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </CardTitle>
        <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
          {periodLabel}
        </span>
      </CardHeader>
      <CardContent
        className="rounded-xl border border-border/60 bg-card p-4"
        aria-busy={loading}
      >
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <StatisticsLoader />
          </div>
        ) : points ? (
          <ChartContainer className="h-32 w-full" config={config}>
            <BarChart
              accessibilityLayer
              data={points}
              margin={{ left: 2, right: 2, top: 8, bottom: 0 }}
            >
              <XAxis dataKey="date" hide />
              <YAxis
                hide
                domain={([min, max]: readonly [number, number]) =>
                  min === 0 && max === 0
                    ? [0, 1]
                    : [Math.min(0, min), Math.max(0, max)]
                }
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    valueFormatter={
                      formatValue
                        ? (value) =>
                            typeof value === "number"
                              ? formatValue(value)
                              : String(value)
                        : undefined
                    }
                  />
                }
              />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                className={barClassName}
                maxBarSize={8}
                minPointSize={3}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-32 items-center justify-center text-2xl text-muted-foreground">
            —
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MetricComparison({
  current,
  previous,
}: {
  current?: number
  previous?: number
}) {
  const { i18n, t } = useTranslation()
  const comparison = periodChange(current, previous)
  if (!comparison) {
    const description = t("pages.realtimeStatus.comparison.unavailable")
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} />}
          className="ms-auto shrink-0 cursor-default text-sm text-muted-foreground"
          aria-label={description}
        >
          —
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    )
  }

  const locale = i18n.resolvedLanguage ?? i18n.language
  const roundedPercent =
    comparison.percent === null ? null : Math.round(comparison.percent)
  const percent =
    roundedPercent === null
      ? undefined
      : new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(roundedPercent / 100)
  const description = t(
    `pages.realtimeStatus.comparison.${
      comparison.percent === null
        ? "newActivity"
        : comparison.direction === "up"
          ? "increased"
          : comparison.direction === "down"
            ? "decreased"
            : "unchanged"
    }`,
    { percent }
  )

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn(
          "ms-auto shrink-0 cursor-default text-sm font-medium whitespace-nowrap tabular-nums",
          comparison.direction === "up"
            ? metricColors.good
            : comparison.direction === "down"
              ? metricColors.bad
              : "text-muted-foreground"
        )}
        aria-label={description}
      >
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          <HugeiconsIcon
            icon={ArrowDownRight01Icon}
            className={
              comparison.direction === "up" || roundedPercent === 0
                ? "-rotate-90"
                : undefined
            }
            size={16}
            strokeWidth={1.75}
          />
          {percent ?? t("pages.realtimeStatus.comparison.new")}
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start">
        <p>{description}</p>
        {previous != null && (
          <p>
            {t("pages.realtimeStatus.comparison.previousValue", {
              value: new Intl.NumberFormat(locale).format(previous),
            })}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function RealtimeMetricCard({
  icon,
  label,
  valueLabel,
  valueClassName,
  qualifier,
  pendingLabel,
  comparison,
  loading,
}: {
  icon: IconSvgElement
  label: string
  valueLabel: string
  valueClassName?: string
  qualifier?: string
  pendingLabel?: string
  comparison?: { current?: number; previous?: number }
  loading: boolean
}) {
  return (
    <Card className="gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70">
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          className="shrink-0 text-muted-foreground"
          icon={icon}
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </CardTitle>
        {qualifier && (
          <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {qualifier}
          </span>
        )}
      </CardHeader>
      <CardContent
        className={cn(
          "min-h-20 flex-row items-center rounded-xl border border-border/60 bg-card p-5",
          loading ? "justify-center" : "justify-between"
        )}
        aria-busy={loading}
      >
        {loading ? (
          <StatisticsLoader />
        ) : (
          <>
            <p
              className={cn(
                "min-w-0 text-2xl font-medium tracking-tight break-words tabular-nums",
                valueClassName
              )}
              title={pendingLabel}
              aria-label={
                pendingLabel ? `${label}: ${pendingLabel}` : undefined
              }
            >
              {valueLabel}
            </p>
            {comparison && <MetricComparison {...comparison} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function RealtimeStatusPage() {
  const { i18n, t } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale)
  const secondsFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const tokenFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    roundingMode: "ceil",
  })
  const formatTrendAmount = (value: number) =>
    formatCompactAmount(value, tokenFormatter)
  const creditsFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    roundingMode: "ceil",
  })
  const formatCreditsAmount = (value: number) =>
    formatCompactAmount(value, creditsFormatter)
  const percentFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const modelRequest = useStatistics<ModelOverview>(
    "/api/admin/v1/statistics/models/overview",
    0,
    { retryAction: false }
  )
  const userRequest = useStatistics<UserStatistics>(
    "/api/admin/v1/statistics/users",
    0,
    { retryAction: false }
  )
  const taskRequest = useStatistics<TaskOverview>(
    "/api/admin/v1/statistics/tasks/overview",
    0,
    { retryAction: false }
  )
  const model = modelRequest.data
  const summary = model?.last_24h
  const quality = model?.last_30m
  const users = userRequest.data
  const tasks = taskRequest.data
  const modelDays =
    model?.days?.length === 90 &&
    model.days.every(
      (day) =>
        typeof day.date === "string" &&
        Number.isFinite(day.model_calls) &&
        Number.isFinite(day.input_tokens) &&
        Number.isFinite(day.output_tokens) &&
        typeof day.credits === "string" &&
        day.credits.trim() !== "" &&
        Number.isFinite(Number(day.credits))
    )
      ? model.days
      : undefined
  const modelCreditsTrend = modelDays?.map((day) => ({
    date: day.date,
    count: Number(day.credits),
  }))
  const modelCallsTrend = modelDays?.map((day) => ({
    date: day.date,
    count: day.model_calls,
  }))
  const modelInputTrend = modelDays?.map((day) => ({
    date: day.date,
    count: day.input_tokens,
  }))
  const modelOutputTrend = modelDays?.map((day) => ({
    date: day.date,
    count: day.output_tokens,
  }))
  const userDays =
    users?.days?.length === 90 &&
    users.days.every(
      (day) =>
        typeof day.date === "string" &&
        Number.isFinite(day.new_users) &&
        Number.isFinite(day.active_users)
    )
      ? users.days
      : undefined
  const taskDays =
    tasks?.days?.length === 90 &&
    tasks.days.every(
      (day) =>
        typeof day.date === "string" &&
        Number.isFinite(day.new_tasks) &&
        Number.isFinite(day.active_tasks)
    )
      ? tasks.days
      : undefined
  const newUsersTrend = userDays?.map((day) => ({
    date: day.date,
    count: day.new_users,
  }))
  const activeUsersTrend = userDays?.map((day) => ({
    date: day.date,
    count: day.active_users,
  }))
  const newTasksTrend = taskDays?.map((day) => ({
    date: day.date,
    count: day.new_tasks,
  }))
  const activeTasksTrend = taskDays?.map((day) => ({
    date: day.date,
    count: day.active_tasks,
  }))
  const valueLabels: Partial<Record<MetricKey, string>> = {
    ...(summary
      ? {
          model_calls:
            summary.model_calls == null
              ? "—"
              : numberFormatter.format(summary.model_calls),
          input_tokens:
            summary.input_tokens == null
              ? "—"
              : formatCompactAmount(summary.input_tokens, tokenFormatter),
          output_tokens:
            summary.output_tokens == null
              ? "—"
              : formatCompactAmount(summary.output_tokens, tokenFormatter),
        }
      : {}),
    ...(quality
      ? {
          tpm:
            quality.tpm == null
              ? "—"
              : formatCompactAmount(quality.tpm, tokenFormatter),
          rpm:
            quality.rpm == null
              ? "—"
              : numberFormatter.format(Math.ceil(quality.rpm)),
          cache_hit_rate:
            quality.cache_hit_rate == null
              ? "—"
              : `${percentFormatter.format(quality.cache_hit_rate)}%`,
          p95_response_time:
            quality.p95_response_time == null
              ? "—"
              : t("pages.realtimeStatus.units.seconds", {
                  count: secondsFormatter.format(
                    quality.p95_response_time / 1000
                  ),
                }),
          p95_first_token_time:
            quality.p95_first_token_time == null
              ? "—"
              : t("pages.realtimeStatus.units.seconds", {
                  count: secondsFormatter.format(
                    quality.p95_first_token_time / 1000
                  ),
                }),
          model_success_rate:
            quality.model_success_rate == null
              ? "—"
              : `${percentFormatter.format(quality.model_success_rate)}%`,
        }
      : {}),
    total_users:
      users?.total_users == null
        ? "—"
        : numberFormatter.format(users.total_users),
    new_users_24h:
      users?.new_users_24h == null
        ? "—"
        : numberFormatter.format(users.new_users_24h),
    active_users_24h:
      users?.active_users_24h == null
        ? "—"
        : numberFormatter.format(users.active_users_24h),
    total_tasks:
      tasks?.total_tasks == null
        ? "—"
        : numberFormatter.format(tasks.total_tasks),
    new_tasks_24h:
      tasks?.new_tasks_24h == null
        ? "—"
        : numberFormatter.format(tasks.new_tasks_24h),
    active_tasks_24h:
      tasks?.active_tasks_24h == null
        ? "—"
        : numberFormatter.format(tasks.active_tasks_24h),
  }

  const renderMetric = (metric: (typeof METRICS)[number]) => {
    const source = SHORT_METRICS.has(metric.key) ? quality : summary
    const loading =
      metric.key === "total_users" ||
      metric.key === "new_users_24h" ||
      metric.key === "active_users_24h"
        ? userRequest.loading
        : metric.key === "total_tasks" ||
            metric.key === "new_tasks_24h" ||
            metric.key === "active_tasks_24h"
          ? taskRequest.loading
          : modelRequest.loading
    return (
      <RealtimeMetricCard
        icon={metric.icon}
        key={metric.key}
        label={t(`pages.realtimeStatus.metrics.${metric.labelKey}`)}
        valueLabel={valueLabels[metric.key] ?? "—"}
        loading={loading}
        comparison={
          metric.key === "model_calls" ||
          metric.key === "input_tokens" ||
          metric.key === "output_tokens"
            ? {
                current: summary?.[metric.key],
                previous: model?.previous_24h?.[metric.key],
              }
            : undefined
        }
        valueClassName={
          metric.key === "p95_first_token_time"
            ? durationColor(quality?.p95_first_token_time, 3_000, 6_000)
            : metric.key === "p95_response_time"
              ? durationColor(quality?.p95_response_time, 10_000, 30_000)
              : metric.key === "cache_hit_rate" ||
                  metric.key === "model_success_rate"
                ? rateColor(quality?.[metric.key])
                : undefined
        }
        pendingLabel={
          source &&
          !OVERVIEW_METRICS.has(metric.key) &&
          (source as Record<string, unknown>)[metric.key] === undefined
            ? t("pages.realtimeStatus.pendingMetric")
            : undefined
        }
        qualifier={
          metric.key === "p95_response_time" ||
          metric.key === "p95_first_token_time"
            ? `${t("pages.realtimeStatus.period30m")} - P95`
            : SHORT_METRICS.has(metric.key)
              ? t("pages.realtimeStatus.period30m")
              : PERIOD_METRICS.has(metric.key)
                ? t("pages.realtimeStatus.period24h")
                : undefined
        }
      />
    )
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {METRICS.slice(0, 9).map(renderMetric)}
        </div>
        <div className="flex flex-col gap-2">
          <div className="grid gap-5 lg:grid-cols-2">
            <TrendCard
              icon={Coins01Icon}
              title={t("pages.realtimeStatus.metrics.modelConsumption")}
              periodLabel={t("pages.realtimeStatus.period90d")}
              points={modelCreditsTrend}
              loading={modelRequest.loading}
              formatValue={formatCreditsAmount}
              color="var(--color-yellow-500)"
              barClassName="fill-yellow-500"
            />
            <TrendCard
              icon={Activity01Icon}
              title={t("pages.realtimeStatus.callsTrend")}
              periodLabel={t("pages.realtimeStatus.period90d")}
              points={modelCallsTrend}
              loading={modelRequest.loading}
              color="var(--color-emerald-500)"
              barClassName="fill-emerald-500"
            />
            <TrendCard
              icon={TokenCircleIcon}
              title={t("pages.realtimeStatus.metrics.inputTokens")}
              periodLabel={t("pages.realtimeStatus.period90d")}
              points={modelInputTrend}
              loading={modelRequest.loading}
              formatValue={formatTrendAmount}
              color="var(--color-emerald-400)"
              barClassName="fill-emerald-400"
            />
            <TrendCard
              icon={AiChat02Icon}
              title={t("pages.realtimeStatus.metrics.outputTokens")}
              periodLabel={t("pages.realtimeStatus.period90d")}
              points={modelOutputTrend}
              loading={modelRequest.loading}
              formatValue={formatTrendAmount}
              color="var(--color-emerald-600)"
              barClassName="fill-emerald-600"
            />
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {METRICS.slice(9, 12).map(renderMetric)}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendCard
            icon={UserAdd01Icon}
            title={t("pages.realtimeStatus.newUsersTrend")}
            periodLabel={t("pages.realtimeStatus.period90d")}
            points={newUsersTrend}
            loading={userRequest.loading}
            color="var(--color-orange-500)"
            barClassName="fill-orange-500"
          />
          <TrendCard
            icon={User02Icon}
            title={t("pages.realtimeStatus.activeUsersTrend")}
            periodLabel={t("pages.realtimeStatus.period90d")}
            points={activeUsersTrend}
            loading={userRequest.loading}
            color="var(--color-orange-400)"
            barClassName="fill-orange-400"
          />
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {METRICS.slice(12).map(renderMetric)}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendCard
            icon={TaskAdd01Icon}
            title={t("pages.realtimeStatus.metrics.newTasks")}
            periodLabel={t("pages.realtimeStatus.period90d")}
            points={newTasksTrend}
            loading={taskRequest.loading}
            color="var(--color-rose-500)"
            barClassName="fill-rose-500"
          />
          <TrendCard
            icon={TaskDaily01Icon}
            title={t("pages.realtimeStatus.metrics.activeTasks")}
            periodLabel={t("pages.realtimeStatus.period90d")}
            points={activeTasksTrend}
            loading={taskRequest.loading}
            color="var(--color-rose-400)"
            barClassName="fill-rose-400"
          />
        </div>
      </div>
    </section>
  )
}
