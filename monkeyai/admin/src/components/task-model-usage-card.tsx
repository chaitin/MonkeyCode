import { Activity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Cell, Pie, PieChart } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

type ModelUsageItem = {
  id: string
  label: string
  total: number
  fill: string
  detail: string
}

export function TaskModelUsageCard({ items }: { items: ModelUsageItem[] }) {
  const { t, i18n } = useTranslation()
  const key = "pages.sessionReporting.taskAnalysis"
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language)
  const total = items.reduce((sum, item) => sum + item.total, 0)
  const usageHint = (total: number, model: string) =>
    t(`${key}.modelUsageHint`, { conversations: number.format(total), model })
  return (
    <Card
      className="min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
      role="region"
      aria-label={t(`${key}.modelUsage`)}
    >
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={Activity01Icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${key}.modelUsage`)}
        </CardTitle>
        <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
          {t("pages.realtimeStatus.period24h")}
        </span>
      </CardHeader>
      <CardContent className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card p-4">
        <div className="flex h-32 min-w-0 items-center justify-center gap-3 sm:gap-5">
          <div className="legacy-aspect-square relative aspect-square w-24 shrink-0 sm:w-32">
            <ChartContainer
              config={{ total: { label: t(`${key}.conversationCount`) } }}
              className="absolute inset-0 aspect-square h-full w-full"
              role="img"
              aria-label={items
                .map((item) => `${item.label}: ${number.format(item.total)}`)
                .join(", ")}
            >
              <PieChart accessibilityLayer>
                <ChartTooltip
                  cursor={false}
                  wrapperStyle={{ zIndex: 10 }}
                  content={
                    <ChartTooltipContent
                      className="w-max whitespace-nowrap"
                      hideLabel
                      nameKey="label"
                      formatter={(value, name, item) => (
                        <>
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{
                              backgroundColor: item.payload?.fill ?? item.color,
                            }}
                          />
                          <span>{usageHint(Number(value), String(name))}</span>
                        </>
                      )}
                    />
                  }
                />
                <Pie
                  data={items}
                  dataKey="total"
                  nameKey="label"
                  innerRadius="72%"
                  outerRadius="98%"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={items.length > 1 ? 3 : 0}
                  cornerRadius={3}
                  stroke="transparent"
                  isAnimationActive={false}
                >
                  {items.map((model) => (
                    <Cell key={model.id} fill={model.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-lg font-medium tabular-nums sm:text-xl">
                {number.format(total)}
              </p>
            </div>
          </div>
          <ul
            data-slot="model-usage-legend"
            className="grid min-w-0 max-w-80 flex-1"
          >
            {items.map((model) => (
              <li key={model.id} className="min-w-0">
                <div
                  data-model-id={model.id}
                  data-count={model.total}
                  title={
                    model.id === "other"
                      ? `${usageHint(model.total, model.label)}\n${model.detail}`
                      : usageHint(model.total, model.label)
                  }
                  className="flex h-8 w-full min-w-0 items-center gap-1.5 px-1 text-start text-xs sm:gap-2 sm:px-2"
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: model.fill }}
                  />
                  <span className="min-w-0 flex-1 truncate">{model.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {number.format(model.total)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
