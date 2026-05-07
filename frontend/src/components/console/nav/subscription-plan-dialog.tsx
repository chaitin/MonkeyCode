import { useEffect, useState } from "react"
import { IconCheck, IconCrown, IconHelpCircle, IconX } from "@tabler/icons-react"
import { toast } from "sonner"

import { ConstsSubscriptionPlan } from "@/api/Api"
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { getSubscriptionPlanShortLabel, hasProSubscription } from "@/utils/common"
import { useCommonData } from "../data-provider"
import dayjs from "dayjs"

type AccountPlanId = "basic" | "pro" | "ultra"
type SubscriptionBillingPeriod = "monthly" | "yearly"

type AccountPlanFeature = {
  label: string
  status?: "supported" | "partial" | "unsupported"
  tooltip?: string
}

type AccountPlanCard = {
  id: AccountPlanId
  name: string
  desc: string
  monthlyPrice: string
  monthlyAmount: number
  monthlyUnit: string
  yearlyPrice: string
  yearlyAmount: number
  yearlyUnit: string
  yearlyDiscount?: string
}

const accountPlanCards: AccountPlanCard[] = [
  {
    id: "basic",
    name: "基础会员",
    desc: "免费可用，适合轻量办公和简单开发任务。",
    monthlyPrice: "¥0",
    monthlyAmount: 0,
    monthlyUnit: "永久免费",
    yearlyPrice: "¥0",
    yearlyAmount: 0,
    yearlyUnit: "永久免费",
  },
  {
    id: "pro",
    name: "专业会员",
    desc: "适合日常高频使用。",
    monthlyPrice: "¥99",
    monthlyAmount: 99,
    monthlyUnit: "/ 月",
    yearlyPrice: "¥999",
    yearlyAmount: 999,
    yearlyUnit: "/ 年",
    yearlyDiscount: "8.3 折",
  },
  {
    id: "ultra",
    name: "旗舰会员",
    desc: "面向专业开发者和重度用户。",
    monthlyPrice: "¥499",
    monthlyAmount: 499,
    monthlyUnit: "/ 月",
    yearlyPrice: "¥4999",
    yearlyAmount: 4999,
    yearlyUnit: "/ 年",
    yearlyDiscount: "8.3 折",
  },
]

const thirdPartyModelsTooltip = "gpt、deepseek、glm、qwen、minimax、kimi、mimo 等大模型，调用时消耗积分"
const enhancedCapabilitiesTooltip = "图片识别、文档解析、联网搜索等能力，调用时消耗积分"

