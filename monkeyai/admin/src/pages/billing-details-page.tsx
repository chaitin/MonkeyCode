import { useEffect, useState, type FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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
const selectClass = "h-9 rounded-md border bg-background px-3 text-sm"
const categoryNames: Record<string, string> = {
  model: "模型",
  tool: "工具",
  other: "其他",
}

export function BillingDetailsPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const [draft, setDraft] = useState(() => Object.fromEntries(params))
  const [entries, setEntries] = useState<Entries | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [summary, setSummary] = useState<{
    charges: string
    refunds: string
    net_consumption: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const view = params.get("view") ?? "entries"
  const page = Math.max(1, Number(params.get("page") ?? "1"))
  const pageSize = Number(params.get("page_size") ?? "20")
  const query = params.toString()
  useEffect(() => {
    let cancelled = false
    const next = new URLSearchParams(query)
    for (const key of ["from", "until"]) {
      const v = next.get(key)
      if (v && /^\d{4}-\d{2}-\d{2}$/.test(v))
        next.set(key, new Date(`${v}T00:00:00+08:00`).toISOString())
    }
    const request =
      view === "entries"
        ? Promise.all([
            api<Entries>(`/api/admin/v1/billing/entries?${next}`),
            api<{ charges: string; refunds: string; net_consumption: string }>(
              `/api/admin/v1/billing/summary?${next}`
            ),
          ]).then(([list, total]) => {
            if (!cancelled) {
              setEntries(list)
              setSummary(total)
            }
          })
        : api<Pending>(`/api/admin/v1/billing/reconciliation?${next}`).then(
            (set) => {
              if (!cancelled) setPending(set)
            }
          )
    void request
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query, view, refresh])
  const navigate = (change: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(change).forEach(([key, value]) =>
      value ? next.set(key, value) : next.delete(key)
    )
    setError("")
    setLoading(true)
    setParams(next)
    setRefresh((v) => v + 1)
  }
  const reload = () => {
    setError("")
    setLoading(true)
    setRefresh((v) => v + 1)
  }
  const search = (e: FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    setParams({ ...draft, page: "1", view: "entries" })
    setRefresh((v) => v + 1)
  }
  const total =
    view === "entries" ? (entries?.total ?? 0) : (pending?.total ?? 0)
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const field = (key: string, value: string) =>
    setDraft({ ...draft, [key]: value })
  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant={view === "entries" ? "secondary" : "ghost"}
            onClick={() => navigate({ view: "entries", page: "1" })}
          >
            积分流水
          </Button>
          <Button
            variant={view === "pending" ? "secondary" : "ghost"}
            onClick={() => navigate({ view: "pending", page: "1" })}
          >
            待处理与对账
          </Button>
        </div>
        <Button variant="outline" disabled={loading} onClick={reload}>
          {loading ? "读取中…" : "刷新"}
        </Button>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
          <Button variant="ghost" size="sm" onClick={reload}>
            重试
          </Button>
        </div>
      )}
      {view === "entries" && (
        <>
          {summary && (
            <div className="grid grid-cols-3 gap-4">
              {[
                ["扣费积分", summary.charges],
                ["退款积分", summary.refunds],
                ["净消耗积分", summary.net_consumption],
              ].map(([label, value]) => (
                <Card key={label}>
                  <CardContent className="py-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-2 text-xl tabular-nums">
                      {credits(value, i18n.language)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <CardContent className="p-0">
              <form
                onSubmit={search}
                className="flex flex-wrap items-end gap-3 p-5"
              >
                <Field className="w-48">
                  <FieldLabel htmlFor="billing-user">用户或邮箱</FieldLabel>
                  <Input
                    id="billing-user"
                    placeholder="搜索用户或邮箱"
                    value={draft.user ?? ""}
                    onChange={(e) => field("user", e.target.value)}
                  />
                </Field>
                <Field className="w-48">
                  <FieldLabel htmlFor="billing-content">内容</FieldLabel>
                  <Input
                    id="billing-content"
                    placeholder="搜索资源或调整原因"
                    value={draft.content ?? ""}
                    onChange={(e) => field("content", e.target.value)}
                  />
                </Field>
                <Field className="w-40">
                  <FieldLabel htmlFor="billing-from">开始日期</FieldLabel>
                  <Input
                    id="billing-from"
                    type="date"
                    value={draft.from ?? ""}
                    onChange={(e) => field("from", e.target.value)}
                  />
                </Field>
                <Field className="w-40">
                  <FieldLabel htmlFor="billing-until">
                    结束日期（不含）
                  </FieldLabel>
                  <Input
                    id="billing-until"
                    type="date"
                    value={draft.until ?? ""}
                    onChange={(e) => field("until", e.target.value)}
                  />
                </Field>
                <select
                  className={selectClass}
                  aria-label="资源类型"
                  value={draft.category ?? ""}
                  onChange={(e) => field("category", e.target.value)}
                >
                  <option value="">全部类型</option>
                  {Object.entries(categoryNames).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  aria-label="流水类型"
                  value={draft.entry_type ?? ""}
                  onChange={(e) => field("entry_type", e.target.value)}
                >
                  <option value="">全部账目</option>
                  {Object.entries(entryNames).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  aria-label="计费模式"
                  value={draft.mode ?? ""}
                  onChange={(e) => field("mode", e.target.value)}
                >
                  <option value="">全部模式</option>
                  <option value="local">本地</option>
                  <option value="remote">百智云</option>
                </select>
                <Button type="submit" disabled={loading}>
                  搜索
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft({})
                    setLoading(true)
                    setParams({})
                    setRefresh((v) => v + 1)
                  }}
                >
                  重置
                </Button>
              </form>
              <Table aria-busy={loading}>
                <TableHeader>
                  <TableRow>
                    <TableHead>入账时间</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>
                      {t("pages.billingDetails.columns.content")}
                    </TableHead>
                    <TableHead>模式</TableHead>
                    <TableHead className="text-end">积分变动</TableHead>
                    <TableHead className="text-end">当期剩余额度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries?.items.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {dateTime(e.occurred_at)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{e.user_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {e.user_email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {entryNames[e.entry_type]}
                        </Badge>
                        <span className="ms-2 text-xs text-muted-foreground">
                          {categoryNames[e.category]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {e.transaction_id ? (
                          <button
                            className="text-start hover:text-primary hover:underline"
                            onClick={() => setSelected(e.transaction_id)}
                          >
                            {e.item_name}
                          </button>
                        ) : (
                          e.item_name
                        )}
                      </TableCell>
                      <TableCell>
                        {e.mode === "remote" ? "百智云" : "本地"}
                      </TableCell>
                      <TableCell className="text-end font-medium tabular-nums">
                        {credits(e.credit_delta, i18n.language)}
                      </TableCell>
                      <TableCell className="text-end text-muted-foreground tabular-nums">
                        {credits(e.balance_after, i18n.language)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!entries?.items.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-36 text-center text-muted-foreground"
                      >
                        {loading
                          ? "正在读取流水…"
                          : t("pages.billingDetails.empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      {view === "pending" && (
        <>
          <p className="text-sm text-muted-foreground">
            这里只重试扣费确认；结果未知的业务调用不会自动重新执行。百智云历史余额以钱包侧记录为准。
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
                  账户 {d.account_id}：余额 {d.balance} / 流水合计{" "}
                  {d.ledger_balance}；冻结 {d.frozen} / 未完成预留 {d.reserved}
                </p>
              ))}
            </div>
          )}
          {!!pending?.migration_issues.length && (
            <details className="rounded-lg border p-4">
              <summary className="cursor-pointer text-sm">
                {pending.migration_issues.length} 项旧额度配置需要核实
              </summary>
              {pending.migration_issues.map((i) => (
                <p key={i.id} className="mt-2 text-sm text-muted-foreground">
                  {i.subject}：{i.reason}
                </p>
              ))}
            </details>
          )}
          <Card>
            <CardContent className="p-0">
              <Table aria-busy={loading}>
                <TableHeader>
                  <TableRow>
                    <TableHead>调用时间</TableHead>
                    <TableHead>用户</TableHead>
                    <TableHead>
                      {t("pages.billingDetails.columns.content")}
                    </TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead className="text-end">预留积分</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending?.items.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap">
                        {dateTime(tx.started_at)}
                      </TableCell>
                      <TableCell>{tx.user_name}</TableCell>
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
                        {credits(tx.reserve)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelected(tx.id)}
                        >
                          查看详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!pending?.items.length && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-36 text-center text-muted-foreground"
                      >
                        {loading ? "正在读取…" : "暂无待处理交易"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <div className="flex items-center gap-3">
          <select
            className={selectClass}
            aria-label="每页条数"
            value={pageSize}
            onChange={(e) => navigate({ page_size: e.target.value, page: "1" })}
          >
            {[20, 50, 100].map((v) => (
              <option key={v} value={v}>
                {v} 条 / 页
              </option>
            ))}
          </select>
          <span>共 {total} 条</span>
        </div>
        <div className="flex items-center gap-3">
          <span>
            第 {page} / {pages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page <= 1}
            onClick={() => navigate({ page: String(page - 1) })}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || page >= pages}
            onClick={() => navigate({ page: String(page + 1) })}
          >
            下一页
          </Button>
        </div>
      </div>
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
  const [data, setData] = useState<Transaction | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const [result, setResult] = useState("failed")
  const [counts, setCounts] = useState({
    input_tokens: "0",
    cached_input_tokens: "0",
    output_tokens: "0",
  })
  useEffect(() => {
    let alive = true
    void api<Transaction>(`/api/admin/v1/billing/transactions/${id}`)
      .then((v) => {
        if (alive) setData(v)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [id])
  const act = async (action: string) => {
    setBusy(true)
    setError("")
    try {
      const body =
        action === "resolve"
          ? {
              reason,
              usage: {
                ...Object.fromEntries(
                  Object.entries(counts).map(([k, v]) => [k, Number(v)])
                ),
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
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
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
          <DialogDescription>
            {data ? `${data.user_name} · ${data.item_name}` : "正在读取交易…"}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {data && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4">
              {[
                ["状态", stateNames[data.status]],
                ["预留积分", credits(data.reserve)],
                ["结算积分", credits(data.amount)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 font-medium">{value}</p>
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">交易 ID</dt>
              <dd className="font-mono text-xs break-all">{data.id}</dd>
              <dt className="text-muted-foreground">调用时间</dt>
              <dd>{dateTime(data.started_at)}</dd>
              <dt className="text-muted-foreground">模式</dt>
              <dd>{data.mode === "remote" ? "百智云远程计费" : "本地计费"}</dd>
              <dt className="text-muted-foreground">会话</dt>
              <dd className="break-all">{data.session_id || "未关联会话"}</dd>
              <dt className="text-muted-foreground">原始计价</dt>
              <dd>{credits(data.raw_amount)} 积分</dd>
            </dl>
            {data.usage && data.category === "model" && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>用量组成</TableHead>
                    <TableHead>Token 数</TableHead>
                    <TableHead>每百万 Token 积分</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    [
                      "普通输入",
                      data.usage.input_tokens - data.usage.cached_input_tokens,
                      data.pricing?.input,
                    ],
                    [
                      "缓存输入",
                      data.usage.cached_input_tokens,
                      data.pricing?.cached,
                    ],
                    ["输出", data.usage.output_tokens, data.pricing?.output],
                  ].map(([label, count, price]) => (
                    <TableRow key={label}>
                      <TableCell>{label}</TableCell>
                      <TableCell>{count}</TableCell>
                      <TableCell>{credits(price as string)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {data.pricing && (
              <p className="text-xs text-muted-foreground">
                {data.category === "model"
                  ? `模型倍率：${credits(data.pricing.multiplier)}`
                  : `每次调用：${credits(data.pricing.tool)} 积分`}
              </p>
            )}
            {data.error_code && (
              <p className="rounded-md border p-3 text-sm">
                处理原因：{data.error_code}
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
            {data.status === "settled" &&
              data.mode === "local" &&
              data.amount &&
              !/^0(?:\.0+)?$/.test(data.amount) &&
              !data.entries?.some((e) => e.entry_type === "refund") && (
                <form
                  className="space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act("refund")
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="refund-reason">
                      全额退款原因
                    </FieldLabel>
                    <Input
                      id="refund-reason"
                      value={reason}
                      required
                      maxLength={500}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={busy || !reason.trim()}
                  >
                    退回原周期账户
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    退款保留原始扣款流水。原周期已结束时，退款不会转入当前周期。
                  </p>
                </form>
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
                <select
                  className={selectClass}
                  aria-label="业务执行结果"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="failed">失败或未执行</option>
                  <option value="succeeded">执行成功</option>
                  <option value="cancelled">已取消</option>
                </select>
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
