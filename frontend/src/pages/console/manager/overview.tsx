import { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Activity,
  FolderKanban,
  MessageSquareText,
  Target,
} from "lucide-react"
import { toast } from "sonner"

import type { DomainTeamDashboardResp } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { InsightTable } from "@/components/manager/dashboard/insight-table"
import { MetricCard } from "@/components/manager/dashboard/metric-card"
import {
  TimeRangeTabs,
  type DashboardRange,
} from "@/components/manager/dashboard/time-range-tabs"
import { TrendCard } from "@/components/manager/dashboard/trend-card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"

function formatDuration(seconds?: number) {
  if (!seconds) return "暂无"
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟`
  return `${(seconds / 3600).toFixed(1)} 小时`
}

function formatTokens(value?: number) {
  if (!value) return "0"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function InsightEmpty() {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      当前周期暂无数据
    </div>
  )
}

function formatCount(value?: number) {
  return String(value || 0)
}

function formatRate(value?: number) {
  return `${value || 0}%`
}

function formatChartDate(value?: string) {
  if (!value) return ""
  const parts = value.split("-")
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`
  return value
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value?: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-md border border-[var(--dashboard-brand-border)] bg-popover px-4 py-2 text-sm shadow-sm">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-2 font-medium text-[var(--dashboard-brand)]">
        {formatCount(payload[0]?.value)}
      </div>
    </div>
  )
}

