import {
  CalendarCheck2,
  FileText,
  HandCoins,
  Megaphone,
  UserPlus,
} from "lucide-react"
import type { ComponentType } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface GetCreditsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenCommunity?: () => void
  onOpenEarn?: () => void
}

interface CreditWay {
  title: string
  description: string
  reward: string
  icon: ComponentType<{ className?: string }>
  action?: {
    kind: "link" | "button"
    label: string
    href?: string
    actionKey?: "community" | "earn"
  }
}

const CREDIT_WAYS: CreditWay[] = [
  {
    title: "邀请注册",
    description: "将邀请链接分享给好友。好友通过你的链接注册后，你可以获得积分奖励。",
    reward: "+5,000 积分 / 人",
    icon: UserPlus,
    action: {
      kind: "button",
      label: "去邀请好友",
      actionKey: "earn",
    },
  },
  {
    title: "征文投稿",
    description: "分享你使用 MonkeyCode 的故事，写得越真诚、越有料、越有传播力，奖励越高。",
    reward: "1 万 - 10 万积分",
    icon: FileText,
    action: {
      kind: "link",
      href: "https://monkeycode.docs.baizhi.cloud/node/019d8bcf-5bcc-7b38-afcf-6b9d180a0096",
      label: "查看详细规则",
    },
  },
  {
    title: "充值积分",
    description: "如果需要更高额度，可以直接充值积分，随用随取。",
    reward: "立即到账",
    icon: HandCoins,
    action: {
      kind: "button",
      label: "去充值",
      actionKey: "earn",
    },
  },
  {
    title: "每日签到",
    description: "每天签到 1 次，持续积累积分，适合日常轻量使用。",
    reward: "+100 积分 / 天",
    icon: CalendarCheck2,
  },
  {
    title: "社区活动",
    description: "加入社群，参与福利活动、共创反馈或专题活动，赢取额外积分。",
    reward: "不定期奖励",
    icon: Megaphone,
    action: {
      kind: "button",
      label: "加入社区交流群",
      actionKey: "community",
    },
  },
] as const

export default function GetCreditsDialog({ open, onOpenChange, onOpenCommunity, onOpenEarn }: GetCreditsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>获取积分</DialogTitle>
        </DialogHeader>

        <div className="mt-1 flex-1 overflow-y-auto pr-1">
          <div className="space-y-2.5">
          {CREDIT_WAYS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border bg-background p-3.5"
            >
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary">
                  <item.icon className="size-[18px]" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm font-medium text-foreground">
                      {item.title}
                    </div>
                    <div className="shrink-0">
                      <Badge variant="secondary" className="font-medium text-primary">
                        {item.reward}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </div>
                  {item.action?.kind === "link" ? (
                    <div>
                      <Button
                        asChild
                        className="px-0"
                        size="xs"
                        variant="link"
                      >
                        <a
                          href={item.action.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {item.action.label}
                        </a>
                      </Button>
                    </div>
                  ) : item.action?.kind === "button" ? (
                    <div>
                      <Button
                        className="px-0"
                        type="button"
                        size="xs"
                        variant="link"
                        onClick={() => {
                          if (item.action?.actionKey === "community") {
                            onOpenCommunity?.()
                            return
                          }
                          if (item.action?.actionKey === "earn") {
                            onOpenEarn?.()
                          }
                        }}
                      >
                        {item.action.label}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
