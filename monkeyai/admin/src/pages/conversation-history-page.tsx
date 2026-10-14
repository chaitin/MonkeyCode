import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
  Loading03Icon,
  Search02Icon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { addDays } from "date-fns"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { AccountDialog } from "@/components/billing/account-dialog"
import { DatePickerField } from "@/components/date-picker-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuOptionsContent,
  DropdownMenuGroup,
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
import { useStatistics } from "@/hooks/use-statistics"
import {
  conversationQuery,
  conversationResult,
  type Conversation,
  type ConversationPage,
} from "@/lib/conversation-history"
import { startOfLocalDay } from "@/lib/date-range"
import { cn } from "@/lib/utils"

const columns = [
  "time",
  "user",
  "task",
  "turn",
  "inputTokens",
  "outputTokens",
  "result",
  "content",
  "duration",
] as const

type ConversationColumn = (typeof columns)[number]

const defaultColumns: ConversationColumn[] = [
  "time",
  "user",
  "result",
  "content",
  "duration",
]
const numericColumns = new Set<ConversationColumn>([
  "duration",
  "inputTokens",
  "outputTokens",
])
const mutedColumns = new Set<ConversationColumn>(["time", "turn", "duration"])

type SearchField = "taskName" | "taskId" | "user" | "content" | "dateRange"

type Filters = {
  taskName: string
  taskId: string
  user: string
  content: string
  from?: Date
  until?: Date
}

const emptyFilters = (): Filters => ({
  taskName: "",
  taskId: "",
  user: "",
  content: "",
})

const labels = {
  zh: {
    task: "任务名称",
    taskId: "任务 ID",
    user: "用户",
    keyword: "对话内容",
    keywordPlaceholder: "搜索对话内容",
    from: "开始日期",
    until: "结束日期",
    search: "搜索",
    fields: "更多",
    dateRange: "日期范围",
    time: "对话时间",
    turn: "轮次",
    turnNumber: (n: number) => `第 ${n} 轮`,
    content: "对话内容",
    noText: "（无文本输入）",
    duration: "耗时",
    seconds: (n: string) => `${n} 秒`,
    inputTokens: "输入 Token",
    outputTokens: "输出 Token",
    result: "结果",
    roundResult: "本轮结果",
    results: {
      completed: "已完成",
      incomplete: "未完成",
      failed: "失败",
      interrupted: "已中断",
      unknown: "未知",
    },
    empty: "没有符合条件的对话",
  },
  en: {
    task: "Task name",
    taskId: "Task ID",
    user: "User",
    keyword: "Message content",
    keywordPlaceholder: "Search messages",
    from: "Start date",
    until: "End date",
    search: "Search",
    fields: "More",
    dateRange: "Date range",
    time: "Message time",
    turn: "Turn",
    turnNumber: (n: number) => `Turn ${n}`,
    content: "Message",
    noText: "(No text input)",
    duration: "Duration",
    seconds: (n: string) => `${n} s`,
    inputTokens: "Input tokens",
    outputTokens: "Output tokens",
    result: "Result",
    roundResult: "Turn outcome",
    results: {
      completed: "Completed",
      incomplete: "Incomplete",
      failed: "Failed",
      interrupted: "Interrupted",
      unknown: "Unknown",
    },
    empty: "No matching messages",
  },
}

