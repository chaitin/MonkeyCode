import { useEffect, useState } from "react"
import { IconBuildingSkyscraper, IconCheck, IconCrown, IconHelpCircle, IconX } from "@tabler/icons-react"
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
import { getSubscriptionPlanShortLabel, hasProSubscription } from "@/utils/common"
import { useCommonData } from "../data-provider"
import dayjs from "dayjs"

type PersonalAccountPlanId = "basic" | "pro" | "ultra"
type AccountPlanId = PersonalAccountPlanId | "team"
type SubscriptionBillingPeriod = "monthly" | "yearly"

type AccountPlanFeature = {
  label: string
  status?: "supported" | "partial" | "unsupported"
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
    desc: "适合轻量办公和简单开发任务。",
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
  {
    id: "team",
    name: "团队版",
    desc: "面向企业级开发团队。",
    monthlyPrice: "联系销售",
    monthlyAmount: 0,
    monthlyUnit: "",
    yearlyPrice: "联系销售",
    yearlyAmount: 0,
    yearlyUnit: "",
  },
]

const thirdPartyModelsTooltip = "gpt、deepseek、glm、qwen、minimax、kimi、mimo 等大模型，调用时消耗积分"
const enhancedCapabilitiesTooltip = "图片识别、文档解析、联网搜索等能力，调用时消耗积分"
const basicModelsTooltip = "当前为 qwen3.6-plus"
const proModelsTooltip = "上下文更大，能力更强，对标国内一线厂商的当前主力模型，如 qwen3.6-plus, minimax-m2.7, kimi-k2.6, glm-5.1 等"
const ultraModelsTooltip = "超长的上下文和超强的能力，对标国际一线厂商的主力模型，如 gpt-5.5, claude-opus-4.6 等"
const monthlyCreditsTooltip = "积分可用于 AI 调用图片识别、文档解析、联网搜索等工具时支付调用费用；也可以调用更多模型；当每日 Token 额度不足时，还可以消耗积分继续使用。"

