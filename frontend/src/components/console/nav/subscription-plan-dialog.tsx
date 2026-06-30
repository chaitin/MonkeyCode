import { useEffect, useState } from "react"
import { IconCheck, IconCrown, IconHelpCircle, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import { ConstsSubscriptionPeriodUnit, ConstsSubscriptionPlan } from "@/api/Api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { hasProSubscription } from "@/utils/common"
import { useAppRuntime } from "@/components/app-runtime-provider"
import { formatRegionCurrency, getPricingRegion, getSubscriptionPlanAmount } from "@/utils/pricing"
import { useCommonData } from "../data-provider"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"

type PersonalAccountPlanId = "basic" | "pro" | "ultra"
type SubscriptionBillingPeriod = "monthly" | "yearly"

type AccountPlanFeature = {
  label: string
  status?: "supported" | "partial" | "unsupported"
}

type AccountPlanCard = {
  id: PersonalAccountPlanId
  name: string
  desc: string
  monthlyAmount: number
  yearlyAmount: number
}

const monthlyPeriodCounts = Array.from({ length: 12 }, (_, index) => index + 1)
const yearlyPeriodCounts = Array.from({ length: 5 }, (_, index) => index + 1)

interface SubscriptionPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatSubscriptionExpiry(expiresAt?: string) {
  if (!expiresAt) {
    return null
  }

  const parsed = dayjs(expiresAt)
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : expiresAt
}

function normalizeAccountPlanId(plan?: string | null): PersonalAccountPlanId {
  if (plan === "pro") {
    return "pro"
  }
  if (plan === "flagship" || plan === "ultra") {
    return "ultra"
  }
  return "basic"
}

export default function SubscriptionPlanDialog({ open, onOpenChange }: SubscriptionPlanDialogProps) {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const pricingRegion = getPricingRegion(serverConfig?.region)
  const {
    loadingSubscription,
    reloadSubscription,
    subscription,
    user,
  } = useCommonData()
  const accountPlanCards: AccountPlanCard[] = [
    {
      id: "basic",
      name: t("subscriptionPlan.plans.basic.name"),
      desc: t("subscriptionPlan.plans.basic.desc"),
      monthlyAmount: getSubscriptionPlanAmount(pricingRegion, "basic", "monthly"),
      yearlyAmount: getSubscriptionPlanAmount(pricingRegion, "basic", "yearly"),
    },
    {
      id: "pro",
      name: t("subscriptionPlan.plans.pro.name"),
      desc: t("subscriptionPlan.plans.pro.desc"),
      monthlyAmount: getSubscriptionPlanAmount(pricingRegion, "pro", "monthly"),
      yearlyAmount: getSubscriptionPlanAmount(pricingRegion, "pro", "yearly"),
    },
    {
      id: "ultra",
      name: t("subscriptionPlan.plans.ultra.name"),
      desc: t("subscriptionPlan.plans.ultra.desc"),
      monthlyAmount: getSubscriptionPlanAmount(pricingRegion, "ultra", "monthly"),
      yearlyAmount: getSubscriptionPlanAmount(pricingRegion, "ultra", "yearly"),
    },
  ]
  const accountPlanComparisonRows: { label: string; tooltip?: string; values: Record<PersonalAccountPlanId, AccountPlanFeature> }[] = [
    {
      label: t("subscriptionPlan.features.taskConcurrency.label"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.oneTask") },
        pro: { label: t("subscriptionPlan.featureValues.threeTasks") },
        ultra: { label: t("subscriptionPlan.featureValues.threeTasks") },
      },
    },
    {
      label: t("subscriptionPlan.features.cloudDevEnvironment.label"),
      values: {
        basic: { label: "1C / 4G" },
        pro: { label: "2C / 8G" },
        ultra: { label: "2C / 8G" },
      },
    },
    {
      label: t("subscriptionPlan.features.dailyQuota.label"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.dailyQuotaBasic") },
        pro: { label: t("subscriptionPlan.featureValues.dailyQuotaPro") },
        ultra: { label: t("subscriptionPlan.featureValues.dailyQuotaUltra") },
      },
    },
    {
      label: t("subscriptionPlan.features.modelScope.label"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.modelScopeBasic") },
        pro: { label: t("subscriptionPlan.featureValues.modelScopePro") },
        ultra: { label: t("subscriptionPlan.featureValues.modelScopeUltra") },
      },
    },
    {
      label: t("subscriptionPlan.features.monthlyCredits.label"),
      tooltip: t("subscriptionPlan.features.monthlyCredits.tooltip"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.noCredits"), status: "unsupported" },
        pro: { label: t("subscriptionPlan.featureValues.credits10k") },
        ultra: { label: t("subscriptionPlan.featureValues.credits100k") },
      },
    },
    {
      label: t("subscriptionPlan.features.thirdPartyModels.label"),
      tooltip: t("subscriptionPlan.features.thirdPartyModels.tooltip"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.partialSupport"), status: "partial" },
        pro: { label: t("subscriptionPlan.featureValues.supported") },
        ultra: { label: t("subscriptionPlan.featureValues.supported") },
      },
    },
    {
      label: t("subscriptionPlan.features.enhancedCapabilities.label"),
      tooltip: t("subscriptionPlan.features.enhancedCapabilities.tooltip"),
      values: {
        basic: { label: t("subscriptionPlan.featureValues.partialSupport"), status: "partial" },
        pro: { label: t("subscriptionPlan.featureValues.supported") },
        ultra: { label: t("subscriptionPlan.featureValues.supported") },
      },
    },
  ]
  const [selectedAccountPlanId, setSelectedAccountPlanId] = useState<PersonalAccountPlanId>("basic")
  const [selectedBillingPeriod, setSelectedBillingPeriod] = useState<SubscriptionBillingPeriod>("monthly")
  const [selectedPeriodCount, setSelectedPeriodCount] = useState(1)
  const [confirmSubscriptionPlan, setConfirmSubscriptionPlan] = useState<"pro" | "ultra" | null>(null)
  const [isProLoading, setIsProLoading] = useState(false)
  const [isFlagshipLoading, setIsFlagshipLoading] = useState(false)
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false)
  const isProPlan = subscription?.plan === "pro"
  const isFlagshipPlan = subscription?.plan === "flagship" || subscription?.plan === "ultra"
  const hasAdvancedPlan = hasProSubscription(subscription)
  const isTeamUser = !!user?.team?.id
  const triggerPlanLabel = t(`subscriptionPlan.plans.${normalizeAccountPlanId(subscription?.plan)}.name`)
  const isRenewingCurrentPlan = confirmSubscriptionPlan === "pro"
    ? isProPlan
    : confirmSubscriptionPlan === "ultra"
      ? isFlagshipPlan
      : false
  const confirmingPlanCard = accountPlanCards.find((plan) => plan.id === confirmSubscriptionPlan)
  const selectedAccountPlan = accountPlanCards.find((plan) => plan.id === selectedAccountPlanId) || accountPlanCards[0]
  const selectedAccountPlanFeatures = accountPlanComparisonRows.map((row) => ({
    label: row.label,
    tooltip: row.tooltip,
    feature: row.values[selectedAccountPlan.id],
  }))
  const selectedSubscriptionPlan = selectedAccountPlan.id === "basic" ? null : selectedAccountPlan.id
  const isSelectedCurrentPlan = selectedAccountPlan.id === "basic" ? !hasAdvancedPlan : selectedAccountPlan.id === "pro" ? isProPlan : selectedAccountPlan.id === "ultra" ? isFlagshipPlan : false
  const isSelectedPlanLoading = selectedAccountPlan.id === "pro" ? isProLoading : selectedAccountPlan.id === "ultra" ? isFlagshipLoading : false
  const canSubscribeSelectedPlan = selectedSubscriptionPlan === "pro" ? !isFlagshipPlan : selectedSubscriptionPlan === "ultra"
  const selectedPeriodAmount = selectedBillingPeriod === "monthly" ? selectedAccountPlan.monthlyAmount : selectedAccountPlan.yearlyAmount
  const selectedOrderTotal = selectedPeriodAmount * selectedPeriodCount
  const selectedOrderTotalLabel = formatRegionCurrency(selectedOrderTotal, pricingRegion)
  const selectedPeriodUnit = selectedBillingPeriod === "monthly" ? ConstsSubscriptionPeriodUnit.PeriodMonth : ConstsSubscriptionPeriodUnit.PeriodYear
  const subscriptionPeriodCounts = selectedBillingPeriod === "monthly" ? monthlyPeriodCounts : yearlyPeriodCounts
  const selectedPeriodCountLabel = selectedBillingPeriod === "monthly"
    ? t("subscriptionPlan.billing.monthCount", { count: selectedPeriodCount })
    : t("subscriptionPlan.billing.yearCount", { count: selectedPeriodCount })
  const subscriptionExpiry = formatSubscriptionExpiry(subscription?.expires_at)

  useEffect(() => {
    if (!open) {
      return
    }

    reloadSubscription()
  }, [open, reloadSubscription])

  useEffect(() => {
    if (!open) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (active) {
        setSelectedAccountPlanId(isFlagshipPlan ? "ultra" : isProPlan ? "pro" : "basic")
      }
    })

    return () => {
      active = false
    }
  }, [isFlagshipPlan, isProPlan, open])

  const handleToggleAutoRenew = async (checked: boolean) => {
    if (!hasAdvancedPlan) {
      return
    }

    setIsAutoRenewLoading(true)
    await apiRequest("v1UsersSubscriptionAutoRenewUpdate", { auto_renew: checked }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(checked ? t("subscriptionPlan.toast.autoRenewEnabled") : t("subscriptionPlan.toast.autoRenewDisabled"))
        reloadSubscription()
      } else {
        toast.error(resp.message || t("subscriptionPlan.toast.autoRenewFailed"))
      }
    })
    setIsAutoRenewLoading(false)
  }

  const handleSubscribePlan = async (plan: "pro" | "ultra") => {
    const setLoading = plan === "pro" ? setIsProLoading : setIsFlagshipLoading
    const planLabel = t(`subscriptionPlan.plans.${plan}.name`)

    setLoading(true)
    await apiRequest("v1UsersWalletRechargeCreate", {
      plan: plan === "pro" ? ConstsSubscriptionPlan.PlanPro : ConstsSubscriptionPlan.PlanUltra,
      period_unit: selectedPeriodUnit,
      period_count: selectedPeriodCount,
    }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        setConfirmSubscriptionPlan(null)
        onOpenChange(false)
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || t(isRenewingCurrentPlan ? "subscriptionPlan.toast.renewFailed" : "subscriptionPlan.toast.subscribeFailed", { plan: planLabel }))
      }
    })
    setLoading(false)
  }

  const handleConfirmSubscription = async () => {
    if (confirmSubscriptionPlan === "pro") {
      await handleSubscribePlan("pro")
    } else if (confirmSubscriptionPlan === "ultra") {
      await handleSubscribePlan("ultra")
    }
    setConfirmSubscriptionPlan(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[40vh] max-h-[80vh] max-w-[80vw] flex-col gap-0 overflow-hidden p-0 md:max-w-4xl">
          <DialogHeader className="px-5 py-4">
            <DialogTitle>{t("subscriptionPlan.dialog.title")}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {!isTeamUser && hasAdvancedPlan ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{triggerPlanLabel}</Badge>
                  <span className="text-muted-foreground">
                    {loadingSubscription
                      ? t("subscriptionPlan.status.expiryLoading", { plan: triggerPlanLabel })
                      : t("subscriptionPlan.status.expiresAt", { plan: triggerPlanLabel, date: subscriptionExpiry || t("subscriptionPlan.status.lifetime") })}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-medium">
                    {loadingSubscription
                      ? t("subscriptionPlan.status.autoRenewLoading")
                      : subscription?.auto_renew
                        ? t("subscriptionPlan.status.autoRenewEnabled")
                        : t("subscriptionPlan.status.autoRenewDisabled")}
                  </span>
                  <Switch
                    checked={!!subscription?.auto_renew}
                    onCheckedChange={(checked) => void handleToggleAutoRenew(checked)}
                    disabled={loadingSubscription || isAutoRenewLoading}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] gap-4">
              <div className="grid min-h-0 gap-4 md:grid-cols-[240px_1fr]">
                <div className="grid min-h-0 gap-3 overflow-y-auto pr-1 md:grid-rows-3">
                  {accountPlanCards.map((plan) => {
                    const isCurrentPlan = plan.id === "basic" ? !hasAdvancedPlan : plan.id === "pro" ? isProPlan : plan.id === "ultra" ? isFlagshipPlan : false
                    const isSelected = selectedAccountPlan.id === plan.id

                    return (
                      <button
                        key={plan.id}
                        type="button"
                        className={cn(
                          "flex h-full w-full flex-col rounded-md border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/40",
                          isSelected && "border-primary bg-primary/5",
                        )}
                          onClick={() => setSelectedAccountPlanId(plan.id)}
                        >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 font-medium">
                            <IconCrown className={cn("size-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                            {plan.name}
                          </div>
                          {isCurrentPlan ? <Badge className="shrink-0">{t("subscriptionPlan.status.currentPlan")}</Badge> : null}
                        </div>
                        <div className="mt-3 text-xs leading-5 text-muted-foreground [@media(max-height:760px)]:hidden">{plan.desc}</div>
                      </button>
                    )
                  })}
                </div>

                <div className="flex min-h-0 flex-col rounded-md border bg-background">
                  <div className="border-b px-4 py-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <IconCrown className="size-4 text-primary" />
                        {selectedAccountPlan.name}
                        {isSelectedCurrentPlan ? <Badge>{t("subscriptionPlan.status.currentPlan")}</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{selectedAccountPlan.desc}</div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <div className="divide-y">
                      {selectedAccountPlanFeatures.map(({ label, tooltip, feature }) => {
                        const status = feature.status || "supported"
                        const FeatureIcon = status === "unsupported" ? IconX : IconCheck

                        return (
                          <div
                            key={label}
                            className={cn(
                              "flex h-10 items-center gap-3 px-4 text-sm",
                              status === "unsupported" && "text-muted-foreground",
                            )}
                          >
                            <FeatureIcon
                              className={cn(
                                "size-4 shrink-0",
                                status === "unsupported"
                                  ? "text-muted-foreground"
                                  : status === "partial"
                                    ? "text-warning"
                                  : "text-primary",
                              )}
                            />
                            <div className="flex min-w-0 flex-1 items-center gap-1 text-foreground">
                              <span className="truncate">{label}</span>
                              {tooltip ? (
                                <Tooltip>
                                  <TooltipTrigger className="inline-flex shrink-0 transition-colors hover:text-primary">
                                    <IconHelpCircle className="size-3.5" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[320px] leading-6">
                                    {tooltip}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                            <div className={cn(
                              "flex max-w-[60%] shrink-0 items-center justify-end text-right font-medium leading-5",
                              status === "unsupported" ? "text-muted-foreground" : "text-foreground",
                            )}>
                              {feature.label}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Tabs
                      value={selectedBillingPeriod}
                      onValueChange={(value) => {
                        setSelectedBillingPeriod(value as SubscriptionBillingPeriod)
                        setSelectedPeriodCount(1)
                      }}
                    >
                      <TabsList className="h-8 bg-muted group-data-horizontal/tabs:h-8">
                        <TabsTrigger value="monthly" className="h-7 px-3 text-xs">{t("subscriptionPlan.billing.monthly")}</TabsTrigger>
                        <TabsTrigger value="yearly" className="h-7 px-3 text-xs">{t("subscriptionPlan.billing.yearly")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <Select
                      value={String(selectedPeriodCount)}
                      onValueChange={(value) => setSelectedPeriodCount(Number(value))}
                    >
                      <SelectTrigger className="w-24 bg-background" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {subscriptionPeriodCounts.map((count) => (
                          <SelectItem key={count} value={String(count)}>
                            {selectedBillingPeriod === "monthly"
                              ? t("subscriptionPlan.billing.monthCount", { count })
                              : t("subscriptionPlan.billing.yearCount", { count })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="flex min-w-20 items-end justify-end">
                      <span className="text-xl font-semibold leading-none">{selectedOrderTotalLabel}</span>
                    </div>
                    {canSubscribeSelectedPlan ? (
                      <Button
                        className="w-full md:w-40"
                        onClick={() => setConfirmSubscriptionPlan(selectedSubscriptionPlan)}
                        disabled={isSelectedPlanLoading}
                      >
                        {isSelectedPlanLoading && <Spinner />}
                        {isSelectedCurrentPlan
                          ? t("subscriptionPlan.actions.renew")
                          : t("subscriptionPlan.actions.subscribePlan", { plan: selectedAccountPlan.name })}
                      </Button>
                    ) : (
                      <div className="flex h-9 w-full items-center justify-center rounded-md border bg-background px-4 text-sm text-muted-foreground md:w-40">
                        {isSelectedCurrentPlan ? t("subscriptionPlan.status.currentPlan") : t("subscriptionPlan.status.unavailable")}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmSubscriptionPlan !== null} onOpenChange={(nextOpen) => !nextOpen && setConfirmSubscriptionPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRenewingCurrentPlan ? t("subscriptionPlan.confirm.renewTitle") : t("subscriptionPlan.confirm.subscribeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingPlanCard
                ? t("subscriptionPlan.confirm.description", {
                    action: isRenewingCurrentPlan ? t("subscriptionPlan.actions.renew") : t("subscriptionPlan.actions.subscribe"),
                    plan: confirmingPlanCard.name,
                    period: selectedPeriodCountLabel,
                    total: selectedOrderTotalLabel,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProLoading || isFlagshipLoading}>{t("subscriptionPlan.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmSubscription()
              }}
              disabled={isProLoading || isFlagshipLoading}
            >
              {(isProLoading || isFlagshipLoading) && <Spinner className="mr-2 size-4" />}
              {isRenewingCurrentPlan ? t("subscriptionPlan.confirm.renewAction") : t("subscriptionPlan.confirm.subscribeAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
