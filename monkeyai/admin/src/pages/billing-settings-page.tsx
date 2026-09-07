import { useCallback, useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { api } from "@/lib/api"
import {
  credits,
  cycleNames,
  dateTime,
  validCredits,
  type AccountDetails,
  type BillingSettings,
  type Policy,
  type QuotaGroup,
  type Quotas,
  type QuotaUser,
} from "@/lib/billing"

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm"
type Target = {
  id: string
  name: string
  type: "group" | "user"
  own: string | null
  inherited: string
  root?: boolean
}

export function BillingSettingsPage() {
  const { t, i18n } = useTranslation()
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [quotas, setQuotas] = useState<Quotas | null>(null)
  const [pricing, setPricing] = useState<Pick<
    Policy,
    | "input_credits_per_million_tokens"
    | "cached_input_credits_per_million_tokens"
    | "output_credits_per_million_tokens"
  > | null>(null)
  const [cycle, setCycle] = useState("monthly")
  const [mode, setMode] = useState("local")
  const [enabled, setEnabled] = useState(false)
  const [changes, setChanges] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [query, setQuery] = useState("")
  const [target, setTarget] = useState<Target | null>(null)
  const [quotaValue, setQuotaValue] = useState("")
  const [inherit, setInherit] = useState(false)
  const [accountUser, setAccountUser] = useState<QuotaUser | null>(null)

  const load = useCallback(
    () =>
      Promise.all([
        api<BillingSettings>("/api/admin/v1/billing/settings"),
        api<Quotas>("/api/admin/v1/billing/quotas"),
      ]).then(([s, q]) => {
        setSettings(s)
        setQuotas(q)
        setPricing({
          input_credits_per_million_tokens:
            s.policy.input_credits_per_million_tokens,
          cached_input_credits_per_million_tokens:
            s.policy.cached_input_credits_per_million_tokens,
          output_credits_per_million_tokens:
            s.policy.output_credits_per_million_tokens,
        })
        setCycle(s.policy.pending_cycle ?? s.policy.quota_refresh_cycle)
        setMode(s.policy.charging_mode)
        setEnabled(s.policy.enabled)
        setChanges({})
      }),
    []
  )
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message))
  }, [load])
  const format = (value: string) => credits(value, i18n.language)
  const own = (type: string, id: string, value: string | null) =>
    Object.hasOwn(changes, `${type}:${id}`) ? changes[`${type}:${id}`] : value
  const openQuota = (v: Target) => {
    setTarget(v)
    setQuotaValue(v.own ?? v.inherited)
    setInherit(v.own === null && !v.root)
  }
  const save = async (section: string) => {
    if (!settings || !quotas || !pricing) return
    setBusy(section)
    setError("")
    setNotice("")
    try {
      if (section === "quotas") {
        const result = await api<Quotas>("/api/admin/v1/billing/quotas", {
          method: "PUT",
          body: JSON.stringify({
            revision: settings.policy.revision,
            changes: Object.entries(changes).map(([key, value]) => {
              const [subject_type, id] = key.split(":")
              return { subject_type, id, credits: value }
            }),
          }),
        })
        setQuotas(result)
        setChanges({})
        setSettings({
          ...settings,
          policy: { ...settings.policy, revision: result.revision },
        })
        setNotice(
          `周期额度已保存，将在 ${dateTime(result.effective_at)} 后的新周期生效。`
        )
      } else {
        const values =
          section === "pricing"
            ? pricing
            : section === "cycle"
              ? { quota_refresh_cycle: cycle }
              : { charging_mode: mode, enabled }
        const result = await api<BillingSettings>(
          `/api/admin/v1/billing/settings/${section}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              revision: settings.policy.revision,
              ...values,
            }),
          }
        )
        setSettings(result)
        setQuotas({ ...quotas, revision: result.policy.revision })
        setNotice(
          section === "cycle"
            ? "刷新设置已保存，请查看下次刷新时间。"
            : "设置已保存，对新调用生效。"
        )
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy("")
    }
  }
  const dirtyPricing =
    pricing &&
    settings &&
    Object.entries(pricing).some(
      ([key, value]) => value !== settings.policy[key as keyof Policy]
    )
  const userRow = (user: QuotaUser, inherited: string) => (
    <div
      key={user.id}
      className="flex min-h-10 flex-wrap items-center gap-2 rounded-md py-1 ps-6 hover:bg-muted/50"
    >
      <button
        className="min-w-0 flex-1 text-start text-sm hover:underline"
        onClick={() => setAccountUser(user)}
      >
        <span>{user.name}</span>
        <span className="ms-2 text-xs text-muted-foreground">{user.email}</span>
      </button>
      {user.status === "disabled" && <Badge variant="secondary">已停用</Badge>}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          openQuota({
            id: user.id,
            name: user.name,
            type: "user",
            own: own("user", user.id, user.credits),
            inherited,
          })
        }
      >
        <span className="tabular-nums">
          {format(own("user", user.id, user.credits) ?? inherited)}
        </span>
        <span className="text-xs text-muted-foreground">
          {own("user", user.id, user.credits) === null ? "继承" : "自定义"}
        </span>
      </Button>
    </div>
  )
  const renderGroup = (
    g: QuotaGroup,
    inherited: string,
    depth = 0
  ): React.ReactNode => {
    if (!quotas || depth > 100) return null
    const value = own("group", g.id, g.credits)
    const effective = value ?? inherited
    return (
      <details
        key={g.id}
        open
        className="ms-3 border-s border-border/50 ps-3 first:ms-0 first:border-0 first:ps-0"
      >
        <summary className="cursor-pointer py-1">
          <span className="inline-flex w-[calc(100%-1rem)] items-center justify-between gap-2 align-middle">
            <span className="text-sm font-medium">{g.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault()
                openQuota({
                  id: g.id,
                  name: g.name,
                  type: "group",
                  own: value,
                  inherited,
                  root: !g.parent_id,
                })
              }}
            >
              {format(effective)}
              <span className="text-xs text-muted-foreground">
                {value === null ? "继承" : "积分"}
              </span>
            </Button>
          </span>
        </summary>
        {quotas.groups
          .filter((c) => c.parent_id === g.id)
          .map((c) => renderGroup(c, effective, depth + 1))}
        {quotas.users
          .filter((u) => u.group_id === g.id)
          .map((u) => userRow(u, effective))}
      </details>
    )
  }
  if (!settings || !quotas || !pricing)
    return (
      <div className="p-4" role="status">
        {error || "正在读取计费设置…"}
        {error && (
          <Button
            className="ms-3"
            onClick={() => void load().catch((e: Error) => setError(e.message))}
          >
            重试
          </Button>
        )}
      </div>
    )
  const pricingFields = [
    ["input_credits_per_million_tokens", "inputToken"],
    ["cached_input_credits_per_million_tokens", "cachedInputToken"],
    ["output_credits_per_million_tokens", "outputToken"],
  ] as const
  return (
    <section className="grid flex-1 content-start gap-4 p-4 pt-0 xl:grid-cols-2">
      {(error || notice) && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm xl:col-span-2 ${error ? "border-destructive/30 text-destructive" : "text-muted-foreground"}`}
          role={error ? "alert" : "status"}
        >
          {error || notice}
          {error && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void load().catch((e: Error) => setError(e.message))
              }
            >
              重新加载（放弃草稿）
            </Button>
          )}
        </div>
      )}
      <Card className="xl:row-span-3">
        <CardHeader>
          <CardTitle>{t("pages.billingSettings.groupQuota.title")}</CardTitle>
          <CardDescription>
            分组提供成员默认额度，成员独立消费；点击成员查看当前余额。
          </CardDescription>
          <CardAction>
            <Button
              disabled={!Object.keys(changes).length || !!busy}
              onClick={() => void save("quotas")}
            >
              {busy === "quotas" ? "保存中…" : t("pages.billingSettings.save")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            aria-label="搜索计费成员"
            placeholder="搜索成员姓名或邮箱"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {cycleNames[settings.policy.quota_refresh_cycle]}额度 ·
            修改在下周期生效；当期补发请进入成员账户。
          </p>
          {query
            ? quotas.users
                .filter((u) =>
                  `${u.name} ${u.email}`
                    .toLowerCase()
                    .includes(query.toLowerCase())
                )
                .map((u) => userRow(u, u.effective_credits))
            : quotas.groups
                .filter((g) => !g.parent_id)
                .map((g) => renderGroup(g, "15000"))}
          {query &&
            !quotas.users.some((u) =>
              `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())
            ) && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                没有符合条件的成员。
              </p>
            )}
          <Link
            className="inline-block text-sm text-primary hover:underline"
            to="/console/settings/members"
          >
            管理成员与分组
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.billingSettings.quotaRefresh.title")}</CardTitle>
          <CardDescription>
            按上海时区在自然周期开始时刷新，余额不结转。
          </CardDescription>
          <CardAction>
            <Button
              disabled={
                cycle ===
                  (settings.policy.pending_cycle ??
                    settings.policy.quota_refresh_cycle) || !!busy
              }
              onClick={() => void save("cycle")}
            >
              {busy === "cycle" ? "保存中…" : t("pages.billingSettings.save")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field>
            <FieldLabel htmlFor="billing-cycle">刷新周期</FieldLabel>
            <select
              id="billing-cycle"
              className={selectClass}
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
            >
              {Object.entries(cycleNames).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}刷新
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-muted-foreground">
            下次刷新：{dateTime(settings.next_refresh_at)}（Asia/Shanghai）
          </p>
          {settings.policy.pending_cycle && (
            <p className="text-sm">
              将在 {dateTime(settings.policy.cycle_effective_at)} 切换为
              {cycleNames[settings.policy.pending_cycle]}刷新。
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.billingSettings.modelPricing.title")}</CardTitle>
          <CardDescription>
            每百万 Token 的积分价格，再乘以模型配置中的倍率。
          </CardDescription>
          <CardAction>
            <Button
              disabled={
                !dirtyPricing ||
                !Object.values(pricing).every((v) => validCredits(v)) ||
                !!busy
              }
              onClick={() => void save("pricing")}
            >
              {busy === "pricing" ? "保存中…" : t("pages.billingSettings.save")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5">
          {pricingFields.map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={key}>
                {t(`pages.billingSettings.modelPricing.${label}`)}
              </FieldLabel>
              <Input
                id={key}
                inputMode="decimal"
                value={pricing[key]}
                aria-invalid={!validCredits(pricing[key])}
                onChange={(e) =>
                  setPricing({ ...pricing, [key]: e.target.value })
                }
              />
              <FieldDescription>
                {validCredits(pricing[key])
                  ? "每百万 Token 消耗的积分，支持六位小数"
                  : "请输入非负数字，最多六位小数"}
              </FieldDescription>
            </Field>
          ))}
          <p className="text-xs text-muted-foreground">
            缓存命中从总输入中扣除后单独计价；缓存写入按普通输入计价。
          </p>
          <Link
            to="/console/resources/tools"
            className="text-sm text-primary hover:underline"
          >
            管理工具每次调用积分
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            {t("pages.billingSettings.chargingMethod.title")}
          </CardTitle>
          <CardDescription>
            新调用使用当前模式，已有交易按原模式完成结算。
          </CardDescription>
          <CardAction>
            <Button
              disabled={
                (mode === settings.policy.charging_mode &&
                  enabled === settings.policy.enabled) ||
                !!busy
              }
              onClick={() => void save("mode")}
            >
              {busy === "mode" ? "保存中…" : t("pages.billingSettings.save")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {[
              ["local", "本地计费"],
              ["remote", "远程计费（百智云）"],
            ].map(([value, label]) => (
              <Button
                key={value}
                variant={mode === value ? "outline" : "ghost"}
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用实际扣费
          </label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? "调用前预留积分，按真实用量结算。"
              : "当前仅记录调用，不扣积分；启用后从新调用开始计费。"}
          </p>
          {mode === "remote" && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              {settings.wallet.configured ? (
                <>
                  <Badge variant="secondary">证书已配置</Badge>
                  <p>
                    环境：{settings.wallet.environment} · 应用 ID：
                    {settings.wallet.app_id}
                  </p>
                  <p>
                    证书到期：{dateTime(settings.wallet.certificate_expires_at)}
                  </p>
                  <p>
                    已绑定{" "}
                    {quotas.users.filter((u) => u.external_user_id).length} /{" "}
                    {quotas.users.length}{" "}
                    位成员，未绑定成员无法发起远程付费调用。
                  </p>
                </>
              ) : (
                <p>
                  尚未配置百智云连接。请在部署环境设置应用 ID 和 mTLS
                  证书，再启用远程模式。
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                百智云扣款与本地周期额度分别管理；周期刷新不发放百智云积分。
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (!target || (!inherit && !validCredits(quotaValue))) return
              setChanges({
                ...changes,
                [`${target.type}:${target.id}`]: inherit ? null : quotaValue,
              })
              setTarget(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>调整 {target?.name} 的周期额度</DialogTitle>
              <DialogDescription>
                修改在下个周期生效，不改变当期余额。
              </DialogDescription>
            </DialogHeader>
            <div className="my-5 space-y-4">
              {!target?.root && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={inherit}
                    onChange={(e) => setInherit(e.target.checked)}
                  />
                  继承上级额度（{format(target?.inherited ?? "0")} 积分）
                </label>
              )}
              <Field>
                <FieldLabel htmlFor="quota-value">每周期积分</FieldLabel>
                <Input
                  id="quota-value"
                  disabled={inherit}
                  inputMode="decimal"
                  value={quotaValue}
                  onChange={(e) => setQuotaValue(e.target.value)}
                />
                <FieldDescription>
                  0 表示没有付费额度，留空不能代替继承。
                </FieldDescription>
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTarget(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={!inherit && !validCredits(quotaValue)}
              >
                加入待保存变更
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {accountUser && (
        <AccountDialog
          user={accountUser}
          groups={quotas.groups}
          onClose={() => setAccountUser(null)}
          onChanged={() => {
            void api<Quotas>("/api/admin/v1/billing/quotas")
              .then(setQuotas)
              .catch((e: Error) => setError(e.message))
          }}
        />
      )}
    </section>
  )
}

function AccountDialog({
  user,
  groups,
  onClose,
  onChanged,
}: {
  user: QuotaUser
  groups: QuotaGroup[]
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<AccountDetails | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [delta, setDelta] = useState("")
  const [reason, setReason] = useState("")
  const [external, setExternal] = useState(user.external_user_id ?? "")
  const [group, setGroup] = useState(user.group_id)
  const [key, setKey] = useState(() => crypto.randomUUID())
  const load = useCallback(
    () =>
      api<AccountDetails>(`/api/admin/v1/billing/accounts/${user.id}`).then(
        setData
      ),
    [user.id]
  )
  useEffect(() => {
    void load().catch((e: Error) => setError(e.message))
  }, [load])
  const run = async (kind: "adjust" | "wallet" | "group") => {
    setBusy(true)
    setError("")
    try {
      if (kind === "adjust") {
        await api(`/api/admin/v1/billing/accounts/${user.id}/adjustments`, {
          method: "POST",
          body: JSON.stringify({ delta, reason, idempotency_key: key }),
        })
        setDelta("")
        setReason("")
        setKey(crypto.randomUUID())
      }
      if (kind === "wallet")
        await api(`/api/admin/v1/billing/accounts/${user.id}/wallet`, {
          method: "PUT",
          body: JSON.stringify({ external_user_id: external }),
        })
      if (kind === "group")
        await api(`/api/admin/v1/users/${user.id}/billing-group`, {
          method: "PUT",
          body: JSON.stringify({ group_id: group }),
        })
      await load()
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{user.name} 的积分账户</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          <p role="status">正在读取账户…</p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-4">
              {[
                ["可用", data.account.available],
                ["冻结", data.account.frozen],
                ["账面剩余", data.account.balance],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg tabular-nums">{credits(value)}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              周期额度：{credits(data.account.quota)} · 当前周期：
              {dateTime(data.account.period_start_at)} —{" "}
              {dateTime(data.account.period_end_at)}
            </p>
            <Field>
              <FieldLabel htmlFor="billing-group">计费归属分组</FieldLabel>
              <div className="flex gap-2">
                <select
                  className={selectClass}
                  id="billing-group"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run("group")}
                >
                  保存归属
                </Button>
              </div>
              <FieldDescription>
                只影响下周期继承的额度，资源授权关系独立管理。
              </FieldDescription>
            </Field>
            <form
              className="space-y-3 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault()
                void run("adjust")
              }}
            >
              <Field>
                <FieldLabel htmlFor="adjust-delta">调整当期积分</FieldLabel>
                <Input
                  id="adjust-delta"
                  value={delta}
                  onChange={(e) => {
                    setDelta(e.target.value)
                    setKey(crypto.randomUUID())
                  }}
                  placeholder="正数补发，负数回收"
                  inputMode="decimal"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="adjust-reason">调整原因</FieldLabel>
                <Input
                  id="adjust-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    setKey(crypto.randomUUID())
                  }}
                />
              </Field>
              <Button
                type="submit"
                disabled={
                  busy ||
                  !validCredits(delta, true) ||
                  /^-?0(?:\.0+)?$/.test(delta) ||
                  !reason.trim()
                }
              >
                确认调整
              </Button>
            </form>
            {data.wallet.configured && (
              <div className="space-y-3 border-t pt-4">
                <Field>
                  <FieldLabel htmlFor="wallet-user">百智云用户 ID</FieldLabel>
                  <Input
                    id="wallet-user"
                    value={external}
                    onChange={(e) => setExternal(e.target.value)}
                  />
                  <FieldDescription>
                    保存时由服务端核实用户身份。此操作不发放或转移积分。
                  </FieldDescription>
                </Field>
                <Button
                  variant="outline"
                  disabled={busy || !external.trim()}
                  onClick={() => void run("wallet")}
                >
                  核实并绑定
                </Button>
                {data.wallet_available !== undefined && (
                  <p>
                    百智云当前可用：{credits(data.wallet_available)} 积分{" "}
                    <span className="text-xs text-muted-foreground">
                      （{dateTime(data.wallet_queried_at)} 查询）
                    </span>
                  </p>
                )}
                {data.wallet_error && (
                  <p className="text-sm text-destructive">
                    {data.wallet_error}
                  </p>
                )}
              </div>
            )}
            <details>
              <summary className="cursor-pointer text-sm">最近周期记录</summary>
              <div className="mt-2 space-y-2">
                {data.history.map((a) => (
                  <div
                    key={a.id}
                    className="flex justify-between gap-3 text-xs text-muted-foreground"
                  >
                    <span>{dateTime(a.period_start_at)}</span>
                    <span>
                      剩余 {credits(a.balance)} · 冻结 {credits(a.frozen)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
