import {
  ComputerIcon,
  GlobeIcon,
  Layers01Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Pie, PieChart } from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import type {
  ClientDistributionDimension,
  ClientOverview,
} from "@/lib/session-reporting"

type DistributionItem = {
  id: string
  label: string
  count: number
  fill: string
}

const key = "pages.sessionReporting.clients.distribution"
const colors = [
  "#3b82f6",
  "#2dd4bf",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#94a3b8",
]
const dimensions: {
  field: ClientDistributionDimension
  icon: IconSvgElement
}[] = [
  { field: "client_type", icon: ComputerIcon },
  { field: "platform", icon: GlobeIcon },
  { field: "client_version", icon: Layers01Icon },
]
const knownValues = {
  client_type: ["desktop", "web", "extension", "mobile", "unknown"],
  platform: ["windows", "macos", "linux", "web", "android", "ios"],
}
const platformLabels: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  web: "Web",
  android: "Android",
  ios: "iOS",
}

function categoryColor(
  field: ClientDistributionDimension,
  value: string | null
) {
  if (value === null || value === "unknown") return colors[5]
  const index =
    field === "client_version" ? -1 : knownValues[field].indexOf(value)
  if (index >= 0) return colors[index % colors.length]
  let hash = 0
  for (const character of `${field}:${value}`) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  }
  return colors[hash % colors.length]
}

function DistributionCard({
  title,
  icon,
  items,
  total,
  loading,
  error,
  onRetry,
}: {
  title: string
  icon: IconSvgElement
  items: DistributionItem[]
  total?: number
  loading: boolean
  error?: string
  onRetry: () => void
}) {
  const { i18n, t } = useTranslation()
  const formatter = new Intl.NumberFormat(i18n.language)
  const chartDescription = items
    .map((item) => `${item.label}: ${formatter.format(item.count)}`)
    .join(", ")

  return (
    <Card
      role="figure"
      aria-label={title}
      className="@container/distribution min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
    >
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
        />
        <CardTitle
          role="heading"
          aria-level={2}
          title={title}
          className="min-w-0 flex-1 truncate font-mono text-sm font-medium tracking-wide text-muted-foreground uppercase"
        >
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent
        aria-busy={loading}
        className="min-h-40 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border/60 bg-card p-3 @min-[300px]/distribution:flex-row"
      >
        {loading ? (
          <span
            role="status"
            aria-label={t("statistics.loading")}
            className="text-muted-foreground"
          >
            <HugeiconsIcon
              icon={Loading03Icon}
              size={20}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          </span>
        ) : error ? (
          <div
            role="alert"
            aria-label={error}
            title={error}
            className="flex flex-col items-center gap-2"
          >
            <span className="text-2xl text-muted-foreground">—</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              {t("statistics.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="relative aspect-square w-32 max-w-40 shrink-0 @min-[300px]/distribution:w-[42%]">
              {items.length ? (
                <ChartContainer
                  config={{ count: { label: t(`${key}.sessions`) } }}
                  className="absolute inset-0 aspect-square h-full w-full"
                  role="img"
                  aria-label={`${title}: ${chartDescription}`}
                >
                  <PieChart accessibilityLayer>
                    <ChartTooltip
                      cursor={false}
                      wrapperStyle={{ zIndex: 10 }}
                      content={
                        <ChartTooltipContent hideLabel nameKey="label" />
                      }
                    />
                    <Pie
                      data={items}
                      dataKey="count"
                      nameKey="label"
                      innerRadius="68%"
                      outerRadius="96%"
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={items.length > 1 ? 3 : 0}
                      cornerRadius={3}
                      stroke="transparent"
                      isAnimationActive={false}
                    />
                  </PieChart>
                </ChartContainer>
              ) : (
                <div className="size-full rounded-full border-[12px] border-muted" />
              )}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="font-mono text-base leading-none font-semibold tabular-nums">
                  {total === undefined ? "—" : formatter.format(total)}
                </span>
              </div>
            </div>
            {items.length ? (
              <ul className="grid w-full min-w-0 gap-2.5 @min-[300px]/distribution:flex-1">
                {items.slice(0, 4).map((item) => (
                  <li
                    key={item.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-xs"
                    title={`${item.label} · ${formatter.format(item.count)} ${t(`${key}.sessions`)}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.fill }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="text-end font-mono text-xs font-medium tabular-nums">
                      {formatter.format(item.count)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="flex-1 text-center text-xs text-muted-foreground">
                {t(`${key}.empty`)}
              </span>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ClientDistributionCards({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: ClientOverview
  loading: boolean
  error?: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid shrink-0 gap-4 lg:grid-cols-3">
      {dimensions.map(({ field, icon }) => {
        const items = (data?.distributions[field] ?? []).map(
          ({ value, count }) => ({
            id: JSON.stringify(value),
            label:
              value === null
                ? t(`${key}.unknown`)
                : field === "client_type"
                  ? t(`${key}.types.${value}`, { defaultValue: value })
                  : field === "platform"
                    ? (platformLabels[value] ?? value)
                    : value,
            count,
            fill: categoryColor(field, value),
          })
        )
        return (
          <DistributionCard
            key={field}
            title={t(`${key}.${field}`)}
            icon={icon}
            items={items}
            total={data?.total}
            loading={loading}
            error={error}
            onRetry={onRetry}
          />
        )
      })}
    </div>
  )
}
