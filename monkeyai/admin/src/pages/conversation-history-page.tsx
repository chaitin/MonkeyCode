import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FilterHorizontalIcon,
  Search02Icon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"

import { DatePickerField } from "@/components/date-picker-field"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { endOfLocalDay, startOfLocalDay } from "@/lib/date-range"

type Conversation = {
  id: string
  userName: string
  userEmail: string
  taskId: string
  taskTitle: string
  turn: number
  at: string
  content: string
}

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
const users = [
  { name: "林晨", email: "lin.chen@example.com" },
  { name: "周宁", email: "zhou.ning@example.com" },
  { name: "陈晓", email: "chen.xiao@example.com" },
  { name: "王悦", email: "wang.yue@example.com" },
]
const tasks = [
  { id: "00000000-0000-4000-8000-000000000001", title: "整理季度产品反馈" },
  { id: "00000000-0000-4000-8000-000000000002", title: "准备新品发布邮件" },
  { id: "00000000-0000-4000-8000-000000000003", title: "分析销售数据趋势" },
  { id: "00000000-0000-4000-8000-000000000004", title: "修复登录流程异常" },
  { id: "00000000-0000-4000-8000-000000000005", title: "设计春季活动海报" },
]
const examples: {
  user: number
  task: number
  turn: number
  minutes: number
  content: string
}[] = [
  {
    user: 0,
    task: 0,
    turn: 5,
    minutes: 8,
    content:
      "请把用户反馈按性能、易用性和价格三个主题归类，并列出每类最常见的三个问题。",
  },
  {
    user: 1,
    task: 1,
    turn: 4,
    minutes: 22,
    content:
      "邮件标题再简短一点，正文保持轻松自然的语气，最后加上报名链接的占位符。",
  },
  {
    user: 2,
    task: 2,
    turn: 6,
    minutes: 45,
    content:
      "对比最近三个月各渠道的销售额，说明增长最快的渠道，并标出样本量过少的数据。",
  },
  {
    user: 3,
    task: 3,
    turn: 3,
    minutes: 68,
    content:
      "登录失败时偶尔会跳回首页。请检查重定向逻辑，给出复现步骤和可能的修复方案。",
  },
  {
    user: 0,
    task: 0,
    turn: 4,
    minutes: 140,
    content: "能把刚才的结论整理成一页摘要吗？重点写给产品和客服团队看。",
  },
  {
    user: 1,
    task: 4,
    turn: 3,
    minutes: 225,
    content:
      "把主视觉里的标题放大，背景留出足够的留白。\n请分别给出横版和方版的排版建议。",
  },
  {
    user: 2,
    task: 2,
    turn: 5,
    minutes: 330,
    content:
      "这张表的日期是本地时间，请按自然日重新汇总，不要把当天的订单归到前一天。",
  },
  {
    user: 3,
    task: 3,
    turn: 2,
    minutes: 480,
    content: "先梳理登录页面、回调页面和会话校验之间的调用顺序。",
  },
  {
    user: 1,
    task: 1,
    turn: 3,
    minutes: 750,
    content: "请给邮件加一段 50 字以内的产品亮点介绍，避免使用过于正式的措辞。",
  },
  {
    user: 0,
    task: 0,
    turn: 3,
    minutes: 1000,
    content: "根据这些反馈，哪些问题应该优先放进下个版本？请说明判断依据。",
  },
  {
    user: 1,
    task: 4,
    turn: 2,
    minutes: 1490,
    content: "配色可以更明亮一些，但不要改变现有品牌色。",
  },
  {
    user: 2,
    task: 2,
    turn: 4,
    minutes: 1700,
    content: "按地区拆分结果，再补充每个地区的订单数和客单价。",
  },
  {
    user: 1,
    task: 1,
    turn: 2,
    minutes: 2020,
    content:
      "目标读者是已经注册但没有使用过产品的人，开头需要更直接地说明价值。",
  },
  {
    user: 0,
    task: 0,
    turn: 2,
    minutes: 2550,
    content: "请先去掉重复反馈，把相同意思的建议合并，并保留原始数量。",
  },
  {
    user: 3,
    task: 3,
    turn: 1,
    minutes: 3100,
    content:
      "帮我排查登录后跳转不稳定的问题，尤其关注页面刷新后返回地址丢失的情况。",
  },
  {
    user: 1,
    task: 4,
    turn: 1,
    minutes: 3610,
    content: "设计一张春季活动海报，画面需要清爽、明亮，并突出限时体验的主题。",
  },
  {
    user: 2,
    task: 2,
    turn: 3,
    minutes: 4310,
    content: "销售额包含退款，请在计算增长率之前扣除退款金额。",
  },
  {
    user: 1,
    task: 1,
    turn: 1,
    minutes: 5020,
    content: "写一封新品发布邮件，介绍主要功能和上线时间，控制在三段以内。",
  },
  {
    user: 0,
    task: 0,
    turn: 1,
    minutes: 5780,
    content: "整理本季度收到的产品反馈，先给我一个总体概览。",
  },
  {
    user: 2,
    task: 2,
    turn: 2,
    minutes: 7210,
    content: "请先检查数据中的异常值，再按月份绘制趋势。",
  },
  {
    user: 2,
    task: 2,
    turn: 1,
    minutes: 8650,
    content: "分析过去三个月的销售数据，找出主要变化。",
  },
]
const sampleConversations: Conversation[] = examples.map((example, index) => ({
  id: `sample-${index}`,
  userName: users[example.user].name,
  userEmail: users[example.user].email,
  taskId: tasks[example.task].id,
  taskTitle: tasks[example.task].title,
  turn: example.turn,
  at: new Date(Date.now() - example.minutes * 60_000).toISOString(),
  content: example.content,
}))

