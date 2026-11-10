import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import {
  AiChat02Icon,
  Clock01Icon,
  DashboardSpeed01Icon,
  Loading03Icon,
  TaskDone01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { TaskOverviewCards } from "@/components/task-overview-cards"
import { TaskModelUsageCard } from "@/components/task-model-usage-card"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStatistics } from "@/hooks/use-statistics"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { sessionOutcomes, type SessionOverview } from "@/lib/statistics"
import { cn } from "@/lib/utils"

const key = "pages.sessionReporting.taskAnalysis"
const modelColors = ["#3b82f6", "#2dd4bf", "#a78bfa", "#94a3b8"]
const colors = {
  complete: "var(--color-emerald-500)",
  error: "var(--color-rose-500)",
  interrupted: "#fbbf24",
  max_turns: "var(--color-orange-500)",
  output_limit: "#a78bfa",
  unknown: "#94a3b8",
}
const shell = "min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
const body = "min-w-0 flex-1 rounded-xl border border-border/60 bg-card"

function AnalysisCard({
  title,
  icon,
  qualifier,
  children,
  className,
}: {
  title: string
  icon: IconSvgElement
  qualifier?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={shell} role="region" aria-label={title}>
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        {qualifier && (
          <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
            {qualifier}
          </span>
        )}
      </CardHeader>
      <CardContent className={cn(body, "p-5", className)}>
        {children}
      </CardContent>
    </Card>
  )
}

export function TaskAnalysisPage() {
  const { t } = useTranslation()
  const request = useStatistics<SessionOverview>(
    "/api/admin/v1/statistics/session-reporting/sessions/overview",
    0,
    { retryAction: false }
  )
  if (request.loading)
    return (
      <section
        className="flex min-h-96 flex-1 items-center justify-center p-4"
        role="status"
        aria-label={t("statistics.loading")}
      >
        <HugeiconsIcon
          icon={Loading03Icon}
          className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      </section>
    )
  if (!request.data)
    return (
      <section
        className="flex min-h-96 flex-1 flex-col items-center justify-center gap-3 p-4 text-center"
        role="alert"
      >
        <p className="text-sm text-muted-foreground">
          {t(`${key}.loadFailed`)}
        </p>
        <Button variant="outline" onClick={request.reload}>
          {t("statistics.retry")}
        </Button>
      </section>
    )
  return <TaskAnalysisContent overview={request.data} />
}

