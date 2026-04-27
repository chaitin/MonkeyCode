import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { IconGift } from "@tabler/icons-react"
import * as React from "react"

const DAILY_FREE_MODEL_TOTAL_TOKENS = 50_000_000_000

function formatTokenNumber(value: number) {
  if (value >= 100_000_000) {
    const amount = value / 100_000_000
    return `${amount >= 100 ? amount.toFixed(0) : amount.toFixed(1)} 亿`
  }

  if (value >= 10_000) {
    const amount = value / 10_000
    return `${amount >= 100 ? amount.toFixed(0) : amount.toFixed(1)} 万`
  }

  return value.toLocaleString("zh-CN")
}

function normalizeUsagePercent(value?: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.min(Math.max(value as number, 0), 100)
}

export default function FreeModelUsageIndicator() {
  const [usagePercent, setUsagePercent] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false

    const fetchUsage = async () => {
      try {
        const response = await fetch("/api/v1/users/free-model-pool/usage", {
          method: "GET",
          credentials: "include",
        })
        if (!response.ok) {
          return
        }

        const resp = await response.json() as {
          code?: number
          data?: {
            usage_percent?: number
          }
        }

        if (cancelled || resp.code !== 0) {
          return
        }

        setUsagePercent(normalizeUsagePercent(resp.data?.usage_percent))
      } catch {
        return
      }
    }

    void fetchUsage()
    const timer = window.setInterval(() => {
      void fetchUsage()
    }, 30_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const totalTokens = DAILY_FREE_MODEL_TOTAL_TOKENS
  const progress = usagePercent
  const usedTokens = Math.min(Math.round((totalTokens * progress) / 100), totalTokens)
  const exhausted = progress >= 100

  return (
    <HoverCard openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "hidden h-8 items-center gap-2 rounded-md px-3 text-left transition-colors md:inline-flex",
            !exhausted && "min-w-[248px]",
            exhausted
              ? "bg-amber-500/8 text-amber-600 hover:bg-amber-500/12"
              : "bg-muted/50 hover:bg-accent"
          )}
        >
          <div
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full",
              exhausted ? "bg-amber-500/12 text-amber-600" : "bg-primary/10 text-primary"
            )}
          >
            <IconGift className="size-3.5" />
          </div>
          {exhausted ? (
            <div className="min-w-0 flex-1 truncate text-sm font-medium">
              今日免费模型已用尽
            </div>
          ) : (
            <>
              <div className="shrink-0 text-sm font-medium">免费大模型</div>
              <Progress
                value={progress}
                className="h-1.5 min-w-12 flex-1 bg-muted-foreground/10"
              />
              <div className="shrink-0 text-xs text-muted-foreground">{progress.toFixed(1)}%</div>
            </>
          )}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="w-80"
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="text-sm font-medium">免费模型大放送</div>
            <div className="text-xs leading-5 text-muted-foreground">
              MonkeyCode 每天早上 10 点送出 500 亿 Token 免费额度，供所有用户共享使用。
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              选择带有“免费”标记的模型，即可直接使用这部分免费额度。
            </div>
            <div className="text-xs leading-5 text-muted-foreground">
              当日免费额度耗尽后，模型调用将按各模型的正常价格扣除积分。
            </div>
          </div>

          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">今日免费额度</span>
              <span className="font-medium">500 亿 tokens</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">目前已使用</span>
              <span className="font-medium">
                {formatTokenNumber(usedTokens)} tokens
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">使用进度</span>
              <span className={cn("font-medium", exhausted && "text-amber-600")}>
                {exhausted ? "已用尽" : `${progress.toFixed(1)}%`}
              </span>
            </div>
            <Progress
              value={Math.min(progress, 100)}
              className="mt-3 h-2 bg-muted"
            />
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
