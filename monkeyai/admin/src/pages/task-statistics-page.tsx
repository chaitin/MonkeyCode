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

const TASK_SUMMARY = {
  total: 12846,
  completionRate: 92.4,
  averageDurationSeconds: 102,
  running: 186,
  trends: ["+12.5%", "+2.1%", "-8.4%", "+14"],
} as const

const TASK_TYPE_ROWS = [
  { key: "conversation", total: 5150, completionRate: 94.8, duration: 48 },
  { key: "workflow", total: 2980, completionRate: 91.2, duration: 136 },
  { key: "retrieval", total: 2236, completionRate: 93.5, duration: 64 },
  { key: "tool", total: 1720, completionRate: 88.9, duration: 82 },
  { key: "scheduled", total: 760, completionRate: 90.7, duration: 174 },
] as const

function buildTaskTrendData(dateFormatter: Intl.DateTimeFormat) {
  const days = 30
  const points = 10
  const endDate = new Date(2026, 8, 2)

  return Array.from({ length: points }, (_, index) => {
    const date = new Date(endDate)
    const daysAgo = Math.round(
      ((points - 1 - index) * (days - 1)) / (points - 1)
    )
    date.setDate(date.getDate() - daysAgo)

    return {
      date: dateFormatter.format(date),
      completed: Math.round(276 + index * 11 + Math.sin(index * 1.35) * 32),
      failed: Math.max(8, Math.round(26 + Math.cos(index * 1.1) * 9)),
    }
  })
}

export function TaskStatisticsPage() {
  const { i18n, t } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale)
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  })
  const summary = TASK_SUMMARY
  const trendData = buildTaskTrendData(dateFormatter)
  const completedTasks = Math.round(
    (summary.total * summary.completionRate) / 100
  )
  const failedTasks = Math.max(
    0,
    summary.total - completedTasks - summary.running
  )
  const statusData = [
    {
      status: "completed",
      value: completedTasks,
      fill: "var(--color-completed)",
    },
    {
      status: "running",
      value: summary.running,
      fill: "var(--color-running)",
    },
    {
      status: "failed",
      value: failedTasks,
      fill: "var(--color-failed)",
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
  const scaledTaskTypes = TASK_TYPE_ROWS.map((row) => {
    const total = row.total

    return {
      ...row,
      total,
      completed: Math.round((total * row.completionRate) / 100),
    }
  })
  const formatDuration = (seconds: number) =>
    seconds < 60
      ? t("pages.taskStatistics.durationSeconds", { count: seconds })
      : t("pages.taskStatistics.durationMinutes", {
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        })

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Task01Icon}
          label={t("pages.taskStatistics.metrics.totalTasks")}
          trend={summary.trends[0]}
          value={numberFormatter.format(summary.total)}
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={TaskDone01Icon}
          label={t("pages.taskStatistics.metrics.completionRate")}
          trend={summary.trends[1]}
          value={`${summary.completionRate}%`}
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Clock01Icon}
          label={t("pages.taskStatistics.metrics.averageDuration")}
          trend={summary.trends[2]}
          trendDirection="down"
          value={formatDuration(summary.averageDurationSeconds)}
        />
        <StatisticsMetricCard
          comparison={t("pages.taskStatistics.comparedToPrevious")}
          icon={Loading03Icon}
          label={t("pages.taskStatistics.metrics.runningTasks")}
          trend={summary.trends[3]}
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
                  dataKey="completed"
                  fill="var(--color-completed)"
                  fillOpacity={0.22}
                  stroke="var(--color-completed)"
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
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
                    <Badge variant="outline">{row.completionRate}%</Badge>
                  </TableCell>
                  <TableCell className="pe-(--card-spacing) text-end tabular-nums">
                    {formatDuration(row.duration)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}
