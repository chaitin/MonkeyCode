import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Loading03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays } from "date-fns"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { DatePickerField } from "@/components/date-picker-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api } from "@/lib/api"
import { startOfLocalDay } from "@/lib/date-range"
import {
  defaultWindow,
  reportPaths,
  reportQuery,
  type ReportPage,
  type ReportResourceRow,
  type ReportWindow,
} from "@/lib/session-reporting"
import { cn } from "@/lib/utils"
import {
  ReportKind,
  ReportNumber,
  ReportValue,
} from "@/pages/session-reporting-page"

const key = "pages.sessionReporting"
const columns = [
  "kind",
  "resource_id",
  "version",
  "enabled_sessions",
  "available_sessions",
  "used_sessions",
  "calls",
  "failure_rate",
] as const
const pageSizes = ["20", "50", "100"]

export function ResourceAnalysisPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [filters, setFilters] = useState<ReportWindow>(defaultWindow)
  const [startDay, setStartDay] = useState<Date>()
  const [endDay, setEndDay] = useState<Date>()
  const [userID, setUserID] = useState("")
  const [invalidRange, setInvalidRange] = useState(false)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [active, setActive] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [revision, setRevision] = useState(0)
  const searchRevisionRef = useRef<number | null>(null)
  const [data, setData] = useState<ReportPage<ReportResourceRow>>()
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string>()
  const items = data?.items ?? []
  const from = items.length ? active * pageSize + 1 : 0
  const to = items.length ? active * pageSize + items.length : 0
  const pageSizeItems = pageSizes.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const path = `${reportPaths.resources}${reportQuery(filters, cursors[active])}&limit=${pageSize}`

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 20_000)
    const isSearch = searchRevisionRef.current === revision
    if (!isSearch) {
      setLoading(true)
      setError(undefined)
    }
    api<ReportPage<ReportResourceRow>>(path, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((result) => {
        if (disposed || timedOut) return
        setData(result)
        setError(undefined)
        if (isSearch) {
          showToast({
            status: "success",
            title: t("pages.operationLogs.filters.searchSuccess"),
          })
        }
      })
      .catch((reason: unknown) => {
        if (disposed) return
        const message = timedOut
          ? t(`${key}.errors.timeout`)
          : reason instanceof Error
            ? reason.message
            : String(reason)
        setError(message)
        showToast({ status: "error", title: message })
      })
      .finally(() => {
        clearTimeout(timeout)
        if (disposed) return
        setLoading(false)
        if (isSearch) {
          setSearching(false)
          searchRevisionRef.current = null
        }
      })
    return () => {
      disposed = true
      clearTimeout(timeout)
      controller.abort()
    }
  }, [path, revision, showToast, t])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || searching) return
    if (
      Boolean(startDay) !== Boolean(endDay) ||
      (startDay &&
        endDay &&
        startOfLocalDay(startDay) > startOfLocalDay(endDay))
    ) {
      setInvalidRange(true)
      return
    }
    const timeWindow = defaultWindow()
    setInvalidRange(false)
    setError(undefined)
    setFilters({
      from: startDay
        ? startOfLocalDay(startDay).toISOString()
        : timeWindow.from,
      until: endDay
        ? startOfLocalDay(addDays(endDay, 1)).toISOString()
        : timeWindow.until,
      user_id: userID.trim(),
    })
    setCursors([undefined])
    setActive(0)
    const nextRevision = revision + 1
    searchRevisionRef.current = nextRevision
    setSearching(true)
    setRevision(nextRevision)
  }

  return (
    <section className="flex h-[calc(100svh-4rem)] min-h-0 flex-none flex-col overflow-hidden p-4 pt-px md:h-[calc(100svh-5rem)]">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            onSubmit={applySearch}
            className="flex flex-wrap items-center gap-2 px-(--card-spacing)"
          >
            <DatePickerField
              id="resource-analysis-from"
              className="w-32 sm:w-32"
              label={t("audit.since")}
              placeholder={t("audit.since")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              value={startDay}
              onChange={setStartDay}
              disabled={endDay ? { after: endDay } : undefined}
            />
            <DatePickerField
              id="resource-analysis-until"
              className="w-32 sm:w-32"
              label={t("audit.until")}
              placeholder={t("audit.until")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              value={endDay}
              onChange={setEndDay}
              disabled={startDay ? { before: startDay } : undefined}
            />
            <Input
              className="w-44"
              placeholder={t(`${key}.fields.user_id`)}
              aria-label={t(`${key}.fields.user_id`)}
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              value={userID}
              onChange={(event) => setUserID(event.target.value.trim())}
            />
            <Button type="submit" disabled={loading || searching}>
              <HugeiconsIcon
                icon={searching ? Loading03Icon : Search02Icon}
                data-icon="inline-start"
                className={
                  searching
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {t("pages.operationLogs.filters.search")}
            </Button>
            {invalidRange && (
              <p role="alert" className="text-sm text-destructive">
                {t(`${key}.resources.invalidRange`)}
              </p>
            )}
          </form>
          {error && (
            <div className="px-(--card-spacing)">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("statistics.retry")}
              </Button>
            </div>
          )}
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={cn(
                !items.length && "h-full",
                "[&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)"
              )}
              aria-label={t(`${key}.resources.title`)}
              aria-busy={loading || searching}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column} className="whitespace-nowrap">
                      {t(`${key}.fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className={!items.length ? "h-full" : undefined}>
                {items.map((row) => (
                  <TableRow key={row.sort_key}>
                    <TableCell className="whitespace-nowrap">
                      <ReportKind value={row.kind} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ReportValue value={row.resource_id} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <ReportValue value={row.version} />
                    </TableCell>
                    {[
                      row.enabled_sessions,
                      row.available_sessions,
                      row.used_sessions,
                      row.calls,
                    ].map((value, index) => (
                      <TableCell
                        key={index}
                        className="whitespace-nowrap tabular-nums"
                      >
                        <ReportNumber value={value} />
                      </TableCell>
                    ))}
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <ReportNumber value={row.failure_rate} suffix="%" />
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={columns.length}
                      className="h-full text-center text-muted-foreground"
                    >
                      {loading || searching ? (
                        <span
                          role="status"
                          aria-label={t("statistics.loading")}
                        >
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            className="mx-auto animate-spin motion-reduce:animate-none"
                            size={20}
                            aria-hidden="true"
                          />
                        </span>
                      ) : error ? (
                        "—"
                      ) : (
                        t("statistics.empty")
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
          <div className="flex flex-wrap items-center justify-between gap-3 px-(--card-spacing)">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                items={pageSizeItems}
                value={String(pageSize)}
                onValueChange={(value) => {
                  if (value !== null && Number(value) !== pageSize) {
                    setPageSize(Number(value))
                    setCursors([undefined])
                    setActive(0)
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("pages.operationLogs.pagination.pageSizeLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="start">
                  <SelectGroup>
                    {pageSizeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {t(`${key}.clients.cursorSummary`, { from, to })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t(`${key}.clients.cursorPage`, { page: active + 1 })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={loading || searching || active === 0}
                onClick={() => setActive((value) => value - 1)}
                aria-label={t("pages.operationLogs.pagination.previous")}
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  className="rtl:rotate-180"
                />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={
                  loading || searching || Boolean(error) || !data?.next_cursor
                }
                onClick={() => {
                  if (!data?.next_cursor) return
                  setCursors((current) => [
                    ...current.slice(0, active + 1),
                    data.next_cursor ?? undefined,
                  ])
                  setActive((value) => value + 1)
                }}
                aria-label={t("pages.operationLogs.pagination.next")}
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="rtl:rotate-180"
                />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
