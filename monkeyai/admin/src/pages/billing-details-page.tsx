import { useEffect, useRef, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
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
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Field, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"
import { endOfLocalDay, startOfLocalDay } from "@/lib/date-range"
import {
  credits,
  dateTime,
  entryNames,
  stateNames,
  type Entry,
  type Transaction,
} from "@/lib/billing"

type Entries = {
  items: Entry[]
  total: number
  page: number
  page_size: number
}
type Pending = {
  items: Transaction[]
  total: number
  differences: {
    account_id: string
    balance: string
    ledger_balance: string
    frozen: string
    reserved: string
  }[]
  migration_issues: { id: number; subject: string; reason: string }[]
}
const PAGE_SIZE_OPTIONS = ["20", "50", "100", "200", "500"]
const billingCredits = (value: string | null | undefined, locale = "zh-CN") =>
  credits(value, locale, 0)
const changedCredits = (value: string, locale: string) =>
  credits(value, locale, 0, "expand")
const balanceCredits = (value: string, locale: string) =>
  credits(value, locale, 0, "floor")

const CATEGORY_FILTERS = ["model", "tool", "other"]
const ENTRY_FILTERS = ["charge", "grant", "reset", "refund", "adjustment"]

function filterDate(value?: string) {
  if (!value) return undefined
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = dateOnly
    ? new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      )
    : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const categoryNames: Record<string, string> = {
  model: "模型",
  image: "生图",
  tool: "工具",
  other: "其他",
}

export function BillingDetailsPage() {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const values = Object.fromEntries(params)
    delete values.page
    delete values.page_size
    return values
  })
  const [entries, setEntries] = useState<Entries | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const searchRefreshRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const view = params.get("view") ?? "entries"
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const requestParams = new URLSearchParams(params)
  requestParams.delete("page")
  requestParams.delete("page_size")
  requestParams.set("page", String(page))
  requestParams.set("page_size", String(pageSize))
  const query = requestParams.toString()
  useEffect(() => {
    if (!params.has("page") && !params.has("page_size")) return
    const next = new URLSearchParams(params)
    next.delete("page")
    next.delete("page_size")
    setParams(next, { replace: true })
  }, [params, setParams])
  useEffect(() => {
    let cancelled = false
    const isSearch = searchRefreshRef.current === refresh
    const next = new URLSearchParams(query)
    next.delete("mode")
    for (const key of ["from", "until"] as const) {
      const value = filterDate(next.get(key) ?? undefined)
      if (value) {
        next.set(
          key,
          (key === "from"
            ? startOfLocalDay(value)
            : endOfLocalDay(value)
          ).toISOString()
        )
      }
    }
    const request =
      view === "entries"
        ? api<Entries>(`/api/admin/v1/billing/entries?${next}`).then((list) => {
            if (!cancelled) setEntries(list)
          })
        : api<Pending>(`/api/admin/v1/billing/reconciliation?${next}`).then(
            (set) => {
              if (!cancelled) setPending(set)
            }
          )
    void request
      .then(() => {
        if (!cancelled && isSearch) {
          showToast({
            status: "success",
            title: t("pages.operationLogs.filters.searchSuccess"),
          })
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          if (!isSearch) setLoadFailed(true)
          showToast({ status: "error", title: e.message })
        }
      })
      .finally(() => {
        if (cancelled) return
        if (isSearch) {
          setSearching(false)
          searchRefreshRef.current = null
        } else {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [query, view, refresh, showToast, t])
  const navigate = (change: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(change).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    )
    setLoadFailed(false)
    setLoading(true)
    setSearching(false)
    searchRefreshRef.current = null
    setParams(next)
    setRefresh((v) => v + 1)
  }
  const reload = () => {
    setLoadFailed(false)
    setLoading(true)
    setSearching(false)
    searchRefreshRef.current = null
    setRefresh((v) => v + 1)
  }
  const search = (e: FormEvent) => {
    e.preventDefault()
    if (searching) return
    setLoadFailed(false)
    setPage(1)
    const next = new URLSearchParams({ view: "entries" })
    for (const [key, value] of Object.entries(draft)) {
      if (value && !["mode", "page", "page_size", "view"].includes(key)) {
        next.set(key, value)
      }
    }
    const nextRefresh = refresh + 1
    searchRefreshRef.current = nextRefresh
    setSearching(true)
    setParams(next)
    setRefresh(nextRefresh)
  }
  const total =
    view === "entries" ? (entries?.total ?? 0) : (pending?.total ?? 0)
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const visibleCount =
    view === "entries"
      ? (entries?.items.length ?? 0)
      : (pending?.items.length ?? 0)
  const firstVisible = visibleCount === 0 ? 0 : (page - 1) * pageSize + 1
  const lastVisible =
    visibleCount === 0 ? 0 : (page - 1) * pageSize + visibleCount
  const locale = i18n.resolvedLanguage ?? i18n.language
  const fromInput = filterDate(draft.from)
  const untilInput = filterDate(draft.until)
  const categoryLabel = (value: string) =>
    t(`pages.billingDetails.categories.${value}`, {
      defaultValue: categoryNames[value] ?? value,
    })
  const entryLabel = (value: string) =>
    t(`pages.billingDetails.entryTypes.${value}`, {
      defaultValue: entryNames[value] ?? value,
    })
  const pageSizeItems = PAGE_SIZE_OPTIONS.map((value) => ({
    value,
    label: t("pages.operationLogs.pagination.perPage", { count: value }),
  }))
  const field = (key: string, value: string) =>
    setDraft({ ...draft, [key]: value })
  const pagination = (
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
          {t("pages.operationLogs.pagination.page", { page, pages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={loading || page === 1}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          aria-label={t("pages.operationLogs.pagination.previous")}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="rtl:rotate-180" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={loading || loadFailed || page >= pages}
          onClick={() => setPage((value) => Math.min(pages, value + 1))}
          aria-label={t("pages.operationLogs.pagination.next")}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value !== "entries" && value !== "pending") return
          setPage(1)
          navigate({ view: value })
        }}
        className="min-h-0 flex-1 gap-4"
      >
        <TabsList>
          <TabsTrigger value="entries">积分流水</TabsTrigger>
          <TabsTrigger value="pending">待处理与对账</TabsTrigger>
        </TabsList>
        {loadFailed && (
          <div>
            <Button variant="outline" onClick={reload}>
              重试
            </Button>
          </div>
        )}
        <TabsContent value="entries" className="min-h-0 flex-1">
          <Card className="h-full min-h-0">
            <CardContent className="min-h-0 flex-1 gap-4 px-0">
              <form
                onSubmit={search}
                className="flex flex-wrap items-center gap-2 px-(--card-spacing)"
              >
                <Input
                  id="billing-user"
                  className="w-32"
                  placeholder={t(
                    "pages.billingDetails.filters.userPlaceholder"
                  )}
                  aria-label={t("pages.billingDetails.filters.userPlaceholder")}
                  value={draft.user ?? ""}
                  onChange={(event) => field("user", event.target.value)}
                />
                <Input
                  id="billing-content"
                  className="w-32"
                  placeholder={t(
                    "pages.billingDetails.filters.itemPlaceholder"
                  )}
                  aria-label={t("pages.billingDetails.filters.itemPlaceholder")}
                  value={draft.content ?? ""}
                  onChange={(event) => field("content", event.target.value)}
                />
                <DatePickerField
                  id="billing-from"
                  className="w-32 sm:w-32"
                  label={t("audit.since")}
                  placeholder={t("audit.since")}
                  locale={locale}
                  value={fromInput}
                  onChange={(value) =>
                    field(
                      "from",
                      value ? startOfLocalDay(value).toISOString() : ""
                    )
                  }
                  disabled={untilInput ? { after: untilInput } : undefined}
                />
                <DatePickerField
                  id="billing-until"
                  className="w-32 sm:w-32"
                  label={t("audit.until")}
                  placeholder={t("audit.until")}
                  locale={locale}
                  value={untilInput}
                  onChange={(value) =>
                    field(
                      "until",
                      value ? endOfLocalDay(value).toISOString() : ""
                    )
                  }
                  disabled={fromInput ? { before: fromInput } : undefined}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className={
                          draft.category ? undefined : "text-muted-foreground"
                        }
                      />
                    }
                  >
                    {draft.category
                      ? categoryLabel(draft.category)
                      : t("pages.billingDetails.filters.category")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {t("pages.billingDetails.filters.category")}
                      </DropdownMenuLabel>
                      {CATEGORY_FILTERS.map((value) => (
                        <DropdownMenuCheckboxItem
                          key={value}
                          checked={draft.category === value}
                          onCheckedChange={(checked) =>
                            field("category", checked ? value : "")
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
                        type="button"
                        variant="outline"
                        className={
                          draft.entry_type ? undefined : "text-muted-foreground"
                        }
                      />
                    }
                  >
                    {draft.entry_type
                      ? entryLabel(draft.entry_type)
                      : t("pages.billingDetails.filters.entryType")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>
                        {t("pages.billingDetails.filters.entryType")}
                      </DropdownMenuLabel>
                      {ENTRY_FILTERS.map((value) => (
                        <DropdownMenuCheckboxItem
                          key={value}
                          checked={draft.entry_type === value}
                          onCheckedChange={(checked) =>
                            field("entry_type", checked ? value : "")
                          }
                        >
                          {entryLabel(value)}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
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
                  {t("pages.billingDetails.filters.search")}
                </Button>
              </form>
              <ScrollArea
                horizontal
                className="min-h-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
              >
                <Table
                  aria-busy={loading}
                  className={!entries?.items.length ? "h-full" : undefined}
                >
                  <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                    <TableRow>
                      <TableHead className="ps-(--card-spacing) text-muted-foreground">
                        入账时间
                      </TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>
                        {t("pages.billingDetails.columns.content")}
                      </TableHead>
                      <TableHead className="text-start">积分变动</TableHead>
                      <TableHead className="text-start">剩余积分</TableHead>
                      <TableHead className="w-20 pe-(--card-spacing) whitespace-nowrap">
                        {t("pages.operationLogs.columns.operations")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody
                    className={!entries?.items.length ? "h-full" : undefined}
                  >
                    {entries?.items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="ps-(--card-spacing) whitespace-nowrap text-muted-foreground">
                          {dateTime(e.occurred_at)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center gap-3"
                            title={e.user_email}
                          >
                            <HugeiconsIcon
                              icon={User02Icon}
                              className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            <span className="truncate">{e.user_name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {entryLabel(e.entry_type)} -{" "}
                          {categoryLabel(e.category)}
                        </TableCell>
                        <TableCell>{e.item_name}</TableCell>
                        <TableCell
                          className={`text-start font-medium tabular-nums ${e.credit_delta.startsWith("-") ? "text-red-600 dark:text-red-400" : "text-orange-600 dark:text-orange-400"}`}
                        >
                          {changedCredits(e.credit_delta, i18n.language)}
                        </TableCell>
                        <TableCell className="text-start text-yellow-600 tabular-nums dark:text-yellow-400">
                          {balanceCredits(e.balance_after, i18n.language)}
                        </TableCell>
                        <TableCell className="w-20 pe-(--card-spacing) whitespace-nowrap">
                          {e.transaction_id ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => setSelected(e.transaction_id)}
                            >
                              {t("pages.operationLogs.details")}
                            </Button>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!entries?.items.length && (
                      <TableRow className="h-full">
                        <TableCell
                          colSpan={7}
                          className="h-full text-center text-muted-foreground"
                        >
                          {loading
                            ? "正在读取流水…"
                            : t("pages.billingDetails.empty")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              {pagination}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent
          value="pending"
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">
            系统会自动重试扣费确认，并对带上游响应 ID 的 Responses
            异常查询真实用量；不会重新执行模型调用，证据不足时仍需人工核查。百智云历史余额以钱包侧记录为准。
          </p>
          {!!pending?.differences.length && (
            <div
              className="rounded-lg border border-destructive/30 p-4"
              role="alert"
            >
              <p className="font-medium">
                发现 {pending.differences.length} 个账户账目差异
              </p>
              {pending.differences.map((d) => (
                <p key={d.account_id} className="mt-2 text-xs">
                  账户 {d.account_id}：余额{" "}
                  {billingCredits(d.balance, i18n.language)} / 流水合计{" "}
                  {billingCredits(d.ledger_balance, i18n.language)}；冻结{" "}
                  {billingCredits(d.frozen, i18n.language)} / 未完成预留{" "}
                  {billingCredits(d.reserved, i18n.language)}
                </p>
              ))}
            </div>
          )}
          {!!pending?.migration_issues.length && (
            <Collapsible className="rounded-lg border p-4">
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start p-0 text-sm font-normal hover:bg-transparent"
                  />
                }
              >
                {pending.migration_issues.length} 项旧额度配置需要核实
              </CollapsibleTrigger>
              <CollapsibleContent>
                {pending.migration_issues.map((i) => (
                  <p key={i.id} className="mt-2 text-sm text-muted-foreground">
                    {i.subject}：{i.reason}
                  </p>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          <Card className="min-h-0 flex-1">
            <CardContent className="min-h-0 flex-1 gap-4 px-0">
              <ScrollArea
                horizontal
                className="min-h-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible"
              >
                <Table
                  aria-busy={loading}
                  className={!pending?.items.length ? "h-full" : undefined}
                >
                  <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                    <TableRow>
                      <TableHead className="ps-(--card-spacing) text-muted-foreground">
                        调用时间
                      </TableHead>
                      <TableHead>用户</TableHead>
                      <TableHead>
                        {t("pages.billingDetails.columns.content")}
                      </TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>原因</TableHead>
                      <TableHead className="text-end">预留积分</TableHead>
                      <TableHead className="w-20 pe-(--card-spacing) whitespace-nowrap">
                        {t("pages.operationLogs.columns.operations")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody
                    className={!pending?.items.length ? "h-full" : undefined}
                  >
                    {pending?.items.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="ps-(--card-spacing) whitespace-nowrap text-muted-foreground">
                          {dateTime(tx.started_at)}
                        </TableCell>
                        <TableCell>
                          <div
                            className="flex items-center gap-3"
                            title={tx.user_email}
                          >
                            <HugeiconsIcon
                              icon={User02Icon}
                              className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            <span className="truncate">{tx.user_name}</span>
                          </div>
                        </TableCell>
                        <TableCell>{tx.item_name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {stateNames[tx.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {tx.error_code || "—"}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {billingCredits(tx.reserve, i18n.language)}
                        </TableCell>
                        <TableCell className="w-20 pe-(--card-spacing) whitespace-nowrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => setSelected(tx.id)}
                          >
                            {t("pages.operationLogs.details")}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!pending?.items.length && (
                      <TableRow className="h-full">
                        <TableCell
                          colSpan={7}
                          className="h-full text-center text-muted-foreground"
                        >
                          {loading ? "正在读取…" : "暂无待处理交易"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              {pagination}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {selected && (
        <TransactionDialog
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </section>
  )
}

function TransactionDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string
  onClose: () => void
  onChanged: () => void
}) {
  const { i18n, t } = useTranslation()
  const { showToast } = useAppToast()
  const [data, setData] = useState<Transaction | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadRevision, setLoadRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const [result, setResult] = useState("failed")
  const [generatedImages, setGeneratedImages] = useState("0")
  const [counts, setCounts] = useState({
    input_tokens: "0",
    cached_input_tokens: "0",
    output_tokens: "0",
  })
  const resultItems = [
    { value: "failed", label: "失败或未执行" },
    { value: "succeeded", label: "执行成功" },
    ...(data?.category === "image"
      ? []
      : [{ value: "cancelled", label: "已取消" }]),
  ]
  useEffect(() => {
    let alive = true
    void api<Transaction>(`/api/admin/v1/billing/transactions/${id}`)
      .then((v) => {
        if (alive) {
          setData(v)
          setLoadFailed(false)
        }
      })
      .catch((e: Error) => {
        if (alive) {
          setLoadFailed(true)
          showToast({ status: "error", title: e.message })
        }
      })
    return () => {
      alive = false
    }
  }, [id, loadRevision, showToast])
  const act = async (action: string) => {
    setBusy(true)
    try {
      const body =
        action === "resolve"
          ? {
              reason,
              usage: {
                ...(data?.category === "model"
                  ? Object.fromEntries(
                      Object.entries(counts).map(([k, v]) => [k, Number(v)])
                    )
                  : data?.category === "image"
                    ? {
                        generated_images:
                          result === "succeeded" ? Number(generatedImages) : 0,
                      }
                    : {}),
                known: true,
                result,
              },
            }
          : { reason }
      await api(`/api/admin/v1/billing/transactions/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      setData(
        await api<Transaction>(`/api/admin/v1/billing/transactions/${id}`)
      )
      onChanged()
      showToast({
        status: "success",
        title: t("resources.operationCompleted"),
      })
    } catch (e) {
      showToast({ status: "error", title: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }
  const detailRows: { label: string; value: string | number }[] = data
    ? [
        { label: "用户", value: data.user_name },
        { label: "内容", value: data.item_name },
        { label: "状态", value: stateNames[data.status] },
        {
          label: "预留积分",
          value: billingCredits(data.reserve, i18n.language),
        },
        {
          label: "结算积分",
          value: billingCredits(data.amount, i18n.language),
        },
        { label: "交易 ID", value: data.id },
        { label: "调用时间", value: dateTime(data.started_at) },
        {
          label: "模式",
          value: data.mode === "remote" ? "百智云远程计费" : "本地计费",
        },
        { label: "会话", value: data.session_id || "未关联会话" },
        {
          label: "原始计价",
          value: `${billingCredits(data.raw_amount, i18n.language)} 积分`,
        },
        ...(data.request_id
          ? [{ label: "上游响应 ID", value: data.request_id }]
          : []),
        ...(data.usage?.stream !== undefined
          ? [
              {
                label: "响应方式",
                value: data.usage.stream ? "流式" : "非流式",
              },
            ]
          : []),
        ...(data.usage?.terminal_event
          ? [{ label: "终止事件", value: data.usage.terminal_event }]
          : []),
        ...(data.usage?.reconciled
          ? [{ label: "用量来源", value: "上游自动对账" }]
          : []),
        ...(data.usage && data.category === "model"
          ? [
              {
                label: "普通输入 Token",
                value: data.usage.input_tokens - data.usage.cached_input_tokens,
              },
              {
                label: "缓存输入 Token",
                value: data.usage.cached_input_tokens,
              },
              { label: "输出 Token", value: data.usage.output_tokens },
            ]
          : []),
        ...(data.usage && data.category === "image"
          ? [
              {
                label: "生成图片",
                value: `${data.usage.generated_images ?? 0} 张`,
              },
              ...(data.pricing?.image_unit
                ? [
                    {
                      label: "每张图片积分",
                      value: billingCredits(
                        data.pricing.image_unit,
                        i18n.language
                      ),
                    },
                  ]
                : []),
            ]
          : []),
      ]
    : []
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>计费交易详情</DialogTitle>
          {!data && !loadFailed && (
            <p className="text-sm text-muted-foreground">正在读取交易…</p>
          )}
        </DialogHeader>
        {loadFailed && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setLoadRevision((value) => value + 1)}
          >
            重试
          </Button>
        )}
        {data && (
          <div className="space-y-5">
            <ScrollArea className="rounded-lg border [&_[data-slot=scroll-area-viewport]]:max-h-[min(40vh,24rem)]">
              <dl className="divide-y">
                {detailRows.map(({ label, value }) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                  >
                    <dt className="w-32 shrink-0 break-words text-muted-foreground sm:w-44">
                      {label}
                    </dt>
                    <dd className="min-w-0 text-right break-all tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </ScrollArea>
            {data.error_code && (
              <p className="rounded-md border p-3 text-sm">
                处理原因：{data.error_code}
              </p>
            )}
            {data.usage?.initial_error_code && (
              <p className="rounded-md border p-3 text-sm">
                自动对账前原因：{data.usage.initial_error_code}
              </p>
            )}
            {data.wallet_records?.map((w) => (
              <div key={w.biz_id} className="rounded-md border p-3 text-xs">
                <p>百智云业务单：{w.biz_id}</p>
                <p className="mt-1">
                  状态：{w.status} {w.trace_id && `· 跟踪 ID：${w.trace_id}`}
                </p>
                <p className="mt-2 text-muted-foreground">
                  钱包历史余额需以百智云账单为准。
                </p>
              </div>
            ))}
            {data.status === "settling" && (
              <Button disabled={busy} onClick={() => void act("retry")}>
                重试结算
              </Button>
            )}
            {data.status === "unknown" && (
              <form
                className="space-y-3 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void act("resolve")
                }}
              >
                <p className="text-sm font-medium">填写核查结果</p>
                <Select
                  items={resultItems}
                  value={result}
                  onValueChange={(value) => {
                    if (value !== null) setResult(value)
                  }}
                >
                  <SelectTrigger aria-label="业务执行结果">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <SelectGroup>
                      {resultItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {data.category === "image" && result === "succeeded" && (
                  <Field>
                    <FieldLabel htmlFor="generated-images">
                      已归档图片张数
                    </FieldLabel>
                    <Input
                      id="generated-images"
                      type="number"
                      min="1"
                      max="16"
                      inputMode="numeric"
                      value={generatedImages}
                      onChange={(event) =>
                        setGeneratedImages(event.target.value)
                      }
                      required
                    />
                  </Field>
                )}
                {data.category === "model" && (
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(counts).map(([key, value]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={key}>
                          {
                            (
                              {
                                input_tokens: "总输入",
                                cached_input_tokens: "缓存输入",
                                output_tokens: "输出",
                              } as Record<string, string>
                            )[key]
                          }{" "}
                          Token
                        </FieldLabel>
                        <Input
                          id={key}
                          inputMode="numeric"
                          pattern="[0-9]+"
                          required
                          value={value}
                          onChange={(e) =>
                            setCounts({ ...counts, [key]: e.target.value })
                          }
                        />
                      </Field>
                    ))}
                  </div>
                )}
                <Field>
                  <FieldLabel htmlFor="resolve-reason">
                    核查证据与原因
                  </FieldLabel>
                  <Input
                    id="resolve-reason"
                    value={reason}
                    required
                    maxLength={1000}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={busy || !reason.trim()}>
                  提交核查结果
                </Button>
                <p className="text-xs text-muted-foreground">
                  提交只处理账目，不重新执行模型或工具。远程预扣状态未知时需先联系百智云核实。
                </p>
              </form>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
