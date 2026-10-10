import { useEffect, useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Search02Icon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays, startOfDay } from "date-fns"
import { useTranslation } from "react-i18next"

import { useStatistics } from "@/hooks/use-statistics"
import { StatisticsFeedback } from "@/components/statistics-feedback"
import { DatePickerField } from "@/components/date-picker-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
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

type TaskHistoryEntry = {
  id: string
  title: string
  user_name: string
  user_email: string
  started_at: string
  last_active_at: string
  turn_count: number
}

type TaskHistory = {
  items: TaskHistoryEntry[]
  total: number
  page: number
  page_size: number
}

type TaskHistoryFilters = {
  taskName: string
  userName: string
  startTime: Date | undefined
  endTime: Date | undefined
}

const DEFAULT_PAGE_SIZE = 50
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const EMPTY_FILTERS: TaskHistoryFilters = {
  taskName: "",
  userName: "",
  startTime: undefined,
  endTime: undefined,
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number, string, string][] =
  [
    ["year", 365 * 86_400_000, "年", "年"],
    ["month", 30 * 86_400_000, "个月", "個月"],
    ["day", 86_400_000, "天", "天"],
    ["hour", 3_600_000, "小时", "小時"],
    ["minute", 60_000, "分钟", "分鐘"],
  ]

function formatLastActivity(
  value: string,
  now: number,
  locale: string,
  formatter: Intl.RelativeTimeFormat
) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "—"

  const elapsed = Math.max(0, now - timestamp)
  const isChinese = locale.startsWith("zh")
  const isTraditional = locale.toLowerCase().startsWith("zh-tw")
  if (elapsed < 60_000)
    return isChinese
      ? isTraditional
        ? "剛剛"
        : "刚刚"
      : formatter.format(0, "second")

  const [unit, duration, simplified, traditional] = RELATIVE_UNITS.find(
    ([, duration]) => elapsed >= duration
  ) ?? ["minute", 60_000, "分钟", "分鐘"]
  const count = Math.max(1, Math.floor(elapsed / duration))
  if (isChinese) {
    return `${count} ${isTraditional ? traditional : simplified}前`
  }
  return formatter.format(-count, unit)
}