function DashboardLineChart({
  data,
  stroke,
}: {
  data: { date?: string; value?: number }[]
  stroke: string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="dashboardTrendArea" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--dashboard-brand)"
              stopOpacity={0.18}
            />
            <stop
              offset="55%"
              stopColor="var(--dashboard-brand)"
              stopOpacity={0.08}
            />
            <stop
              offset="100%"
              stopColor="var(--dashboard-brand)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="currentColor"
          strokeDasharray="4 8"
          strokeOpacity={0.1}
          vertical={false}
        />
        <XAxis
          dataKey="date"
          interval="preserveStartEnd"
          minTickGap={32}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={formatChartDate}
          tick={{ fontSize: 11, fill: "currentColor", opacity: 0.36 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          tick={{ fontSize: 11, fill: "currentColor", opacity: 0.36 }}
        />
        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: "var(--dashboard-brand)", strokeOpacity: 0.14 }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={stroke}
          strokeWidth={2}
          fill="url(#dashboardTrendArea)"
          fillOpacity={1}
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function InsightRow({
  title,
  subtitle,
  value,
  badge,
}: {
  title: string
  subtitle: string
  value: string
  badge?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-2 py-2 text-sm hover:bg-muted/60">
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="mt-2 flex items-center gap-2 text-muted-foreground">
          {badge && (
            <Badge variant="outline" className="h-6 px-2 text-xs">
              {badge}
            </Badge>
          )}
          <span className="truncate">{subtitle}</span>
        </div>
      </div>
      <div className="shrink-0 font-medium text-[var(--dashboard-brand)]">
        {value}
      </div>
    </div>
  )
}

function TaskStatsPanel({
  running,
  finished,
  averageDuration,
  tokens,
  requests,
}: {
  running: number
  finished: number
  averageDuration?: number
  tokens?: number
  requests?: number
}) {
  const total = running + finished
  const finishedRate = total > 0 ? Math.round((finished / total) * 100) : 0

  return (
    <Card className="gap-0 rounded-lg shadow-none">
      <CardHeader className="gap-2 px-6 pb-4">
        <CardTitle className="text-base font-semibold">任务统计</CardTitle>
        <p className="text-sm text-muted-foreground">
          运行状态、耗时与模型调用
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/60 p-4">
            <div className="text-sm text-muted-foreground">运行中</div>
            <div className="mt-2 text-2xl font-semibold leading-none">
              {running}
            </div>
          </div>
          <div className="rounded-lg bg-muted/60 p-4">
            <div className="text-sm text-muted-foreground">已结束</div>
            <div className="mt-2 text-2xl font-semibold leading-none">
              {finished}
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">完成占比</span>
            <span className="font-medium">{finishedRate}%</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--dashboard-brand-muted)]">
            <div
              className="h-2 rounded-full bg-[var(--dashboard-brand)]"
              style={{ width: `${finishedRate}%` }}
            />
          </div>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">平均耗时</span>
            <span className="font-medium">{formatDuration(averageDuration)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Token 消耗</span>
            <span className="font-medium">{formatTokens(tokens)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">模型调用</span>
            <span className="font-medium">{requests || 0} 次</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function TeamManagerOverview() {
  const [range, setRange] = useState<DashboardRange>("7d")
  const [data, setData] = useState<DomainTeamDashboardResp | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    apiRequest(
      "v1TeamsDashboardList",
      { range },
      [],
      (resp) => {
        if (resp.code === 0) {
          setData(resp.data)
        } else {
          toast.error(resp.message || "获取团队概览失败")
        }
        setLoading(false)
      },
      () => {
        setLoading(false)
      },
    )
  }, [range])

  const metrics = data?.metrics
  const projectStats = data?.project_stats
  const taskStats = data?.task_stats
  const conversationStats = data?.conversation_stats
  const projectTrend = useMemo(() => projectStats?.daily_created || [], [projectStats])
  const taskTrend = useMemo(() => taskStats?.daily_created || [], [taskStats])
  const conversationTrend = useMemo(() => conversationStats?.daily_created || [], [conversationStats])
  const hasTrendData =
    projectTrend.length > 0 || taskTrend.length > 0 || conversationTrend.length > 0

  return (
    <div
      className="flex flex-col gap-6 [--dashboard-brand:oklch(0.555_0.163_48.998)] [--dashboard-brand-border:oklch(0.555_0.163_48.998_/_28%)] [--dashboard-brand-muted:oklch(0.555_0.163_48.998_/_12%)]"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-normal">
              团队管理概览
            </h1>
            {loading && data && (
              <Badge variant="outline" className="font-normal">
                刷新中
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            项目、任务、对话与资源消耗
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <div className="text-sm font-medium">统计周期</div>
          <TimeRangeTabs value={range} onChange={setRange} />
        </div>
      </div>

      {loading && !data ? (
        <Empty className="bg-muted">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Spinner className="size-6" />
            </EmptyMedia>
            <EmptyTitle>正在加载团队概览</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="任务总数"
              value={formatCount(taskStats?.total)}
              stats={[
                { label: "近 7 天活动", value: formatCount(taskStats?.active_7d) },
                { label: "今日活动", value: formatCount(taskStats?.active_today) },
              ]}
              icon={<Target />}
            />
            <MetricCard
              title="项目总数"
              value={formatCount(projectStats?.total)}
              stats={[
                { label: "近 7 天活动", value: formatCount(projectStats?.active_7d) },
                { label: "今日活动", value: formatCount(projectStats?.active_today) },
              ]}
              icon={<FolderKanban />}
            />
            <MetricCard
              title="对话总数"
              value={formatCount(conversationStats?.total)}
              stats={[
                { label: "近 7 天", value: formatCount(conversationStats?.count_7d) },
                { label: "今日", value: formatCount(conversationStats?.count_today) },
              ]}
              icon={<MessageSquareText />}
            />
            <MetricCard
              title="活跃成员"
              value={`${metrics?.active_members || 0} / ${metrics?.total_members || 0}`}
              stats={[
                { label: "活跃率", value: formatRate(metrics?.active_rate) },
                { label: "总成员", value: formatCount(metrics?.total_members) },
              ]}
              icon={<Activity />}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <div className="grid gap-4">
              <TrendCard
                title="任务创建趋势"
                description="按日期统计新增任务"
                contentClassName="h-72"
              >
                {taskTrend.length > 0 ? (
                  <DashboardLineChart
                    data={taskTrend}
                    stroke="var(--dashboard-brand)"
                  />
                ) : (
                  <InsightEmpty />
                )}
              </TrendCard>
              <div className="grid gap-4 lg:grid-cols-2">
                <TrendCard
                  title="项目创建趋势"
                  description="按日期统计新增项目"
                  contentClassName="h-52"
                >
                  {projectTrend.length > 0 ? (
                    <DashboardLineChart
                      data={projectTrend}
                      stroke="var(--dashboard-brand)"
                    />
                  ) : (
                    <InsightEmpty />
                  )}
                </TrendCard>
                <TrendCard
                  title="对话创建趋势"
                  description="按日期统计新增对话"
                  contentClassName="h-52"
                >
                  {conversationTrend.length > 0 ? (
                    <DashboardLineChart
                      data={conversationTrend}
                      stroke="var(--dashboard-brand)"
                    />
                  ) : (
                    <InsightEmpty />
                  )}
                </TrendCard>
              </div>
            </div>
            <TaskStatsPanel
              running={metrics?.running_task_count || 0}
              finished={metrics?.finished_task_count || 0}
              averageDuration={metrics?.average_duration}
              tokens={metrics?.total_tokens}
              requests={metrics?.llm_requests}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <InsightTable title="高活跃成员" description="按任务数量排序">
              <div className="space-y-2">
                {(data?.insights?.active_members || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.active_members || []).map((item) => (
                  <InsightRow
                    key={item.user_id}
                    title={item.name || item.email || "未命名成员"}
                    subtitle={item.group_name || "未分组"}
                    value={`${item.task_count || 0} 个任务`}
                  />
                ))}
              </div>
            </InsightTable>
            <InsightTable title="高消耗对象" description="按 Token 消耗排序">
              <div className="space-y-2">
                {(data?.insights?.high_consumption || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.high_consumption || []).map((item) => (
                  <InsightRow
                    key={item.id}
                    title={item.name || "未知对象"}
                    subtitle="Token 消耗"
                    value={formatTokens(item.total_tokens)}
                    badge={item.type === "project" ? "项目" : "成员"}
                  />
                ))}
              </div>
            </InsightTable>
            <InsightTable title="长时间运行任务" description="按运行时长排序">
              <div className="space-y-2">
                {(data?.insights?.long_running_tasks || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.long_running_tasks || []).map((item) => (
                  <InsightRow
                    key={item.task_id}
                    title={item.title || "未命名任务"}
                    subtitle={item.creator || item.host_name || "未知创建人"}
                    value={formatDuration(item.duration)}
                  />
                ))}
              </div>
            </InsightTable>
          </div>

          {!hasTrendData && (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              当前周期还没有足够趋势数据，创建项目或任务后这里会展示增长曲线。
            </div>
          )}
        </>
      )}
    </div>
  )
}
