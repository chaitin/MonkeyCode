import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useCommonData } from "../data-provider"
import { Copy, Crown, ExternalLink, MessageSquarePlus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"
const GITHUB_REPOSITORY_URL = "https://github.com/chaitin/monkeycode"

const PLAN_TOKEN_LIMITS = {
  basic: {
    basic: 30_000_000,
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
type QuotaItem = {
  key: string
  total: number
  remaining: number
  used: number
  progress: number
}

function formatTokenNumber(value: number) {
  const amount = value / 1_000_000

  if (amount >= 1) {
    return `${(Math.floor(amount * 10) / 10).toFixed(1)}M`
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

function getQuotaProgressClassName(progress: number) {
  if (progress > 80) {
    return "bg-danger"
  }

  if (progress >= 50) {
    return "bg-warning"
  }

  return "bg-muted-foreground"
}

function getQuotaCircularProgressClassName(progress: number) {
  if (progress > 80) {
    return "text-danger"
  }

  if (progress >= 50) {
    return "text-warning"
  }

  return "text-muted-foreground"
}

function getQuotaItems(
  plan: PlanTokenLimitKey,
  remainingByType: Record<ModelQuotaKey, number>,
): QuotaItem[] {
  const limits = PLAN_TOKEN_LIMITS[plan]

  return [
    { key: "basic", total: limits.basic },
    { key: "pro", total: limits.pro },
    { key: "ultra", total: limits.ultra },
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
}

function openWalletSection(section: "earn" | "usage" | "plan") {
  window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
    detail: { section },
  }))
}

export function RewardsBalanceIndicator() {
  const { t } = useTranslation()
  const {
    balance,
    dailyBasicTokenBalance,
    dailyProTokenBalance,
    dailyUltraTokenBalance,
    subscription,
  } = useCommonData()
  const plan = normalizePlan(subscription?.plan)
  const planLabel = t(`consoleShell.rewards.plans.${plan}`)
  const balanceLabel = Math.floor(balance).toLocaleString("zh-CN")
  const canUpgradePlan = plan !== "ultra"
  const canRenewPlan = plan !== "basic"
  const quotaItems = getQuotaItems(plan, {
    basic: dailyBasicTokenBalance,
    pro: dailyProTokenBalance,
    ultra: dailyUltraTokenBalance,
  })
  const availableQuotaItems = quotaItems.filter((item) => item.total > 0)
  const totalTokens = availableQuotaItems.reduce((sum, item) => sum + item.total, 0)
  const remainingTokens = availableQuotaItems.reduce((sum, item) => sum + item.remaining, 0)
  const usedProgress = totalTokens > 0 ? Math.min(((totalTokens - remainingTokens) / totalTokens) * 100, 100) : 0

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="hidden h-8 items-center gap-2 rounded-sm border border-border/70 bg-background/60 px-2.5 text-left text-sm transition-colors hover:border-brand-border hover:bg-background md:inline-flex"
        >
          <CircularProgress
            value={usedProgress}
            max={100}
            size={16}
            strokeWidth={3}
            indicatorClassName={getQuotaCircularProgressClassName(usedProgress)}
            aria-hidden="true"
          />
          <span className="shrink-0 tabular-nums">
            {t("consoleShell.rewards.quota.freeWithValue", { amount: formatTokenNumber(remainingTokens) })}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="w-80"
      >
        <div className="space-y-4">
          <section className="rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-sm bg-brand-muted px-2 py-1 font-medium text-brand">
                    <Crown className="size-3.5 shrink-0" />
                    <span className="truncate">{planLabel}</span>
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canUpgradePlan ? (
                  <Button type="button" size="xs" variant="secondary" className="h-7" onClick={() => openWalletSection("plan")}>
                    {t("consoleShell.rewards.quota.upgrade")}
                  </Button>
                ) : null}
                {canRenewPlan ? (
                  <Button type="button" size="xs" variant="secondary" className="h-7" onClick={() => openWalletSection("plan")}>
                    {t("consoleShell.rewards.quota.renew")}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
              <span className="text-muted-foreground">{t("consoleShell.rewards.quota.credits")}</span>
              <span className="font-medium tabular-nums">{balanceLabel}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="h-7 flex-1"
                onClick={() => openWalletSection("earn")}
              >
                {t("consoleShell.rewards.quota.earnCredits")}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="secondary"
                className="h-7 flex-1"
                onClick={() => openWalletSection("usage")}
              >
                {t("consoleShell.rewards.quota.creditBill")}
              </Button>
            </div>
          </section>

          <section className="space-y-3">
            {quotaItems.map((item) => (
              <div key={item.key} className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{t(`consoleShell.rewards.quota.models.${item.key}`)}</span>
                  <span className={cn("text-xs", item.total > 0 ? "text-muted-foreground" : "text-muted-foreground/70")}>
                    {item.total > 0 ? t("consoleShell.rewards.quota.remainingToday", { amount: formatTokenNumber(item.remaining) }) : t("consoleShell.rewards.quota.noQuota")}
                  </span>
                </div>
                <Progress
                  value={item.progress}
                  className={cn("mt-3 h-2 bg-muted", item.total === 0 && "opacity-50")}
                  indicatorClassName={getQuotaProgressClassName(item.progress)}
                />
              </div>
            ))}
          </section>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

export function FeedbackSuggestionButton() {
  const { t } = useTranslation()
  const {
    user,
  } = useCommonData()
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false)
  const userId = user?.id || "-"
  const feedbackTemplate = t("consoleShell.rewards.feedback.template", { uid: userId })

  const openFeedbackIssues = () => {
    window.open(GITHUB_REPOSITORY_URL, "_blank", "noopener,noreferrer")
    setFeedbackDialogOpen(false)
  }

  const copyFeedbackTemplate = async () => {
    try {
      await navigator.clipboard.writeText(feedbackTemplate)
      toast.success(t("consoleShell.rewards.feedback.copySuccess"))
    } catch {
      toast.error(t("consoleShell.rewards.feedback.copyFailed"))
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden h-8 shrink-0 gap-1.5 px-2.5 lg:inline-flex"
        onClick={() => setFeedbackDialogOpen(true)}
      >
        <MessageSquarePlus className="size-4" />
        {t("consoleShell.rewards.feedback.button")}
      </Button>
      <Dialog open={feedbackDialogOpen} onOpenChange={setFeedbackDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("consoleShell.rewards.feedback.title")}</DialogTitle>
            <DialogDescription>
              {t("consoleShell.rewards.feedback.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{t("consoleShell.rewards.feedback.templateLabel")}</div>
              <Button type="button" size="xs" variant="secondary" onClick={() => void copyFeedbackTemplate()}>
                <Copy className="size-3.5" />
                {t("consoleShell.rewards.feedback.templateCopy")}
              </Button>
            </div>
            <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-background p-2 text-xs text-muted-foreground">
              {feedbackTemplate}
            </pre>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" onClick={openFeedbackIssues}>
              <ExternalLink className="size-4" />
              {t("consoleShell.rewards.feedback.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function FreeModelUsageIndicator() {
  return (
    <div className="hidden items-center gap-2 md:flex">
      <RewardsBalanceIndicator />
      <FeedbackSuggestionButton />
    </div>
  )
}
