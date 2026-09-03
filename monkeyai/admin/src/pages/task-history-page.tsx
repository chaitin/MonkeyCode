import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { endOfDay, startOfDay } from "date-fns"
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

type TaskStatus = "completed" | "running" | "failed" | "cancelled"
type TaskType = "conversation" | "workflow" | "retrieval" | "tool" | "scheduled"
type ClientType = "desktop" | "web" | "extension" | "mobile"

type TaskHistoryEntry = {
  id: string
  title: string
  type: TaskType
  clientType: ClientType
  clientName: string
  deviceId: string
  owner: string
  ownerEmail: string
  status: TaskStatus
  startedAt: string
  lastActiveAt: string
  conversationCount: number
  durationSeconds: number | null
  inputTokens: number
  outputTokens: number
  credits: number
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

const TASK_HISTORY: TaskHistoryEntry[] = [
  {
    id: "task_9f2c8a1d",
    title: "生成季度经营分析报告",
    type: "workflow",
    clientType: "desktop",
    clientName: "MonkeyCode macOS",
    deviceId: "MCP-MAC-7H2K",
    owner: "张明",
    ownerEmail: "zhangming@example.com",
    status: "completed",
    startedAt: "2026-09-02T07:42:18Z",
    lastActiveAt: "2026-09-02T07:44:46Z",
    conversationCount: 18,
    durationSeconds: 148,
    inputTokens: 128640,
    outputTokens: 24680,
    credits: 96,
  },
  {
    id: "task_8b4e6f20",
    title: "排查订单服务响应变慢问题",
    type: "conversation",
    clientType: "web",
    clientName: "Web Console",
    deviceId: "WEB-SESSION-83A1",
    owner: "李娜",
    ownerEmail: "lina@example.com",
    status: "running",
    startedAt: "2026-09-02T07:35:04Z",
    lastActiveAt: "2026-09-02T07:48:12Z",
    conversationCount: 12,
    durationSeconds: null,
    inputTokens: 46920,
    outputTokens: 8640,
    credits: 35,
  },
  {
    id: "task_72ad3c94",
    title: "整理竞品功能调研结果",
    type: "retrieval",
    clientType: "extension",
    clientName: "Chrome Extension",
    deviceId: "EXT-CHROME-2D91",
    owner: "王琦",
    ownerEmail: "wangqi@example.com",
    status: "completed",
    startedAt: "2026-09-02T06:58:31Z",
    lastActiveAt: "2026-09-02T06:59:45Z",
    conversationCount: 6,
    durationSeconds: 74,
    inputTokens: 58940,
    outputTokens: 11320,
    credits: 44,
  },
  {
    id: "task_615ee4b7",
    title: "修复移动端登录状态丢失",
    type: "tool",
    clientType: "desktop",
    clientName: "MonkeyCode Windows",
    deviceId: "MCP-WIN-4F6B",
    owner: "陈晨",
    ownerEmail: "chenchen@example.com",
    status: "failed",
    startedAt: "2026-09-02T06:26:47Z",
    lastActiveAt: "2026-09-02T06:27:39Z",
    conversationCount: 9,
    durationSeconds: 52,
    inputTokens: 31760,
    outputTokens: 4280,
    credits: 23,
  },
  {
    id: "task_5cd8913a",
    title: "同步产品帮助中心知识库",
    type: "scheduled",
    clientType: "web",
    clientName: "Web Console",
    deviceId: "WEB-SCHEDULER",
    owner: "系统",
    ownerEmail: "system@monkeyai.local",
    status: "completed",
    startedAt: "2026-09-02T05:00:00Z",
    lastActiveAt: "2026-09-02T05:03:56Z",
    conversationCount: 4,
    durationSeconds: 236,
    inputTokens: 284500,
    outputTokens: 18720,
    credits: 158,
  },
  {
    id: "task_49e72b6c",
    title: "总结客户访谈录音",
    type: "conversation",
    clientType: "mobile",
    clientName: "MonkeyCode iOS",
    deviceId: "IOS-15PM-8A31",
    owner: "周悦",
    ownerEmail: "zhouyue@example.com",
    status: "cancelled",
    startedAt: "2026-09-02T04:42:16Z",
    lastActiveAt: "2026-09-02T04:42:47Z",
    conversationCount: 3,
    durationSeconds: 31,
    inputTokens: 18420,
    outputTokens: 2180,
    credits: 12,
  },
  {
    id: "task_330af85e",
    title: "生成 API 接口测试用例",
    type: "workflow",
    clientType: "desktop",
    clientName: "MonkeyCode Linux",
    deviceId: "MCP-LINUX-91C7",
    owner: "赵磊",
    ownerEmail: "zhaolei@example.com",
    status: "completed",
    startedAt: "2026-09-02T03:54:02Z",
    lastActiveAt: "2026-09-02T03:55:54Z",
    conversationCount: 15,
    durationSeconds: 112,
    inputTokens: 96480,
    outputTokens: 22460,
    credits: 78,
  },
  {
    id: "task_2ed64a10",
    title: "检查发布分支代码变更",
    type: "tool",
    clientType: "extension",
    clientName: "VS Code Extension",
    deviceId: "EXT-VSCODE-44E2",
    owner: "张明",
    ownerEmail: "zhangming@example.com",
    status: "completed",
    startedAt: "2026-09-02T03:18:49Z",
    lastActiveAt: "2026-09-02T03:20:18Z",
    conversationCount: 8,
    durationSeconds: 89,
    inputTokens: 74120,
    outputTokens: 12680,
    credits: 55,
  },
  {
    id: "task_1a9c37fd",
    title: "提取合同中的风险条款",
    type: "retrieval",
    clientType: "mobile",
    clientName: "MonkeyCode Android",
    deviceId: "ANDROID-P9-6D0A",
    owner: "李娜",
    ownerEmail: "lina@example.com",
    status: "completed",
    startedAt: "2026-09-02T02:47:35Z",
    lastActiveAt: "2026-09-02T02:48:43Z",
    conversationCount: 5,
    durationSeconds: 68,
    inputTokens: 52640,
    outputTokens: 9780,
    credits: 41,
  },
  {
    id: "task_0f5632bc",
    title: "分析本周客服会话主题",
    type: "scheduled",
    clientType: "web",
    clientName: "Web Console",
    deviceId: "WEB-SCHEDULER",
    owner: "系统",
    ownerEmail: "system@monkeyai.local",
    status: "failed",
    startedAt: "2026-09-02T02:00:00Z",
    lastActiveAt: "2026-09-02T02:03:04Z",
    conversationCount: 7,
    durationSeconds: 184,
    inputTokens: 192300,
    outputTokens: 15640,
    credits: 121,
  },
  {
    id: "task_f82d10a7",
    title: "优化数据导入脚本",
    type: "conversation",
    clientType: "desktop",
    clientName: "MonkeyCode macOS",
    deviceId: "MCP-MAC-7H2K",
    owner: "张明",
    ownerEmail: "zhangming@example.com",
    status: "completed",
    startedAt: "2026-09-02T01:26:53Z",
    lastActiveAt: "2026-09-02T01:30:16Z",
    conversationCount: 21,
    durationSeconds: 203,
    inputTokens: 156840,
    outputTokens: 31860,
    credits: 117,
  },
  {
    id: "task_e47ba291",
    title: "制作新品发布会内容大纲",
    type: "workflow",
    clientType: "web",
    clientName: "Web Console",
    deviceId: "WEB-SESSION-61B3",
    owner: "周悦",
    ownerEmail: "zhouyue@example.com",
    status: "completed",
    startedAt: "2026-09-02T00:38:12Z",
    lastActiveAt: "2026-09-02T00:40:18Z",
    conversationCount: 14,
    durationSeconds: 126,
    inputTokens: 88260,
    outputTokens: 19740,
    credits: 69,
  },
]

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

  const filteredTasks = useMemo(() => {
    const taskNameQuery = filters.taskName.trim().toLocaleLowerCase(locale)
    const userNameQuery = filters.userName.trim().toLocaleLowerCase(locale)
    const startTimestamp = filters.startTime
      ? startOfDay(filters.startTime).getTime()
      : null
    const endTimestamp = filters.endTime
      ? endOfDay(filters.endTime).getTime()
      : null

    return TASK_HISTORY.filter((task) => {
      const startedAt = new Date(task.startedAt).getTime()
      const matchesTaskName =
        taskNameQuery.length === 0 ||
        [task.id, task.title].some((value) =>
          value.toLocaleLowerCase(locale).includes(taskNameQuery)
        )
      const matchesUserName =
        userNameQuery.length === 0 ||
        [task.owner, task.ownerEmail].some((value) =>
          value.toLocaleLowerCase(locale).includes(userNameQuery)
        )
      const matchesStartTime =
        startTimestamp === null || startedAt >= startTimestamp
      const matchesEndTime = endTimestamp === null || startedAt <= endTimestamp

      return (
        matchesTaskName && matchesUserName && matchesStartTime && matchesEndTime
      )
    })
  }, [filters, locale])

  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const visibleTasks = filteredTasks.slice(pageStart, pageStart + pageSize)
  const firstVisible = filteredTasks.length === 0 ? 0 : pageStart + 1
  const lastVisible = Math.min(pageStart + pageSize, filteredTasks.length)
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
    resetPage()
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-0">
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
                        title={task.ownerEmail}
                      >
                        <Avatar className="size-6">
                          <AvatarFallback>
                            {task.owner.slice(0, 1).toLocaleUpperCase(locale)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium">
                          {task.owner}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(new Date(task.startedAt))}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(new Date(task.lastActiveAt))}
                    </TableCell>
                    <TableCell className="pe-(--card-spacing) text-end tabular-nums">
                      {numberFormatter.format(task.conversationCount)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-muted-foreground"
                  >
                    {t("pages.taskHistory.empty")}
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
                  total: filteredTasks.length,
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
                disabled={currentPage === 1}
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
                disabled={currentPage === pageCount}
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
