import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item"
import { IconChevronDown, IconCoin, IconGift } from "@tabler/icons-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import dayjs from "dayjs"

import { ConstsTransactionKind, type DomainInvitationItem, type DomainTransactionLog } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { captchaChallenge } from "@/utils/common"
import { useCommonData } from "../data-provider"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

const WALLET_NAV = [
  { id: "earn", name: "我的积分", icon: IconGift },
  { id: "usage", name: "积分账单", icon: IconCoin },
] as const

const COMMUNITY_GROUPS = [
  { id: "wechat", src: "/wechat.png", alt: "微信二维码", label: "微信群", iconName: "wecom" },
  { id: "dingtalk", src: "/dingtalk.png", alt: "钉钉群二维码", label: "钉钉群", iconName: "dingtalk" },
  { id: "feishu", src: "/feishu.png", alt: "飞书群二维码", label: "飞书群", iconName: "lark" },
] as const

type WalletSectionId = (typeof WALLET_NAV)[number]["id"]

export default function WalletDialog() {
  const [open, setOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<WalletSectionId>("earn")
  const [transcations, setTranscations] = useState<DomainTransactionLog[]>([])
  const [invitations, setInvitations] = useState<DomainInvitationItem[]>([])
  const [invitationCount, setInvitationCount] = useState(0)
  const [isInvitationsLoading, setIsInvitationsLoading] = useState(false)
  const [isInvitationListExpanded, setIsInvitationListExpanded] = useState(false)
  const [isCheckinSubmitting, setIsCheckinSubmitting] = useState(false)
  const [exchangeCode, setExchangeCode] = useState("")
  const [isExchangeLoading, setIsExchangeLoading] = useState(false)
  const [selectedRechargeCredits, setSelectedRechargeCredits] = useState<number | null>(null)
  const [rechargingCredits, setRechargingCredits] = useState<number | null>(null)
  const [showRechargeDialog, setShowRechargeDialog] = useState(false)
  const [isCreditConsumptionUpdating, setIsCreditConsumptionUpdating] = useState(false)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const contentScrollRef = useRef<HTMLDivElement>(null)

  const {
    balance,
    checkedInToday,
    loadingCheckinStatus,
    reloadCheckinStatus,
    reloadSubscription,
    reloadWallet,
    subscription,
    user,
  } = useCommonData()

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()
  const getInvitationInitial = (name?: string) => name?.trim().charAt(0).toUpperCase() || "?"
  const invitationLink = `https://monkeycode-ai.com/?ic=${user.id}`
  const rechargeOptions = [
    { credits: 2000, price: 10, discountLabel: "无折扣" },
    { credits: 15000, price: 50, discountLabel: "6.7 折" },
    { credits: 100000, price: 250, discountLabel: "5.0 折" },
    { credits: 500000, price: 1000, discountLabel: "4.0 折" },
  ]

  const positiveKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindSignupBonus,
    ConstsTransactionKind.TransactionKindVoucherExchange,
    ConstsTransactionKind.TransactionKindInvitationReward,
    ConstsTransactionKind.TransactionKindProUpgradeRefund,
    ConstsTransactionKind.TransactionKindDailyGrant,
    ConstsTransactionKind.TransactionKindTopUp,
    ConstsTransactionKind.TransactionKindCheckin,
  ])

  const negativeKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindVMConsumption,
    ConstsTransactionKind.TransactionKindModelConsumption,
    ConstsTransactionKind.TransactionKindMCPToolConsumption,
    ConstsTransactionKind.TransactionKindProSubscription,
    ConstsTransactionKind.TransactionKindProAutoRenew,
    ConstsTransactionKind.TransactionKindUltraSubscription,
    ConstsTransactionKind.TransactionKindUltraAutoRenew,
    ConstsTransactionKind.TransactionKindViolationFine,
  ])

  const getTransactionDirection = (kind?: ConstsTransactionKind) => {
    const kindKey = kind || ""
    if (positiveKinds.has(kindKey)) {
      return 1
    }
    if (negativeKinds.has(kindKey)) {
      return -1
    }
    return 1
  }

  const getTransactionLabel = (kind?: ConstsTransactionKind) => {
    switch (kind) {
      case ConstsTransactionKind.TransactionKindSignupBonus:
        return "新用户注册奖励"
      case ConstsTransactionKind.TransactionKindVoucherExchange:
        return "通过兑换码领取"
      case ConstsTransactionKind.TransactionKindInvitationReward:
        return "邀请注册奖励"
      case ConstsTransactionKind.TransactionKindVMConsumption:
        return "开发环境消耗"
      case ConstsTransactionKind.TransactionKindModelConsumption:
        return "大模型消耗"
      case ConstsTransactionKind.TransactionKindMCPToolConsumption:
        return "MCP 工具消耗"
      case ConstsTransactionKind.TransactionKindProSubscription:
        return "兑换专业会员"
      case ConstsTransactionKind.TransactionKindProAutoRenew:
        return "专业会员自动续费"
      case ConstsTransactionKind.TransactionKindUltraSubscription:
        return "兑换旗舰会员"
      case ConstsTransactionKind.TransactionKindUltraAutoRenew:
        return "旗舰会员自动续费"
      case ConstsTransactionKind.TransactionKindProUpgradeRefund:
        return "套餐升级退款"
      case ConstsTransactionKind.TransactionKindDailyGrant:
        return "当日钱包发放"
      case ConstsTransactionKind.TransactionKindTopUp:
        return "充值积分"
      case ConstsTransactionKind.TransactionKindCheckin:
        return "每日签到奖励"
      case ConstsTransactionKind.TransactionKindViolationFine:
        return "违规罚扣"
      default:
        return "交易记录"
    }
  }

  const formatSignedAmount = (rawValue?: number, kind?: ConstsTransactionKind) => {
    if (!rawValue) {
      return null
    }

    const normalized = rawValue / 1000
    const direction = getTransactionDirection(kind)
    const sign = direction >= 0 ? "+" : "-"
    return `${sign}${formatPoints(Math.abs(normalized))}`
  }

  const formatInvitationTime = (timestamp?: number) => {
    if (!timestamp) {
      return "注册时间未知"
    }

    const parsed = dayjs.unix(timestamp)
    return parsed.isValid() ? `${parsed.fromNow()}注册` : "注册时间未知"
  }

  const fetchTranscations = useCallback(async (pageToLoad: number, replace = false) => {
    setIsLoadingMore(true)
    await apiRequest("v1UsersWalletTransactionList", {
      size: 20,
      page: pageToLoad,
    }, [], (resp) => {
      if (resp.code === 0) {
        const newTransactions = resp.data?.transactions || []
        setTranscations(prev => replace ? newTransactions : [...prev, ...newTransactions])
        setHasNextPage(resp.data?.page?.has_next_page || false)
        setPage(pageToLoad + 1)
      } else {
        toast.error(resp.message || "获取交易记录失败")
      }
    })
    setIsLoadingMore(false)
  }, [])

  const fetchInvitations = useCallback(async () => {
    setIsInvitationsLoading(true)
    await apiRequest("v1UsersInvitationsList", {
      page: 1,
      size: 20,
    }, [], (resp) => {
      if (resp.code === 0) {
        const items = resp.data?.items || []
        setInvitations(items)
        setInvitationCount(resp.data?.count || items.length)
      } else {
        toast.error(resp.message || "获取邀请用户列表失败")
      }
    })
    setIsInvitationsLoading(false)
  }, [])

  const loadMore = useCallback(() => {
    if (hasNextPage && !isLoadingMore) {
      fetchTranscations(page)
    }
  }, [fetchTranscations, hasNextPage, isLoadingMore, page])

  const initializeDialog = useCallback((section: WalletSectionId) => {
    setActiveSection(section)
    setIsInvitationListExpanded(false)
    reloadWallet()
    reloadCheckinStatus()
    reloadSubscription()
    setPage(1)
    setTranscations([])
    setHasNextPage(false)
    fetchTranscations(1, true)
    fetchInvitations()
  }, [fetchInvitations, fetchTranscations, reloadCheckinStatus, reloadSubscription, reloadWallet])

  useEffect(() => {
    const handleOpenWallet = (event: Event) => {
      const customEvent = event as CustomEvent<{ section?: string }>
      const section = customEvent.detail?.section
      if (section !== "earn" && section !== "usage") {
        return
      }

      initializeDialog(section)
      setOpen(true)
    }

    window.addEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    return () => {
      window.removeEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    }
  }, [initializeDialog])

  useEffect(() => {
    if (!open || activeSection !== "usage") {
      return
    }

    const currentRef = loadMoreRef.current
    const rootRef = contentScrollRef.current
    if (!currentRef || !rootRef) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      {
        root: rootRef,
        threshold: 0,
        rootMargin: "0px 0px 120px 0px",
      },
    )

    observer.observe(currentRef)

    return () => {
      observer.unobserve(currentRef)
      observer.disconnect()
    }
  }, [activeSection, hasNextPage, loadMore, open, transcations.length])

  const handleCopyInvitationLink = () => {
    navigator.clipboard.writeText(invitationLink)
    toast.success("邀请链接已复制到剪贴板")
  }

  const handleExchange = async () => {
    if (!exchangeCode.trim()) {
      toast.error("请输入兑换码")
      return
    }

    setIsExchangeLoading(true)
    await apiRequest("v1UsersWalletExchangeCreate", { code: exchangeCode.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("兑换成功")
        setExchangeCode("")
        reloadWallet()
      } else {
        toast.error(resp.message || "兑换失败")
      }
    })
    setIsExchangeLoading(false)
  }

  const handleRecharge = async () => {
    if (!selectedRechargeCredits) {
      toast.error("请选择充值套餐")
      return
    }

    setRechargingCredits(selectedRechargeCredits)
    await apiRequest("v1UsersWalletRechargeCreate", { credits: selectedRechargeCredits }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        setShowRechargeDialog(false)
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || "获取支付链接失败")
      }
    })
    setRechargingCredits(null)
  }

  const handleCreditConsumptionChange = async (enabled: boolean) => {
    if (isCreditConsumptionUpdating) {
      return
    }

    setIsCreditConsumptionUpdating(true)
    await apiRequest("v1UsersSubscriptionCreditConsumptionUpdate", {
      enable_credit_consumption: enabled,
    }, [], (resp) => {
      if (resp.code === 0) {
        reloadSubscription()
        toast.success(enabled ? "已允许额度耗尽后消耗积分" : "已关闭额度耗尽后消耗积分")
        return
      }

      toast.error(resp.message || "设置失败")
    }, () => {
      toast.error("设置失败")
    })
    setIsCreditConsumptionUpdating(false)
  }

  const handleCheckin = async () => {
    if (isCheckinSubmitting || checkedInToday) {
      return
    }

    setIsCheckinSubmitting(true)

    const captchaToken = await captchaChallenge()
    if (!captchaToken) {
      toast.error("验证码验证失败")
      setIsCheckinSubmitting(false)
      return
    }

    await apiRequest(
      "v1UsersWalletCheckinCreate",
      { captcha_token: captchaToken },
      [],
      (resp) => {
        if (resp.code === 0) {
          reloadWallet()
          reloadCheckinStatus()
          fetchTranscations(1, true)
          toast.success("签到成功，已领取 100 积分")
          return
        }

        toast.error(resp.message || "签到失败，请重试")
      },
      () => {
        toast.error("签到失败，请重试")
      },
    )

    setIsCheckinSubmitting(false)
  }

  const earnContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-md font-medium">当前可用积分</div>
          <Button
            variant="default"
            size="sm"
            className="px-3"
            onClick={() => {
              setSelectedRechargeCredits(null)
              setShowRechargeDialog(true)
            }}
          >
            充值
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">积分余额</div>
            <div className="mt-2 text-lg font-medium tabular-nums">{formatPoints(balance)}</div>
          </div>
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-md font-medium">邀请注册</div>
            <div className="mt-2 text-sm text-muted-foreground">
              将下方邀请链接分享给好友。好友通过该链接注册后，你将获得 5000 积分奖励。
            </div>
          </div>
          <div className="rounded-full bg-brand-muted px-2.5 py-1 text-xs font-medium text-brand">
            +5,000
          </div>
        </div>
        <div className="mt-4 flex flex-row justify-between gap-2">
          <Input value={invitationLink} readOnly />
          <Button variant="outline" onClick={handleCopyInvitationLink}>复制邀请链接</Button>
        </div>
        <div className="mt-4">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60"
            onClick={() => setIsInvitationListExpanded((prev) => !prev)}
          >
            <span className="text-sm font-medium">已邀请 {formatPoints(invitationCount)} 人</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {isInvitationListExpanded ? "收起列表" : "展开列表"}
              <IconChevronDown className={cn("size-4 transition-transform", isInvitationListExpanded && "rotate-180")} />
            </span>
          </button>
          {isInvitationListExpanded ? (
            <div className="mt-3 space-y-2">
              {isInvitationsLoading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Spinner />
                  <span className="ml-2">加载邀请用户中...</span>
                </div>
              ) : invitations.length > 0 ? (
                invitations.map((invitation) => (
                  <div
                    key={invitation.id || `${invitation.name || "unknown"}-${invitation.invited_at || 0}`}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={invitation.avatar_url} alt={invitation.name || "邀请用户头像"} />
                        <AvatarFallback>{getInvitationInitial(invitation.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {invitation.name || "未命名用户"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatInvitationTime(invitation.invited_at)}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-sm font-medium text-brand">
                      +{formatPoints(invitation.credits || 0)} 积分
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  暂无邀请记录
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div>
          <div className="text-md font-medium">社区活动</div>
          <div className="mt-2 text-sm text-muted-foreground">
            加入技术交流群，参与不定期社区活动与福利互动，赢取更多积分奖励。
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {COMMUNITY_GROUPS.map((group) => (
            <HoverCard key={group.id} openDelay={120} closeDelay={80}>
              <HoverCardTrigger asChild>
                <Button variant="outline">
                  <Icon name={group.iconName} className="size-4" />
                  {group.label}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent className="w-auto p-3" side="top" align="center">
                <div className="flex items-center justify-center">
                  <img
                    src={group.src}
                    alt={group.alt}
                    className="h-40 w-40 rounded-lg object-contain"
                  />
                </div>
              </HoverCardContent>
            </HoverCard>
          ))}
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-md font-medium">每日签到</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {checkedInToday === true
                ? "今日已领取 100 积分，明天可再次签到。"
                : checkedInToday === false
                  ? "每天可签到 1 次，完成后获得 100 积分奖励。"
                  : "暂时无法确认签到状态，请稍后重试。"}
            </div>
          </div>
          <Button
            variant={checkedInToday === true ? "outline" : "default"}
            className="sm:min-w-32"
            onClick={handleCheckin}
            disabled={loadingCheckinStatus || isCheckinSubmitting || checkedInToday !== false}
          >
            {isCheckinSubmitting && <Spinner />}
            {checkedInToday === true ? "今日已签到" : "签到领 100 积分"}
          </Button>
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div className="text-md font-medium">兑换积分</div>
        <div className="mt-4 flex gap-2">
          <Input
            placeholder="请输入兑换码"
            value={exchangeCode}
            onChange={(e) => setExchangeCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleExchange()}
          />
          <Button
            variant="outline"
            onClick={handleExchange}
            disabled={isExchangeLoading}
          >
            {isExchangeLoading && <Spinner />}
            兑换
          </Button>
        </div>
      </div>
    </div>
  )

  const usageContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium">额度耗尽后消耗积分</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              开启后，基础模型、专业模型、旗舰模型的当日免费额度用完时，将继续消耗积分使用对应模型。
            </div>
          </div>
          <Switch
            checked={subscription?.enable_credit_consumption !== false}
            onCheckedChange={(checked) => void handleCreditConsumptionChange(checked)}
            disabled={isCreditConsumptionUpdating}
          />
        </div>
      </div>
      <ItemGroup className="flex flex-col gap-0 has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0">
        {transcations.map((transaction, index) => (
        <div key={`${transaction.created_at || 0}-${transaction.kind || "unknown"}-${index}`}>
          <Item
            variant="default"
            size="sm"
            className="px-2 py-2"
          >
            <ItemContent>
              <ItemTitle className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground font-normal">
                    {transaction.remark || getTransactionLabel(transaction.kind)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {dayjs((transaction.created_at || 0) * 1000).format("YYYY-MM-DD HH:mm:ss")}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-right tabular-nums",
                    getTransactionDirection(transaction.kind) >= 0
                      ? "text-danger"
                      : "text-success",
                  )}
                >
                  {formatSignedAmount(transaction.amount || ((transaction.amount_balance || 0) + (transaction.amount_daily || 0)), transaction.kind)}
                </div>
              </ItemTitle>
            </ItemContent>
          </Item>
          {index < transcations.length - 1 && <ItemSeparator className="my-0" />}
        </div>
      ))}
        {hasNextPage && (
          <div ref={loadMoreRef} className="flex justify-center py-2">
            {isLoadingMore && <Spinner className="size-4" />}
          </div>
        )}
      </ItemGroup>
    </div>
  )

  const sectionMeta = activeSection === "earn"
    ? {
        title: "我的积分",
        description: "查看当前积分，并通过签到、兑换码和邀请注册获得积分",
      }
    : {
        title: "积分账单",
        description: "查看积分充值、消耗和奖励记录",
      }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setIsInvitationListExpanded(false)
            setPage(1)
          }
        }}
      >
        <DialogContent className="flex h-[60vh] max-h-[90vh] w-[90vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="sr-only">
            <DialogTitle>钱包</DialogTitle>
            <DialogDescription>查看积分余额、获取积分和积分账单</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 w-full flex-1 overflow-hidden">
            <aside className="w-12 shrink-0 border-r p-2 md:w-44">
              <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
                <IconCoin className="size-4 shrink-0" />
                <span className="hidden sm:inline">钱包</span>
              </div>
              <div className="space-y-1">
                {WALLET_NAV.map((item) => (
                  <Button
                    key={item.id}
                    type="button"
                    variant={activeSection === item.id ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    onClick={() => initializeDialog(item.id)}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{item.name}</span>
                  </Button>
                ))}
              </div>
            </aside>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="border-b px-4 py-3">
                <div className="text-sm font-medium">{sectionMeta.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{sectionMeta.description}</div>
              </div>
              <div ref={contentScrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {activeSection === "earn" ? earnContent : usageContent}
              </div>
            </main>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showRechargeDialog}
        onOpenChange={(nextOpen) => {
          setShowRechargeDialog(nextOpen)
          if (!nextOpen && rechargingCredits === null) {
            setSelectedRechargeCredits(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>充值积分</DialogTitle>
            <DialogDescription>请选择一个充值档位，系统会为你打开支付页面。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {rechargeOptions.map((option) => (
              <button
                key={option.credits}
                type="button"
                className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left transition-colors hover:border-brand-border disabled:cursor-not-allowed disabled:opacity-60",
                  selectedRechargeCredits === option.credits && "border-2 border-brand",
                )}
                onClick={() => setSelectedRechargeCredits(option.credits)}
                disabled={rechargingCredits !== null}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="truncate text-sm font-medium">{formatPoints(option.credits)} 积分</div>
                  <div className="shrink-0 rounded-full bg-brand-muted px-2 py-0.5 text-xs font-medium text-brand">
                    {option.discountLabel}
                  </div>
                </div>
                <div
                  className={cn(
                    "shrink-0 text-brand text-base font-medium",
                    selectedRechargeCredits === option.credits && "font-bold",
                  )}
                >
                  ¥{option.price}
                </div>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowRechargeDialog(false)
                if (rechargingCredits === null) {
                  setSelectedRechargeCredits(null)
                }
              }}
              disabled={rechargingCredits !== null}
            >
              取消
            </Button>
            <Button
              onClick={() => void handleRecharge()}
              disabled={!selectedRechargeCredits || rechargingCredits !== null}
            >
              {rechargingCredits !== null && <Spinner className="mr-2 size-4" />}
              确认充值
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