const accountPlanComparisonRows: { label: string; tooltip?: string; values: Record<PersonalAccountPlanId, AccountPlanFeature> }[] = [
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
    tooltip: basicModelsTooltip,
    values: {
      basic: { label: "每天 3000 万 Token" },
      pro: { label: "每天 3000 万 Token" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "专业模型",
    tooltip: proModelsTooltip,
    values: {
      basic: { label: "无额度", status: "unsupported" },
      pro: { label: "每天 3000 万 Token" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "旗舰模型",
    tooltip: ultraModelsTooltip,
    values: {
      basic: { label: "无额度", status: "unsupported" },
      pro: { label: "无额度", status: "unsupported" },
      ultra: { label: "每天 6000 万 Token" },
    },
  },
  {
    label: "每月赠送积分",
    tooltip: monthlyCreditsTooltip,
    values: {
      basic: { label: "不赠送积分", status: "unsupported" },
      pro: { label: "1 万积分" },
      ultra: { label: "10 万积分" },
    },
  },
  {
    label: "更多第三方大模型",
    tooltip: thirdPartyModelsTooltip,
    values: {
      basic: { label: "部分支持", status: "partial" },
      pro: { label: "支持" },
      ultra: { label: "支持" },
    },
  },
  {
    label: "更多增强能力",
    tooltip: enhancedCapabilitiesTooltip,
    values: {
      basic: { label: "部分支持", status: "partial" },
      pro: { label: "支持" },
      ultra: { label: "支持" },
    },
  },
]

const teamPlanFeatures: AccountPlanFeature[] = [
  { label: "统一额度池，团队成员共享使用" },
  { label: "成员管理，支持按团队统一开通" },
  { label: "用量统计，便于查看团队消耗" },
  { label: "私有化部署，适配企业内网和合规要求" },
  { label: "专属方案，按团队规模和模型需求配置" },
  { label: "咨询留资，销售专人跟进" },
]
const TEAM_CONSULT_URL = "https://baizhi.cloud/consult"

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
  const isSelectedTeamPlan = selectedAccountPlan.id === "team"
  const SelectedPlanIcon = isSelectedTeamPlan ? IconBuildingSkyscraper : IconCrown
  const selectedAccountPlanFeatures = isSelectedTeamPlan
    ? []
    : accountPlanComparisonRows.map((row) => ({
      label: row.label,
      tooltip: row.tooltip,
      feature: row.values[selectedAccountPlan.id as PersonalAccountPlanId],
    }))
  const selectedSubscriptionPlan = selectedAccountPlan.id === "pro" || selectedAccountPlan.id === "ultra" ? selectedAccountPlan.id : null
  const isSelectedCurrentPlan = selectedAccountPlan.id === "basic" ? !hasAdvancedPlan : selectedAccountPlan.id === "pro" ? isProPlan : selectedAccountPlan.id === "ultra" ? isFlagshipPlan : false
  const isSelectedPlanLoading = selectedAccountPlan.id === "pro" ? isProLoading : selectedAccountPlan.id === "ultra" ? isFlagshipLoading : false
  const canSubscribeSelectedPlan = selectedSubscriptionPlan === "pro" ? !isFlagshipPlan : selectedSubscriptionPlan === "ultra"
  const selectedPeriodAmount = selectedBillingPeriod === "monthly" ? selectedAccountPlan.monthlyAmount : selectedAccountPlan.yearlyAmount
  const selectedOrderTotal = selectedPeriodAmount * selectedPeriodCount
  const selectedPeriodUnitText = selectedBillingPeriod === "monthly" ? "月" : "年"
  const selectedPeriodUnit = selectedBillingPeriod === "monthly" ? ConstsSubscriptionPeriodUnit.PeriodMonth : ConstsSubscriptionPeriodUnit.PeriodYear
  const subscriptionPeriodCounts = selectedBillingPeriod === "monthly" ? monthlyPeriodCounts : yearlyPeriodCounts

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

    setSelectedAccountPlanId(isFlagshipPlan ? "ultra" : isProPlan ? "pro" : "basic")
  }, [isFlagshipPlan, isProPlan, open])

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
      period_unit: selectedPeriodUnit,
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
          <DialogHeader className="px-5 py-4">
            <DialogTitle>我的套餐</DialogTitle>
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
                <div className="grid min-h-0 gap-3 overflow-y-auto pr-1 md:grid-rows-4">
                  {accountPlanCards.map((plan) => {
                    const isCurrentPlan = plan.id === "basic" ? !hasAdvancedPlan : plan.id === "pro" ? isProPlan : plan.id === "ultra" ? isFlagshipPlan : false
                    const isSelected = selectedAccountPlan.id === plan.id
                    const PlanIcon = plan.id === "team" ? IconBuildingSkyscraper : IconCrown

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
                            <PlanIcon className={cn("size-4", isSelected ? "text-primary" : "text-muted-foreground")} />
                            {plan.name}
                          </div>
                          {isCurrentPlan ? <Badge className="shrink-0">当前套餐</Badge> : null}
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
                        <SelectedPlanIcon className="size-4 text-primary" />
                        {selectedAccountPlan.name}
                        {isSelectedCurrentPlan ? <Badge>当前套餐</Badge> : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{selectedAccountPlan.desc}</div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    {isSelectedTeamPlan ? (
                      <div className="space-y-4">
                        <div className="rounded-md border bg-muted/20 p-4 text-sm leading-6 text-muted-foreground">
                          面向企业级开发团队，团队版支持团队内共享额度和私有化部署。
                        </div>
                        <div className="divide-y">
                          {teamPlanFeatures.map((feature) => (
                            <div key={feature.label} className="flex h-10 items-center gap-3 px-4 text-sm">
                              <IconCheck className="size-4 shrink-0 text-primary" />
                              <div className="min-w-0 flex-1 truncate text-foreground">{feature.label}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
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
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {isSelectedTeamPlan ? (
                    <>
                      <div className="text-sm text-muted-foreground">
                        提交联系方式后，我们会根据团队规模和部署需求联系你。
                      </div>
                      <Button
                        className="w-full md:w-40"
                        onClick={() => window.open(TEAM_CONSULT_URL, "_blank", "noopener,noreferrer")}
                      >
                        联系销售
                      </Button>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
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
