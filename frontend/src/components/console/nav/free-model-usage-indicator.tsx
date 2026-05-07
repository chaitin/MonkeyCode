import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCommonData } from "../data-provider"
import { getSubscriptionPlanLabel } from "@/utils/common"
import { Crown } from "lucide-react"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

const PLAN_TOKEN_LIMITS = {
  basic: {
    basic: 20_000_000,
    pro: 0,
    ultra: 0,
  },
  pro: {
    basic: 30_000_000,
    pro: 30_000_000,
    ultra: 0,
  },
  ultra: {
    basic: 60_000_000,
    pro: 60_000_000,
    ultra: 60_000_000,
  },
} as const

type PlanTokenLimitKey = keyof typeof PLAN_TOKEN_LIMITS
type ModelQuotaKey = keyof (typeof PLAN_TOKEN_LIMITS)["basic"]

function formatTokenNumber(value: number) {
  const amount = value / 1_000_000

  if (amount >= 1) {
    return `${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1)} M`
  }

  return `${value.toLocaleString("zh-CN")}`
}

function normalizePlan(plan?: string | null): PlanTokenLimitKey {
  if (plan === "pro") {
    return "pro"
  }
  if (plan === "ultra" || plan === "flagship") {
    return "ultra"
  }
  return "basic"
}

function clampTokenBalance(value: number, total: number) {
  return Math.min(Math.max(value, 0), total)
}

export default function FreeModelUsageIndicator() {
  const {
    balance,
    dailyBasicTokenBalance,
    dailyProTokenBalance,
    dailyUltraTokenBalance,
    subscription,
  } = useCommonData()
  const plan = normalizePlan(subscription?.plan)
  const limits = PLAN_TOKEN_LIMITS[plan]
  const remainingByType: Record<ModelQuotaKey, number> = {
    basic: dailyBasicTokenBalance,
    pro: dailyProTokenBalance,
    ultra: dailyUltraTokenBalance,
  }
  const quotaItems = [
    { key: "basic", label: "基础模型", total: limits.basic },
    { key: "pro", label: "专业模型", total: limits.pro },
    { key: "ultra", label: "旗舰模型", total: limits.ultra },
  ].map((item) => {
    const remaining = clampTokenBalance(remainingByType[item.key as ModelQuotaKey], item.total)
    const used = Math.max(item.total - remaining, 0)
    const progress = item.total > 0 ? Math.min((used / item.total) * 100, 100) : 0

    return {
      ...item,
      remaining,
      used,
      progress,
    }
  })
  const availableQuotaItems = quotaItems.filter((item) => item.total > 0)
  const totalTokens = availableQuotaItems.reduce((sum, item) => sum + item.total, 0)
  const remainingTokens = availableQuotaItems.reduce((sum, item) => sum + item.remaining, 0)
  const remainingProgress = totalTokens > 0 ? Math.min((remainingTokens / totalTokens) * 100, 100) : 0
  const planLabel = getSubscriptionPlanLabel(subscription?.plan)
  const balanceLabel = Math.floor(balance).toLocaleString("zh-CN")
  const canUpgradePlan = plan !== "ultra"
  const canRenewPlan = plan !== "basic"
  const openPlanSection = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "plan" },
    }))
  }

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="hidden h-8 items-center gap-2 rounded-sm border border-border/70 bg-background/60 px-2.5 text-left transition-colors hover:border-primary/30 hover:bg-background md:inline-flex"
        >
          <CircularProgress
            value={remainingProgress}
            max={100}
            size={16}
            strokeWidth={3}
            aria-hidden="true"
          />
          <span className="shrink-0 text-sm font-medium">{planLabel}</span>
          <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{balanceLabel}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="w-80"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">每日模型额度</div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-sm bg-primary/10 px-2 py-1 font-medium text-primary">
              <Crown className="size-3.5" />
              {planLabel}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              {canUpgradePlan ? (
                <Button type="button" size="xs" variant="secondary" onClick={openPlanSection}>
                  升级
                </Button>
              ) : null}
              {canRenewPlan ? (
                <Button type="button" size="xs" variant="secondary" onClick={openPlanSection}>
                  续费
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
            <span className="text-muted-foreground">积分余额</span>
            <span className="font-medium">{balanceLabel}</span>
          </div>

          <div className="space-y-3">
            {quotaItems.map((item) => (
              <div key={item.key} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className={cn("text-xs", item.total > 0 ? "text-muted-foreground" : "text-muted-foreground/70")}>
                    {item.total > 0 ? `剩余 ${formatTokenNumber(item.remaining)} Tokens` : "无额度"}
                  </span>
                </div>
                <Progress
                  value={item.progress}
                  className={cn("mt-3 h-2 bg-muted", item.total === 0 && "opacity-50")}
                />
              </div>
            ))}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
