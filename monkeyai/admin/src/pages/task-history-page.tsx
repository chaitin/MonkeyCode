import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays, startOfDay } from "date-fns"
import {
  ar,
  de,
  enUS,
  es,
  fr,
  ja,
  ko,
  ru,
  zhCN,
  zhTW,
  type Locale,
} from "date-fns/locale"
import { useTranslation } from "react-i18next"

import { useStatistics } from "@/hooks/use-statistics"
import { StatisticsFeedback } from "@/components/statistics-feedback"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const EMPTY_FILTERS: TaskHistoryFilters = {
  taskName: "",
  userName: "",
  startTime: undefined,
  endTime: undefined,
}

const DATE_LOCALES: Record<string, Locale> = {
  ar,
  de,
  en: enUS,
  es,
  fr,
  ja,
  ko,
  ru,
  zh: zhCN,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
}

type DatePickerFieldProps = {
  id: string
  label: string
  placeholder: string
  locale: string
  calendarLocale: Locale
  value: Date | undefined
  onChange: (value: Date | undefined) => void
  disabled?: React.ComponentProps<typeof Calendar>["disabled"]
}

function DatePickerField({
  id,
  label,
  placeholder,
  locale,
  calendarLocale,
  value,
  onChange,
  disabled,
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false)
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale]
  )

  return (
    <Field className="sm:w-48">
      <FieldLabel htmlFor={id} className="sr-only">
        {label}
      </FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              className="w-full justify-start px-2.5 font-normal"
            />
          }
        >
          <HugeiconsIcon icon={Calendar03Icon} data-icon="inline-start" />
          {value ? formatter.format(value) : placeholder}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            defaultMonth={value}
            onSelect={(date) => {
              onChange(date)
              if (date) setOpen(false)
            }}
            disabled={disabled}
            locale={calendarLocale}
            captionLayout="dropdown"
          />
        </PopoverContent>
      </Popover>
    </Field>
  )
}

export function TaskHistoryPage() {
  const { i18n, t } = useTranslation()
  const [filterInput, setFilterInput] =
    useState<TaskHistoryFilters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<TaskHistoryFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const locale = i18n.resolvedLanguage ?? i18n.language
  const language = locale.split("-")[0]
  const calendarLocale = DATE_LOCALES[locale] ?? DATE_LOCALES[language] ?? enUS

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
  const firstVisible = total === 0 ? 0 : pageStart + 1
  const lastVisible = Math.min(pageStart + pageSize, total)
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
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
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-0">
      <StatisticsFeedback {...request} />
      <Card>
        <CardContent className="gap-4 px-0">
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
                calendarLocale={calendarLocale}
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
                calendarLocale={calendarLocale}
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
          <Table className="min-w-3xl">
            <TableHeader>
              <TableRow>
                <TableHead className="ps-(--card-spacing)">
                  {t("pages.taskHistory.columns.task")}
                </TableHead>
                <TableHead>{t("pages.taskHistory.columns.user")}</TableHead>
                <TableHead>
                  {t("pages.taskHistory.columns.startedAt")}
                </TableHead>
                <TableHead>
                  {t("pages.taskHistory.columns.lastActiveAt")}
                </TableHead>
                <TableHead className="pe-(--card-spacing) text-end">
                  {t("pages.taskHistory.columns.conversationCount")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTasks.length > 0 ? (
                visibleTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="ps-(--card-spacing)">
                      <div className="max-w-72">
                        <span
                          className="block truncate font-medium"
                          title={task.title}
                        >
                          {task.title}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div
                        className="flex max-w-52 items-center gap-3"
                        title={task.user_email}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback>
                            {task.user_name
                              .slice(0, 1)
                              .toLocaleUpperCase(locale)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">
                          {task.user_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(new Date(task.started_at))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(new Date(task.last_active_at))}
                    </TableCell>
                    <TableCell className="pe-(--card-spacing) text-end tabular-nums">
                      {numberFormatter.format(task.turn_count)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-muted-foreground"
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