const labels = {
  zh: {
    sample: "示例数据",
    note: "用于确认页面样式与交互，目前不展示真实对话。",
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
    empty: "没有符合条件的对话",
  },
  en: {
    sample: "Sample data",
    note: "Preview the layout and interactions. No real conversations are shown.",
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
    empty: "No matching messages",
  },
}

export function ConversationHistoryPage() {
  const { i18n, t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const initialTaskId = params.get("task_id") ?? ""
  const initialFilters = () => ({ ...emptyFilters(), taskId: initialTaskId })
  const copy = i18n.language.startsWith("zh") ? labels.zh : labels.en
  const locale = i18n.resolvedLanguage ?? i18n.language
  const [draft, setDraft] = useState<Filters>(initialFilters)
  const [filters, setFilters] = useState<Filters>(initialFilters)
  const [visibleFields, setVisibleFields] = useState<Set<SearchField>>(
    () =>
      new Set(
        initialTaskId ? ["taskName", "taskId", "user"] : ["taskName", "user"]
      )
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
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
  const filtered = useMemo(() => {
    const taskName = filters.taskName.trim().toLocaleLowerCase()
    const taskId = filters.taskId.trim().toLocaleLowerCase()
    const user = filters.user.trim().toLocaleLowerCase()
    const content = filters.content.trim().toLocaleLowerCase()
    const from = filters.from
      ? startOfLocalDay(filters.from).getTime()
      : -Infinity
    const until = filters.until
      ? endOfLocalDay(filters.until).getTime()
      : Infinity
    return sampleConversations.filter((entry) => {
      const at = Date.parse(entry.at)
      return (
        at >= from &&
        at <= until &&
        (!taskId || entry.taskId.toLocaleLowerCase() === taskId) &&
        entry.taskTitle.toLocaleLowerCase().includes(taskName) &&
        `${entry.userName} ${entry.userEmail}`
          .toLocaleLowerCase()
          .includes(user) &&
        entry.content.toLocaleLowerCase().includes(content)
      )
    })
  }, [filters])
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const start = (currentPage - 1) * pageSize
  const visible = filtered.slice(start, start + pageSize)
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
    const next = { ...draft, taskId: draft.taskId.trim() }
    setFilters(next)
    setTaskQuery(next.taskId)
    setPage(1)
  }
  const filterByTask = (entry: Conversation) => {
    const next = { ...draft, taskName: "", taskId: entry.taskId }
    setDraft(next)
    setFilters(next)
    setVisibleFields((current) => new Set(current).add("taskId"))
    setTaskQuery(entry.taskId)
    setPage(1)
  }
  const fieldOptions: { key: SearchField; label: string }[] = [
    { key: "taskName", label: copy.task },
    { key: "taskId", label: copy.taskId },
    { key: "user", label: copy.user },
    { key: "content", label: copy.keyword },
    { key: "dateRange", label: copy.dateRange },
  ]

  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <div
            className="flex flex-wrap items-center gap-2 px-(--card-spacing) text-sm text-muted-foreground"
            role="note"
          >
            <Badge variant="outline">{copy.sample}</Badge>
            <span>{copy.note}</span>
          </div>
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
                onChange={(event) => update("user", event.target.value)}
              />
            )}
            {visibleFields.has("content") && (
              <Input
                className="w-full sm:w-44"
                aria-label={copy.keyword}
                placeholder={copy.keywordPlaceholder}
                value={draft.content}
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
              <DropdownMenuContent align="start">
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
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="submit">
              <HugeiconsIcon icon={Search02Icon} data-icon="inline-start" />
              {copy.search}
            </Button>
          </form>
          <ScrollArea
            horizontal
            className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
          >
            <Table
              className={
                !visible.length
                  ? "h-full min-w-4xl table-fixed"
                  : "min-w-4xl table-fixed"
              }
              aria-label={t("pages.conversationHistory.title")}
            >
              <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                <TableRow>
                  <TableHead className="w-44 ps-(--card-spacing)">
                    {copy.time}
                  </TableHead>
                  <TableHead className="w-36">{copy.user}</TableHead>
                  <TableHead className="w-48">{copy.task}</TableHead>
                  <TableHead className="w-20">{copy.turn}</TableHead>
                  <TableHead className="pe-(--card-spacing)">
                    {copy.content}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={!visible.length ? "h-full" : undefined}>
                {visible.length ? (
                  visible.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="ps-(--card-spacing) text-muted-foreground">
                        <span
                          className="block truncate"
                          title={formatter.format(new Date(entry.at))}
                        >
                          {formatter.format(new Date(entry.at))}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex w-full min-w-0 items-center gap-2"
                          title={entry.userEmail}
                        >
                          <HugeiconsIcon
                            icon={User02Icon}
                            className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">
                            {entry.userName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="block w-full min-w-0 cursor-pointer truncate text-start hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          title={entry.taskTitle}
                          onClick={() => filterByTask(entry)}
                        >
                          {entry.taskTitle}
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="block truncate">
                          {copy.turnNumber(entry.turn)}
                        </span>
                      </TableCell>
                      <TableCell className="pe-(--card-spacing)">
                        <span className="block truncate" title={entry.content}>
                          {entry.content}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="h-full">
                    <TableCell
                      colSpan={5}
                      className="h-full text-center text-muted-foreground"
                    >
                      {copy.empty}
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
                  from: visible.length ? start + 1 : 0,
                  to: start + visible.length,
                  total: filtered.length,
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
                disabled={currentPage === 1}
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
                disabled={currentPage >= pages}
                onClick={() => setPage((value) => Math.min(pages, value + 1))}
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
