import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  FilterHorizontalIcon,
  Loading03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays } from "date-fns"
import { useTranslation } from "react-i18next"
import { TablePagination } from "@/components/table-pagination"

import { useAppToast } from "@/components/animated-toast-provider"
import { AccountDialog } from "@/components/billing/account-dialog"
import { UserAvatar } from "@/components/user-avatar"
import { DatePickerField } from "@/components/date-picker-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuOptionsContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
  "resource_name",
  "user",
  "version",
  "enabled_sessions",
  "available_sessions",
  "used_sessions",
  "calls",
  "success_rate",
] as const
type ResourceColumn = (typeof columns)[number]

const resourceKinds = [
  "model",
  "rule",
  "skill",
  "expert",
  "connector",
  "builtin",
  "workflow",
  "agent",
  "local_mcp",
]

export function ResourceAnalysisPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [filters, setFilters] = useState<ReportWindow>(defaultWindow)
  const [startDay, setStartDay] = useState<Date>()
  const [endDay, setEndDay] = useState<Date>()
  const [showDateRange, setShowDateRange] = useState(false)
  const [kind, setKind] = useState("")
  const [knownKinds, setKnownKinds] = useState(resourceKinds)
  const [userQuery, setUserQuery] = useState("")
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  const [resourceID, setResourceID] = useState("")
  const resourceInputRef = useRef<HTMLInputElement>(null)
  const [visibleColumns, setVisibleColumns] = useState<Set<ResourceColumn>>(
    () =>
      new Set(
        columns.filter(
          (column) =>
            column !== "version" &&
            column !== "available_sessions" &&
            column !== "enabled_sessions"
        )
      )
  )
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
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const items = data?.items ?? []
  const kindOptions = Array.from(
    new Set([...knownKinds, ...(kind ? [kind] : [])])
  )

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
        setKnownKinds((current) => {
          const next = new Set(current)
          for (const item of result.items) next.add(item.kind)
          return next.size === current.length ? current : Array.from(next)
        })
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
    search(resourceID)
  }

  function search(selectedResourceID: string) {
    if (
      Boolean(startDay) !== Boolean(endDay) ||
      (startDay &&
        endDay &&
        startOfLocalDay(startDay) > startOfLocalDay(endDay))
    ) {
      setInvalidRange(true)
      setShowDateRange(true)
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
      user: userQuery.trim(),
      kind,
      resource_id: selectedResourceID.trim(),
    })
    setCursors([undefined])
    setActive(0)
    const nextRevision = revision + 1
    searchRevisionRef.current = nextRevision
    setSearching(true)
    setRevision(nextRevision)
  }

  function renderCell(row: ReportResourceRow, column: ResourceColumn) {
    if (column === "kind") return <ReportKind value={row.kind} />
    if (column === "resource_name") {
      return (
        <button
          type="button"
          title={`${t(`${key}.fields.resource_id`)}: ${row.resource_id}`}
          className="cursor-pointer rounded-sm text-start underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&:hover]:underline"
          onClick={() => {
            setResourceID(row.resource_id)
            resourceInputRef.current?.focus({ preventScroll: true })
            search(row.resource_id)
          }}
        >
          <ReportValue value={row.resource_name || row.resource_id} />
        </button>
      )
    }
    if (column === "user") {
      return (
        <button
          type="button"
          className="flex max-w-52 items-center gap-2 rounded-sm text-left underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer [&:enabled:hover_span]:underline"
          title={row.user_email || undefined}
          disabled={!row.user_id}
          onClick={() => {
            if (row.user_id) setAccountUserID(row.user_id)
          }}
        >
          <UserAvatar src={row.user_avatar_url} />
          <span className="truncate">
            {row.user_name || row.user_email || row.user_id || "—"}
          </span>
        </button>
      )
    }
    if (column === "version") return <ReportValue value={row.version} />
    if (column === "success_rate") {
      const successRate =
        row.calls > 0 ? ((row.calls - row.failed) / row.calls) * 100 : null
      return (
        <span
          className={
            successRate === null
              ? "text-muted-foreground"
              : successRate >= 95
                ? "text-green-600 dark:text-green-400"
                : successRate >= 60
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-red-600 dark:text-red-400"
          }
        >
          <ReportNumber value={successRate} suffix="%" />
        </span>
      )
    }
    return <ReportNumber value={row[column]} />
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col overflow-hidden p-4 pt-px md:h-[calc(100vh-5rem)]">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            onSubmit={applySearch}
            className="flex flex-wrap items-center gap-2 px-[var(--card-spacing)]"
          >
            {showDateRange && (
              <>
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
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    id="resource-analysis-kind"
                    type="button"
                    variant="outline"
                    className={cn(
                      "min-w-24 justify-start text-start",
                      !kind && "text-muted-foreground"
                    )}
                  />
                }
              >
                {kind ? <ReportKind value={kind} /> : t(`${key}.fields.kind`)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80">
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem
                    checked={!kind}
                    onCheckedChange={() => setKind("")}
                  >
                    {t(`${key}.all`)}
                  </DropdownMenuCheckboxItem>
                  {kindOptions.map((value) => (
                    <DropdownMenuCheckboxItem
                      key={value}
                      title={value}
                      checked={kind === value}
                      onCheckedChange={(checked) =>
                        setKind(checked ? value : "")
                      }
                    >
                      <ReportKind value={value} />
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Input
              className="w-32"
              placeholder={t(`${key}.fields.user`)}
              aria-label={t(`${key}.fields.user`)}
              maxLength={200}
              value={userQuery}
              onChange={(event) => setUserQuery(event.target.value)}
            />
            <Input
              ref={resourceInputRef}
              className="w-44"
              placeholder={t(`${key}.fields.resource_id`)}
              aria-label={t(`${key}.fields.resource_id`)}
              maxLength={256}
              value={resourceID}
              onChange={(event) => setResourceID(event.target.value)}
            />
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
                  <DropdownMenuCheckboxItem
                    checked={showDateRange}
                    onCheckedChange={setShowDateRange}
                  >
                    {t("audit.since")} – {t("audit.until")}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
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
                {t(`${key}.resources.invalidRange`)}
              </p>
            )}
          </form>
          {error && (
            <div className="px-[var(--card-spacing)]">
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
                "[&_td:first-child]:ps-[var(--card-spacing)] [&_td:last-child]:pe-[var(--card-spacing)] [&_th:first-child]:ps-[var(--card-spacing)] [&_th:last-child]:pe-[var(--card-spacing)]"
              )}
              aria-label={t(`${key}.resources.title`)}
              aria-busy={loading || searching}
            >
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  {displayedColumns.map((column) => (
                    <TableHead key={column} className="whitespace-nowrap">
                      {t(`${key}.fields.${column}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className={!items.length ? "h-full" : undefined}>
                {items.map((row) => (
                  <TableRow key={row.sort_key}>
                    {displayedColumns.map((column) => (
                      <TableCell
                        key={column}
                        className={cn(
                          "whitespace-nowrap",
                          column !== "kind" &&
                            column !== "resource_name" &&
                            column !== "user" &&
                            column !== "version" &&
                            "tabular-nums"
                        )}
                      >
                        {renderCell(row, column)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={displayedColumns.length}
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
          <TablePagination
            page={active + 1}
            pageSize={pageSize}
            itemCount={items.length}
            loading={loading || searching}
            error={Boolean(error)}
            hasNext={Boolean(data?.next_cursor)}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setCursors([undefined])
              setActive(0)
            }}
            onPrevious={() => setActive((value) => Math.max(0, value - 1))}
            onNext={() => {
              const next = data?.next_cursor
              if (!next) return
              setCursors((current) => [...current.slice(0, active + 1), next])
              setActive((value) => value + 1)
            }}
          />
        </CardContent>
      </Card>
      {accountUserID && (
        <AccountDialog
          key={accountUserID}
          userId={accountUserID}
          onClose={() => setAccountUserID(null)}
        />
      )}
    </section>
  )
}
