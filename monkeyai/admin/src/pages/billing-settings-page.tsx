import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react"
import type { VirtualItem } from "@tanstack/react-virtual"
import {
  Folder02Icon,
  FolderIcon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { useAppToast } from "@/components/animated-toast-provider"
import { AccountDialog } from "@/components/billing/account-dialog"
import { TableLoading } from "@/components/table-loading"
import { UserAvatar } from "@/components/user-avatar"
import { useVirtualRows } from "@/hooks/use-virtual-rows"
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
import { api } from "@/lib/api"
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
  sortQuotaUsers,
  type QuotaMemberSort,
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
  const [settingsLoadFailed, setSettingsLoadFailed] = useState(false)
  const [quotasLoadFailed, setQuotasLoadFailed] = useState(false)
  const [walletVersion, setWalletVersion] = useState(0)
  const [query, setQuery] = useState("")
  const [memberSort, setMemberSort] = useState<QuotaMemberSort>("name-asc")
  const [memberViewport, setMemberViewport] = useState<HTMLDivElement | null>(
    null
  )
  const [target, setTarget] = useState<Target | null>(null)
  const [quotaValue, setQuotaValue] = useState("")
  const [quotaMode, setQuotaMode] = useState<"inherit" | "custom">("custom")
  const [pricingTarget, setPricingTarget] = useState<PricingKey | null>(null)
  const [pricingValue, setPricingValue] = useState("")
  const [accountUserID, setAccountUserID] = useState<string | null>(null)
  const quotaUsers = quotas?.users
  const memberLocale = i18n.resolvedLanguage ?? i18n.language
  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.toLowerCase()
    return sortQuotaUsers(
      (quotaUsers ?? []).filter((user) =>
        `${user.name} ${user.email}`.toLowerCase().includes(normalizedQuery)
      ),
      memberSort,
      memberLocale
    )
  }, [quotaUsers, query, memberSort, memberLocale])
  const memberKeys = useMemo(
    () => visibleUsers.map((user) => user.id),
    [visibleUsers]
  )
  const resetUsers = useMemo(
    () =>
      (quotaUsers ?? []).map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatar_url,
        groupIds: user.group_ids,
      })),
    [quotaUsers]
  )
  const memberVirtualizer = useVirtualRows({
    keys: memberKeys,
    scrollElement: memberViewport,
    estimateSize: 58,
    gap: 8,
  })
  const { scrollToOffset: scrollMembersTo } = memberVirtualizer
  useEffect(() => {
    scrollMembersTo(0)
  }, [query, memberSort, scrollMembersTo])

  const loadSettings = useCallback(
    (signal?: AbortSignal) =>
      api<BillingSettings>("/api/admin/v1/billing/settings", { signal })
        .then((result) => {
          if (signal?.aborted) return
          setSettings(result)
          setSettingsLoadFailed(false)
          setPricing({
            input_credits_per_million_tokens:
              result.policy.input_credits_per_million_tokens,
            cached_input_credits_per_million_tokens:
              result.policy.cached_input_credits_per_million_tokens,
            output_credits_per_million_tokens:
              result.policy.output_credits_per_million_tokens,
          })
          setCycle(
            result.policy.pending_cycle ?? result.policy.quota_refresh_cycle
          )
          setMode(result.policy.charging_mode)
          setEnabled(result.policy.enabled)
          setWalletVersion((value) => value + 1)
        })
        .catch((error: Error) => {
          if (signal?.aborted) return
          setSettingsLoadFailed(true)
          showToast({ status: "error", title: error.message })
        }),
    [showToast]
  )
  const loadQuotas = useCallback(
    (signal?: AbortSignal) =>
      api<Quotas>("/api/admin/v1/billing/quotas", { signal })
        .then((result) => {
          if (signal?.aborted) return
          setQuotas(result)
          setQuotasLoadFailed(false)
        })
        .catch((error: Error) => {
          if (signal?.aborted) return
          setQuotasLoadFailed(true)
          showToast({ status: "error", title: error.message })
        }),
    [showToast]
  )
  const load = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([loadSettings(signal), loadQuotas(signal)]),
    [loadSettings, loadQuotas]
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
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
    if (!settings || !pricing) return false
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
      setQuotas((current) =>
        current ? { ...current, revision: result.policy.revision } : current
      )
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
      void load()
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setBusy("")
    }
  }
  const refreshQuotas = () => {
    void loadQuotas()
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
  const userItem = (user: QuotaUser, row: VirtualItem) => {
    const disabled = user.status === "disabled"
    const balance = user.balance_credits
    return (
      <div
        key={user.id}
        role="listitem"
        ref={memberVirtualizer.measureElement}
        data-index={row.index}
        data-virtual-key={user.id}
        aria-posinset={row.index + 1}
        aria-setsize={visibleUsers.length}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          transform: `translateY(${row.start}px)`,
        }}
      >
        <Item
          size="sm"
          variant="outline"
          render={
            <Button
              type="button"
              variant="ghost"
              className="h-auto cursor-pointer justify-start whitespace-normal text-start underline-offset-2 hover:bg-muted [&:enabled:hover_[data-slot=item-title]_span]:underline"
              onClick={() => {
                memberVirtualizer.pin("menu", user.id, true)
                setAccountUserID(user.id)
              }}
            />
          }
          className={cn("gap-2", disabled && "text-muted-foreground")}
        >
          <ItemMedia>
            <UserAvatar src={user.avatar_url} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="min-w-0 max-w-full">
              <span className="truncate">{user.name}</span>
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {savedLocalBilling
                ? t("pages.billingSettings.groupQuota.remaining", {
                    credits: balance === undefined ? "—" : formatQuota(balance),
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
            className="w-full cursor-pointer justify-between gap-2 pe-2 text-start font-normal hover:!bg-foreground/5"
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
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="group absolute top-0 z-10 cursor-pointer hover:!bg-transparent active:!translate-y-0 aria-expanded:!bg-transparent"
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
        </div>
        <CollapsibleContent
          className={children.length > 0 ? "pt-1" : undefined}
        >
          <div className="flex flex-col gap-1">
            {children.map((child) => renderGroup(child, effective, depth + 1))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }
  const loadState = (failed: boolean, retry: () => void) => (
    <div className="flex min-h-40 flex-1 items-center justify-center">
      {failed ? (
        <Button variant="outline" onClick={retry}>
          {t("statistics.retry")}
        </Button>
      ) : (
        <TableLoading />
      )}
    </div>
  )
  const retrySettings = () => {
    setSettingsLoadFailed(false)
    void loadSettings()
  }
  const retryQuotaCards = () => {
    if (settingsLoadFailed) retrySettings()
    if (quotasLoadFailed) {
      setQuotasLoadFailed(false)
      void loadQuotas()
    }
  }
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
  const memberSortItems = [
    {
      value: "name-asc",
      label: t("pages.billingSettings.groupQuota.nameAscending"),
    },
    {
      value: "credits-asc",
      label: t("pages.billingSettings.groupQuota.creditsAscending"),
    },
  ] satisfies { value: QuotaMemberSort; label: string }[]
  const selectedMode = enabled ? mode : "disabled"
  return (
    <section className="flex min-h-0 flex-1 flex-col p-4 pt-px lg:h-[calc(100vh-5rem)] lg:flex-none lg:overflow-hidden">
      <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-2 lg:items-stretch">
        <div className="grid min-h-0 gap-4 lg:h-full lg:grid-rows-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="min-h-80 lg:min-h-0">
            <CardHeader>
              <CardTitle>
                {t("pages.billingSettings.groupQuota.title")}
              </CardTitle>
              <CardAction>
                <Button
                  nativeButton={false}
                  variant="secondary"
                  size="sm"
                  render={<Link to={CONSOLE_ROUTES.membersAndGroups} />}
                >
                  {t("pages.billingSettings.groupQuota.manageGroups")}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {quotas && settings ? (
                <ScrollArea className="-ms-1 -me-[var(--card-spacing)] min-h-0 lg:flex-1">
                  <div className="flex flex-col gap-1 ps-1 pe-[var(--card-spacing)]">
                    {quotas.groups
                      .filter((g) => !g.parent_id)
                      .map((g) => renderGroup(g, "10000"))}
                  </div>
                </ScrollArea>
              ) : (
                loadState(
                  settingsLoadFailed || quotasLoadFailed,
                  retryQuotaCards
                )
              )}
            </CardContent>
          </Card>
          <Card className="h-[28rem] min-h-80 lg:h-auto lg:min-h-0">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>
                {t("pages.billingSettings.groupQuota.memberTitle")}
              </CardTitle>
              <CardAction className="flex min-w-0 items-center gap-2 self-auto">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(
                    "pages.membersAndGroups.searchMembersPlaceholder"
                  )}
                  aria-label={t("pages.membersAndGroups.searchMembers")}
                  className="h-8 w-28 min-w-0 sm:w-32"
                />
                <Select
                  items={memberSortItems}
                  value={memberSort}
                  onValueChange={(value) => {
                    if (value !== null) setMemberSort(value as QuotaMemberSort)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-28 shrink-0"
                    aria-label={t(
                      "pages.billingSettings.groupQuota.memberSort"
                    )}
                    title={
                      memberSortItems.find((item) => item.value === memberSort)
                        ?.label
                    }
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false} align="end">
                    <SelectGroup>
                      {memberSortItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </CardAction>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              {quotas && settings ? (
                <ScrollArea
                  viewportRef={setMemberViewport}
                  className="-me-[var(--card-spacing)] min-h-0 min-w-0 flex-1 pe-[var(--card-spacing)]"
                >
                  <ItemGroup
                    className="relative gap-2"
                    style={{ height: memberVirtualizer.totalSize }}
                    onFocusCapture={memberVirtualizer.onFocusCapture}
                    onBlurCapture={memberVirtualizer.onBlurCapture}
                  >
                    {memberVirtualizer.items.map((row) =>
                      userItem(visibleUsers[row.index], row)
                    )}
                  </ItemGroup>
                  {query && visibleUsers.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      {t("pages.membersAndGroups.noMembersFound")}
                    </p>
                  )}
                </ScrollArea>
              ) : (
                loadState(
                  settingsLoadFailed || quotasLoadFailed,
                  retryQuotaCards
                )
              )}
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
                          !settings?.wallet.configured) ||
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
                {settings ? (
                  <>
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
                        aria-label={t(
                          "pages.billingSettings.chargingMethod.mode"
                        )}
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
                              {t(
                                "pages.billingSettings.quotaRefresh.itemTitle"
                              )}
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
                              {t(
                                "pages.billingSettings.quotaRefresh.configure"
                              )}
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
                            <span className="text-xs font-normal tabular-nums text-muted-foreground">
                              {dateTime(settings.next_refresh_at)}
                            </span>
                          </ItemActions>
                        </Item>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          disabled={!!busy || !quotas}
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
                  </>
                ) : (
                  loadState(settingsLoadFailed, retrySettings)
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
                {pricing ? (
                  <>
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
                              {t(
                                "pages.billingSettings.modelPricing.configure"
                              )}
                            </Button>
                          </ItemActions>
                        </Item>
                      ))}
                    </ItemGroup>
                    <Button
                      nativeButton={false}
                      variant="secondary"
                      render={<Link to="/console/resources/models" />}
                    >
                      {t("pages.billingSettings.modelPricing.manageMultiplier")}
                      <HugeiconsIcon
                        icon={LinkSquare02Icon}
                        data-icon="inline-end"
                      />
                    </Button>
                  </>
                ) : (
                  loadState(settingsLoadFailed, retrySettings)
                )}
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
                  nativeButton={false}
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
                options={(quotas?.groups ?? []).map((group) => ({
                  id: group.id,
                  parentId: group.parent_id,
                  name: group.name,
                }))}
                users={resetUsers}
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
                loading={busy === "reset"}
                variant="destructive"
                disabled={
                  busy === "reset" ||
                  (resetSelection.groupIds.length === 0 &&
                    resetSelection.userIds.length === 0)
                }
              >
                {t("pages.billingSettings.quotaRefresh.resetNow")}
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
              <Button
                type="submit"
                loading={busy === "cycle"}
                disabled={busy === "cycle"}
              >
                {t("pages.billingSettings.quotaRefresh.confirm")}
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
                !pricing ||
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
                loading={busy === "pricing"}
                disabled={!validCredits(pricingValue) || busy === "pricing"}
              >
                {t("pages.billingSettings.modelPricing.confirm")}
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
                    <span className="text-sm tabular-nums text-muted-foreground">
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
                loading={busy === "quota"}
                disabled={
                  busy === "quota" ||
                  (quotaMode === "custom" && !validQuota(quotaValue))
                }
              >
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {accountUserID && (
        <AccountDialog
          key={accountUserID}
          userId={accountUserID}
          onClose={() => {
            memberVirtualizer.pin("focus", accountUserID, true)
            memberVirtualizer.pin("menu", accountUserID, false)
            setAccountUserID(null)
            refreshQuotas()
          }}
          onChanged={refreshQuotas}
        />
      )}
    </section>
  )
}
