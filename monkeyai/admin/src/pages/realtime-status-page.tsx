import {
  Activity01Icon,
  AiChat02Icon,
  Clock01Icon,
  Coins01Icon,
  DashboardSpeed01Icon,
  Database02Icon,
  GaugeIcon,
  Loading03Icon,
  TaskDone01Icon,
  TokenCircleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatisticsTrendCard as TrendCard } from "@/components/statistics-trend-card"
import { ModelMessageDistributionCard } from "@/components/model-message-distribution-card"
import { StatisticsPeriodComparison as MetricComparison } from "@/components/statistics-period-comparison"
import { useStatistics } from "@/hooks/use-statistics"
import type { ModelOverview } from "@/lib/statistics"
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
  { key: "avg_response_time", labelKey: "avgResponseTime", icon: Clock01Icon },
  {
    key: "avg_first_token_time",
    labelKey: "avgFirstTokenTime",
    icon: Clock01Icon,
  },
  {
    key: "model_success_rate",
    labelKey: "modelSuccessRate",
    icon: TaskDone01Icon,
  },
] as const satisfies readonly {
  key: keyof ModelOverview["last_24h"] | keyof ModelOverview["last_30m"]
  labelKey: string
  icon: IconSvgElement
}[]

type MetricKey = (typeof METRICS)[number]["key"]

const PERIOD_METRICS = new Set<MetricKey>([
  "model_calls",
  "input_tokens",
  "output_tokens",
])
const SHORT_METRICS = new Set<MetricKey>([
  "tpm",
  "rpm",
  "cache_hit_rate",
  "avg_response_time",
  "avg_first_token_time",
  "model_success_rate",
])

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
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
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
                "min-w-0 break-words text-2xl font-medium tabular-nums tracking-tight",
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
  const model = modelRequest.data
  const summary = model?.last_24h
  const quality = model?.last_30m
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
          avg_response_time:
            quality.avg_response_time == null
              ? "—"
              : t("pages.realtimeStatus.units.seconds", {
                  count: secondsFormatter.format(
                    quality.avg_response_time / 1000
                  ),
                }),
          avg_first_token_time:
            quality.avg_first_token_time == null
              ? "—"
              : t("pages.realtimeStatus.units.seconds", {
                  count: secondsFormatter.format(
                    quality.avg_first_token_time / 1000
                  ),
                }),
          model_success_rate:
            quality.model_success_rate == null
              ? "—"
              : `${percentFormatter.format(quality.model_success_rate)}%`,
        }
      : {}),
  }

  const renderMetric = (metric: (typeof METRICS)[number]) => {
    const source = SHORT_METRICS.has(metric.key) ? quality : summary
    return (
      <RealtimeMetricCard
        icon={metric.icon}
        key={metric.key}
        label={t(`pages.realtimeStatus.metrics.${metric.labelKey}`)}
        valueLabel={valueLabels[metric.key] ?? "—"}
        loading={modelRequest.loading}
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
          metric.key === "avg_first_token_time"
            ? durationColor(quality?.avg_first_token_time, 3_000, 6_000)
            : metric.key === "avg_response_time"
              ? durationColor(quality?.avg_response_time, 10_000, 30_000)
              : metric.key === "cache_hit_rate" ||
                  metric.key === "model_success_rate"
                ? rateColor(quality?.[metric.key])
                : undefined
        }
        pendingLabel={
          source &&
          (source as Record<string, unknown>)[metric.key] === undefined
            ? t("pages.realtimeStatus.pendingMetric")
            : undefined
        }
        qualifier={
          metric.key === "avg_response_time" ||
          metric.key === "avg_first_token_time"
            ? `${t("pages.realtimeStatus.period30m")} - ${t("pages.realtimeStatus.average")}`
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
          {METRICS.map(renderMetric)}
        </div>
        <ModelMessageDistributionCard
          distribution={model?.message_distribution}
          loading={modelRequest.loading}
        />
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
      </div>
    </section>
  )
}
