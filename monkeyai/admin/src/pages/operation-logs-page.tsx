import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Loading03Icon,
  Search02Icon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { DatePickerField } from "@/components/date-picker-field"
import { api } from "@/lib/api"
import { endOfLocalDay, startOfLocalDay } from "@/lib/date-range"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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

type LogCategory =
  "model" | "identity" | "resource" | "billing" | "security" | "settings"
type LogResult = "success" | "failed"
type AuditLog = {
  id: string
  occurred_at: string
  actor_name: string
  actor_email: string | null
  action: string
  category: LogCategory
  target_type: string | null
  target_id: string | null
  request_params: Record<string, unknown>
  source_ip: string | null
  user_agent: string | null
  request_id: string | null
  error_message: string | null
  result: LogResult
}
type AuditPage = {
  items: AuditLog[]
  total: number
  page: number
  page_size: number
}
type CategoryFilter = LogCategory | null
type ResultFilter = LogResult | null
const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const CATEGORY_FILTERS: LogCategory[] = [
  "model",
  "identity",
  "resource",
  "billing",
  "security",
  "settings",
]
const RESULT_FILTERS: LogResult[] = ["success", "failed"]

export function OperationLogsPage() {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [operatorInput, setOperatorInput] = useState("")
  const [ipInput, setIpInput] = useState("")
  const [categoryInput, setCategoryInput] = useState<CategoryFilter>(null)
  const [resultInput, setResultInput] = useState<ResultFilter>(null)
  const [operatorQuery, setOperatorQuery] = useState("")
  const [ipQuery, setIpQuery] = useState("")
  const [category, setCategory] = useState<CategoryFilter>(null)
  const [result, setResult] = useState<ResultFilter>(null)
  const [revision, setRevision] = useState(0)
  const [sinceInput, setSinceInput] = useState<Date>()
  const [untilInput, setUntilInput] = useState<Date>()
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [invalidRange, setInvalidRange] = useState(false)
  const [data, setData] = useState<AuditPage>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const searchRevisionRef = useRef<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const categoryLabel = (value: LogCategory) => t(`audit.categories.${value}`)
  const resultLabel = (value: LogResult) =>
    t(`pages.operationLogs.results.${value}`)

  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  for (const [key, value] of Object.entries({
    actor: operatorQuery,
    ip: ipQuery,
    category: category ?? "",
    result: result ?? "",
    since,
    until,
  })) {
    if (value) query.set(key, value)
  }
  const path = `/api/admin/v1/audits?${query}`
  useEffect(() => {
    const controller = new AbortController()
    const isSearch = searchRevisionRef.current === revision
    if (!isSearch) {
      setLoading(true)
      setError(undefined)
    }
    api<AuditPage>(path, { signal: controller.signal })
      .then((nextData) => {
        if (controller.signal.aborted) return
        setData(nextData)
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
        if (!isSearch) setError(message)
        showToast({
          status: "error",
          title: message,
          ...(!isSearch && {
            action: {
              label: t("statistics.retry"),
              onClick: () => setRevision((value) => value + 1),
            },
          }),
        })
      })
      .finally(() => {
        if (controller.signal.aborted) return
        if (isSearch) {
          setSearching(false)
          searchRevisionRef.current = null
        } else {
          setLoading(false)
        }
      })
    return () => controller.abort()
  }, [path, revision, showToast, t])
  const total = data?.total ?? 0
  const visibleLogs = data?.items ?? []
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = page
  const pageStart = (page - 1) * pageSize
  const firstVisible = visibleLogs.length === 0 ? 0 : pageStart + 1
  const lastVisible =
    visibleLogs.length === 0 ? 0 : pageStart + visibleLogs.length
  const actionLabel = (log: AuditLog) =>
    `${t(`audit.targets.${log.target_type}`, { defaultValue: log.target_type ?? categoryLabel(log.category) })} - ${t(`audit.actions.${log.action}`, { defaultValue: log.action })}`
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const locale = i18n.resolvedLanguage ?? i18n.language
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [locale]
  )

  const applySearch = () => {
    if (loading || searching) return
    const start = sinceInput ? startOfLocalDay(sinceInput) : undefined
    const end = untilInput ? endOfLocalDay(untilInput) : undefined
    if (start && end && start > end) {
      setInvalidRange(true)
      return
    }
    setInvalidRange(false)
    setError(undefined)
    setSince(start?.toISOString() ?? "")
    setUntil(end?.toISOString() ?? "")
    const nextRevision = revision + 1
    searchRevisionRef.current = nextRevision
    setSearching(true)
    setRevision(nextRevision)
    setOperatorQuery(operatorInput)
    setIpQuery(ipInput)
    setCategory(categoryInput)
    setResult(resultInput)
    setPage(1)
  }

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      applySearch()
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <div className="flex flex-wrap items-center gap-2 px-(--card-spacing)">
            <Input
              className="w-32"
              value={operatorInput}
              onChange={(event) => setOperatorInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t(
                "pages.operationLogs.filters.operatorSearchPlaceholder"
              )}
              aria-label={t(
                "pages.operationLogs.filters.operatorSearchPlaceholder"
              )}
            />
            <Input
              className="w-32"
              value={ipInput}
              onChange={(event) => setIpInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pages.operationLogs.filters.ipSearchPlaceholder")}
              aria-label={t("pages.operationLogs.filters.ipSearchPlaceholder")}
            />
            <DatePickerField
              id="audit-start-date"
              className="w-32 sm:w-32"
              label={t("audit.since")}
              placeholder={t("audit.since")}
              locale={locale}
              value={sinceInput}
              onChange={setSinceInput}
              disabled={untilInput ? { after: untilInput } : undefined}
            />
            <DatePickerField
              id="audit-end-date"
              className="w-32 sm:w-32"
              label={t("audit.until")}
              placeholder={t("audit.until")}
              locale={locale}
              value={untilInput}
              onChange={setUntilInput}
              disabled={sinceInput ? { before: sinceInput } : undefined}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className={cn(!categoryInput && "text-muted-foreground")}
                  />
                }
              >
                {categoryInput
                  ? categoryLabel(categoryInput)
                  : t("pages.operationLogs.filters.actionType")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.actionType")}
                  </DropdownMenuLabel>
                  {CATEGORY_FILTERS.map((value) => (
                    <DropdownMenuCheckboxItem
                      key={value}
                      checked={categoryInput === value}
                      onCheckedChange={(checked) =>
                        setCategoryInput(checked ? value : null)
                      }
                    >
                      {categoryLabel(value)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    className={cn(!resultInput && "text-muted-foreground")}
                  />
                }
              >
                {resultInput
                  ? resultLabel(resultInput)
                  : t("pages.operationLogs.filters.result")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.result")}
                  </DropdownMenuLabel>
                  {RESULT_FILTERS.map((value) => (
                    <DropdownMenuCheckboxItem
                      key={value}
                      checked={resultInput === value}
                      onCheckedChange={(checked) =>
                        setResultInput(checked ? value : null)
                      }
                    >
                      {resultLabel(value)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              onClick={applySearch}
              disabled={loading || searching}
            >
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
              <p
                id="audit-range-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {t("audit.invalidRange")}
              </p>
            )}
          </div>
          {error && (
            <div className="px-(--card-spacing)">
              <Button
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("statistics.retry")}
              </Button>
            </div>
          )}
          <ScrollArea
            horizontal
            className="min-h-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={cn("min-w-4xl", !visibleLogs.length && "h-full")}
              aria-label={t("pages.operationLogs.tableTitle")}
              aria-busy={loading}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  <TableHead className="ps-(--card-spacing)">
                    {t("pages.operationLogs.columns.time")}
                  </TableHead>
                  <TableHead>
                    {t("pages.operationLogs.columns.operator")}
                  </TableHead>
                  <TableHead>
                    {t("pages.operationLogs.columns.result")}
                  </TableHead>
                  <TableHead>
                    {t("pages.operationLogs.columns.action")}
                  </TableHead>
                  <TableHead>
                    {t("pages.operationLogs.columns.ipAddress")}
                  </TableHead>
                  <TableHead className="w-px pe-(--card-spacing) whitespace-nowrap">
                    {t("pages.operationLogs.columns.operations")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={!visibleLogs.length ? "h-full" : undefined}>
                {visibleLogs.length > 0 ? (
                  visibleLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="ps-(--card-spacing)">
                        {dateFormatter.format(new Date(log.occurred_at))}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex max-w-52 items-center gap-3"
                          title={log.actor_email ?? undefined}
                        >
                          <HugeiconsIcon
                            icon={User02Icon}
                            className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="truncate">{log.actor_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.result === "success"
                              ? "secondary"
                              : "destructive"
                          }
                        >
                          {resultLabel(log.result)}
                        </Badge>
                      </TableCell>
                      <TableCell>{actionLabel(log)}</TableCell>
                      <TableCell className="font-mono">
                        {log.source_ip || "—"}
                      </TableCell>
                      <TableCell className="w-px pe-(--card-spacing) whitespace-nowrap">
                        <Dialog>
                          <DialogTrigger
                            render={
                              <Button
                                variant="outline"
                                size="xs"
                                type="button"
                              />
                            }
                          >
                            {t("pages.operationLogs.details")}
                          </DialogTrigger>
                          <DialogContent
                            className="sm:max-w-2xl"
                            closeLabel={t("common.close")}
                          >
                            <DialogHeader>
                              <DialogTitle>{t("audit.details")}</DialogTitle>
                            </DialogHeader>
                            <div className="max-h-[65vh] space-y-3 overflow-auto">
                              <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                                {[
                                  [
                                    t("pages.operationLogs.columns.time"),
                                    dateFormatter.format(
                                      new Date(log.occurred_at)
                                    ),
                                  ],
                                  [
                                    t("pages.operationLogs.columns.operator"),
                                    log.actor_email
                                      ? `${log.actor_name} (${log.actor_email})`
                                      : log.actor_name,
                                  ],
                                  [
                                    t("pages.operationLogs.columns.action"),
                                    actionLabel(log),
                                  ],
                                  [t("audit.target"), log.target_id],
                                  [
                                    t("pages.operationLogs.columns.ipAddress"),
                                    log.source_ip,
                                  ],
                                  [t("audit.userAgent"), log.user_agent],
                                  [t("audit.requestId"), log.request_id],
                                  [
                                    t("pages.operationLogs.columns.result"),
                                    resultLabel(log.result),
                                  ],
                                  [t("audit.error"), log.error_message],
                                ].map(([label, value]) => (
                                  <div key={label} className="contents">
                                    <dt className="text-muted-foreground">
                                      {label}
                                    </dt>
                                    <dd className="break-all">
                                      {value || "—"}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                              <pre className="rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
                                {JSON.stringify(log.request_params, null, 2)}
                              </pre>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={6}
                      className="h-full text-center text-muted-foreground"
                    >
                      {loading ? (
                        <span role="status">{t("resources.loading")}</span>
                      ) : error ? (
                        "—"
                      ) : (
                        t("pages.operationLogs.empty")
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
                  if (value !== null) {
                    setPageSize(Number(value))
                    setPage(1)
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
                {t("pages.operationLogs.pagination.summary", {
                  from: firstVisible,
                  to: lastVisible,
                  total,
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("pages.operationLogs.pagination.page", {
                  page: currentPage,
                  pages: pageCount,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={loading || currentPage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
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
                disabled={loading || Boolean(error) || currentPage >= pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
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