const accountPlanComparisonRows: { label: string; values: Record<AccountPlanId, AccountPlanFeature> }[] = [
  {
    label: "任务并发",
    values: {
      basic: { label: "1 个任务" },
      pro: { label: "3 个任务" },
      ultra: { label: "3 个任务" },
    },
  },
  {
    label: "云开发环境",
    values: {
      basic: { label: "1C / 4G" },
      pro: { label: "2C / 8G" },
      ultra: { label: "2C / 8G" },
    },
  },
  {
    label: "基础模型",
    values: {
      basic: { label: "每天 2000 万 Token" },
      pro: { label: "每天 3000 万 Token" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "专业模型",
    values: {
      basic: { label: "无额度", status: "unsupported" },
      pro: { label: "每天 3000 万 Token" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "旗舰模型",
    values: {
      basic: { label: "无额度", status: "unsupported" },
      pro: { label: "无额度", status: "unsupported" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "每月赠送积分",
    values: {
      basic: { label: "不赠送积分", status: "unsupported" },
      pro: { label: "1 万积分" },
      ultra: { label: "10 万积分" },
    },
  },
  {
    label: "更多第三方大模型",
    values: {
      basic: { label: "部分支持", status: "partial", tooltip: thirdPartyModelsTooltip },
      pro: { label: "支持", tooltip: thirdPartyModelsTooltip },
      ultra: { label: "支持", tooltip: thirdPartyModelsTooltip },
    },
  },
  {
    label: "更多增强能力",
    values: {
      basic: { label: "部分支持", status: "partial", tooltip: enhancedCapabilitiesTooltip },
      pro: { label: "支持", tooltip: enhancedCapabilitiesTooltip },
      ultra: { label: "支持", tooltip: enhancedCapabilitiesTooltip },
    },
  },
]

const monthlyPeriodCounts = Array.from({ length: 12 }, (_, index) => index + 1)
const yearlyPeriodCounts = Array.from({ length: 5 }, (_, index) => index + 1)

interface SubscriptionPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatSubscriptionExpiry(expiresAt?: string) {
  if (!expiresAt) {
    return "长期有效"
  }

  const parsed = dayjs(expiresAt)
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : expiresAt
}

export default function SubscriptionPlanDialog({ open, onOpenChange }: SubscriptionPlanDialogProps) {
  const {
    loadingSubscription,
    reloadSubscription,
    reloadWallet,
    subscription,
    user,
  } = useCommonData()
  const [selectedAccountPlanId, setSelectedAccountPlanId] = useState<AccountPlanId>("basic")
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
  const triggerPlanLabel = getSubscriptionPlanShortLabel(subscription?.plan)
  const isRenewingCurrentPlan = confirmSubscriptionPlan === "pro"
    ? isProPlan
    : confirmSubscriptionPlan === "ultra"
      ? isFlagshipPlan
      : false
  const confirmingPlanCard = accountPlanCards.find((plan) => plan.id === confirmSubscriptionPlan)
  const selectedAccountPlan = accountPlanCards.find((plan) => plan.id === selectedAccountPlanId) || accountPlanCards[0]
  const selectedAccountPlanFeatures = accountPlanComparisonRows.map((row) => ({
    label: row.label,
    feature: row.values[selectedAccountPlan.id],
  }))
  const selectedSubscriptionPlan = selectedAccountPlan.id === "pro" || selectedAccountPlan.id === "ultra" ? selectedAccountPlan.id : null
  const isSelectedCurrentPlan = selectedAccountPlan.id === "basic" ? !hasAdvancedPlan : selectedAccountPlan.id === "pro" ? isProPlan : isFlagshipPlan
  const isSelectedPlanLoading = selectedAccountPlan.id === "pro" ? isProLoading : selectedAccountPlan.id === "ultra" ? isFlagshipLoading : false
  const canSubscribeSelectedPlan = selectedSubscriptionPlan === "pro" ? !isFlagshipPlan : selectedSubscriptionPlan === "ultra"
  const selectedPeriodAmount = selectedBillingPeriod === "monthly" ? selectedAccountPlan.monthlyAmount : selectedAccountPlan.yearlyAmount
  const selectedOrderTotal = selectedPeriodAmount * selectedPeriodCount
  const selectedPeriodUnitText = selectedBillingPeriod === "monthly" ? "月" : "年"
  const subscriptionPeriodCounts = selectedBillingPeriod === "monthly" ? monthlyPeriodCounts : yearlyPeriodCounts

  useEffect(() => {
    if (!open) {
      return
    }

    reloadWallet()
    reloadSubscription()
    setSelectedAccountPlanId(isFlagshipPlan ? "ultra" : isProPlan ? "pro" : "basic")
  }, [isFlagshipPlan, isProPlan, open, reloadSubscription, reloadWallet])

  const handleToggleAutoRenew = async (checked: boolean) => {
    if (!hasAdvancedPlan) {
      return
    }

    setIsAutoRenewLoading(true)
    await apiRequest("v1UsersSubscriptionAutoRenewUpdate", { auto_renew: checked }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(checked ? "已开启自动续费" : "已关闭自动续费")
        reloadSubscription()
      } else {
        toast.error(resp.message || "自动续费设置失败")
      }
    })
    setIsAutoRenewLoading(false)
  }

  const handleSubscribePlan = async (plan: "pro" | "ultra") => {
    const setLoading = plan === "pro" ? setIsProLoading : setIsFlagshipLoading
    const planLabel = plan === "pro" ? "专业会员" : "旗舰会员"

    setLoading(true)
    await apiRequest("v1UsersWalletRechargeCreate", {
      plan: plan === "pro" ? ConstsSubscriptionPlan.PlanPro : ConstsSubscriptionPlan.PlanUltra,
      period_unit: selectedPeriodUnitText,
      period_count: selectedPeriodCount,
    }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        setConfirmSubscriptionPlan(null)
        onOpenChange(false)
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || `${isRenewingCurrentPlan ? "续费" : "开通"}${planLabel}失败`)
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
        <DialogContent className="flex h-[60vh] max-h-[90vh] max-w-[80vw] flex-col gap-0 overflow-hidden p-0 md:max-w-4xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>我的套餐</DialogTitle>
            <DialogDescription>查看基础会员、专业会员与旗舰会员权益，以及当前套餐状态</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {!isTeamUser && hasAdvancedPlan ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md border px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{triggerPlanLabel}</Badge>
                  <span className="text-muted-foreground">
                    {loadingSubscription ? `${triggerPlanLabel}到期时间加载中...` : `${triggerPlanLabel}将于 ${formatSubscriptionExpiry(subscription?.expires_at)} 到期`}
                  </span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-medium">
                    {loadingSubscription ? "自动续费加载中..." : `自动续费${subscription?.auto_renew ? "已开启" : "已关闭"}`}
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
                <div className="grid min-h-0 gap-3 md:grid-rows-3">
                  {accountPlanCards.map((plan) => {
                    const isCurrentPlan = plan.id === "basic" ? !hasAdvancedPlan : plan.id === "pro" ? isProPlan : isFlagshipPlan
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
                          {isCurrentPlan ? <Badge className="shrink-0">当前套餐</Badge> : null}
                        </div>
                        <div className="mt-3 text-xs leading-5 text-muted-foreground">{plan.desc}</div>
                        <div className="mt-auto flex flex-wrap items-end gap-x-3 gap-y-1 pt-4">
                          <div className="flex items-end gap-1">
                            <span className="text-lg font-semibold leading-none">{plan.monthlyPrice}</span>
                            <span className="pb-0.5 text-xs font-medium leading-none text-muted-foreground">/ 月</span>
                          </div>
                          <div className="flex items-end gap-1">
                            <span className="text-lg font-semibold leading-none">{plan.yearlyPrice}</span>
                            <span className="pb-0.5 text-xs font-medium leading-none text-muted-foreground">/ 年</span>
                          </div>
                        </div>
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
                        {isSelectedCurrentPlan ? <Badge>当前套餐</Badge> : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{selectedAccountPlan.desc}</div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedAccountPlanFeatures.map(({ label, feature }) => {
                        const status = feature.status || "supported"
                        const FeatureIcon = status === "unsupported" ? IconX : IconCheck

                        return (
                          <div
                            key={label}
                            className={cn(
                              "flex items-start gap-3 rounded-md border bg-muted/30 px-4 py-3 text-sm",
                              status === "unsupported" && "text-muted-foreground",
                            )}
                          >
                            <FeatureIcon
                              className={cn(
                                "mt-0.5 size-4 shrink-0",
                                status === "unsupported"
                                  ? "text-muted-foreground"
                                  : status === "partial"
                                    ? "text-yellow-600"
                                    : "text-primary",
                              )}
                            />
                            <div className="min-w-0">
                              <div className="text-xs text-muted-foreground">{label}</div>
                              <div className={cn("mt-1 font-medium leading-5", status === "unsupported" ? "text-muted-foreground" : "text-foreground")}>
                                {feature.label}
                                {feature.tooltip ? (
                                  <Tooltip>
                                    <TooltipTrigger className="ml-1 inline-flex align-[-2px] text-muted-foreground transition-colors hover:text-primary">
                                      <IconHelpCircle className="size-3.5" />
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[320px] leading-6">
                                      {feature.tooltip}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : null}
                              </div>
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
                        <TabsTrigger value="monthly" className="h-7 px-3 text-xs">月付</TabsTrigger>
                        <TabsTrigger value="yearly" className="h-7 px-3 text-xs">年付</TabsTrigger>
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
                            {count} {selectedBillingPeriod === "monthly" ? "个月" : "年"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="flex min-w-20 items-end justify-end">
                      <span className="text-xl font-semibold leading-none">¥{selectedOrderTotal}</span>
                    </div>
                    {canSubscribeSelectedPlan ? (
                      <Button
                        className="w-full md:w-40"
                        onClick={() => setConfirmSubscriptionPlan(selectedSubscriptionPlan)}
                        disabled={isSelectedPlanLoading}
                      >
                        {isSelectedPlanLoading && <Spinner />}
                        {isSelectedCurrentPlan ? "续费" : `开通${selectedAccountPlan.name}`}
                      </Button>
                    ) : (
                      <div className="flex h-9 w-full items-center justify-center rounded-md border bg-background px-4 text-sm text-muted-foreground md:w-40">
                        {isSelectedCurrentPlan ? "当前套餐" : "不可购买"}
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
            <AlertDialogTitle>{isRenewingCurrentPlan ? "确认续费套餐" : "确认开通套餐"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmingPlanCard
                ? `确认${isRenewingCurrentPlan ? "续费" : "开通"}${confirmingPlanCard.name}，购买 ${selectedPeriodCount} ${selectedPeriodUnitText}，合计 ¥${selectedOrderTotal}？`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProLoading || isFlagshipLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmSubscription()
              }}
              disabled={isProLoading || isFlagshipLoading}
            >
              {(isProLoading || isFlagshipLoading) && <Spinner className="mr-2 size-4" />}
              {isRenewingCurrentPlan ? "确认续费" : "确认开通"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
