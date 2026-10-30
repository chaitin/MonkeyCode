import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  FilterHorizontalIcon,
  Loading03Icon,
  Search02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { TablePagination } from "@/components/table-pagination"
import { TableLoading } from "@/components/table-loading"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"

import { AccountDialog } from "@/components/billing/account-dialog"
import { UserAvatar } from "@/components/user-avatar"
import { UserSearch } from "@/components/user-search"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useStatistics } from "@/hooks/use-statistics"
import { useTableQuery } from "@/hooks/use-table-query"
import { queryDate, queryDateValue } from "@/lib/table-query"
import {
  conversationQuery,
  conversationResult,
  type Conversation,
  type ConversationPage,
} from "@/lib/conversation-history"
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
  userId: string
  content: string
  from?: Date
  until?: Date
}

const emptyFilters = (): Filters => ({
  taskName: "",
  taskId: "",
  user: "",
  userId: "",
  content: "",
})

const CONVERSATION_QUERY_KEYS = [
  "task",
  "task_id",
  "user",
  "user_id",
  "content",
  "from",
  "until",
] as const
function conversationFilterInput(filters: Record<string, string>): Filters {
  return {
    ...emptyFilters(),
    taskName: filters.task ?? "",
    taskId: filters.task_id ?? "",
    user: filters.user_id ? "" : (filters.user ?? ""),
    userId: filters.user_id ?? "",
    content: filters.content ?? "",
    from: queryDate(filters.from),
    until: queryDate(filters.until, true),
  }
}
function activeConversationFields(
  filters: Record<string, string>
): SearchField[] {
  return [
    ...(filters.task ? ["taskName" as const] : []),
    ...(filters.task_id ? ["taskId" as const] : []),
    ...(filters.user || filters.user_id ? ["user" as const] : []),
    ...(filters.content ? ["content" as const] : []),
    ...(filters.from || filters.until ? ["dateRange" as const] : []),
  ]
}

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
  const tableQuery = useTableQuery(CONVERSATION_QUERY_KEYS)
  const { filters, filterQuery, page, pageSize, setPage, setPageSize } =
    tableQuery
  const [previousQuery, setPreviousQuery] = useState(filterQuery)
  const formRef = useRef<HTMLFormElement>(null)
  const copy = i18n.language.startsWith("zh") ? labels.zh : labels.en
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  })
  const tokenFormatter = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
  const [draft, setDraft] = useState<Filters>(() =>
    conversationFilterInput(filters)
  )
  const [visibleFields, setVisibleFields] = useState<Set<SearchField>>(
    () => new Set(["taskName", "user", ...activeConversationFields(filters)])
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<ConversationColumn>>(
    () => new Set(defaultColumns)
  )
  const displayedColumns = columns.filter((column) =>
    visibleColumns.has(column)
  )
  const [accountUserID, setAccountUserID] = useState<string | null>(null)

  if (previousQuery !== filterQuery) {
    setPreviousQuery(filterQuery)
    setDraft(conversationFilterInput(filters))
    setVisibleFields(
      (current) => new Set([...current, ...activeConversationFields(filters)])
    )
  }

  const query = conversationQuery(
    {
      taskName: filters.task ?? "",
      taskId: filters.task_id ?? "",
      user: filters.user_id ? "" : (filters.user ?? ""),
      userId: filters.user_id ?? "",
      content: filters.content ?? "",
      from: filters.from,
      until: filters.until,
    },
    page,
    pageSize
  )
  const request = useStatistics<ConversationPage>(
    `/api/admin/v1/statistics/conversations?${query}`
  )
  const currentPage = request.data?.page ?? page
  useEffect(() => {
    if (
      !request.loading &&
      !request.error &&
      request.data?.page === page &&
      page > 1 &&
      request.data.items.length === 0
    )
      setPage(1, { replace: true })
  }, [request.loading, request.error, request.data, page, setPage])
  const visible = request.data?.items ?? []

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, TABLE_DATE_TIME_OPTIONS),
    [locale]
  )
  const update = (key: "taskName" | "taskId" | "content", value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))
  const commitFilters = (next: Filters) => {
    const bounds = {
      from: queryDateValue(next.from, filters.from, "from"),
      until: queryDateValue(next.until, filters.until, "exclusiveUntil"),
    }
    tableQuery.commit({
      task: next.taskName.trim(),
      task_id: next.taskId.trim(),
      user: "",
      user_id: next.userId,
      content: next.content.trim(),
      ...bounds,
    })
    return (
      conversationQuery({ ...next, user: "", ...bounds }, 1, pageSize) !== query
    )
  }
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (request.loading || (draft.user.trim() && !draft.userId)) return
    const next = { ...draft, taskId: draft.taskId.trim() }
    if (!commitFilters(next)) request.reload()
  }
  const filterByTask = (entry: Conversation) => {
    if (!formRef.current?.reportValidity()) return
    const next = { ...draft, taskName: "", taskId: entry.session_id }
    setDraft(next)
    setVisibleFields((current) => new Set(current).add("taskId"))
    if (!commitFilters(next)) request.reload()
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
            <UserAvatar src={entry.user_avatar_url} />
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
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100vh-5rem)] md:flex-none md:overflow-hidden">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <form
            ref={formRef}
            className="flex flex-wrap items-end gap-3 px-[var(--card-spacing)]"
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
              <UserSearch
                id="conversation-history-user"
                selectionOnly
                userID={draft.userId}
                query={draft.user}
                onChange={({ userID, query }) =>
                  setDraft((current) => ({
                    ...current,
                    userId: userID,
                    user: query,
                  }))
                }
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
                      onCheckedChange={(checked) => {
                        setVisibleFields((current) => {
                          const next = new Set(current)
                          if (checked) next.add(key)
                          else next.delete(key)
                          return next
                        })
                        if (!checked && key === "user")
                          setDraft((current) => ({
                            ...current,
                            userId: "",
                            user: "",
                          }))
                      }}
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
                "table-auto [&_td:first-child]:ps-[var(--card-spacing)] [&_td:last-child]:pe-[var(--card-spacing)] [&_th:first-child]:ps-[var(--card-spacing)] [&_th:last-child]:pe-[var(--card-spacing)]",
                !visible.length && "h-full"
              )}
              aria-label={t("pages.conversationHistory.title")}
              aria-busy={request.loading}
            >
              <TableHeader className="sticky top-0 z-10">
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
                        <TableLoading />
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
          <TablePagination
            page={currentPage}
            pageSize={pageSize}
            itemCount={visible.length}
            hasNext={request.data?.has_next ?? false}
            loading={request.loading}
            error={Boolean(request.error)}
            onPageSizeChange={(size) => {
              setPageSize(size)
            }}
            onPrevious={() => setPage(Math.max(1, currentPage - 1))}
            onNext={() => setPage(currentPage + 1)}
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