export function ConversationHistoryPage() {
  const { i18n, t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const selectedTaskId = params.get("task_id") ?? ""
  const initialFilters = () => ({ ...emptyFilters(), taskId: selectedTaskId })
  const copy = i18n.language.startsWith("zh") ? labels.zh : labels.en
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  })
  const tokenFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [visibleFields, setVisibleFields] = useState<Set<SearchField>>(
    () =>
      new Set(
        selectedTaskId ? ["taskName", "taskId", "user"] : ["taskName", "user"]
      )
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<ConversationColumn>>(
    () => new Set(defaultColumns)
  )
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [accountUserID, setAccountUserID] = useState<string | null>(null)

  const [previousTaskId, setPreviousTaskId] = useState(selectedTaskId)
  if (previousTaskId !== selectedTaskId) {
    setPreviousTaskId(selectedTaskId)
    setDraft((current) => ({ ...current, taskId: selectedTaskId }))
    setPage(1)
    if (selectedTaskId)
      setVisibleFields((current) => new Set(current).add("taskId"))
  }

  const query = conversationQuery(
    {
      ...filters,
      taskId: selectedTaskId,
      from: filters.from
        ? startOfLocalDay(filters.from).toISOString()
        : undefined,
      until: filters.until
        ? startOfLocalDay(addDays(filters.until, 1)).toISOString()
        : undefined,
    },
    page,
    pageSize
  )
  const request = useStatistics<ConversationPage>(
    `/api/admin/v1/statistics/conversations?${query}`
  )
  const total = request.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = request.data?.page ?? page
  const start = (currentPage - 1) * pageSize
  const visible = request.data?.items ?? []
  const pageSizeItems = [10, 20, 50].map((size) => ({
    value: String(size),
    label: t("pages.operationLogs.pagination.perPage", { count: size }),
  }))
  const formatter = useMemo(
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
  const update = (
    key: "taskName" | "taskId" | "user" | "content",
    value: string
  ) => setDraft((current) => ({ ...current, [key]: value }))
  const setTaskQuery = (taskId: string) => {
    const next = new URLSearchParams(params)
    if (taskId) next.set("task_id", taskId)
    else next.delete("task_id")
    setParams(next, { replace: true })
  }
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (request.loading) return
    const next = { ...draft, taskId: draft.taskId.trim() }
    setFilters(next)
    setTaskQuery(next.taskId)
    setPage(1)
    request.reload()
  }
  const filterByTask = (entry: Conversation) => {
    const next = { ...draft, taskName: "", taskId: entry.session_id }
    setDraft(next)
    setFilters(next)
    setVisibleFields((current) => new Set(current).add("taskId"))
    setTaskQuery(entry.session_id)
    setPage(1)
  }
  const fieldOptions: { key: SearchField; label: string }[] = [
    { key: "taskName", label: copy.task },
    { key: "taskId", label: copy.taskId },
    { key: "user", label: copy.user },
    { key: "content", label: copy.keyword },
    { key: "dateRange", label: copy.dateRange },
  ]

  function renderCell(entry: Conversation, column: ConversationColumn) {
    switch (column) {
      case "time":
        return (
          <span
            className="block truncate"
            title={formatter.format(new Date(entry.started_at))}
          >
            {formatter.format(new Date(entry.started_at))}
          </span>
        )
      case "user":
        return (
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-2 rounded-sm text-start underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring enabled:cursor-pointer [&:enabled:hover_span]:underline"
            title={entry.user_email}
            disabled={!entry.user_id}
            onClick={() => setAccountUserID(entry.user_id)}
          >
            <HugeiconsIcon
              icon={User02Icon}
              className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{entry.user_name}</span>
          </button>
        )
      case "task":
        return (
          <button
            type="button"
            className="block w-full min-w-0 cursor-pointer truncate text-start underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring [&:hover]:underline"
            title={entry.task_title}
            onClick={() => filterByTask(entry)}
          >
            {entry.task_title}
          </button>
        )
      case "turn":
        return (
          <span className="block truncate">
            {copy.turnNumber(entry.turn_index)}
          </span>
        )
      case "duration":
        return copy.seconds(numberFormatter.format(entry.duration_seconds))
      case "inputTokens":
      case "outputTokens": {
        const value =
          column === "inputTokens" ? entry.input_tokens : entry.output_tokens
        return value == null ? (
          "—"
        ) : (
          <span title={numberFormatter.format(value)}>
            {tokenFormatter.format(value)}
          </span>
        )
      }
      case "result":
        return (
          <Badge
            variant={entry.is_completed === false ? "destructive" : "secondary"}
            title={`${copy.roundResult}: ${t(`pages.sessionReporting.outcomes.${entry.outcome}`)}${entry.error_code ? ` · ${entry.error_code}` : ""}`}
          >
            {copy.results[conversationResult(entry.outcome)]}
          </Badge>
        )
      case "content": {
        const text = entry.input_text?.trim() ? entry.input_text : copy.noText
        const title = entry.input_text_truncated
          ? `${text}\n${t("pages.sessionReporting.detail.textTruncated")}`
          : text
        return (
          <span className="block truncate" title={title}>
            {text}
          </span>
        )
      }
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            className="flex flex-wrap items-end gap-3 px-(--card-spacing)"
            onSubmit={search}
          >
            {visibleFields.has("taskName") && (
              <Input
                className="w-full sm:w-44"
                aria-label={copy.task}
                placeholder={copy.task}
                value={draft.taskName}
                maxLength={200}
                onChange={(event) => update("taskName", event.target.value)}
              />
            )}
            {visibleFields.has("taskId") && (
              <Input
                className="w-full sm:w-64"
                aria-label={copy.taskId}
                placeholder={copy.taskId}
                value={draft.taskId}
                onChange={(event) => update("taskId", event.target.value)}
              />
            )}
            {visibleFields.has("user") && (
              <Input
                className="w-full sm:w-44"
                aria-label={copy.user}
                placeholder={copy.user}
                value={draft.user}
                maxLength={200}
                onChange={(event) => update("user", event.target.value)}
              />
            )}
            {visibleFields.has("content") && (
              <Input
                className="w-full sm:w-44"
                aria-label={copy.keyword}
                placeholder={copy.keywordPlaceholder}
                value={draft.content}
                maxLength={200}
                onChange={(event) => update("content", event.target.value)}
              />
            )}
            {visibleFields.has("dateRange") && (
              <>
                <DatePickerField
                  id="conversation-history-from"
                  className="w-full sm:w-36"
                  label={copy.from}
                  placeholder={copy.from}
                  locale={locale}
                  value={draft.from}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, from: value }))
                  }
                  disabled={draft.until ? { after: draft.until } : undefined}
                />
                <DatePickerField
                  id="conversation-history-until"
                  className="w-full sm:w-36"
                  label={copy.until}
                  placeholder={copy.until}
                  locale={locale}
                  value={draft.until}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, until: value }))
                  }
                  disabled={draft.from ? { before: draft.from } : undefined}
                />
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="outline" />}
              >
                <HugeiconsIcon
                  icon={FilterHorizontalIcon}
                  data-icon="inline-start"
                />
                {copy.fields}
              </DropdownMenuTrigger>
              <DropdownMenuOptionsContent align="start">
                <DropdownMenuGroup>
                  {fieldOptions.map(({ key, label }) => (
                    <DropdownMenuCheckboxItem
                      key={key}
                      checked={visibleFields.has(key)}
                      onCheckedChange={(checked) =>
                        setVisibleFields((current) => {
                          const next = new Set(current)
                          if (checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }
                    >
                      {label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
            <Button type="submit" disabled={request.loading}>
              <HugeiconsIcon
                icon={request.loading ? Loading03Icon : Search02Icon}
                className={
                  request.loading
                    ? "animate-spin motion-reduce:animate-none"
                    : undefined
                }
                data-icon="inline-start"
              />
              {copy.search}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="outline" className="ms-auto" />
                }
              >
                {t("pages.sessionReporting.clients.selectColumns")}
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
                      {copy[column]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuOptionsContent>
            </DropdownMenu>
          </form>
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={cn(
                "table-auto [&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)",
                !visible.length && "h-full"
              )}
              aria-label={t("pages.conversationHistory.title")}
              aria-busy={request.loading}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  {displayedColumns.map((column) => (
                    <TableHead
                      key={column}
                      className={
                        numericColumns.has(column) ? "text-end" : undefined
                      }
                    >
                      {copy[column]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody className={!visible.length ? "h-full" : undefined}>
                {visible.length ? (
                  visible.map((entry) => (
                    <TableRow key={`${entry.session_id}:${entry.turn_index}`}>
                      {displayedColumns.map((column) => (
                        <TableCell
                          key={column}
                          className={cn(
                            numericColumns.has(column) &&
                              "text-end tabular-nums",
                            mutedColumns.has(column) && "text-muted-foreground"
                          )}
                        >
                          {renderCell(entry, column)}
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
                      {request.loading ? (
                        <span
                          role="status"
                          aria-label={t("statistics.loading")}
                          className="inline-flex text-muted-foreground"
                        >
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={20}
                            className="animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                        </span>
                      ) : request.error ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={request.reload}
                        >
                          {t("statistics.retry")}
                        </Button>
                      ) : (
                        copy.empty
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
                disabled={request.loading}
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
                  from: visible.length ? start + 1 : 0,
                  to: start + visible.length,
                  total,
                })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t("pages.operationLogs.pagination.page", {
                  page: currentPage,
                  pages,
                })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled={request.loading || currentPage === 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
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
                disabled={request.loading || currentPage >= pages}
                onClick={() => setPage(Math.min(pages, currentPage + 1))}
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
