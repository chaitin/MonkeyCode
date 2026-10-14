import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
  Loading03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays } from "date-fns"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { ClientDistributionCards } from "@/components/client-distribution-cards"
import { DatePickerField } from "@/components/date-picker-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuOptionsContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  type ClientOverview,
  type ReportClient,
  type ReportPage,
  type ReportWindow,
} from "@/lib/session-reporting"
import { cn } from "@/lib/utils"
import {
  ReportNumber,
  ReportTime,
  ReportValue,
} from "@/pages/session-reporting-page"

type ClientColumn = Exclude<keyof ReportClient, "sort_key">
type ClientSearchField =
  | "client_type"
  | "platform"
  | "outcome"
  | "user_id"
  | "group_id"
  | "model_id"
  | "expert_id"

const key = "pages.sessionReporting"
const columns: ClientColumn[] = [
  "client_type",
  "platform",
  "os_version",
  "client_version",
  "engine_version",
  "runtime_version",
  "locale",
  "timezone",
  "sessions",
  "turns",
  "interrupted",
  "completion_rate",
  "anomaly_rate",
  "p95_duration_seconds",
  "last_active_at",
]
const defaultColumns: ClientColumn[] = [
  "client_type",
  "platform",
  "os_version",
  "client_version",
]
const searchFields: ClientSearchField[] = [
  "client_type",
  "platform",
  "outcome",
  "user_id",
  "group_id",
  "model_id",
  "expert_id",
]
const selectValues = {
  client_type: ["desktop", "web", "extension", "mobile", "unknown"],
  platform: ["macos", "windows", "linux", "ios", "android", "web"],
  outcome: [
    "complete",
    "interrupted",
    "error",
    "max_turns",
    "output_limit",
    "unknown",
  ],
}
const pageSizes = ["20", "50", "100"]

