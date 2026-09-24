import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  Folder02Icon,
  FolderIcon,
  LinkSquare02Icon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { useAppToast } from "@/components/animated-toast-provider"
import {
  GroupSelect,
  type GroupSelectionValue,
} from "@/components/group-select"
import { Button } from "@/components/ui/button"
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError, api } from "@/lib/api"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { cn } from "@/lib/utils"
import {
  WalletSettings,
  type WalletInput,
} from "@/components/billing/wallet-settings"
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

type PricingKey =
  | "input_credits_per_million_tokens"
  | "cached_input_credits_per_million_tokens"
  | "output_credits_per_million_tokens"
type PricingSettings = Pick<Policy, PricingKey>

type Target = {
  id: string
  name: string
  type: "group"
  own: string | null
  inherited: string
  allowInherit?: boolean
}

export function BillingSettingsPage() {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [quotas, setQuotas] = useState<Quotas | null>(null)
  const [pricing, setPricing] = useState<PricingSettings | null>(null)
  const [cycle, setCycle] = useState("weekly")
  const [cycleDialogOpen, setCycleDialogOpen] = useState(false)
  const [cycleValue, setCycleValue] = useState("weekly")
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetSelection, setResetSelection] = useState<GroupSelectionValue>({
    groupIds: [],
    userIds: [],
  })
  const [resetRequestID, setResetRequestID] = useState("")
  const [mode, setMode] = useState("local")
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState("")
  const [loadFailed, setLoadFailed] = useState(false)
  const [walletVersion, setWalletVersion] = useState(0)
  const [query, setQuery] = useState("")
  const [target, setTarget] = useState<Target | null>(null)
  const [quotaValue, setQuotaValue] = useState("")
  const [quotaMode, setQuotaMode] = useState<"inherit" | "custom">("custom")
  const [pricingTarget, setPricingTarget] = useState<PricingKey | null>(null)
  const [pricingValue, setPricingValue] = useState("")
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
        setLoadFailed(false)
        setWalletVersion((value) => value + 1)
      }),
    []
  )
  const handleLoadFailure = useCallback(
    (error: Error) => {
      setLoadFailed(true)
      showToast({ status: "error", title: error.message })
    },
    [showToast]
  )
  const retryLoad = () => {
    setLoadFailed(false)
    void load().catch(handleLoadFailure)
  }
  useEffect(() => {
    void load().catch(handleLoadFailure)
  }, [handleLoadFailure, load])
  const format = (value: string) => credits(value, i18n.language)
  const integerQuotaValue = (value: string) => value.split(".", 1)[0]
  const formatQuota = (value: string) =>
    credits(value, i18n.language, 0, "floor")
  const validQuota = (value: string) => /^\d{1,12}$/.test(value)
  const openQuota = (value: Target) => {
    setTarget(value)
    setQuotaValue(integerQuotaValue(value.own ?? value.inherited))
    setQuotaMode(
      value.own === null && value.allowInherit !== false ? "inherit" : "custom"
    )
  }
  const openPricing = (key: PricingKey) => {
    if (!pricing) return
    setPricingTarget(key)
    setPricingValue(pricing[key])
  }
  const saveQuota = async (event: FormEvent) => {
    event.preventDefault()
    if (
      !target ||
      !settings ||
      !quotas ||
      busy ||
      (quotaMode === "custom" && !validQuota(quotaValue))
    )
      return
    setBusy("quota")
    try {
      const result = await api<Quotas>("/api/admin/v1/billing/quotas", {
        method: "PUT",
        body: JSON.stringify({
          revision: settings.policy.revision,
          changes: [
            {
              subject_type: target.type,
              id: target.id,
              credits: quotaMode === "inherit" ? null : quotaValue,
            },
          ],
        }),
      })
      setQuotas(result)
      setSettings({
        ...settings,
        policy: { ...settings.policy, revision: result.revision },
      })
      setTarget(null)
      showToast({
        status: "success",
        title: `周期额度已保存，将在 ${dateTime(result.effective_at)} 后的新周期生效。`,
      })
    } catch (error) {
      showToast({ status: "error", title: (error as Error).message })
    } finally {
      setBusy("")
    }
  }
  const save = async (
    section: string,
    wallet?: WalletInput,
    pricingOverride?: PricingSettings,
    cycleOverride?: string
  ): Promise<boolean> => {
    if (!settings || !quotas || !pricing) return false
    setBusy(section)
    try {
      const values =
        section === "wallet"
          ? wallet
          : section === "pricing"
            ? (pricingOverride ?? pricing)
            : section === "cycle"
              ? { quota_refresh_cycle: cycleOverride ?? cycle }
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
      showToast({
        status: "success",
        title:
          section === "wallet"
            ? result.policy.charging_mode === "remote" && result.policy.enabled
              ? "百智云连接配置已保存，无需重启。"
              : "百智云连接配置已保存，无需重启；请保存计费方式以启用远程计费。"
            : section === "cycle"
              ? `重置设置已保存，将于 ${dateTime(result.next_refresh_at)} 重置，当前余额不变。`
              : "设置已保存，对新调用生效。",
      })
    } catch (e) {
      showToast({ status: "error", title: (e as Error).message })
      if (section === "wallet") throw e
      return false
    } finally {
      setBusy("")
    }
    return true
  }
  const resetCurrentQuotas = async (event: FormEvent) => {
    event.preventDefault()
    if (
      !resetRequestID ||
      (resetSelection.groupIds.length === 0 &&
        resetSelection.userIds.length === 0) ||
      busy
    )
      return
    setBusy("reset")
    try {
      const result = await api<{ reset_count: number }>(
        "/api/admin/v1/billing/quotas/reset",
        {
          method: "POST",
          body: JSON.stringify({
            group_ids: resetSelection.groupIds,
            user_ids: resetSelection.userIds,
            idempotency_key: resetRequestID,
          }),
        }
      )
      setResetDialogOpen(false)
      showToast({
        status: "success",
        title: t("pages.billingSettings.quotaRefresh.resetSuccess", {
          count: result.reset_count,
        }),
      })
      void load().catch(handleLoadFailure)
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setBusy("")
    }
  }
  const refreshQuotas = () => {
    void api<Quotas>("/api/admin/v1/billing/quotas")
      .then(setQuotas)
      .catch((error: Error) =>
        showToast({ status: "error", title: error.message })
      )
  }
  const dirtyMode =
    settings &&
    (mode !== settings.policy.charging_mode ||
      enabled !== settings.policy.enabled)
  const savedLocalBilling =
    settings?.policy.enabled && settings.policy.charging_mode === "local"
  const savedBillingStateLabel = t(
    `pages.billingSettings.groupQuota.${settings?.policy.enabled ? "remoteBilling" : "billingDisabled"}`
  )
  const quotaCycleName = t(
    `pages.billingSettings.quotaRefresh.cycleLabels.${cycle}`
  )
  const periodicQuotaLabel = (value: string) =>
    t("pages.billingSettings.groupQuota.summary", {
      cycle: quotaCycleName,
      credits: formatQuota(value),
    })
  const userItem = (user: QuotaUser) => {
    const disabled = user.status === "disabled"
    const balance = user.balance_credits
    return (
      <div key={user.id} role="listitem">
        <Item
          size="sm"
          variant="outline"
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto cursor-pointer justify-start text-start whitespace-normal hover:bg-muted"
              onClick={() => setAccountUser(user)}
            />
          }
          className={cn(disabled && "text-muted-foreground")}
        >
          <ItemMedia>
            <HugeiconsIcon
              icon={User02Icon}
              className={cn(
                "size-4 shrink-0",
                disabled
                  ? "text-muted-foreground"
                  : "text-blue-600 dark:text-blue-400"
              )}
              strokeWidth={2}
              aria-hidden="true"
            />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="max-w-full min-w-0">
              <span className="truncate">{user.name}</span>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {savedLocalBilling
                ? t("pages.billingSettings.groupQuota.remaining", {
                    credits: balance === undefined ? "—" : format(balance),
                  })
                : savedBillingStateLabel}
            </span>
          </ItemActions>
        </Item>
      </div>
    )
  }
  const renderGroup = (
    g: QuotaGroup,
    inherited: string,
    depth = 0
  ): React.ReactNode => {
    if (!quotas || depth > 100) return null
    const value = g.credits
    const effective = value ?? inherited
    const children = quotas.groups.filter((child) => child.parent_id === g.id)
    const openGroupQuota = () =>
      openQuota({
        id: g.id,
        name: g.name,
        type: "group",
        own: value,
        inherited,
        allowInherit: g.allow_inherit,
      })
    return (
      <Collapsible key={g.id} defaultOpen={children.length > 0}>
        <div className="group/quota-row relative -mx-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full cursor-pointer justify-between gap-2 pe-2 text-start font-normal hover:bg-foreground/5!"
            style={{
              paddingInlineStart: `${depth * 1.25 + 2.5}rem`,
            }}
            onClick={openGroupQuota}
          >
            <span className="min-w-0 flex-1 truncate text-start">{g.name}</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums transition-colors group-hover/quota-row:text-foreground">
              {savedLocalBilling
                ? periodicQuotaLabel(effective)
                : savedBillingStateLabel}
            </span>
          </Button>
          {children.length > 0 ? (
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="group absolute top-0 z-10 cursor-pointer hover:bg-transparent! active:translate-y-0! aria-expanded:bg-transparent!"
                  style={{ insetInlineStart: `${depth * 1.25 + 0.25}rem` }}
                  aria-label={`展开或折叠 ${g.name}`}
                />
              }
            >
              <HugeiconsIcon
                icon={FolderIcon}
                className="size-4 text-yellow-600 group-aria-expanded:hidden dark:text-yellow-400"
                strokeWidth={2}
              />
              <HugeiconsIcon
                icon={Folder02Icon}
                className="hidden size-4 text-yellow-600 group-aria-expanded:block dark:text-yellow-400"
                strokeWidth={2}
              />
            </CollapsibleTrigger>
          ) : (
            <span
              className="absolute top-0 z-10 flex size-8 items-center justify-center"
              style={{ insetInlineStart: `${depth * 1.25 + 0.25}rem` }}
            >
              <HugeiconsIcon
                icon={FolderIcon}
                className="size-4 text-yellow-600 dark:text-yellow-400"
                strokeWidth={2}
              />
            </span>
          )}
        </div>
        {children.length > 0 && (
          <CollapsibleContent className="pt-1">
            <div className="flex flex-col gap-1">
              {children.map((child) =>
                renderGroup(child, effective, depth + 1)
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    )
  }
  if (!settings || !quotas || !pricing)
    return (
      <div className="p-4" role="status">
        {loadFailed ? (
          <Button variant="outline" onClick={retryLoad}>
            重试
          </Button>
        ) : (
          "正在读取计费设置…"
        )}
      </div>
    )
  const pricingFields = [
    {
      key: "input_credits_per_million_tokens",
      title: "inputToken",
      description: "inputTokenDescription",
    },
    {
      key: "cached_input_credits_per_million_tokens",
      title: "cachedInputToken",
      description: "cachedInputTokenDescription",
    },
    {
      key: "output_credits_per_million_tokens",
      title: "outputToken",
      description: "outputTokenDescription",
    },
  ] as const satisfies ReadonlyArray<{
    key: PricingKey
    title: string
    description: string
  }>
  const selectedPricingField = pricingFields.find(
    (field) => field.key === pricingTarget
  )
  const cycleItems = Object.keys(cycleNames).map((value) => ({
    value,
    label: t(`pages.billingSettings.quotaRefresh.cycles.${value}`),
  }))
  const modeItems = [
    {
      value: "disabled",
      label: t("pages.billingSettings.chargingMethod.modes.disabled"),
    },
    {
      value: "local",
      label: t("pages.billingSettings.chargingMethod.modes.local"),
    },
    {
      value: "remote",
      label: t("pages.billingSettings.chargingMethod.modes.remote"),
    },
  ]
  const selectedMode = enabled ? mode : "disabled"
  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px lg:h-[calc(100svh-5rem)] lg:flex-none lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-2 lg:items-stretch">
        <div className="grid min-h-0 gap-4 lg:h-full lg:grid-rows-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="min-h-80 lg:min-h-0">
            <CardHeader>
              <CardTitle>
                {t("pages.billingSettings.groupQuota.title")}
              </CardTitle>
              <CardAction>
                <Button
                  variant="secondary"
                  size="sm"
                  render={<Link to={CONSOLE_ROUTES.membersAndGroups} />}
                >
                  {t("pages.billingSettings.groupQuota.manageGroups")}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <ScrollArea className="-ms-1 -me-(--card-spacing) min-h-0 lg:flex-1">
                <div className="flex flex-col gap-1 ps-1 pe-(--card-spacing)">
                  {quotas.groups
                    .filter((g) => !g.parent_id)
                    .map((g) => renderGroup(g, "10000"))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card className="min-h-80 lg:min-h-0">
            <CardHeader className="gap-3">
              <CardTitle>
                {t("pages.billingSettings.groupQuota.memberTitle")}
              </CardTitle>
              <CardAction>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(
                    "pages.membersAndGroups.searchMembersPlaceholder"
                  )}
                  aria-label={t("pages.membersAndGroups.searchMembers")}
                  className="h-8 w-40 min-w-0 sm:w-52"
                />
              </CardAction>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <ScrollArea className="-me-(--card-spacing) min-h-0 min-w-0 flex-1 pe-(--card-spacing)">
                <ItemGroup className="gap-2">
                  {quotas.users
                    .filter((user) =>
                      `${user.name} ${user.email}`
                        .toLowerCase()
                        .includes(query.toLowerCase())
                    )
                    .map(userItem)}
                </ItemGroup>
                {query &&
                  !quotas.users.some((user) =>
                    `${user.name} ${user.email}`
                      .toLowerCase()
                      .includes(query.toLowerCase())
                  ) && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("pages.membersAndGroups.noMembersFound")}
                    </p>
                  )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        <ScrollArea className="min-h-0 lg:h-full">
          <div className="grid gap-4 ps-px pe-3 pt-px pb-px">
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("pages.billingSettings.chargingMethod.title")}
                </CardTitle>
                <CardDescription>
                  {t("pages.billingSettings.chargingMethod.description")}
                </CardDescription>
                {(dirtyMode || busy === "mode") && (
                  <CardAction>
                    <Button
                      disabled={
                        (enabled &&
                          mode === "remote" &&
                          !settings.wallet.configured) ||
                        !!busy
                      }
                      onClick={() => void save("mode")}
                    >
                      {busy === "mode"
                        ? "保存中…"
                        : t("pages.billingSettings.save")}
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <Select
                  items={modeItems}
                  value={selectedMode}
                  onValueChange={(value) => {
                    if (value === null) return
                    if (value === "disabled") {
                      setEnabled(false)
                      return
                    }
                    setMode(value)
                    setEnabled(true)
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label={t("pages.billingSettings.chargingMethod.mode")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="start">
                    <SelectGroup>
                      {modeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {enabled && mode === "local" && (
                  <ItemGroup className="gap-2">
                    <Item variant="outline">
                      <ItemContent>
                        <ItemTitle>
                          {t("pages.billingSettings.quotaRefresh.itemTitle")}
                        </ItemTitle>
                        <ItemDescription>
                          {t(
                            "pages.billingSettings.quotaRefresh.itemDescription",
                            {
                              cycle: t(
                                `pages.billingSettings.quotaRefresh.cycleLabels.${cycle}`
                              ),
                            }
                          )}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setCycleValue(cycle)
                            setCycleDialogOpen(true)
                          }}
                        >
                          {t("pages.billingSettings.quotaRefresh.configure")}
                        </Button>
                      </ItemActions>
                    </Item>
                    <Item variant="outline">
                      <ItemContent>
                        <ItemTitle>
                          {t(
                            "pages.billingSettings.quotaRefresh.nextResetTitle"
                          )}
                        </ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {dateTime(settings.next_refresh_at)}
                        </span>
                      </ItemActions>
                    </Item>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={!!busy}
                      onClick={() => {
                        setResetSelection({ groupIds: [], userIds: [] })
                        setResetRequestID(crypto.randomUUID())
                        setResetDialogOpen(true)
                      }}
                    >
                      {t("pages.billingSettings.quotaRefresh.resetNow")}
                    </Button>
                  </ItemGroup>
                )}
                {enabled && mode === "remote" && (
                  <div className="space-y-3">
                    <WalletSettings
                      key={walletVersion}
                      info={settings.wallet}
                      busy={!!busy}
                      onSave={(input) => save("wallet", input)}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("pages.billingSettings.modelPricing.title")}
                </CardTitle>
                <CardDescription>
                  {t("pages.billingSettings.modelPricing.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ItemGroup className="gap-2">
                  {pricingFields.map((field) => (
                    <Item key={field.key} variant="outline">
                      <ItemContent>
                        <ItemTitle>
                          {t(
                            `pages.billingSettings.modelPricing.${field.title}`
                          )}
                        </ItemTitle>
                        <ItemDescription>
                          {t(
                            `pages.billingSettings.modelPricing.${field.description}`,
                            { credits: format(pricing[field.key]) }
                          )}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => openPricing(field.key)}
                        >
                          {t("pages.billingSettings.modelPricing.configure")}
                        </Button>
                      </ItemActions>
                    </Item>
                  ))}
                </ItemGroup>
                <Button
                  variant="secondary"
                  render={<Link to="/console/resources/models" />}
                >
                  {t("pages.billingSettings.modelPricing.manageMultiplier")}
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    data-icon="inline-end"
                  />
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t("pages.billingSettings.toolPricing.title")}
                </CardTitle>
                <CardDescription>
                  {t("pages.billingSettings.toolPricing.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="secondary"
                  render={<Link to="/console/resources/tools" />}
                >
                  {t("pages.billingSettings.toolPricing.manage")}
                  <HugeiconsIcon
                    icon={LinkSquare02Icon}
                    data-icon="inline-end"
                  />
                </Button>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>
      <Dialog
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (busy !== "reset") setResetDialogOpen(open)
        }}
      >
        <DialogContent>
          <form onSubmit={resetCurrentQuotas}>
            <DialogHeader>
              <DialogTitle>
                {t("pages.billingSettings.quotaRefresh.resetDialogTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("pages.billingSettings.quotaRefresh.resetDialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <Field className="my-6">
              <FieldLabel htmlFor="billing-reset-targets">
                {t("pages.billingSettings.quotaRefresh.resetTargets")}
              </FieldLabel>
              <GroupSelect
                id="billing-reset-targets"
                options={quotas.groups.map((group) => ({
                  id: group.id,
                  parentId: group.parent_id,
                  name: group.name,
                }))}
                users={quotas.users.map((user) => ({
                  id: user.id,
                  name: user.name,
                  email: user.email,
                  groupIds: user.group_ids,
                }))}
                value={resetSelection}
                onValueChange={(value) => {
                  setResetSelection(value)
                  setResetRequestID(crypto.randomUUID())
                }}
                label={t("pages.billingSettings.quotaRefresh.resetTargets")}
                placeholder={t(
                  "pages.billingSettings.quotaRefresh.resetPlaceholder"
                )}
                emptyText={t(
                  "pages.billingSettings.quotaRefresh.resetNoResults"
                )}
                locale={i18n.resolvedLanguage ?? i18n.language}
                defaultExpanded
                collapsible
                multiple
                selectionMode="both"
                searchable
                searchPlaceholder={t(
                  "pages.billingSettings.quotaRefresh.resetSearch"
                )}
                noResultsText={t(
                  "pages.billingSettings.quotaRefresh.resetNoResults"
                )}
                cascadeGroups
                disabled={busy === "reset"}
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy === "reset"}
                onClick={() => setResetDialogOpen(false)}
              >
                {t("pages.billingSettings.quotaRefresh.cancel")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  busy === "reset" ||
                  (resetSelection.groupIds.length === 0 &&
                    resetSelection.userIds.length === 0)
                }
              >
                {busy === "reset"
                  ? t("pages.billingSettings.quotaRefresh.resetting")
                  : t("pages.billingSettings.quotaRefresh.resetNow")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={cycleDialogOpen}
        onOpenChange={(open) => {
          if (!open && busy !== "cycle") setCycleDialogOpen(false)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!cycleNames[cycleValue] || busy === "cycle") return
              void save("cycle", undefined, undefined, cycleValue).then(
                (saved) => {
                  if (!saved) return
                  setCycle(cycleValue)
                  setCycleDialogOpen(false)
                }
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t("pages.billingSettings.quotaRefresh.dialogTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("pages.billingSettings.quotaRefresh.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <Field className="my-6">
              <FieldLabel htmlFor="billing-cycle">
                {t("pages.billingSettings.quotaRefresh.cycle")}
              </FieldLabel>
              <Select
                items={cycleItems}
                value={cycleValue}
                onValueChange={(value) => {
                  if (value !== null) setCycleValue(value)
                }}
              >
                <SelectTrigger id="billing-cycle" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="start">
                  <SelectGroup>
                    {cycleItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy === "cycle"}
                onClick={() => setCycleDialogOpen(false)}
              >
                {t("pages.billingSettings.quotaRefresh.cancel")}
              </Button>
              <Button type="submit" disabled={busy === "cycle"}>
                {busy === "cycle"
                  ? "保存中…"
                  : t("pages.billingSettings.quotaRefresh.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pricingTarget !== null}
        onOpenChange={(open) => {
          if (!open && busy !== "pricing") setPricingTarget(null)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (
                !pricingTarget ||
                !validCredits(pricingValue) ||
                busy === "pricing"
              )
                return
              const nextPricing = {
                ...pricing,
                [pricingTarget]: pricingValue,
              }
              void save("pricing", undefined, nextPricing).then((saved) => {
                if (!saved) return
                setPricing(nextPricing)
                setPricingTarget(null)
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {selectedPricingField
                  ? t("pages.billingSettings.modelPricing.configureTitle", {
                      name: t(
                        `pages.billingSettings.modelPricing.${selectedPricingField.title}`
                      ),
                    })
                  : ""}
              </DialogTitle>
              <DialogDescription>
                {t("pages.billingSettings.modelPricing.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <Field className="my-6">
              <FieldLabel htmlFor="model-pricing-value">
                {t("pages.billingSettings.modelPricing.valueLabel")}
              </FieldLabel>
              <Input
                id="model-pricing-value"
                inputMode="decimal"
                value={pricingValue}
                aria-invalid={!validCredits(pricingValue)}
                onChange={(event) => setPricingValue(event.target.value)}
              />
              {!validCredits(pricingValue) && (
                <FieldDescription>
                  {t("pages.billingSettings.modelPricing.valueInvalid")}
                </FieldDescription>
              )}
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy === "pricing"}
                onClick={() => setPricingTarget(null)}
              >
                {t("pages.billingSettings.modelPricing.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!validCredits(pricingValue) || busy === "pricing"}
              >
                {busy === "pricing"
                  ? "保存中…"
                  : t("pages.billingSettings.modelPricing.confirm")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && busy !== "quota") setTarget(null)
        }}
      >
        <DialogContent>
          <form onSubmit={saveQuota}>
            <DialogHeader>
              <DialogTitle>调整 {target?.name} 的周期额度</DialogTitle>
              <DialogDescription>
                修改在下个周期生效，不改变当期余额。
              </DialogDescription>
            </DialogHeader>
            <Tabs
              className="my-6"
              value={quotaMode}
              onValueChange={(value) =>
                setQuotaMode(value as "inherit" | "custom")
              }
            >
              <TabsList className="w-full">
                <TabsTrigger
                  value="inherit"
                  disabled={target?.allowInherit === false}
                >
                  继承上级额度
                </TabsTrigger>
                <TabsTrigger value="custom">自定义额度</TabsTrigger>
              </TabsList>
              <TabsContent value="inherit" className="pt-3">
                <Item variant="outline">
                  <ItemContent>
                    <ItemTitle className="font-normal">上级额度</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatQuota(target?.inherited ?? "0")} 积分
                    </span>
                  </ItemActions>
                </Item>
              </TabsContent>
              <TabsContent value="custom" className="pt-3">
                <Field>
                  <FieldLabel htmlFor="quota-value">每周期积分</FieldLabel>
                  <Input
                    id="quota-value"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={quotaValue}
                    onChange={(event) => {
                      if (/^\d{0,12}$/.test(event.target.value))
                        setQuotaValue(event.target.value)
                    }}
                    autoFocus
                  />
                </Field>
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={busy === "quota"}
                onClick={() => setTarget(null)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={
                  busy === "quota" ||
                  (quotaMode === "custom" && !validQuota(quotaValue))
                }
              >
                {busy === "quota" ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {accountUser && (
        <AccountDialog
          user={accountUser}
          onClose={() => {
            setAccountUser(null)
            refreshQuotas()
          }}
          onChanged={refreshQuotas}
        />
      )}
    </section>
  )
}

function AccountDialog({
  user,
  onClose,
  onChanged,
}: {
  user: QuotaUser
  onClose: () => void
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const displayCredits = (value: string | null | undefined) =>
    credits(value, i18n.language, 0, "floor")
  const [data, setData] = useState<AccountDetails | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustmentType, setAdjustmentType] = useState<"add" | "deduct">("add")
  const [adjustmentAmount, setAdjustmentAmount] = useState("")
  const [adjustmentReason, setAdjustmentReason] = useState("")
  const [external, setExternal] = useState(user.external_user_id ?? "")
  const running = useRef(false)
  const load = useCallback(
    () =>
      api<AccountDetails>(`/api/admin/v1/billing/accounts/${user.id}`).then(
        (value) => {
          setData(value)
          setLoadFailed(false)
        }
      ),
    [user.id]
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
        await api(`/api/admin/v1/billing/accounts/${user.id}/adjustments`, {
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
        await api(`/api/admin/v1/billing/accounts/${user.id}/wallet`, {
          method: "PUT",
          body: JSON.stringify({ external_user_id: external }),
        })
      await load()
      onChanged()
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
            <DialogTitle>{user.name} 的积分账户</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          {loadFailed && (
            <Button type="button" variant="outline" onClick={loadAccount}>
              重试
            </Button>
          )}
          {!data && !loadFailed ? (
            <p role="status">正在读取账户…</p>
          ) : data ? (
            <div className="space-y-5">
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
                <Button
                  variant="secondary"
                  render={
                    <Link
                      to={`${CONSOLE_ROUTES.billingDetails}?view=entries&user=${encodeURIComponent(user.name)}`}
                    />
                  }
                >
                  费用明细
                </Button>
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
              为 {user.name} 调整当前周期的账面积分。
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