export function TaskHistoryPage() {
  const { i18n, t } = useTranslation()
  const [filterInput, setFilterInput] =
    useState<TaskHistoryFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<TaskHistoryFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [now, setNow] = useState(() => Date.now())
  const locale = i18n.resolvedLanguage ?? i18n.language

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const query = new URLSearchParams({
    task: filters.taskName,
    user: filters.userName,
    page: String(page),
    page_size: String(pageSize),
  })
  if (filters.startTime)
    query.set("from", startOfDay(filters.startTime).toISOString())
  if (filters.endTime)
    query.set("until", startOfDay(addDays(filters.endTime, 1)).toISOString())
  const request = useStatistics<TaskHistory>(
    `/api/admin/v1/statistics/history?${query}`
  )
  const total = request.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = request.data?.page ?? page
  const pageStart = (currentPage - 1) * pageSize
  const visibleTasks = request.data?.items ?? []
  const firstVisible = visibleTasks.length === 0 ? 0 : pageStart + 1
  const lastVisible =
    visibleTasks.length === 0 ? 0 : pageStart + visibleTasks.length
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const relativeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
    [locale]
  )
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
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const resetPage = () => setPage(1)
  const updateTextFilterInput = (
    key: "taskName" | "userName",
    value: string
  ) => {
    setFilterInput((current) => ({ ...current, [key]: value }))
  }
  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFilters(filterInput)
    request.reload()
    resetPage()
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <StatisticsFeedback {...request} />
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form onSubmit={applySearch} className="px-(--card-spacing)">
            <FieldGroup className="flex-row flex-wrap items-end gap-3">
              <Field className="sm:w-56">
                <FieldLabel
                  htmlFor="task-history-task-name"
                  className="sr-only"
                >
                  {t("pages.taskHistory.filters.taskName")}
                </FieldLabel>
                <Input
                  id="task-history-task-name"
                  value={filterInput.taskName}
                  onChange={(event) =>
                    updateTextFilterInput("taskName", event.target.value)
                  }
                  placeholder={t(
                    "pages.taskHistory.filters.taskNamePlaceholder"
                  )}
                />
              </Field>
              <Field className="sm:w-56">
                <FieldLabel
                  htmlFor="task-history-user-name"
                  className="sr-only"
                >
                  {t("pages.taskHistory.filters.userName")}
                </FieldLabel>
                <Input
                  id="task-history-user-name"
                  value={filterInput.userName}
                  onChange={(event) =>
                    updateTextFilterInput("userName", event.target.value)
                  }
                  placeholder={t(
                    "pages.taskHistory.filters.userNamePlaceholder"
                  )}
                />
              </Field>
              <DatePickerField
                id="task-history-start-time"
                label={t("pages.taskHistory.filters.startTime")}
                placeholder={t("pages.taskHistory.filters.startTime")}
                locale={locale}
                value={filterInput.startTime}
                onChange={(value) =>
                  setFilterInput((current) => ({
                    ...current,
                    startTime: value,
                  }))
                }
                disabled={
                  filterInput.endTime
                    ? { after: filterInput.endTime }
                    : undefined
                }
              />
              <DatePickerField
                id="task-history-end-time"
                label={t("pages.taskHistory.filters.endTime")}
                placeholder={t("pages.taskHistory.filters.endTime")}
                locale={locale}
                value={filterInput.endTime}
                onChange={(value) =>
                  setFilterInput((current) => ({
                    ...current,
                    endTime: value,
                  }))
                }
                disabled={
                  filterInput.startTime
                    ? { before: filterInput.startTime }
                    : undefined
                }
              />
              <Field className="sm:w-auto">
                <FieldLabel className="sr-only">
                  {t("pages.taskHistory.filters.search")}
                </FieldLabel>
                <Button type="submit" className="w-full xl:w-auto">
                  <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
                  {t("pages.taskHistory.filters.search")}
                </Button>
              </Field>
            </FieldGroup>
          </form>
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={
                !visibleTasks.length ? "h-full min-w-3xl" : "min-w-3xl"
              }
              aria-label={t("pages.taskHistory.title")}
              aria-busy={request.loading}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  <TableHead className="ps-(--card-spacing)">
                    {t("pages.taskHistory.columns.startedAt")}
                  </TableHead>
                  <TableHead>{t("pages.taskHistory.columns.user")}</TableHead>
                  <TableHead>{t("pages.taskHistory.columns.task")}</TableHead>
                  <TableHead className="text-end">
                    {t("pages.taskHistory.columns.conversationCount")}
                  </TableHead>
                  <TableHead className="pe-(--card-spacing) text-end">
                    {t("pages.taskHistory.columns.lastActiveAt")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody
                className={!visibleTasks.length ? "h-full" : undefined}
              >
                {visibleTasks.length > 0 ? (
                  visibleTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="ps-(--card-spacing) text-muted-foreground">
                        {dateFormatter.format(new Date(task.started_at))}
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex max-w-52 items-center gap-3"
                          title={task.user_email}
                        >
                          <HugeiconsIcon
                            icon={User02Icon}
                            className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="truncate">{task.user_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-72">
                          <span className="block truncate" title={task.title}>
                            {task.title}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {numberFormatter.format(task.turn_count)}
                      </TableCell>
                      <TableCell
                        className="pe-(--card-spacing) text-end whitespace-nowrap text-muted-foreground"
                        title={dateFormatter.format(
                          new Date(task.last_active_at)
                        )}
                      >
                        {formatLastActivity(
                          task.last_active_at,
                          now,
                          locale,
                          relativeFormatter
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={5}
                      className="h-full text-center text-muted-foreground"
                    >
                      {request.loading
                        ? t("statistics.loading")
                        : request.error
                          ? "—"
                          : t("pages.taskHistory.empty")}
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
                    resetPage()
                  }
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("pages.operationLogs.pagination.pageSizeLabel")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
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
                disabled={
                  request.loading || !!request.error || currentPage === 1
                }
                onClick={() => setPage(Math.max(1, currentPage - 1))}
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
                disabled={
                  request.loading || !!request.error || currentPage >= pageCount
                }
                onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
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