function TaskAnalysisContent({ overview }: { overview: SessionOverview }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const ranked = overview.last_24h.models
    .map((model) => ({
      id: model.id ?? "unknown",
      label: model.name ?? t(`${key}.unknownModel`),
      detail: model.name ?? t(`${key}.unknownModel`),
      total: model.messages,
    }))
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
  const models =
    ranked.length <= 4
      ? ranked
      : [
          ...ranked.slice(0, 3),
          {
            id: "other",
            label: t(`${key}.otherModels`),
            detail: ranked
              .slice(3)
              .map((model) => model.label)
              .join(", "),
            total: ranked.slice(3).reduce((sum, model) => sum + model.total, 0),
          },
        ]
  const last24hSummary = {
    ...overview.last_24h.outcomes,
    total: overview.last_24h.messages,
    ...overview.last_24h.duration_seconds,
  }
  const last24hMessageCounts = overview.last_24h.messages_per_session
  const modelChartItems = models.map((model, index) => ({
    ...model,
    fill: modelColors[index],
  }))
  const number = new Intl.NumberFormat(locale)
  const messageCount = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  })
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  })
  const duration = (seconds: number) => {
    const rounded = Math.round(seconds)
    const minutes = Math.floor(rounded / 60)
    const rest = rounded % 60
    return minutes
      ? rest
        ? t(`${key}.minutesSeconds`, { minutes, seconds: rest })
        : t(`${key}.minutes`, { count: minutes })
      : t(`${key}.seconds`, { count: rest })
  }
  const metrics = [
    {
      name: "average",
      value:
        last24hSummary.average == null ? "—" : duration(last24hSummary.average),
      icon: Clock01Icon,
    },
    {
      name: "p10",
      value: last24hSummary.p10 == null ? "—" : duration(last24hSummary.p10),
      icon: Clock01Icon,
    },
    {
      name: "p90",
      value: last24hSummary.p90 == null ? "—" : duration(last24hSummary.p90),
      icon: DashboardSpeed01Icon,
      color: "text-amber-600 dark:text-amber-400",
    },
  ]

  const messageMetrics = [
    {
      name: "averageMessages",
      value:
        last24hMessageCounts.average == null
          ? "—"
          : messageCount.format(last24hMessageCounts.average),
      icon: AiChat02Icon,
    },
    {
      name: "p10Messages",
      value:
        last24hMessageCounts.p10 == null
          ? "—"
          : number.format(last24hMessageCounts.p10),
      icon: AiChat02Icon,
    },
    {
      name: "p90Messages",
      value:
        last24hMessageCounts.p90 == null
          ? "—"
          : number.format(last24hMessageCounts.p90),
      icon: AiChat02Icon,
      color: "text-amber-600 dark:text-amber-400",
    },
  ]

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-5 p-4 pt-0">
      <TaskOverviewCards
        overview={overview}
        modelUsage={<TaskModelUsageCard items={modelChartItems} />}
      />
      {[metrics, messageMetrics].map((group) => (
        <div key={group[0].name} className="grid gap-5 md:grid-cols-3">
          {group.map((metric) => (
            <AnalysisCard
              key={metric.name}
              title={t(`${key}.${metric.name}`)}
              icon={metric.icon}
              qualifier={t("pages.realtimeStatus.period24h")}
              className="min-h-20 justify-center"
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <p
                      tabIndex={0}
                      className={cn(
                        "w-fit max-w-full break-words text-2xl font-medium tabular-nums tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        metric.color
                      )}
                    />
                  }
                >
                  {metric.value}
                </TooltipTrigger>
                <TooltipContent>
                  {t(`${key}.hints.${metric.name}`)}
                </TooltipContent>
              </Tooltip>
            </AnalysisCard>
          ))}
        </div>
      ))}
      <AnalysisCard
        title={t(`${key}.conversationResults`)}
        icon={TaskDone01Icon}
        qualifier={t("pages.realtimeStatus.period24h")}
        className="gap-5"
      >
        <div
          data-slot="conversation-outcome-bar"
          role="group"
          aria-label={t(`${key}.conversationResults`)}
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        >
          {sessionOutcomes
            .filter((outcome) => last24hSummary[outcome] > 0)
            .map((outcome) => {
              const count = last24hSummary[outcome]
              const share = count / Math.max(1, last24hSummary.total)
              const label = t(`${key}.resultDetail`, {
                outcome: t(`${key}.outcomes.${outcome}`),
                amount: number.format(count),
                percent: percent.format(share),
              })
              return (
                <Tooltip key={outcome}>
                  <TooltipTrigger
                    render={
                      <span
                        tabIndex={0}
                        data-outcome={outcome}
                        data-count={count}
                        aria-label={label}
                        className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/50"
                        style={{
                          width: `${share * 100}%`,
                          background: colors[outcome],
                        }}
                      />
                    }
                  />
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              )
            })}
        </div>
        <div
          data-slot="conversation-outcome-legend"
          className="flex min-w-0 max-w-full flex-nowrap items-center gap-5 overflow-x-auto pb-1 text-xs text-muted-foreground"
        >
          {sessionOutcomes.map((outcome) => (
            <span
              key={outcome}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: colors[outcome] }}
              />
              {t(`${key}.outcomes.${outcome}`)}
            </span>
          ))}
        </div>
      </AnalysisCard>
    </section>
  )
}
