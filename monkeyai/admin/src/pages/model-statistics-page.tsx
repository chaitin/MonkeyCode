import { useState } from "react"
import {
  Activity01Icon,
  Database02Icon,
  TokenCircleIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Line, LineChart, XAxis } from "recharts"

import { StatisticsMetricCard } from "@/components/statistics-metric-card"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type TimeRange = "24h" | "7d" | "30d"

const MODEL_ROWS = [
  {
    id: "gpt-5",
    model: "GPT-5",
    calls: 24340,
    inputTokens: 32800000,
    outputTokens: 11600000,
    credits: 486800,
    cacheHitRate: 61.8,
  },
  {
    id: "claude-3-7-sonnet",
    model: "Claude 3.7 Sonnet",
    calls: 18870,
    inputTokens: 27100000,
    outputTokens: 9200000,
    credits: 424575,
    cacheHitRate: 55.4,
  },
  {
    id: "deepseek-v3",
    model: "DeepSeek V3",
    calls: 13640,
    inputTokens: 17600000,
    outputTokens: 6300000,
    credits: 102300,
    cacheHitRate: 72.6,
  },
  {
    id: "gemini-2-5-pro",
    model: "Gemini 2.5 Pro",
    calls: 9560,
    inputTokens: 11900000,
    outputTokens: 4300000,
    credits: 191200,
    cacheHitRate: 64.1,
  },
  {
    id: "qwen3-235b",
    model: "Qwen3 235B",
    calls: 7808,
    inputTokens: 9000000,
    outputTokens: 2800000,
    credits: 85888,
    cacheHitRate: 68.9,
  },
] as const

type ModelFilter = "all" | (typeof MODEL_ROWS)[number]["id"]
type ModelStatsRow = (typeof MODEL_ROWS)[number]

const RANGE_SCALE: Record<TimeRange, number> = {
  "24h": 0.043,
  "7d": 0.25,
  "30d": 1,
}

const RANGE_POINTS: Record<TimeRange, number> = {
  "24h": 24 * 12,
  "7d": 7 * 24 * 2,
  "30d": 30 * 12,
}

const RANGE_INTERVAL_MINUTES: Record<TimeRange, number> = {
  "24h": 5,
  "7d": 30,
  "30d": 120,
}

const RANGE_TRENDS: Record<
  TimeRange,
  readonly [string, string, string, string]
> = {
  "24h": ["+4.6%", "+0.7%", "+5.2%", "+3.8%"],
  "7d": ["+9.8%", "+1.2%", "+11.2%", "+8.4%"],
  "30d": ["+15.7%", "+1.8%", "+18.9%", "+13.6%"],
}

function distributeTotal(total: number, count: number, phase: number) {
  const weights = Array.from(
    { length: count },
    (_, index) =>
      1 +
      Math.sin((index / count) * Math.PI * 12 + phase) * 0.18 +
      (index / Math.max(1, count - 1)) * 0.14
  )
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  let assigned = 0

  return weights.map((weight, index) => {
    if (index === count - 1) return total - assigned

    const value = Math.round((total * weight) / weightTotal)
    assigned += value
    return value
  })
}

function getSummary(model: ModelFilter, range: TimeRange) {
  const rows: readonly ModelStatsRow[] =
    model === "all" ? MODEL_ROWS : MODEL_ROWS.filter((row) => row.id === model)
  const scale = RANGE_SCALE[range]
  const calls = rows.reduce(
    (sum, row) => sum + Math.round(row.calls * scale),
    0
  )
  const weightedCacheHits = rows.reduce(
    (sum, row) => sum + row.calls * row.cacheHitRate,
    0
  )
  const baseCalls = rows.reduce((sum, row) => sum + row.calls, 0)

  return {
    calls,
    cacheHitRate: weightedCacheHits / baseCalls,
    inputTokens: rows.reduce(
      (sum, row) => sum + Math.round(row.inputTokens * scale),
      0
    ),
    outputTokens: rows.reduce(
      (sum, row) => sum + Math.round(row.outputTokens * scale),
      0
    ),
    credits: rows.reduce(
      (sum, row) => sum + Math.round(row.credits * scale),
      0
    ),
    trends: RANGE_TRENDS[range],
  }
}

function buildTrendData(
  range: TimeRange,
  model: ModelFilter,
  summary: ReturnType<typeof getSummary>,
  locale: string
) {
  const points = RANGE_POINTS[range]
  const intervalMinutes = RANGE_INTERVAL_MINUTES[range]
  const endDate = new Date(2026, 8, 2, 12)
  const modelIndex = Math.max(
    0,
    MODEL_ROWS.findIndex((row) => row.id === model)
  )
  const callValues = distributeTotal(summary.calls, points, modelIndex * 0.43)
  const inputTokenValues = distributeTotal(
    summary.inputTokens,
    points,
    modelIndex * 0.43 + 0.7
  )
  const outputTokenValues = distributeTotal(
    summary.outputTokens,
    points,
    modelIndex * 0.43 + 1.1
  )
  const creditValues = distributeTotal(
    summary.credits,
    points,
    modelIndex * 0.43 + 1.5
  )
  const labelFormatter = new Intl.DateTimeFormat(
    locale,
    range === "24h"
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
  )

  return Array.from({ length: points }, (_, index) => {
    const date = new Date(endDate)
    date.setMinutes(date.getMinutes() - (points - 1 - index) * intervalMinutes)

    return {
      date: labelFormatter.format(date),
      calls: callValues[index],
      inputTokens: inputTokenValues[index],
      outputTokens: outputTokenValues[index],
      credits: creditValues[index],
    }
  })
}

