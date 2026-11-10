import { Activity01Icon, Loading03Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { ModelMessageDistribution } from "@/lib/statistics"

const modelColors = [
  "#3b82f6",
  "#2dd4bf",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#f97316",
]

export function ModelMessageDistributionCard({
  distribution,
  loading,
}: {
  distribution?: ModelMessageDistribution
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const key = "pages.sessionReporting.taskAnalysis"
  const title = t(`${key}.modelMessageDistribution`)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  })
  const ranked = (distribution?.models ?? [])
    .map((model) => ({
      id: model.id ?? "unknown",
      name: model.name ?? t(`${key}.unknownModel`),
      detail: model.name ?? t(`${key}.unknownModel`),
      messages: model.messages,
    }))
    .sort((a, b) => b.messages - a.messages || a.id.localeCompare(b.id))
  const grouped =
    ranked.length <= 6
      ? ranked
      : [
          ...ranked.slice(0, 5),
          {
            id: "other",
            name: t(`${key}.otherModels`),
            detail: ranked
              .slice(5)
              .map((model) => model.name)
              .join(", "),
            messages: ranked
              .slice(5)
              .reduce((sum, model) => sum + model.messages, 0),
          },
        ]
  const models = grouped.map((model, index) => ({
    ...model,
    color: model.id === "other" ? "#94a3b8" : modelColors[index],
  }))
  const total = distribution?.total_messages ?? 0

  return (
    <Card
      className="min-w-0 gap-2 bg-muted/40 p-2 shadow-none ring-1 ring-border/70"
      role="region"
      aria-label={title}
    >
      <CardHeader className="flex min-h-7 flex-row items-center gap-3 px-3 py-0">
        <HugeiconsIcon
          icon={Activity01Icon}
          className="shrink-0 text-muted-foreground"
          size={16}
          strokeWidth={1.75}
        />
        <CardTitle className="min-w-0 flex-1 font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
        <span className="ms-auto shrink-0 font-mono text-xs text-muted-foreground/70">
          {t("pages.realtimeStatus.period24h")}
        </span>
      </CardHeader>
      <CardContent
        className="min-w-0 gap-5 rounded-xl border border-border/60 bg-card p-5"
        aria-busy={loading}
      >
        {loading || !distribution || models.length === 0 ? (
          <div className="flex min-h-14 items-center justify-center text-xs text-muted-foreground">
            {loading ? (
              <span role="status" aria-label={t("statistics.loading")}>
                <HugeiconsIcon
                  icon={Loading03Icon}
                  className="animate-spin motion-reduce:animate-none"
                  size={20}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </span>
            ) : distribution ? (
              t("statistics.empty")
            ) : (
              "—"
            )}
          </div>
        ) : (
          <>
            <div className="pt-1">
              <div
                data-slot="model-message-distribution-bar"
                role="group"
                aria-label={title}
                className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              >
                {models.map((model) => {
                  const share = model.messages / Math.max(1, total)
                  const hint = t(`${key}.modelMessageDistributionDetail`, {
                    model: model.name,
                    amount: number.format(model.messages),
                    percent: percent.format(share),
                  })
                  return (
                    <Tooltip key={model.id}>
                      <TooltipTrigger
                        render={
                          <span
                            tabIndex={0}
                            data-model-id={model.id}
                            data-count={model.messages}
                            aria-label={hint}
                            className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-foreground/50"
                            style={{
                              width: `${share * 100}%`,
                              backgroundColor: model.color,
                            }}
                          />
                        }
                      />
                      <TooltipContent className="max-w-none whitespace-nowrap">
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: model.color }}
                        />
                        <span>{hint}</span>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
            <div
              data-slot="model-message-distribution-legend"
              className="flex min-w-0 max-w-full flex-nowrap items-center gap-5 overflow-x-auto pb-1 text-xs text-muted-foreground"
            >
              {models.map((model) => (
                <span
                  key={model.id}
                  title={model.detail}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: model.color }}
                  />
                  {model.name}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
