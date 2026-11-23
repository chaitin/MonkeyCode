import { ArrowDownRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { periodChange } from "@/lib/statistics"
import { cn } from "@/lib/utils"

export function StatisticsPeriodComparison({
  current,
  previous,
  translationKey = "pages.realtimeStatus.comparison",
  periodLabel,
}: {
  current?: number
  previous?: number
  translationKey?: string
  periodLabel?: string
}) {
  const { i18n, t } = useTranslation()
  const comparison = periodChange(current, previous)
  if (!comparison) {
    const description = t(`${translationKey}.unavailable`)
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} />}
          className="ms-auto shrink-0 cursor-default text-sm text-muted-foreground"
          aria-label={description}
        >
          —
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    )
  }
  const locale = i18n.resolvedLanguage ?? i18n.language
  const roundedPercent =
    comparison.percent === null ? null : Math.round(comparison.percent)
  const percent =
    roundedPercent === null
      ? undefined
      : new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 0,
        }).format(roundedPercent / 100)
  const description = t(
    `${translationKey}.${comparison.percent === null ? "newActivity" : comparison.direction === "up" ? "increased" : comparison.direction === "down" ? "decreased" : "unchanged"}`,
    { percent, period: periodLabel }
  )
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn(
          "ms-auto shrink-0 cursor-default whitespace-nowrap text-sm font-medium tabular-nums",
          comparison.direction === "up"
            ? "text-green-600 dark:text-green-400"
            : comparison.direction === "down"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
        )}
        aria-label={description}
      >
        <span aria-hidden="true" className="inline-flex items-center gap-1">
          <HugeiconsIcon
            icon={ArrowDownRight01Icon}
            className={
              comparison.direction === "up" || roundedPercent === 0
                ? "-rotate-90"
                : undefined
            }
            size={16}
            strokeWidth={1.75}
          />
          {percent ?? t(`${translationKey}.new`)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start">
        <p>{description}</p>
        {previous != null && (
          <p>
            {t(`${translationKey}.previousValue`, {
              value: new Intl.NumberFormat(locale).format(previous),
              period: periodLabel,
            })}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
