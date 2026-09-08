import { useState } from "react"
import {
  Activity01Icon,
  AddSquareIcon,
  AiChat02Icon,
  Clock01Icon,
  Coins01Icon,
  DashboardSpeed01Icon,
  GaugeIcon,
  Task01Icon,
  TaskDone01Icon,
  TokenCircleIcon,
  UserMultiple02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useStatistics } from "@/hooks/use-statistics"
import { type RealtimeStatistics } from "@/lib/statistics"
import { StatisticsFeedback } from "@/components/statistics-feedback"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type RealtimeRange = "5m" | "15m" | "30m" | "60m"

type MetricKey = Exclude<keyof RealtimeStatistics, "from" | "until">

const METRICS = [
  {
    key: "model_consumption",
    labelKey: "pages.realtimeStatus.metrics.modelConsumption",
    icon: Coins01Icon,
  },
  {
    key: "p95_response_time",
    labelKey: "pages.realtimeStatus.metrics.p95ResponseTime",
    icon: Clock01Icon,
  },
  {
    key: "model_success_rate",
    labelKey: "pages.realtimeStatus.metrics.modelSuccessRate",
    icon: TaskDone01Icon,
  },
  {
    key: "model_calls",
    labelKey: "pages.realtimeStatus.metrics.modelCalls",
    icon: Activity01Icon,
  },
  {
    key: "tpm",
    labelKey: "pages.realtimeStatus.metrics.tpm",
    icon: DashboardSpeed01Icon,
  },
  {
    key: "rpm",
    labelKey: "pages.realtimeStatus.metrics.rpm",
    icon: GaugeIcon,
  },
  {
    key: "input_tokens",
    labelKey: "pages.realtimeStatus.metrics.inputTokens",
    icon: TokenCircleIcon,
  },
  {
    key: "output_tokens",
    labelKey: "pages.realtimeStatus.metrics.outputTokens",
    icon: AiChat02Icon,
  },
  {
    key: "active_users",
    labelKey: "pages.realtimeStatus.metrics.activeUsers",
    icon: UserMultiple02Icon,
  },
  {
    key: "active_tasks",
    labelKey: "pages.realtimeStatus.metrics.activeTasks",
    icon: Task01Icon,
  },
  {
    key: "new_tasks",
    labelKey: "pages.realtimeStatus.metrics.newTasks",
    icon: AddSquareIcon,
  },
] as const

function RealtimeMetricCard({
  icon,
  label,
  valueLabel,
}: {
  icon: IconSvgElement
  label: string
  valueLabel: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
        <CardAction>
          <HugeiconsIcon
            className="text-muted-foreground"
            icon={icon}
            size={20}
            strokeWidth={2}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="gap-2">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {valueLabel}
        </p>
      </CardContent>
    </Card>
  )
}

export function RealtimeStatusPage() {
  const { i18n, t } = useTranslation()
  const [timeRange, setTimeRange] = useState<RealtimeRange>("15m")
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale)
  const compactNumberFormatter = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const percentFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const request = useStatistics<RealtimeStatistics>(
    `/api/admin/v1/statistics/realtime?range=${timeRange}`,
    30000
  )
  const snapshot = request.data
  const valueLabels: Record<MetricKey, string> | undefined = snapshot
    ? {
        model_consumption: t("pages.realtimeStatus.units.credits", {
          count: new Intl.NumberFormat(locale, {
            maximumFractionDigits: 6,
          }).format(Number(snapshot.model_consumption)),
        }),
        p95_response_time:
          snapshot.p95_response_time === null
            ? "—"
            : t("pages.realtimeStatus.units.milliseconds", {
                count: numberFormatter.format(snapshot.p95_response_time),
              }),
        model_success_rate:
          snapshot.model_success_rate === null
            ? "—"
            : `${percentFormatter.format(snapshot.model_success_rate)}%`,
        model_calls: numberFormatter.format(snapshot.model_calls),
        tpm: compactNumberFormatter.format(snapshot.tpm),
        rpm: numberFormatter.format(snapshot.rpm),
        input_tokens: compactNumberFormatter.format(snapshot.input_tokens),
        output_tokens: compactNumberFormatter.format(snapshot.output_tokens),
        active_users: numberFormatter.format(snapshot.active_users),
        active_tasks: numberFormatter.format(snapshot.active_tasks),
        new_tasks: numberFormatter.format(snapshot.new_tasks),
      }
    : undefined

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={request.reload}
          disabled={request.loading}
        >
          {t("statistics.refresh")}
        </Button>
        <Tabs
          value={timeRange}
          onValueChange={(value) => setTimeRange(value as RealtimeRange)}
        >
          <TabsList aria-label={t("pages.realtimeStatus.timeRange")}>
            {(["5m", "15m", "30m", "60m"] as const).map((range) => (
              <TabsTrigger key={range} value={range}>
                {t(`pages.realtimeStatus.ranges.${range}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("statistics.realtimeScope")}
        {snapshot &&
          ` · ${t("statistics.updated", { time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(snapshot.until)) })}`}
      </p>
      <StatisticsFeedback {...request} />
      {valueLabels && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <RealtimeMetricCard
              icon={metric.icon}
              key={metric.key}
              label={t(metric.labelKey)}
              valueLabel={valueLabels[metric.key]}
            />
          ))}
        </div>
      )}
    </section>
  )
}