export function ClientAnalysisPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [filters, setFilters] = useState<ReportWindow>(defaultWindow)
  const [draft, setDraft] = useState<ReportWindow>(filters)
  const [startDay, setStartDay] = useState<Date>()
  const [endDay, setEndDay] = useState<Date>()
  const [visibleFields, setVisibleFields] = useState<Set<ClientSearchField>>(
    () => new Set(["client_type"])
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<ClientColumn>>(
    () => new Set(defaultColumns)
  )
  const [invalidRange, setInvalidRange] = useState(false)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [active, setActive] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [revision, setRevision] = useState(0)
  const [listRetry, setListRetry] = useState(0)
  const [overviewRetry, setOverviewRetry] = useState(0)
  const [overviewResponse, setOverviewResponse] = useState<{
    key: string
    data?: ClientOverview
    error?: string
  }>()
  const searchRevisionRef = useRef<number | null>(null)
  const [data, setData] = useState<ReportPage<ReportClient>>()
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string>()
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const items = data?.items ?? []
  const pageStart = active * pageSize
  const from = items.length ? pageStart + 1 : 0
  const to = items.length ? pageStart + items.length : 0
  const pageSizeItems = pageSizes.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const path = `${reportPaths.clients}${reportQuery(filters, cursors[active])}&limit=${pageSize}`
  const overviewPath = `${reportPaths.clientsOverview}${reportQuery(filters)}`
  const overviewKey = `${overviewPath}:${revision}:${overviewRetry}`
  const overviewLoading = overviewResponse?.key !== overviewKey
  const overview = overviewLoading ? undefined : overviewResponse.data
  const overviewError = overviewLoading ? undefined : overviewResponse.error
  const searchBusy = searching || (revision > 0 && overviewLoading)

  useEffect(() => {
    const controller = new AbortController()
    api<ClientOverview>(overviewPath, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          setOverviewResponse({ key: overviewKey, data: result })
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setOverviewResponse({
            key: overviewKey,
            error: reason instanceof Error ? reason.message : String(reason),
          })
        }
      })
    return () => controller.abort()
  }, [overviewPath, overviewKey])

  useEffect(() => {
    const controller = new AbortController()
    const isSearch = searchRevisionRef.current === revision
    if (!isSearch) {
      setLoading(true)
      setError(undefined)
    }
    api<ReportPage<ReportClient>>(path, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((result) => {
        if (controller.signal.aborted) return
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
        if (controller.signal.aborted) return
        const message =
          reason instanceof Error ? reason.message : String(reason)
        setError(message)
        showToast({
          status: "error",
          title: message,
          ...(!isSearch && {
            action: {
              label: t("statistics.retry"),
              onClick: () => setListRetry((value) => value + 1),
            },
          }),
        })
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setLoading(false)
        if (isSearch) {
          setSearching(false)
          searchRevisionRef.current = null
        }
      })
    return () => controller.abort()
  }, [path, revision, listRetry, showToast, t])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || searchBusy || overviewLoading) return
    if (
      Boolean(startDay) !== Boolean(endDay) ||
      (startDay &&
        endDay &&
        startOfLocalDay(startDay) > startOfLocalDay(endDay))
    ) {
      setInvalidRange(true)
      return
    }
    setInvalidRange(false)
    setError(undefined)
    const timeWindow = defaultWindow()
    setFilters({
      ...draft,
      from: startDay
        ? startOfLocalDay(startDay).toISOString()
        : timeWindow.from,
      until: endDay
        ? startOfLocalDay(addDays(endDay, 1)).toISOString()
        : timeWindow.until,
    })
    setCursors([undefined])
    setActive(0)
    const nextRevision = revision + 1
    searchRevisionRef.current = nextRevision
    setSearching(true)
    setRevision(nextRevision)
  }

  function renderCell(row: ReportClient, column: ClientColumn) {
    if (column === "last_active_at")
      return <ReportTime value={row.last_active_at} />
    if (column === "completion_rate" || column === "anomaly_rate") {
      return <ReportNumber value={row[column]} suffix="%" />
    }
    if (column === "p95_duration_seconds") {
      return <ReportNumber value={row[column]} suffix="s" />
    }
    return <ReportValue value={row[column]} />
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-px lg:h-[calc(100svh-5rem)] lg:flex-none lg:overflow-hidden">
      <ClientDistributionCards
        data={overview}
        loading={overviewLoading}
        error={overviewError}
        onRetry={() => setOverviewRetry((value) => value + 1)}
      />
      <Card className="h-[32rem] min-h-0 flex-none lg:h-auto lg:flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            onSubmit={applySearch}
            className="flex flex-wrap items-center gap-2 px-(--card-spacing)"
          >
            <DatePickerField
              id="client-analysis-from"
              className="w-32 sm:w-32"
              label={t("audit.since")}
              placeholder={t("audit.since")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              value={startDay}
              onChange={setStartDay}
              disabled={endDay ? { after: endDay } : undefined}
            />
            <DatePickerField
              id="client-analysis-until"
              className="w-32 sm:w-32"
              label={t("audit.until")}
              placeholder={t("audit.until")}
              locale={i18n.resolvedLanguage ?? i18n.language}
              value={endDay}
              onChange={setEndDay}
              disabled={startDay ? { before: startDay } : undefined}
            />
            {visibleFields.has("client_type") && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      className={cn(
                        !draft.client_type && "text-muted-foreground"
                      )}
                    />
                  }
                >
                  {draft.client_type || t(`${key}.fields.client_type`)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t(`${key}.fields.client_type`)}
                    </DropdownMenuLabel>
                    {selectValues.client_type.map((value) => (
                      <DropdownMenuCheckboxItem
                        key={value}
                        checked={draft.client_type === value}
                        onCheckedChange={(checked) =>
                          setDraft((current) => ({
                            ...current,
                            client_type: checked ? value : "",
                          }))
                        }
                      >
                        {value}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {(["platform", "outcome"] as const).map(
              (field) =>
                visibleFields.has(field) && (
                  <Select
                    key={field}
                    value={draft[field] || "__all__"}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        [field]: value === "__all__" ? "" : (value ?? ""),
                      }))
                    }
                  >
                    <SelectTrigger
                      aria-label={t(`${key}.fields.${field}`)}
                      className="min-w-32"
                    >
                      <SelectValue placeholder={t(`${key}.fields.${field}`)} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">
                        {t(`${key}.fields.${field}`)}
                      </SelectItem>
                      {selectValues[field].map((option) => (
                        <SelectItem key={option} value={option}>
                          {field === "outcome"
                            ? t(`${key}.outcomes.${option}`)
                            : option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
            )}
            {(["user_id", "group_id", "model_id", "expert_id"] as const).map(
              (field) =>
                visibleFields.has(field) && (
                  <Input
                    key={field}
                    className="w-40"
                    pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
                    placeholder={t(`${key}.fields.${field}`)}
                    aria-label={t(`${key}.fields.${field}`)}
                    value={draft[field] ?? ""}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field]: event.target.value.trim(),
                      }))
                    }
                  />
                )
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" />}
              >
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  data-icon="inline-start"
                />
                {t("common.more")}
              </DropdownMenuTrigger>
              <DropdownMenuOptionsContent align="start">
                <DropdownMenuGroup>
                  {searchFields.map((field) => (
                    <DropdownMenuCheckboxItem
                      key={field}
                      checked={visibleFields.has(field)}
                      onCheckedChange={(checked) =>
                        setVisibleFields((current) => {
                          const next = new Set(current)
                          if (checked) next.add(field)
                          else next.delete(field)
                          return next
                        })
                      }
                    >
                      {t(`${key}.fields.${field}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
            <Button
              type="submit"
              disabled={loading || searchBusy || overviewLoading}
            >
              <HugeiconsIcon
                icon={searchBusy ? Loading03Icon : Search02Icon}
                data-icon="inline-start"
                className={
                  searchBusy
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
              />
              {t("pages.operationLogs.filters.search")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="ms-auto" />
                }
              >
                {t(`${key}.clients.selectColumns`)}
              </DropdownMenuTrigger>
              <DropdownMenuOptionsContent align="end" className="max-h-80">
                <DropdownMenuGroup>
                  {columns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column}
                      checked={visibleColumns.has(column)}
                      onCheckedChange={(checked) =>
                        setVisibleColumns((current) => {
                          if (!checked && current.size === 1) return current
                          const next = new Set(current)
                          if (checked) next.add(column)
                          else next.delete(column)
                          return next
                        })
                      }
                    >
                      {t(`${key}.fields.${column}`)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
            {invalidRange && (
              <p role="alert" className="text-sm text-destructive">
                {t(`${key}.invalidFilter`)}
              </p>
            )}
          </form>
          {error && (
            <div className="px-(--card-spacing)">
              <Button
                variant="outline"
                onClick={() => setListRetry((value) => value + 1)}
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
              aria-label={t(`${key}.clients.title`)}
              aria-busy={loading || searching}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  {displayedColumns.map((column) => (
                    <TableHead key={column} className="whitespace-nowrap">
                      {t(`${key}.fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length ? (
                  items.map((row) => (
                    <TableRow key={row.sort_key}>
                      {displayedColumns.map((column) => (
                        <TableCell
                          key={column}
                          className={cn(
                            "whitespace-nowrap",
                            column === "last_active_at" &&
                              "text-muted-foreground"
                          )}
                        >
                          {renderCell(row, column)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={displayedColumns.length}
                      className="h-full text-center text-muted-foreground"
                    >
                      {loading ? (
                        <span role="status">{t("statistics.loading")}</span>
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
