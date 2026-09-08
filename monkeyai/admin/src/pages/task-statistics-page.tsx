import { useState } from "react"
import {
  Clock01Icon,
  Loading03Icon,
  Task01Icon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

import { useStatistics } from "@/hooks/use-statistics"
import { change, type TaskStatistics } from "@/lib/statistics"
import { StatisticsFeedback } from "@/components/statistics-feedback"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function TaskStatisticsPage() {
  const { t } = useTranslation()
  const [timeRange, setTimeRange] = useState("30d")
  const request = useStatistics<TaskStatistics>(
    `/api/admin/v1/statistics/tasks?range=${timeRange}`
  )
  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={timeRange} onValueChange={setTimeRange}>
          <TabsList aria-label={t("pages.taskStatistics.timeRange")}>
            {(["7d", "30d", "90d"] as const).map((range) => (
              <TabsTrigger key={range} value={range}>
                {t(`pages.taskStatistics.ranges.${range}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          onClick={request.reload}
          disabled={request.loading}
        >
          {t("statistics.refresh")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("statistics.taskScope")}
      </p>
      <StatisticsFeedback
        {...request}
        empty={request.data?.summary.total === 0}
      />
      {request.data && <TaskDetails data={request.data} />}
    </section>
  )
}

function TaskDetails({ data }: { data: TaskStatistics }) {
  const { i18n, t } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  })
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  })
  const summary = data.summary
  const trendData = data.trend.map((row) => ({
    ...row,
    date: dateFormatter.format(new Date(row.at)),
  }))
  const statusData = [
    {
      status: "completed",
      value: summary.completed,
      fill: "var(--chart-2)",
    },
    {
      status: "running",
      value: summary.running,
      fill: "var(--chart-3)",
    },
    {
      status: "failed",
      value: summary.failed,
      fill: "var(--chart-5)",
    },
  ]
  const trendChartConfig = {
    completed: {
      label: t("pages.taskStatistics.statuses.completed"),
      color: "var(--chart-2)",
    },
    failed: {
      label: t("pages.taskStatistics.statuses.failed"),
      color: "var(--chart-5)",
    },
  } satisfies ChartConfig
  const statusChartConfig = {
    completed: {
      label: t("pages.taskStatistics.statuses.completed"),
      color: "var(--chart-2)",
    },
    running: {
      label: t("pages.taskStatistics.statuses.running"),
      color: "var(--chart-3)",
    },
    failed: {
      label: t("pages.taskStatistics.statuses.failed"),
      color: "var(--chart-5)",
    },
  } satisfies ChartConfig
  const scaledTaskTypes = data.types
  const formatDuration = (seconds: number | null) => {
    if (seconds === null) return "—"
    const rounded = Math.round(seconds)
    return rounded < 60
      ? t("pages.taskStatistics.durationSeconds", { count: rounded })
      : t("pages.taskStatistics.durationMinutes", {
          minutes: Math.floor(rounded / 60),
          seconds: rounded % 60,
        })
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Task01Icon}
          label={t("pages.taskStatistics.metrics.totalTasks")}
          trend={change(summary.total, data.previous.total, locale)}
          value={numberFormatter.format(summary.total)}
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={TaskDone01Icon}
          label={t("pages.taskStatistics.metrics.completionRate")}
          trend={change(
            summary.completion_rate,
            data.previous.completion_rate,
            locale,
            true
          )}
          value={
            summary.completion_rate === null
              ? "—"
              : `${numberFormatter.format(summary.completion_rate)}%`
          }
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Clock01Icon}
          label={t("pages.taskStatistics.metrics.averageDuration")}
          trend={change(
            summary.average_duration_seconds,
            data.previous.average_duration_seconds,
            locale
          )}
          value={formatDuration(summary.average_duration_seconds)}
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Loading03Icon}
          label={t("pages.taskStatistics.metrics.runningTasks")}
          trend={change(summary.running, data.previous.running, locale)}
          value={numberFormatter.format(summary.running)}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{t("pages.taskStatistics.taskTrend")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer className="h-72 w-full" config={trendChartConfig}>
              <AreaChart
                accessibilityLayer
                data={trendData}
                margin={{ left: 0, right: 8 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis
                  axisLine={false}
                  tickFormatter={(value: number) =>
                    compactNumberFormatter.format(value)
                  }
                  tickLine={false}
                  width={42}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="line" />}
                />
                <Area
                  isAnimationActive={false}
                  dataKey="completed"
                  fill="var(--color-completed)"
                  fillOpacity={0.22}
                  stroke="var(--color-completed)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
                  isAnimationActive={false}
                  dataKey="failed"
                  fill="var(--color-failed)"
                  fillOpacity={0.1}
                  stroke="var(--color-failed)"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t("pages.taskStatistics.statusDistribution")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer
              className="mx-auto h-52 w-full"
              config={statusChartConfig}
            >
              <PieChart accessibilityLayer>
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel nameKey="status" />}
                />
                <Pie
                  isAnimationActive={false}
                  data={statusData}
                  dataKey="value"
                  innerRadius={56}
                  nameKey="status"
                  paddingAngle={3}
                  strokeWidth={0}
                />
              </PieChart>
            </ChartContainer>
            <div className="flex flex-col gap-2">
              {statusData.map((item) => (
                <div
                  className="flex items-center gap-2 text-sm"
                  key={item.status}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.fill }}
                  />
                  <span className="text-muted-foreground">
                    {t(`pages.taskStatistics.statuses.${item.status}`)}
                  </span>
                  <span className="ms-auto font-medium tabular-nums">
                    {numberFormatter.format(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>{t("pages.taskStatistics.taskTypeDetails")}</CardTitle>
          <CardAction>
            <Badge variant="secondary">
              {t("pages.taskStatistics.ranges.30d")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="gap-0 px-0">
          <Table className="min-w-2xl">
            <TableHeader>
              <TableRow>
                <TableHead className="ps-(--card-spacing)">
                  {t("pages.taskStatistics.columns.taskType")}
                </TableHead>
                <TableHead>{t("pages.taskStatistics.columns.total")}</TableHead>
                <TableHead>
                  {t("pages.taskStatistics.columns.completed")}
                </TableHead>
                <TableHead>
                  {t("pages.taskStatistics.columns.completionRate")}
                </TableHead>
                <TableHead className="pe-(--card-spacing) text-end">
                  {t("pages.taskStatistics.columns.averageDuration")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scaledTaskTypes.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="ps-(--card-spacing) font-medium">
                    {t(`pages.taskStatistics.taskTypes.${row.key}`)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {numberFormatter.format(row.total)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {numberFormatter.format(row.completed)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {row.completion_rate === null
                        ? "—"
                        : `${numberFormatter.format(row.completion_rate)}%`}
                    </Badge>
                  </TableCell>
                  <TableCell className="pe-(--card-spacing) text-end tabular-nums">
                    {formatDuration(row.average_duration_seconds)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
