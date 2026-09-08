import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { api } from "@/lib/api"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
type CategoryFilter = "all" | LogCategory
type ResultFilter = "all" | LogResult
const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "model",
  "identity",
  "resource",
  "billing",
  "security",
  "settings",
]
const RESULT_FILTERS: ResultFilter[] = ["all", "success", "failed"]

export function OperationLogsPage() {
  const { i18n, t } = useTranslation()
  const [operatorInput, setOperatorInput] = useState("")
  const [ipInput, setIpInput] = useState("")
  const [requestParamsInput, setRequestParamsInput] = useState("")
  const [categoryInput, setCategoryInput] = useState<CategoryFilter>("all")
  const [resultInput, setResultInput] = useState<ResultFilter>("all")
  const [operatorQuery, setOperatorQuery] = useState("")
  const [ipQuery, setIpQuery] = useState("")
  const [requestParamsQuery, setRequestParamsQuery] = useState("")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [result, setResult] = useState<ResultFilter>("all")
  const [revision, setRevision] = useState(0)
  const [sinceInput, setSinceInput] = useState("")
  const [untilInput, setUntilInput] = useState("")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [invalidRange, setInvalidRange] = useState(false)
  const [loaded, setLoaded] = useState<{
    path: string
    revision: number
    data?: AuditPage
    error?: string
  }>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const categoryLabel = (value: CategoryFilter) =>
    value === "all"
      ? t("pages.operationLogs.filters.allActions")
      : t(`audit.categories.${value}`)
  const resultLabel = (value: ResultFilter) =>
    value === "all"
      ? t("pages.operationLogs.filters.allResults")
      : t(`pages.operationLogs.results.${value}`)

  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  })
  for (const [key, value] of Object.entries({
    actor: operatorQuery,
    ip: ipQuery,
    params: requestParamsQuery,
    category: category === "all" ? "" : category,
    result: result === "all" ? "" : result,
    since,
    until,
  })) {
    if (value) query.set(key, value)
  }
  const path = `/api/admin/v1/audits?${query}`
  useEffect(() => {
    const controller = new AbortController()
    api<AuditPage>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ path, revision, data })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({
            path,
            revision,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => controller.abort()
  }, [path, revision])
  const current =
    loaded?.path === path && loaded.revision === revision ? loaded : undefined
  const loading = !current
  const error = current?.error
  const total = current?.data?.total ?? 0
  const visibleLogs = current?.data?.items ?? []
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = page
  const pageStart = (page - 1) * pageSize
  const firstVisible = visibleLogs.length === 0 ? 0 : pageStart + 1
  const lastVisible =
    visibleLogs.length === 0 ? 0 : pageStart + visibleLogs.length
  const actionLabel = (log: AuditLog) =>
    `${t(`audit.actions.${log.action}`, { defaultValue: log.action })} · ${t(`audit.targets.${log.target_type}`, { defaultValue: log.target_type ?? categoryLabel(log.category) })}`
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [i18n.language]
  )

  const updateCategory = (value: string) => {
    setCategoryInput(value as CategoryFilter)
  }

  const updateResult = (value: string) => {
    setResultInput(value as ResultFilter)
  }

  const applySearch = () => {
    const start = sinceInput ? new Date(sinceInput) : undefined
    const end = untilInput ? new Date(untilInput) : undefined
    if (
      (start && !Number.isFinite(start.getTime())) ||
      (end && !Number.isFinite(end.getTime())) ||
      (start && end && start >= end)
    ) {
      setInvalidRange(true)
      return
    }
    setInvalidRange(false)
    setSince(start?.toISOString() ?? "")
    setUntil(end?.toISOString() ?? "")
    setRevision((value) => value + 1)
    setOperatorQuery(operatorInput)
    setIpQuery(ipInput)
    setRequestParamsQuery(requestParamsInput)
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
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-0">
      <Card>
        <CardContent className="gap-4 px-0">
          <div className="flex flex-wrap items-center gap-2 px-(--card-spacing)">
            <Input
              className="w-48"
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
              className="w-48"
              value={ipInput}
              onChange={(event) => setIpInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("pages.operationLogs.filters.ipSearchPlaceholder")}
              aria-label={t("pages.operationLogs.filters.ipSearchPlaceholder")}
            />
            <Input
              className="w-48"
              value={requestParamsInput}
              onChange={(event) => setRequestParamsInput(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t(
                "pages.operationLogs.filters.requestParamsSearchPlaceholder"
              )}
              aria-label={t(
                "pages.operationLogs.filters.requestParamsSearchPlaceholder"
              )}
            />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {categoryLabel(categoryInput)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.actionType")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={categoryInput}
                    onValueChange={updateCategory}
                  >
                    {CATEGORY_FILTERS.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {categoryLabel(value)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                {resultLabel(resultInput)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    {t("pages.operationLogs.filters.result")}
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={resultInput}
                    onValueChange={updateResult}
                  >
                    {RESULT_FILTERS.map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {resultLabel(value)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" onClick={applySearch}>
              <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
              {t("pages.operationLogs.filters.search")}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-(--card-spacing)">
            <label className="flex items-center gap-2 text-sm">
              {t("audit.since")}
              <Input
                type="datetime-local"
                className="w-auto"
                value={sinceInput}
                onChange={(event) => setSinceInput(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-invalid={invalidRange}
                aria-describedby={
                  invalidRange ? "audit-range-error" : undefined
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              {t("audit.until")}
              <Input
                type="datetime-local"
                className="w-auto"
                value={untilInput}
                onChange={(event) => setUntilInput(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                aria-invalid={invalidRange}
                aria-describedby={
                  invalidRange ? "audit-range-error" : undefined
                }
              />
            </label>
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
            <div
              role="alert"
              className="flex items-center gap-3 px-(--card-spacing) text-sm text-destructive"
            >
              {error}
              <Button
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                {t("statistics.retry")}
              </Button>
            </div>
          )}
          <Table
            className="min-w-4xl"
            aria-label={t("pages.operationLogs.tableTitle")}
            aria-busy={loading}
          >
            <TableHeader>
              <TableRow>
                <TableHead className="ps-(--card-spacing)">
                  {t("pages.operationLogs.columns.time")}
                </TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.operator")}
                </TableHead>
                <TableHead>{t("pages.operationLogs.columns.action")}</TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.requestParams")}
                </TableHead>
                <TableHead>
                  {t("pages.operationLogs.columns.ipAddress")}
                </TableHead>
                <TableHead className="pe-(--card-spacing)">
                  {t("pages.operationLogs.columns.result")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLogs.length > 0 ? (
                visibleLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="ps-(--card-spacing) text-muted-foreground">
                      {dateFormatter.format(new Date(log.occurred_at))}
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex max-w-52 items-center gap-3"
                        title={log.actor_email ?? undefined}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback>
                            {log.actor_name.slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">
                          {log.actor_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span>{actionLabel(log)}</span>
                      {log.target_id && (
                        <div
                          className="max-w-52 truncate font-mono text-xs text-muted-foreground"
                          title={log.target_id}
                        >
                          {log.target_id}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="sm"
                              className="max-w-80 justify-start font-mono text-xs"
                            />
                          }
                          aria-label={t("audit.details")}
                        >
                          <span className="truncate">
                            {JSON.stringify(log.request_params)}
                          </span>
                        </DialogTrigger>
                        <DialogContent
                          className="sm:max-w-2xl"
                          closeLabel={t("common.close")}
                        >
                          <DialogHeader>
                            <DialogTitle>{t("audit.details")}</DialogTitle>
                            <DialogDescription>
                              {dateFormatter.format(new Date(log.occurred_at))}{" "}
                              · {log.actor_name} · {actionLabel(log)}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="max-h-[65vh] space-y-3 overflow-auto">
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                              {[
                                [t("audit.target"), log.target_id],
                                [
                                  t("pages.operationLogs.columns.operator"),
                                  log.actor_email,
                                ],
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
                                  <dd className="break-all">{value || "—"}</dd>
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
                    <TableCell className="font-mono text-muted-foreground">
                      {log.source_ip || "—"}
                    </TableCell>
                    <TableCell className="pe-(--card-spacing)">
                      <Badge
                        variant={
                          log.result === "success" ? "secondary" : "destructive"
                        }
                      >
                        {resultLabel(log.result)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-40 text-center text-muted-foreground"
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
                  icon={ArrowLeft02Icon}
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
