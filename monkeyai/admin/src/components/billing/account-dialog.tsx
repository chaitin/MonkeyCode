import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ApiError, api } from "@/lib/api"
import {
  credits,
  dateTime,
  validCredits,
  type AccountDetails,
} from "@/lib/billing"
import { CONSOLE_ROUTES } from "@/lib/routes"

type AccountMember = {
  id: string
  name: string
  email: string
  role: "admin" | "user"
  status: "active" | "disabled"
  joined_at: string
  last_login_at?: string
}

export function AccountDialog({
  userId,
  onClose,
  onChanged,
}: {
  userId: string
  onClose: () => void
  onChanged?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const displayCredits = (value: string | null | undefined) =>
    credits(value, i18n.language, 0, "floor")
  const [data, setData] = useState<AccountDetails | null>(null)
  const [member, setMember] = useState<AccountMember | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState<"add" | "deduct">("add")
  const [adjustmentAmount, setAdjustmentAmount] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [external, setExternal] = useState("")
  const running = useRef(false)
  const accountPath = `/api/admin/v1/billing/accounts/${encodeURIComponent(userId)}`
  const memberPath = `/api/admin/v1/users/${encodeURIComponent(userId)}`
  const load = useCallback(
    () =>
      Promise.all([
        api<AccountMember>(memberPath),
        api<AccountDetails>(accountPath),
      ]).then(([person, value]) => {
        setMember(person)
        setData(value)
        setExternal(value.external_user_id)
        setLoadFailed(false)
      }),
    [accountPath, memberPath]
  )
  const loadAccount = useCallback(() => {
    void load().catch((error: Error) => {
      setLoadFailed(true)
      showToast({ status: "error", title: error.message })
    })
  }, [load, showToast])
  useEffect(() => {
    loadAccount()
  }, [loadAccount])
  const run = async (kind: "adjust" | "wallet") => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      if (kind === "adjust") {
        await api(`${accountPath}/adjustments`, {
          method: "POST",
          body: JSON.stringify({
            delta:
              adjustmentType === "add"
                ? adjustmentAmount
                : `-${adjustmentAmount}`,
            reason: adjustmentReason.trim(),
            version: data?.account.version,
          }),
        })
        setAdjustOpen(false)
        setAdjustmentAmount("")
        setAdjustmentReason("")
      }
      if (kind === "wallet")
        await api(`${accountPath}/wallet`, {
          method: "PUT",
          body: JSON.stringify({ external_user_id: external }),
        })
      await load()
      onChanged?.()
      showToast({
        status: "success",
        title: t("resources.operationCompleted"),
      })
    } catch (e) {
      showToast({ status: "error", title: (e as Error).message })
      if (e instanceof ApiError && (e.status === 409 || e.status === 412)) {
        await load().catch((error: Error) =>
          showToast({ status: "error", title: error.message })
        )
      }
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const adjustmentValid =
    validCredits(adjustmentAmount) &&
    !/^0(?:\.0+)?$/.test(adjustmentAmount) &&
    adjustmentReason.trim().length > 0
  const userLabel = member?.name || member?.email || userId
  const feeSearch = member?.email || member?.name
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {member?.name ? `${member.name} 的账户详情` : "账户详情"}
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="block">{member?.email || "正在读取邮箱…"}</span>
              <span className="block break-all">{userId}</span>
            </DialogDescription>
          </DialogHeader>
          {loadFailed && (
            <Button type="button" variant="outline" onClick={loadAccount}>
              重试
            </Button>
          )}
          {(!data || !member) && !loadFailed ? (
            <p role="status">正在读取成员和账户信息…</p>
          ) : data && member ? (
            <div className="space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-medium">成员信息</h3>
                <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
                  {[
                    ["姓名", member.name],
                    ["邮箱", member.email],
                    ["用户 ID", member.id],
                    ["角色", member.role === "admin" ? "管理员" : "普通成员"],
                    ["状态", member.status === "active" ? "正常" : "已停用"],
                    ["加入时间", dateTime(member.joined_at)],
                    [
                      "最近登录",
                      member.last_login_at
                        ? dateTime(member.last_login_at)
                        : "尚未登录",
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 space-y-1 text-sm">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-medium">积分账户</h3>
                <dl className="divide-y rounded-lg border">
                  {[
                    ["可用", data.account.available],
                    ["冻结", data.account.frozen],
                    ["账面剩余", data.account.balance],
                    ["满额度", data.account.quota],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="tabular-nums">{displayCredits(value)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
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
                      百智云当前可用：{displayCredits(data.wallet_available)}{" "}
                      积分{" "}
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
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAdjustmentType("add")
                    setAdjustmentAmount("")
                    setAdjustmentReason("")
                    setAdjustOpen(true)
                  }}
                >
                  调整积分
                </Button>
                {feeSearch && (
                  <Button
                    variant="secondary"
                    render={
                      <Link
                        to={`${CONSOLE_ROUTES.billingDetails}?view=entries&user=${encodeURIComponent(feeSearch)}`}
                      />
                    }
                  >
                    费用明细
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={adjustOpen}
        onOpenChange={(open) => {
          if (!busy) setAdjustOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>调整积分</DialogTitle>
            <DialogDescription>
              为 {userLabel} 调整当前周期的账面积分。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (adjustmentValid) void run("adjust")
            }}
          >
            <Field>
              <FieldLabel>调整方式</FieldLabel>
              <RadioGroup
                className="grid grid-cols-2 gap-3"
                value={adjustmentType}
                onValueChange={(value) =>
                  setAdjustmentType(value as "add" | "deduct")
                }
                aria-label="调整方式"
              >
                {[
                  ["add", "增加积分"],
                  ["deduct", "扣除积分"],
                ].map(([value, label]) => (
                  <FieldLabel
                    key={value}
                    htmlFor={`adjustment-type-${value}`}
                    className="h-9 w-full cursor-pointer rounded-md border border-input px-2.5 font-normal shadow-xs transition-[color,box-shadow] hover:bg-muted/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 dark:bg-input/30"
                  >
                    <RadioGroupItem
                      id={`adjustment-type-${value}`}
                      value={value}
                      disabled={busy}
                    />
                    <span>{label}</span>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="adjustment-amount">积分数量</FieldLabel>
              <Input
                id="adjustment-amount"
                value={adjustmentAmount}
                onChange={(event) => setAdjustmentAmount(event.target.value)}
                placeholder="请输入正数"
                inputMode="decimal"
                disabled={busy}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="adjustment-reason">调整原因</FieldLabel>
              <Input
                id="adjustment-reason"
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value)}
                maxLength={500}
                disabled={busy}
              />
            </Field>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setAdjustOpen(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                variant={
                  adjustmentType === "deduct" ? "destructive" : "default"
                }
                disabled={busy || !adjustmentValid}
              >
                {busy ? "调整中…" : "确认调整"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
