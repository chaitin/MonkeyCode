import {
  Folder02Icon,
  FolderIcon,
  MoreHorizontalIcon,
  User02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { TFunction } from "i18next"
import { useEffect, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AUTHORIZATION_GROUP_TREE,
  AUTHORIZATION_MEMBERS,
  type AuthorizationGroupNode,
} from "@/lib/authorization-groups"
import { api } from "@/lib/api"

type RefreshCycle = "daily" | "weekly" | "monthly"
type ChargingMode = "local" | "remote"

type ModelPricingSettings = {
  inputTokenCredits: string
  cachedInputTokenCredits: string
  outputTokenCredits: string
}

type RefreshSettings = {
  refreshCycle: RefreshCycle
}

type ChargingMethodSettings = {
  mode: ChargingMode
  baizhiBaseUrl: string
  baizhiApiKey: string
}

type QuotaSettings = {
  rootCredits: string
  quotaOverrides: Partial<Record<string, string>>
}

const INITIAL_MODEL_PRICING: ModelPricingSettings = {
  inputTokenCredits: "100",
  cachedInputTokenCredits: "20",
  outputTokenCredits: "400",
}

const INITIAL_REFRESH_SETTINGS: RefreshSettings = {
  refreshCycle: "monthly",
}

const INITIAL_CHARGING_METHOD: ChargingMethodSettings = {
  mode: "local",
  baizhiBaseUrl: "",
  baizhiApiKey: "",
}

const INITIAL_QUOTA_SETTINGS: QuotaSettings = {
  rootCredits: "15000",
  quotaOverrides: {
    administrators: "50000",
    "product-and-engineering": "20000",
    engineering: "30000",
  },
}

const REFRESH_CYCLES: RefreshCycle[] = ["daily", "weekly", "monthly"]

type QuotaTarget = {
  subjectId: string
  label: string
  isRoot: boolean
  ownCredits?: string
  inheritedCredits: string
}

function QuotaSummary({
  inherited,
  summary,
  t,
  onAdjust,
}: {
  inherited: boolean
  summary: string
  t: TFunction
  onAdjust: () => void
}) {
  return (
    <div className="relative flex min-h-8 min-w-0 items-center justify-end">
      <span
        className="w-full truncate text-end text-xs text-muted-foreground group-hover/quota-row:opacity-0 data-[inherited=true]:text-muted-foreground/40"
        data-inherited={inherited}
      >
        {summary}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t("pages.billingSettings.groupQuota.actions")}
              className="pointer-events-none absolute end-0 opacity-0 transition-none group-hover/quota-row:pointer-events-auto group-hover/quota-row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 aria-expanded:pointer-events-auto aria-expanded:opacity-100"
              size="icon-sm"
              type="button"
              variant="ghost"
            />
          }
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} strokeWidth={2} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onAdjust}>
              {t("pages.billingSettings.groupQuota.adjust")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function QuotaAdjustmentDialog({
  cycleLabel,
  target,
  t,
  formatCredits,
  onOpenChange,
  onSave,
}: {
  cycleLabel: string
  target: QuotaTarget
  t: TFunction
  formatCredits: (credits: string) => string
  onOpenChange: (open: boolean) => void
  onSave: (credits: string | undefined) => void
}) {
  const [mode, setMode] = useState<"inherit" | "custom">(
    target.isRoot || target.ownCredits !== undefined ? "custom" : "inherit"
  )
  const [credits, setCredits] = useState(
    target.ownCredits ?? target.inheritedCredits
  )
  const inheritedSummary = t("pages.billingSettings.groupQuota.summary", {
    cycle: cycleLabel,
    credits: formatCredits(target.inheritedCredits),
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSave(mode === "inherit" ? undefined : credits)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("common.close")}>
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t("pages.billingSettings.groupQuota.dialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.billingSettings.groupQuota.dialogDescription", {
                name: target.label,
              })}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel>
                {t("pages.billingSettings.groupQuota.mode")}
              </FieldLabel>
              <Tabs
                className="w-full"
                value={mode}
                onValueChange={(value) => {
                  setMode(value as "inherit" | "custom")
                }}
              >
                <TabsList
                  aria-label={t("pages.billingSettings.groupQuota.mode")}
                  className="w-full"
                >
                  <TabsTrigger disabled={target.isRoot} value="inherit">
                    {t("pages.billingSettings.groupQuota.modes.inherit")}
                  </TabsTrigger>
                  <TabsTrigger value="custom">
                    {t("pages.billingSettings.groupQuota.modes.custom")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <FieldDescription>
                {target.isRoot
                  ? t("pages.billingSettings.groupQuota.rootDescription")
                  : t("pages.billingSettings.groupQuota.inheritDescription", {
                      summary: inheritedSummary,
                    })}
              </FieldDescription>
            </Field>

            {mode === "custom" && (
              <Field data-invalid={!credits}>
                <FieldLabel htmlFor="quota-adjustment-credits">
                  {t("pages.billingSettings.groupQuota.credits")}
                </FieldLabel>
                <Input
                  aria-invalid={!credits}
                  autoFocus
                  id="quota-adjustment-credits"
                  min="0"
                  required
                  step="1"
                  type="number"
                  value={credits}
                  onChange={(event) => setCredits(event.target.value)}
                />
              </Field>
            )}
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.billingSettings.groupQuota.cancel")}
            </DialogClose>
            <Button disabled={mode === "custom" && !credits} type="submit">
              {t("pages.billingSettings.groupQuota.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function QuotaTreeGroup({
  cycleLabel,
  group,
  inheritedCredits,
  level,
  quotaOverrides,
  rootCredits,
  t,
  formatCredits,
  onAdjustQuota,
}: {
  cycleLabel: string
  group: AuthorizationGroupNode
  inheritedCredits: string
  level: number
  quotaOverrides: Partial<Record<string, string>>
  rootCredits: string
  t: TFunction
  formatCredits: (credits: string) => string
  onAdjustQuota: (target: QuotaTarget) => void
}) {
  const [isOpen, setIsOpen] = useState(level < 2)
  const isRoot = group.value === "all-members"
  const groupLabel = t(group.labelKey)
  const ownCredits = isRoot ? rootCredits : quotaOverrides[group.value]
  const effectiveCredits = ownCredits ?? inheritedCredits
  const directMembers = AUTHORIZATION_MEMBERS.filter(
    (member) => member.groupId === group.value
  )
  const hasChildren = Boolean(group.children?.length || directMembers.length)
  const rowStyle = { paddingInlineStart: `${level * 1.25 + 0.5}rem` }

  return (
    <li role="none">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-level={level + 1}
          className="group/quota-row grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)] items-center gap-3 rounded-md pe-2 hover:bg-muted"
          role="treeitem"
        >
          <CollapsibleTrigger
            disabled={!hasChildren}
            render={
              <Button
                className="min-w-0 justify-start font-normal hover:bg-transparent! disabled:opacity-100 aria-expanded:bg-transparent!"
                size="sm"
                style={rowStyle}
                type="button"
                variant="ghost"
              />
            }
          >
            <HugeiconsIcon
              data-icon="inline-start"
              icon={isOpen ? Folder02Icon : FolderIcon}
              strokeWidth={2}
            />
            <span className="truncate">{groupLabel}</span>
          </CollapsibleTrigger>
          <QuotaSummary
            inherited={!isRoot && ownCredits === undefined}
            summary={t("pages.billingSettings.groupQuota.summary", {
              cycle: cycleLabel,
              credits: formatCredits(effectiveCredits),
            })}
            t={t}
            onAdjust={() =>
              onAdjustQuota({
                subjectId: group.value,
                label: groupLabel,
                isRoot,
                ownCredits,
                inheritedCredits,
              })
            }
          />
        </div>

        <CollapsibleContent>
          <ul className="flex flex-col gap-1" role="group">
            {group.children?.map((child) => (
              <QuotaTreeGroup
                cycleLabel={cycleLabel}
                formatCredits={formatCredits}
                group={child}
                inheritedCredits={effectiveCredits}
                key={child.value}
                level={level + 1}
                quotaOverrides={quotaOverrides}
                rootCredits={rootCredits}
                t={t}
                onAdjustQuota={onAdjustQuota}
              />
            ))}

            {directMembers.map((member) => {
              const memberCredits = quotaOverrides[member.id]
              const memberRowStyle = {
                paddingInlineStart: `${(level + 1) * 1.25 + 0.5}rem`,
              }

              return (
                <li key={member.id} role="none">
                  <div
                    aria-level={level + 2}
                    className="group/quota-row grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)] items-center gap-3 rounded-md pe-2 hover:bg-muted"
                    role="treeitem"
                  >
                    <div
                      className="flex min-w-0 items-center gap-2"
                      style={memberRowStyle}
                    >
                      <HugeiconsIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        icon={User02Icon}
                        strokeWidth={2}
                      />
                      <span className="truncate">{member.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {member.email}
                      </span>
                    </div>
                    <QuotaSummary
                      inherited={memberCredits === undefined}
                      summary={t("pages.billingSettings.groupQuota.summary", {
                        cycle: cycleLabel,
                        credits: formatCredits(
                          memberCredits ?? effectiveCredits
                        ),
                      })}
                      t={t}
                      onAdjust={() =>
                        onAdjustQuota({
                          subjectId: member.id,
                          label: member.name,
                          isRoot: false,
                          ownCredits: memberCredits,
                          inheritedCredits: effectiveCredits,
                        })
                      }
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

export function BillingSettingsPage() {
  const { i18n, t } = useTranslation()
  const [modelPricing, setModelPricing] = useState(INITIAL_MODEL_PRICING)
  const [savedModelPricing, setSavedModelPricing] = useState(
    INITIAL_MODEL_PRICING
  )
  const [modelPricingSaved, setModelPricingSaved] = useState(false)
  const [refreshSettings, setRefreshSettings] = useState(
    INITIAL_REFRESH_SETTINGS
  )
  const [savedRefreshSettings, setSavedRefreshSettings] = useState(
    INITIAL_REFRESH_SETTINGS
  )
  const [refreshSettingsSaved, setRefreshSettingsSaved] = useState(false)
  const [chargingMethod, setChargingMethod] = useState(INITIAL_CHARGING_METHOD)
  const [savedChargingMethod, setSavedChargingMethod] = useState(
    INITIAL_CHARGING_METHOD
  )
  const [chargingMethodSaved, setChargingMethodSaved] = useState(false)
  const [quotaSettings, setQuotaSettings] = useState(INITIAL_QUOTA_SETTINGS)
  const [savedQuotaSettings, setSavedQuotaSettings] = useState(
    INITIAL_QUOTA_SETTINGS
  )
  const [quotaSettingsSaved, setQuotaSettingsSaved] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<QuotaTarget | null>(null)
  const [settingsError, setSettingsError] = useState("")
  const modelPricingDirty =
    JSON.stringify(modelPricing) !== JSON.stringify(savedModelPricing)
  const refreshSettingsDirty =
    JSON.stringify(refreshSettings) !== JSON.stringify(savedRefreshSettings)
  const chargingMethodDirty =
    JSON.stringify(chargingMethod) !== JSON.stringify(savedChargingMethod)
  const quotaSettingsDirty =
    JSON.stringify(quotaSettings) !== JSON.stringify(savedQuotaSettings)
  const refreshCycleItems = REFRESH_CYCLES.map((cycle) => ({
    value: cycle,
    label: t(`pages.billingSettings.quotaRefresh.cycles.${cycle}`),
  }))
  const creditFormatter = new Intl.NumberFormat(
    i18n.resolvedLanguage ?? i18n.language
  )
  const formatCredits = (credits: string) =>
    credits ? creditFormatter.format(Number(credits)) : ""
  const quotaCycleLabel = t(
    `pages.billingSettings.quotaRefresh.cycleLabels.${refreshSettings.refreshCycle}`
  )

  useEffect(() => {
    api<{
      value: Record<string, unknown>
    }>("/api/admin/v1/settings/billing")
      .then(({ value }) => {
        const pricing = {
          inputTokenCredits: String(
            value.input_credits_per_million_tokens ?? "100"
          ),
          cachedInputTokenCredits: String(
            value.cached_input_credits_per_million_tokens ?? "20"
          ),
          outputTokenCredits: String(
            value.output_credits_per_million_tokens ?? "400"
          ),
        }
        const refresh = {
          refreshCycle: String(
            value.quota_refresh_cycle ?? "monthly"
          ) as RefreshCycle,
        }
        const charging = {
          mode: String(value.charging_mode ?? "local") as ChargingMode,
          baizhiBaseUrl: String(value.remote_billing_base_url ?? ""),
          baizhiApiKey: String(value.remote_billing_api_key ?? ""),
        }
        const quotas = {
          rootCredits: String(value.root_credits ?? "15000"),
          quotaOverrides:
            (value.quota_overrides as Partial<Record<string, string>>) ?? {},
        }
        setModelPricing(pricing)
        setSavedModelPricing(pricing)
        setRefreshSettings(refresh)
        setSavedRefreshSettings(refresh)
        setChargingMethod(charging)
        setSavedChargingMethod(charging)
        setQuotaSettings(quotas)
        setSavedQuotaSettings(quotas)
      })
      .catch((reason: { status?: number; message: string }) => {
        if (reason.status !== 404) setSettingsError(reason.message)
      })
  }, [])

  const saveBilling = async (values?: {
    pricing?: ModelPricingSettings
    refresh?: RefreshSettings
    charging?: ChargingMethodSettings
    quotas?: QuotaSettings
  }) => {
    const pricing = values?.pricing ?? modelPricing
    const refresh = values?.refresh ?? refreshSettings
    const charging = values?.charging ?? chargingMethod
    const quotas = values?.quotas ?? quotaSettings
    setSettingsError("")
    try {
      await api("/api/admin/v1/settings/billing", {
        method: "PUT",
        body: JSON.stringify({
          schema_version: 1,
          value: {
            input_credits_per_million_tokens: Number(pricing.inputTokenCredits),
            cached_input_credits_per_million_tokens: Number(
              pricing.cachedInputTokenCredits
            ),
            output_credits_per_million_tokens: Number(
              pricing.outputTokenCredits
            ),
            quota_refresh_cycle: refresh.refreshCycle,
            charging_mode: charging.mode,
            remote_billing_base_url: charging.baizhiBaseUrl || null,
            remote_billing_api_key: charging.baizhiApiKey || null,
            root_credits: Number(quotas.rootCredits),
            quota_overrides: quotas.quotaOverrides,
          },
        }),
      })
      return true
    } catch (reason) {
      setSettingsError((reason as Error).message)
      return false
    }
  }

  const updateModelPricing = <Key extends keyof ModelPricingSettings>(
    key: Key,
    value: ModelPricingSettings[Key]
  ) => {
    setModelPricing((current) => ({ ...current, [key]: value }))
    setModelPricingSaved(false)
  }

  const updateChargingMethod = <Key extends keyof ChargingMethodSettings>(
    key: Key,
    value: ChargingMethodSettings[Key]
  ) => {
    setChargingMethod((current) => ({ ...current, [key]: value }))
    setChargingMethodSaved(false)
  }

  const updateQuotaSetting = <Key extends keyof QuotaSettings>(
    key: Key,
    value: QuotaSettings[Key]
  ) => {
    setQuotaSettings((current) => ({ ...current, [key]: value }))
    setQuotaSettingsSaved(false)
  }

  const updateQuotaOverride = (
    subjectId: string,
    value: string | undefined
  ) => {
    setQuotaSettings((current) => {
      const quotaOverrides = { ...current.quotaOverrides }

      if (value === undefined) {
        delete quotaOverrides[subjectId]
      } else {
        quotaOverrides[subjectId] = value
      }

      return { ...current, quotaOverrides }
    })
    setQuotaSettingsSaved(false)
  }

  return (
    <section className="grid flex-1 gap-4 p-4 pt-0 xl:grid-cols-2">
      {settingsError && (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive xl:col-span-2"
          role="alert"
        >
          {settingsError}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.billingSettings.groupQuota.title")}</CardTitle>
          <CardDescription>
            {t("pages.billingSettings.groupQuota.description")}
          </CardDescription>
          <CardAction className="flex items-center gap-2" aria-live="polite">
            {quotaSettingsSaved && (
              <Badge variant="secondary">
                {t("pages.billingSettings.saved")}
              </Badge>
            )}
            <Button
              disabled={!quotaSettingsDirty || !quotaSettings.rootCredits}
              type="button"
              onClick={async () => {
                if (await saveBilling({ quotas: quotaSettings })) {
                  setSavedQuotaSettings(quotaSettings)
                  setQuotaSettingsSaved(true)
                }
              }}
            >
              {t("pages.billingSettings.save")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ul className="flex min-w-0 flex-col gap-1" role="tree">
            {AUTHORIZATION_GROUP_TREE.map((group) => (
              <QuotaTreeGroup
                cycleLabel={quotaCycleLabel}
                formatCredits={formatCredits}
                group={group}
                inheritedCredits={quotaSettings.rootCredits}
                key={group.value}
                level={0}
                quotaOverrides={quotaSettings.quotaOverrides}
                rootCredits={quotaSettings.rootCredits}
                t={t}
                onAdjustQuota={setQuotaTarget}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              {t("pages.billingSettings.quotaRefresh.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.billingSettings.quotaRefresh.description")}
            </CardDescription>
            <CardAction className="flex items-center gap-2" aria-live="polite">
              {refreshSettingsSaved && (
                <Badge variant="secondary">
                  {t("pages.billingSettings.saved")}
                </Badge>
              )}
              <Button
                disabled={!refreshSettingsDirty}
                type="button"
                onClick={async () => {
                  if (await saveBilling({ refresh: refreshSettings })) {
                    setSavedRefreshSettings(refreshSettings)
                    setRefreshSettingsSaved(true)
                  }
                }}
              >
                {t("pages.billingSettings.save")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="quota-refresh-cycle">
                {t("pages.billingSettings.quotaRefresh.cycle")}
              </FieldLabel>
              <Select
                items={refreshCycleItems}
                value={refreshSettings.refreshCycle}
                onValueChange={(value) => {
                  if (value !== null) {
                    setRefreshSettings({
                      refreshCycle: value as RefreshCycle,
                    })
                    setRefreshSettingsSaved(false)
                  }
                }}
              >
                <SelectTrigger id="quota-refresh-cycle" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {refreshCycleItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {t("pages.billingSettings.quotaRefresh.cycleDescription")}
              </FieldDescription>
            </Field>
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
            <CardAction className="flex items-center gap-2" aria-live="polite">
              {modelPricingSaved && (
                <Badge variant="secondary">
                  {t("pages.billingSettings.saved")}
                </Badge>
              )}
              <Button
                disabled={!modelPricingDirty}
                type="button"
                onClick={async () => {
                  if (await saveBilling({ pricing: modelPricing })) {
                    setSavedModelPricing(modelPricing)
                    setModelPricingSaved(true)
                  }
                }}
              >
                {t("pages.billingSettings.save")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="billing-input-token">
                  {t("pages.billingSettings.modelPricing.inputToken")}
                </FieldLabel>
                <Input
                  id="billing-input-token"
                  min="0"
                  step="0.01"
                  type="number"
                  value={modelPricing.inputTokenCredits}
                  onChange={(event) =>
                    updateModelPricing("inputTokenCredits", event.target.value)
                  }
                />
                <FieldDescription>
                  {t("pages.billingSettings.modelPricing.unit")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-cached-input-token">
                  {t("pages.billingSettings.modelPricing.cachedInputToken")}
                </FieldLabel>
                <Input
                  id="billing-cached-input-token"
                  min="0"
                  step="0.01"
                  type="number"
                  value={modelPricing.cachedInputTokenCredits}
                  onChange={(event) =>
                    updateModelPricing(
                      "cachedInputTokenCredits",
                      event.target.value
                    )
                  }
                />
                <FieldDescription>
                  {t("pages.billingSettings.modelPricing.unit")}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-output-token">
                  {t("pages.billingSettings.modelPricing.outputToken")}
                </FieldLabel>
                <Input
                  id="billing-output-token"
                  min="0"
                  step="0.01"
                  type="number"
                  value={modelPricing.outputTokenCredits}
                  onChange={(event) =>
                    updateModelPricing("outputTokenCredits", event.target.value)
                  }
                />
                <FieldDescription>
                  {t("pages.billingSettings.modelPricing.unit")}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {t("pages.billingSettings.chargingMethod.title")}
            </CardTitle>
            <CardDescription>
              {t("pages.billingSettings.chargingMethod.description")}
            </CardDescription>
            <CardAction className="flex items-center gap-2" aria-live="polite">
              {chargingMethodSaved && (
                <Badge variant="secondary">
                  {t("pages.billingSettings.saved")}
                </Badge>
              )}
              <Button
                disabled={
                  !chargingMethodDirty ||
                  (chargingMethod.mode === "remote" &&
                    (!chargingMethod.baizhiBaseUrl ||
                      !chargingMethod.baizhiApiKey))
                }
                type="button"
                onClick={async () => {
                  if (await saveBilling({ charging: chargingMethod })) {
                    setSavedChargingMethod(chargingMethod)
                    setChargingMethodSaved(true)
                  }
                }}
              >
                {t("pages.billingSettings.save")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>
                  {t("pages.billingSettings.chargingMethod.mode")}
                </FieldLabel>
                <Tabs
                  className="w-full"
                  value={chargingMethod.mode}
                  onValueChange={(value) => {
                    updateChargingMethod("mode", value as ChargingMode)
                  }}
                >
                  <TabsList
                    aria-label={t("pages.billingSettings.chargingMethod.mode")}
                    className="w-full"
                  >
                    <TabsTrigger value="local">
                      {t("pages.billingSettings.chargingMethod.modes.local")}
                    </TabsTrigger>
                    <TabsTrigger value="remote">
                      {t("pages.billingSettings.chargingMethod.modes.remote")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <FieldDescription>
                  {t(
                    `pages.billingSettings.chargingMethod.modeDescriptions.${chargingMethod.mode}`
                  )}
                </FieldDescription>
              </Field>

              {chargingMethod.mode === "remote" && (
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="baizhi-billing-base-url">
                      {t("pages.billingSettings.chargingMethod.baseUrl")}
                    </FieldLabel>
                    <Input
                      id="baizhi-billing-base-url"
                      placeholder="https://api.baizhi.cloud"
                      required
                      type="url"
                      value={chargingMethod.baizhiBaseUrl}
                      onChange={(event) =>
                        updateChargingMethod(
                          "baizhiBaseUrl",
                          event.target.value
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="baizhi-billing-api-key">
                      {t("pages.billingSettings.chargingMethod.apiKey")}
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      id="baizhi-billing-api-key"
                      placeholder={t(
                        "pages.billingSettings.chargingMethod.apiKeyPlaceholder"
                      )}
                      required
                      type="password"
                      value={chargingMethod.baizhiApiKey}
                      onChange={(event) =>
                        updateChargingMethod("baizhiApiKey", event.target.value)
                      }
                    />
                  </Field>
                </FieldGroup>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      {quotaTarget && (
        <QuotaAdjustmentDialog
          cycleLabel={quotaCycleLabel}
          formatCredits={formatCredits}
          key={quotaTarget.subjectId}
          target={quotaTarget}
          t={t}
          onOpenChange={(open) => {
            if (!open) {
              setQuotaTarget(null)
            }
          }}
          onSave={(credits) => {
            if (quotaTarget.isRoot) {
              updateQuotaSetting("rootCredits", credits ?? "")
              return
            }

            updateQuotaOverride(quotaTarget.subjectId, credits)
          }}
        />
      )}
    </section>
  )
}