type TrendData = ReturnType<typeof buildTrendData>
type TrendKey = "calls" | "inputTokens" | "outputTokens" | "credits"

function ModelTrendCard({
  color,
  data,
  dataKey,
  label,
  title,
  total,
}: {
  color: string
  data: TrendData
  dataKey: TrendKey
  label: string
  title: string
  total: string
}) {
  const config = {
    [dataKey]: {
      label,
      color,
    },
  } satisfies ChartConfig

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Badge variant="secondary">{total}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer className="h-36 w-full" config={config}>
          <LineChart
            accessibilityLayer
            data={data}
            margin={{ left: 4, right: 4, top: 8 }}
          >
            <XAxis dataKey="date" hide />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" />}
            />
            <Line
              dataKey={dataKey}
              dot={false}
              stroke={`var(--color-${dataKey})`}
              strokeWidth={2}
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

export function ModelStatisticsPage() {
  const { i18n, t } = useTranslation()
  const [timeRange, setTimeRange] = useState<TimeRange>("30d")
  const [model, setModel] = useState<ModelFilter>("all")
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale)
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const percentFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })
  const summary = getSummary(model, timeRange)
  const trendData = buildTrendData(timeRange, model, summary, locale)
  const modelOptions = [
    { value: "all", label: t("pages.modelStatistics.allModels") },
    ...MODEL_ROWS.map((row) => ({ value: row.id, label: row.model })),
  ]
  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select
          items={modelOptions}
          value={model}
          onValueChange={(value) => setModel(value as ModelFilter)}
        >
          <SelectTrigger
            className="w-full sm:w-64"
            aria-label={t("pages.modelStatistics.modelFilter")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Tabs
          value={timeRange}
          onValueChange={(value) => setTimeRange(value as TimeRange)}
        >
          <TabsList aria-label={t("pages.modelStatistics.timeRange")}>
            {(["24h", "7d", "30d"] as const).map((range) => (
              <TabsTrigger key={range} value={range}>
                {t(`pages.modelStatistics.ranges.${range}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatisticsMetricCard
          comparison={t("pages.modelStatistics.comparedToPrevious")}
          icon={Activity01Icon}
          label={t("pages.modelStatistics.metrics.totalCalls")}
          trend={summary.trends[0]}
          value={numberFormatter.format(summary.calls)}
        />
        <StatisticsMetricCard
          comparison={t("pages.modelStatistics.comparedToPrevious")}
          icon={Database02Icon}
          label={t("pages.modelStatistics.metrics.cacheHitRate")}
          trend={summary.trends[1]}
          value={`${percentFormatter.format(summary.cacheHitRate)}%`}
        />
        <StatisticsMetricCard
          comparison={t("pages.modelStatistics.comparedToPrevious")}
          icon={TokenCircleIcon}
          label={t("pages.modelStatistics.metrics.inputTokens")}
          trend={summary.trends[2]}
          value={compactNumberFormatter.format(summary.inputTokens)}
        />
        <StatisticsMetricCard
          comparison={t("pages.modelStatistics.comparedToPrevious")}
          icon={ZapIcon}
          label={t("pages.modelStatistics.metrics.outputTokens")}
          trend={summary.trends[3]}
          value={compactNumberFormatter.format(summary.outputTokens)}
        />
      </div>

      <div className="flex flex-col gap-4">
        <ModelTrendCard
          color="var(--chart-2)"
          data={trendData}
          dataKey="calls"
          label={t("pages.modelStatistics.series.calls")}
          title={t("pages.modelStatistics.callTrend")}
          total={t("pages.modelStatistics.totals.calls", {
            count: numberFormatter.format(summary.calls),
          })}
        />
        <ModelTrendCard
          color="var(--chart-1)"
          data={trendData}
          dataKey="inputTokens"
          label={t("pages.modelStatistics.series.inputTokens")}
          title={t("pages.modelStatistics.inputTokenTrend")}
          total={t("pages.modelStatistics.totals.tokens", {
            count: numberFormatter.format(summary.inputTokens),
          })}
        />
        <ModelTrendCard
          color="var(--chart-3)"
          data={trendData}
          dataKey="outputTokens"
          label={t("pages.modelStatistics.series.outputTokens")}
          title={t("pages.modelStatistics.outputTokenTrend")}
          total={t("pages.modelStatistics.totals.tokens", {
            count: numberFormatter.format(summary.outputTokens),
          })}
        />
        <ModelTrendCard
          color="var(--chart-4)"
          data={trendData}
          dataKey="credits"
          label={t("pages.modelStatistics.series.credits")}
          title={t("pages.modelStatistics.creditTrend")}
          total={t("pages.modelStatistics.totals.credits", {
            count: numberFormatter.format(summary.credits),
          })}
        />
      </div>
    </section>
  )
}
