import { useState } from "react"
import {
  Activity01Icon,
  Database02Icon,
  TokenCircleIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { Line, LineChart, XAxis } from "recharts"

import { useStatistics } from "@/hooks/use-statistics"
import { change, type ModelStatistics } from "@/lib/statistics"
import { StatisticsFeedback } from "@/components/statistics-feedback"
import { Button } from "@/components/ui/button"
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

type TrendData = (Omit<ModelStatistics["trend"][number], "credits"> & {
  date: string
  credits: number
})[]
type TrendKey = "calls" | "input_tokens" | "output_tokens" | "credits"

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
              isAnimationActive={false}
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
  const [model, setModel] = useState<string>("all")
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
  const request = useStatistics<ModelStatistics>(
    `/api/admin/v1/statistics/models?range=${timeRange}${model === "all" ? "" : `&model_id=${encodeURIComponent(model)}`}`
  )
  const summary = request.data?.summary
  const previous = request.data?.previous
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
  const trendData = (request.data?.trend ?? []).map((row) => ({
    ...row,
    credits: Number(row.credits),
    date: dateFormatter.format(new Date(row.at)),
  }))
  const modelOptions = [
    { value: "all", label: t("pages.modelStatistics.allModels") },
    ...(request.data?.models ?? request.lastData?.models ?? []).map((row) => ({
      value: row.id,
      label: `${row.name}${row.deleted ? ` (${t("statistics.deleted")})` : ""}`,
    })),
  ]
  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select
          items={modelOptions}
          value={model}
          onValueChange={(value) => setModel(value ?? "all")}
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

      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t("statistics.modelScope")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={request.reload}
          disabled={request.loading}
        >
          {t("statistics.refresh")}
        </Button>
      </div>
      <StatisticsFeedback
        {...request}
        empty={summary?.calls === 0 && Number(summary.credits) === 0}
      />
      {summary && previous && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatisticsMetricCard
              comparison={t("pages.modelStatistics.comparedToPrevious")}
              icon={Activity01Icon}
              label={t("pages.modelStatistics.metrics.totalCalls")}
              trend={change(summary.calls, previous.calls, locale)}
              value={numberFormatter.format(summary.calls)}
            />
            <StatisticsMetricCard
              comparison={t("pages.modelStatistics.comparedToPrevious")}
              icon={Database02Icon}
              label={t("pages.modelStatistics.metrics.cacheHitRate")}
              trend={change(
                summary.cache_hit_rate,
                previous.cache_hit_rate,
                locale,
                true
              )}
              value={
                summary.cache_hit_rate === null
                  ? "—"
                  : `${percentFormatter.format(summary.cache_hit_rate)}%`
              }
            />
            <StatisticsMetricCard
              comparison={t("pages.modelStatistics.comparedToPrevious")}
              icon={TokenCircleIcon}
              label={t("pages.modelStatistics.metrics.inputTokens")}
              trend={change(
                summary.input_tokens,
                previous.input_tokens,
                locale
              )}
              value={compactNumberFormatter.format(summary.input_tokens)}
            />
            <StatisticsMetricCard
              comparison={t("pages.modelStatistics.comparedToPrevious")}
              icon={ZapIcon}
              label={t("pages.modelStatistics.metrics.outputTokens")}
              trend={change(
                summary.output_tokens,
                previous.output_tokens,
                locale
              )}
              value={compactNumberFormatter.format(summary.output_tokens)}
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
              dataKey="input_tokens"
              label={t("pages.modelStatistics.series.inputTokens")}
              title={t("pages.modelStatistics.inputTokenTrend")}
              total={t("pages.modelStatistics.totals.tokens", {
                count: numberFormatter.format(summary.input_tokens),
              })}
            />
            <ModelTrendCard
              color="var(--chart-3)"
              data={trendData}
              dataKey="output_tokens"
              label={t("pages.modelStatistics.series.outputTokens")}
              title={t("pages.modelStatistics.outputTokenTrend")}
              total={t("pages.modelStatistics.totals.tokens", {
                count: numberFormatter.format(summary.output_tokens),
              })}
            />
            <ModelTrendCard
              color="var(--chart-4)"
              data={trendData}
              dataKey="credits"
              label={t("pages.modelStatistics.series.credits")}
              title={t("pages.modelStatistics.creditTrend")}
              total={t("pages.modelStatistics.totals.credits", {
                count: new Intl.NumberFormat(locale, {
                  maximumFractionDigits: 6,
                }).format(Number(summary.credits)),
              })}
            />
          </div>
        </>
      )}
    </section>
  )
}
