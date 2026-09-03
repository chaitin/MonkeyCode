import { useState } from "react"
import {
  Activity01Icon,
  AddSquareIcon,
  AiChat02Icon,
  Clock01Icon,
  Coins01Icon,
  DashboardSpeed01Icon,
  GaugeIcon,
  Message01Icon,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

type RealtimeRange = "5m" | "15m" | "30m" | "60m"

type RealtimeSnapshot = {
  modelConsumption: number
  p95ResponseTime: number
  modelSuccessRate: number
  modelCalls: number
  tpm: number
  rpm: number
  inputTokens: number
  outputTokens: number
  activeUsers: number
  activeTasks: number
  newTasks: number
  conversations: number
}

type MetricKey = keyof RealtimeSnapshot

const REALTIME_SNAPSHOTS: Record<RealtimeRange, RealtimeSnapshot> = {
  "5m": {
    modelConsumption: 128,
    p95ResponseTime: 842,
    modelSuccessRate: 99.7,
    modelCalls: 1430,
    tpm: 378400,
    rpm: 286,
    inputTokens: 1480000,
    outputTokens: 412000,
    activeUsers: 184,
    activeTasks: 96,
    newTasks: 421,
    conversations: 1312,
  },
  "15m": {
    modelConsumption: 362,
    p95ResponseTime: 896,
    modelSuccessRate: 99.5,
    modelCalls: 4140,
    tpm: 366800,
    rpm: 276,
    inputTokens: 4320000,
    outputTokens: 1182000,
    activeUsers: 326,
    activeTasks: 207,
    newTasks: 1248,
    conversations: 3864,
  },
  "30m": {
    modelConsumption: 711,
    p95ResponseTime: 931,
    modelSuccessRate: 99.4,
    modelCalls: 7900,
    tpm: 354600,
    rpm: 263,
    inputTokens: 8360000,
    outputTokens: 2278000,
    activeUsers: 451,
    activeTasks: 318,
    newTasks: 2436,
    conversations: 7542,
  },
  "60m": {
    modelConsumption: 1384,
    p95ResponseTime: 1024,
    modelSuccessRate: 99.2,
    modelCalls: 15660,
    tpm: 344300,
    rpm: 261,
    inputTokens: 16240000,
    outputTokens: 4418000,
    activeUsers: 612,
    activeTasks: 428,
    newTasks: 4680,
    conversations: 14620,
  },
}

const METRICS = [
  {
    key: "modelConsumption",
    labelKey: "pages.realtimeStatus.metrics.modelConsumption",
    icon: Coins01Icon,
  },
  {
    key: "p95ResponseTime",
    labelKey: "pages.realtimeStatus.metrics.p95ResponseTime",
    icon: Clock01Icon,
  },
  {
    key: "modelSuccessRate",
    labelKey: "pages.realtimeStatus.metrics.modelSuccessRate",
    icon: TaskDone01Icon,
  },
  {
    key: "modelCalls",
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
    key: "inputTokens",
    labelKey: "pages.realtimeStatus.metrics.inputTokens",
    icon: TokenCircleIcon,
  },
  {
    key: "outputTokens",
    labelKey: "pages.realtimeStatus.metrics.outputTokens",
    icon: AiChat02Icon,
  },
  {
    key: "activeUsers",
    labelKey: "pages.realtimeStatus.metrics.activeUsers",
    icon: UserMultiple02Icon,
  },
  {
    key: "activeTasks",
    labelKey: "pages.realtimeStatus.metrics.activeTasks",
    icon: Task01Icon,
  },
  {
    key: "newTasks",
    labelKey: "pages.realtimeStatus.metrics.newTasks",
    icon: AddSquareIcon,
  },
  {
    key: "conversations",
    labelKey: "pages.realtimeStatus.metrics.conversations",
    icon: Message01Icon,
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
  const snapshot = REALTIME_SNAPSHOTS[timeRange]
  const valueLabels: Record<MetricKey, string> = {
    modelConsumption: t("pages.realtimeStatus.units.credits", {
      count: numberFormatter.format(snapshot.modelConsumption),
    }),
    p95ResponseTime: t("pages.realtimeStatus.units.milliseconds", {
      count: numberFormatter.format(snapshot.p95ResponseTime),
    }),
    modelSuccessRate: `${percentFormatter.format(snapshot.modelSuccessRate)}%`,
    modelCalls: numberFormatter.format(snapshot.modelCalls),
    tpm: compactNumberFormatter.format(snapshot.tpm),
    rpm: numberFormatter.format(snapshot.rpm),
    inputTokens: compactNumberFormatter.format(snapshot.inputTokens),
    outputTokens: compactNumberFormatter.format(snapshot.outputTokens),
    activeUsers: numberFormatter.format(snapshot.activeUsers),
    activeTasks: numberFormatter.format(snapshot.activeTasks),
    newTasks: numberFormatter.format(snapshot.newTasks),
    conversations: numberFormatter.format(snapshot.conversations),
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex justify-end">
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
    </section>
  )
}
