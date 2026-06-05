import { useEffect, useMemo, useState } from "react"
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { toast } from "sonner"

import type { DomainTeamDashboardResp } from "@/api/Api"
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
  return <div className="text-muted-foreground text-sm">暂无数据</div>
}

function formatCount(value?: number) {
  return String(value || 0)
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            团队管理概览
          </h1>
          <p className="text-muted-foreground text-sm">项目、任务与对话统计</p>
        </div>
        <TimeRangeTabs value={range} onChange={setRange} />
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
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard
              title="项目总数"
              value={formatCount(projectStats?.total)}
              description={`近 7 天活动 ${projectStats?.active_7d || 0} · 今日活动 ${projectStats?.active_today || 0}`}
            />
            <MetricCard
              title="任务总数"
              value={formatCount(taskStats?.total)}
              description={`近 7 天活动 ${taskStats?.active_7d || 0} · 今日活动 ${taskStats?.active_today || 0}`}
            />
            <MetricCard
              title="对话总数"
              value={formatCount(conversationStats?.total)}
              description={`近 7 天 ${conversationStats?.count_7d || 0} · 今日 ${conversationStats?.count_today || 0}`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <TrendCard title="每天创建项目数">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={projectTrend}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TrendCard>
            <TrendCard title="每天创建任务数">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={taskTrend}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#059669"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TrendCard>
            <TrendCard title="每天创建对话数">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={conversationTrend}>
                  <XAxis dataKey="date" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={40} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#0891b2"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </TrendCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="活跃成员"
              value={`${metrics?.active_members || 0} / ${metrics?.total_members || 0}`}
              description={`活跃率 ${metrics?.active_rate || 0}%`}
            />
            <MetricCard
              title="周期任务"
              value={String(metrics?.task_count || 0)}
              description={`运行中 ${metrics?.running_task_count || 0} · 已结束 ${metrics?.finished_task_count || 0}`}
            />
            <MetricCard
              title="平均耗时"
              value={formatDuration(metrics?.average_duration)}
              description="仅统计已完成任务"
            />
            <MetricCard
              title="Token 消耗"
              value={formatTokens(metrics?.total_tokens)}
              description={`模型调用 ${metrics?.llm_requests || 0} 次`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <InsightTable title="高活跃成员 Top 5">
              <div className="space-y-3">
                {(data?.insights?.active_members || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.active_members || []).map((item) => (
                  <div
                    key={item.user_id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.name || item.email || "未命名成员"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {item.group_name || "未分组"}
                      </div>
                    </div>
                    <div className="text-muted-foreground shrink-0">
                      {item.task_count || 0} 个任务
                    </div>
                  </div>
                ))}
              </div>
            </InsightTable>
            <InsightTable title="高消耗成员 / 项目 Top 5">
              <div className="space-y-3">
                {(data?.insights?.high_consumption || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.high_consumption || []).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.name || "未知对象"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {item.type === "project" ? "项目" : "成员"}
                      </div>
                    </div>
                    <div className="text-muted-foreground shrink-0">
                      {formatTokens(item.total_tokens)}
                    </div>
                  </div>
                ))}
              </div>
            </InsightTable>
            <InsightTable title="长时间运行任务">
              <div className="space-y-3">
                {(data?.insights?.long_running_tasks || []).length === 0 && (
                  <InsightEmpty />
                )}
                {(data?.insights?.long_running_tasks || []).map((item) => (
                  <div
                    key={item.task_id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.title || "未命名任务"}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {item.creator || item.host_name || "未知创建人"}
                      </div>
                    </div>
                    <div className="text-muted-foreground shrink-0">
                      {formatDuration(item.duration)}
                    </div>
                  </div>
                ))}
              </div>
            </InsightTable>
          </div>
        </>
      )}
    </div>
  )
}
