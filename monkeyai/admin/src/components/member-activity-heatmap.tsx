import { useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import { Activity01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  memberActivityOpacity,
  memberActivityYear,
  memberActivityBounds,
} from "@/lib/member-activity"
import { CONSOLE_ROUTES } from "@/lib/routes"

const key = "pages.sessionReporting.memberAnalysis"

export function MemberActivityHeatmap({
  days,
  until,
  userID,
}: {
  days: { date: string; conversations: number }[]
  until: Date
  userID: string
}) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const gridRef = useRef<HTMLDivElement>(null)
  const { start, end, cells, weekCount } = memberActivityYear(until)
  const counts = new Map(days.map((day) => [day.date, day.conversations]))
  const number = new Intl.NumberFormat(i18n.language)
  const total = cells.reduce(
    (sum, date) => sum + (date ? (counts.get(date) ?? 0) : 0),
    0
  )
  const title = t(`${key}.activity.total`, { count: number.format(total) })
  const fullDate = new Intl.DateTimeFormat(i18n.language, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  })
  const month = new Intl.DateTimeFormat(i18n.language, {
    month: "short",
    timeZone: "Asia/Shanghai",
  })
  const columns = `repeat(${weekCount}, minmax(9px, 1fr))`
  const months = cells
    .flatMap((date, index) => {
      if (
        !date ||
        (date.slice(-2) !== "01" && date !== format(start, "yyyy-MM-dd"))
      )
        return []
      return [{ date, column: Math.floor(index / 7) }]
    })
    .filter((_, index) => [1, 4, 7, 10].includes(index))
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
          {t(`${key}.activity.pastYear`)}
        </span>
      </CardHeader>
      <CardContent className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
        <div
          className="overflow-x-auto pb-2"
          tabIndex={0}
          role="group"
          aria-label={t(`${key}.activity.calendar`)}
        >
          <div className="grid min-w-[640px] grid-cols-1 gap-2">
            <div
              className="grid h-4 gap-0.5 text-xs text-muted-foreground"
              style={{ gridTemplateColumns: columns }}
              aria-hidden="true"
            >
              {months.map(({ date, column }) => (
                <span
                  key={date}
                  className="min-w-0 whitespace-nowrap"
                  style={{
                    gridColumn: `${Math.min(column, weekCount - 3) + 1} / span 3`,
                    gridRow: 1,
                    textAlign: column > weekCount - 3 ? "end" : undefined,
                  }}
                >
                  {month
                    .format(new Date(`${date}T12:00:00+08:00`))
                    .replace(/(\d)月/, "$1 月")}
                </span>
              ))}
            </div>
            <div
              ref={gridRef}
              className="grid grid-flow-col grid-rows-7 gap-0.5"
              style={{ gridTemplateColumns: columns }}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement
                const index = Number(target.dataset.index)
                if (!target.hasAttribute("data-index")) return
                const delta = {
                  ArrowUp: -1,
                  ArrowDown: 1,
                  ArrowLeft: -7,
                  ArrowRight: 7,
                }[event.key]
                if (delta === undefined) return
                event.preventDefault()
                gridRef.current
                  ?.querySelector<HTMLButtonElement>(
                    `[data-index="${index + delta}"]`
                  )
                  ?.focus()
              }}
            >
              {cells.map((date, index) => {
                if (!date)
                  return (
                    <span
                      key={`padding-${index}`}
                      className="h-2.5"
                      aria-hidden="true"
                    />
                  )
                const count = counts.get(date) ?? 0
                const description = t(`${key}.activity.day`, {
                  date: fullDate
                    .format(new Date(`${date}T12:00:00+08:00`))
                    .replace(/(\d)([年月日])/g, "$1 $2 ")
                    .trim(),
                  count: number.format(count),
                })
                return (
                  <Tooltip key={date}>
                    <TooltipTrigger
                      render={<button type="button" />}
                      className="relative h-2.5 min-w-0 cursor-pointer overflow-hidden rounded-[2px] bg-muted outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-1"
                      data-date={date}
                      data-index={index}
                      data-conversations={count}
                      aria-label={description}
                      onClick={() => {
                        const params = new URLSearchParams({
                          user_id: userID,
                          ...memberActivityBounds(date),
                        })
                        navigate(
                          `${CONSOLE_ROUTES.conversationHistory}?${params}`
                        )
                      }}
                      tabIndex={date === format(end, "yyyy-MM-dd") ? 0 : -1}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 bg-emerald-500"
                        style={{ opacity: memberActivityOpacity(count) }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>{description}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
