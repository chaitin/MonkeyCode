import {
  AiChat02Icon,
  Task01Icon,
  TaskAdd01Icon,
  TaskDaily01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import type { ReactNode } from "react"

import { StatisticsTrendCard } from "@/components/statistics-trend-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SessionOverview } from "@/lib/statistics"

export function TaskOverviewCards({
  overview,
  modelUsage,
}: {
  modelUsage: ReactNode
  overview: SessionOverview
}) {
  const { t, i18n } = useTranslation()
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language)
  const period24h = t("pages.realtimeStatus.period24h")
  const key = "pages.sessionReporting.taskAnalysis"
  const metrics = [
    {
      key: "total_tasks",
      label: t("pages.realtimeStatus.metrics.totalTasks"),
      value: overview.total_sessions,
      icon: Task01Icon,
    },
    {
      key: "new_tasks_24h",
      label: t("pages.realtimeStatus.metrics.newTasks"),
      value: overview.new_sessions_24h,
      icon: TaskAdd01Icon,
      qualifier: period24h,
    },
    {
      key: "active_tasks_24h",
      label: t("pages.realtimeStatus.metrics.activeTasks"),
      value: overview.active_sessions_24h,
      icon: TaskDaily01Icon,
      qualifier: period24h,
    },
    {
      key: "total_conversations",
      label: t(`${key}.totalConversations`),
      value: overview.total_messages,
      icon: AiChat02Icon,
    },
    {
      key: "conversations_24h",
      label: t(`${key}.newMessages`),
      value: overview.last_24h.messages,
      icon: AiChat02Icon,
      qualifier: period24h,
    },
  ]

  const metricCards = metrics.map((metric) => (
    <Card
      key={metric.key}
      role="group"
      aria-label={metric.label}
      className="min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
    >
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={metric.icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {metric.label}
        </CardTitle>
        {metric.qualifier && (
          <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {metric.qualifier}
          </span>
        )}
      </CardHeader>
      <CardContent className="min-h-20 flex-row items-center justify-between rounded-xl border border-border/60 bg-card p-5">
        <p className="min-w-0 break-words text-2xl font-medium tabular-nums tracking-tight">
          {number.format(metric.value)}
        </p>
      </CardContent>
    </Card>
  ))

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">{metricCards.slice(0, 3)}</div>
      <div className="grid gap-5 lg:grid-cols-2">
        <StatisticsTrendCard
          icon={TaskAdd01Icon}
          title={t("pages.realtimeStatus.metrics.newTasks")}
          periodLabel={t("pages.realtimeStatus.period90d")}
          points={overview.days.map((day) => ({
            date: day.date,
            count: day.new_sessions,
          }))}
          loading={false}
          color="var(--color-rose-500)"
          barClassName="fill-rose-500"
        />
        <StatisticsTrendCard
          icon={TaskDaily01Icon}
          title={t("pages.realtimeStatus.metrics.activeTasks")}
          periodLabel={t("pages.realtimeStatus.period90d")}
          points={overview.days.map((day) => ({
            date: day.date,
            count: day.active_sessions,
          }))}
          loading={false}
          color="var(--color-rose-400)"
          barClassName="fill-rose-400"
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">{metricCards.slice(3)}</div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <StatisticsTrendCard
          icon={AiChat02Icon}
          title={t(`${key}.conversationCount`)}
          periodLabel={t("pages.realtimeStatus.period90d")}
          points={overview.days.map((day) => ({
            date: day.date,
            count: day.messages,
          }))}
          loading={false}
          color="var(--color-emerald-500)"
          barClassName="fill-emerald-500"
        />
        {modelUsage}
      </div>
    </>
  )
}
