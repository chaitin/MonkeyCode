import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IconCoin, IconCrown, IconGift, IconWallet } from "@tabler/icons-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConstsTransactionKind, type DomainInvitationItem, type DomainTransactionLog } from "@/api/Api";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { useCommonData } from "../data-provider";

interface NavBalanceProps {
  variant?: "sidebar" | "header";
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

const BALANCE_NAV = [
  { id: "balance", name: "积分余额", icon: IconWallet },
  { id: "plan", name: "我的套餐", icon: IconCrown },
  { id: "earn", name: "赚积分", icon: IconGift },
  { id: "usage", name: "积分记录", icon: IconCoin },
] as const

type BalanceSectionId = (typeof BALANCE_NAV)[number]["id"]

export default function NavBalance({ variant = "sidebar" }: NavBalanceProps) {
  const [transcations, setTranscations] = useState<DomainTransactionLog[]>([]);
  const [invitations, setInvitations] = useState<DomainInvitationItem[]>([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const [isInvitationsLoading, setIsInvitationsLoading] = useState(false);
  const [exchangeCode, setExchangeCode] = useState("");
  const [isExchangeLoading, setIsExchangeLoading] = useState(false);
  const [isProLoading, setIsProLoading] = useState(false);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<BalanceSectionId>("balance");
  const [selectedRechargeCredits, setSelectedRechargeCredits] = useState<number | null>(null);
  const [rechargingCredits, setRechargingCredits] = useState<number | null>(null);
  const [page, setPage] = useState<number>(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { balance, dailyBalance, loadingSubscription, reloadSubscription, reloadWallet, subscription, user } = useCommonData();

  const positiveKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindSignupBonus,
    ConstsTransactionKind.TransactionKindVoucherExchange,
    ConstsTransactionKind.TransactionKindInvitationReward,
    ConstsTransactionKind.TransactionKindDailyGrant,
    "top_up",
  ])

  const negativeKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindVMConsumption,
    ConstsTransactionKind.TransactionKindModelConsumption,
    ConstsTransactionKind.TransactionKindProSubscription,
    ConstsTransactionKind.TransactionKindProAutoRenew,
  ])

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()
  const getInvitationInitial = (name?: string) => name?.trim().charAt(0).toUpperCase() || "?"

  const getPlanLabel = (plan?: string) => {
    switch (plan) {
      case "pro":
        return "专业会员"
      case "basic":
        return "普通会员"
      default:
        return "普通会员"
    }
  }

  const getTriggerPlanLabel = (plan?: string) => {
    switch (plan) {
      case "pro":
        return "专业版"
      case "basic":
        return "基础版"
      default:
        return "基础版"
    }
  }

  const formatSubscriptionExpiry = (expiresAt?: string) => {
    if (!expiresAt) {
      return "长期有效"
    }

    const parsed = dayjs(expiresAt)
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : expiresAt
  }

  const remainingPoints = balance + dailyBalance
  const triggerPlanLabel = getTriggerPlanLabel(subscription?.plan)
  const proSubscriptionPrice = 10000
  const canUpgradeToPro = remainingPoints >= proSubscriptionPrice
  const invitationLink = `https://monkeycode-ai.com/?ic=${user.id}`
  const rechargeOptions = [
    { credits: 10000, price: 50 },
    { credits: 50000, price: 200, originalPrice: 250, discountLabel: "8 折" },
    { credits: 300000, price: 1000, originalPrice: 1500, discountLabel: "6.7 折" },
  ]

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
      case ConstsTransactionKind.TransactionKindProSubscription:
        return "兑换专业版"
      case ConstsTransactionKind.TransactionKindProAutoRenew:
        return "专业版自动续费"
      case ConstsTransactionKind.TransactionKindDailyGrant:
        return "当日钱包发放"
      case ConstsTransactionKind.TransactionKindTopUp:
        return "充值积分"
      default:
        return "交易记录"
    }
  }

  const formatSignedAmount = (rawValue?: number, kind?: ConstsTransactionKind) => {
    if (!rawValue) {
      return null
    }

    const normalized = rawValue / 1000
    const kindKey = kind || ""
    const direction = positiveKinds.has(kindKey)
      ? 1
      : negativeKinds.has(kindKey)
        ? -1
        : 1
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
    setIsLoadingMore(true);
    await apiRequest('v1UsersWalletTransactionList', { 
      size: 10, 
      page: pageToLoad,
    }, [], (resp) => {
      if (resp.code === 0) {
        const newTransactions = resp.data?.transactions || [];
        setTranscations(prev => replace ? newTransactions : [...prev, ...newTransactions]);
        setHasNextPage(resp.data?.page?.has_next_page || false);
        setPage(pageToLoad + 1);
      } else {
        toast.error(resp.message || "获取交易记录失败");
      }
    });
    setIsLoadingMore(false);
  }, []);

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
      fetchTranscations(page);
    }
  }, [fetchTranscations, hasNextPage, isLoadingMore, page]);

  const handleExchange = async () => {
    if (!exchangeCode.trim()) {
      toast.error("请输入兑换码");
      return;
    }
    
    setIsExchangeLoading(true);
    await apiRequest('v1UsersWalletExchangeCreate', { code: exchangeCode.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("兑换成功");
        setExchangeCode("");
        reloadWallet();
      } else {
        toast.error(resp.message || "兑换失败");
      }
    })
    setIsExchangeLoading(false);
  }

  const handleOpenPro = async () => {
    if (!canUpgradeToPro) {
      toast.error("积分不足");
      return;
    }

    setIsProLoading(true);
    await apiRequest('v1UsersSubscriptionProCreate', {}, [], (resp) => {
      if (resp.code === 0) {
        toast.success("开通专业版成功");
        reloadWallet();
        reloadSubscription();
        fetchTranscations(1, true);
      } else {
        toast.error(resp.message || "开通专业版失败");
      }
    })
    setIsProLoading(false);
  }

  const handleToggleAutoRenew = async (checked: boolean) => {
    if (subscription?.plan !== "pro") {
      return;
    }

    setIsAutoRenewLoading(true);
    await apiRequest('v1UsersSubscriptionAutoRenewUpdate', { auto_renew: checked }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(checked ? "已开启自动续费" : "已关闭自动续费");
        reloadSubscription();
      } else {
        toast.error(resp.message || "自动续费设置失败");
      }
    })
    setIsAutoRenewLoading(false);
  }

  const handleRecharge = async () => {
    if (!selectedRechargeCredits) {
      toast.error("请选择充值套餐");
      return;
    }

    setRechargingCredits(selectedRechargeCredits)
    await apiRequest('v1UsersWalletRechargeCreate', { credits: selectedRechargeCredits }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || "获取支付链接失败")
      }
    })
    setRechargingCredits(null)
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [loadMore]);

  const openDialog = useCallback((section: BalanceSectionId = "balance") => {
    setActiveSection(section)
    setDialogOpen(true)
    reloadWallet();
    reloadSubscription();
    setPage(1);
    setTranscations([]);
    setHasNextPage(false);
    fetchTranscations(1, true);
    fetchInvitations();
  }, [fetchInvitations, fetchTranscations, reloadSubscription, reloadWallet])

  const handleOpenChange = (open: boolean) => {
    if (open) {
      openDialog("balance")
    } else {
      setDialogOpen(false)
      setPage(1)
    }
  };

  useEffect(() => {
    const handleOpenWallet = (event: Event) => {
      const customEvent = event as CustomEvent<{ section?: BalanceSectionId }>
      openDialog(customEvent.detail?.section || "balance")
    }

    window.addEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    return () => {
      window.removeEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    }
  }, [openDialog])


  const handleCopyInvitationLink = () => {
    navigator.clipboard.writeText(invitationLink);
    toast.success("邀请链接已复制到剪贴板");
  }

  const triggerContent = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconCrown className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-4"} />
        <span className="truncate">{triggerPlanLabel}</span>
      </div>
      <div className="text-primary flex shrink-0 items-center gap-1.5 tabular-nums">
        <IconCoin className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-4"} />
        <span>{formatPoints(remainingPoints)}</span>
      </div>
    </div>
  );

  const sectionMeta = activeSection === "balance"
    ? {
        title: "积分余额",
        description: "查看积分、会员与获取方式",
      }
    : activeSection === "earn"
      ? {
          title: "赚积分",
          description: "通过兑换码和邀请注册获得积分",
        }
    : activeSection === "plan"
      ? {
          title: "我的套餐",
          description: "查看基础版和专业版区别，并切换到专业版",
        }
    : {
        title: "积分记录",
        description: "查看积分充值、消耗和奖励记录",
      }

  const balanceContent = (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border p-5">
          <div className="text-md font-medium">积分概览</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">总积分</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{formatPoints(balance)}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">今日积分</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{formatPoints(dailyBalance)}</div>
            </div>
          </div>
        </div>
        <div className="rounded-md border p-5">
          {loadingSubscription ? (
            <div className="text-sm text-muted-foreground">加载中...</div>
          ) : (
            <>
              <div className="text-md font-medium">账户状态</div>
              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-muted-foreground">当前身份</div>
                  <div>{getPlanLabel(subscription?.plan)}</div>
                </div>
                {subscription?.plan === "pro" && (
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">有效期至</div>
                    <div>{formatSubscriptionExpiry(subscription?.expires_at)}</div>
                  </div>
                )}
                {subscription?.plan === "pro" && (
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">自动续费</div>
                    <div>{subscription.auto_renew ? "已开启" : "已关闭"}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="rounded-md border p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-md font-medium">充值积分</div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {rechargeOptions.map((option) => (
            <button
              key={option.credits}
              type="button"
              className={cn(
                "rounded-md border p-4 text-left transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60",
                selectedRechargeCredits === option.credits && "border-2 border-primary",
              )}
              onClick={() => setSelectedRechargeCredits(option.credits)}
              disabled={rechargingCredits !== null}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">{formatPoints(option.credits)} 积分</div>
                {option.discountLabel && (
                  <div className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {option.discountLabel}
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div
                  className={cn(
                    "text-primary text-lg font-medium",
                    selectedRechargeCredits === option.credits && "font-bold",
                  )}
                >
                  ¥ {option.price}
                </div>
                {option.originalPrice && (
                  <div className="text-xs text-muted-foreground line-through">¥ {option.originalPrice}</div>
                )}
              </div>
            </button>
          ))}
        </div>
        <Button
          className="mt-4"
          onClick={() => void handleRecharge()}
          disabled={!selectedRechargeCredits || rechargingCredits !== null}
        >
          {rechargingCredits !== null && <Spinner />}
          确认充值
        </Button>
      </div>
    </div>
  )

  const planContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-md font-medium">当前套餐</div>
            <div className="mt-3 flex items-center gap-2">
              <div className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                subscription?.plan === "pro" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}>
                {getPlanLabel(subscription?.plan)}
              </div>
              {subscription?.plan === "pro" && (
                <div className="text-xs text-muted-foreground">
                  有效期至 {formatSubscriptionExpiry(subscription?.expires_at)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={cn("rounded-md border p-5", subscription?.plan !== "pro" && "border-2 border-primary")}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-md font-medium">基础版</div>
              <div className="mt-1 text-sm text-muted-foreground">免费</div>
            </div>
            {subscription?.plan !== "pro" && (
              <div className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">当前套餐</div>
            )}
          </div>
          <div className="mt-5 space-y-3">
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">官方指定免费模型</div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">最多同时运行 1 个任务</div>
            <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">不含每日赠送积分</div>
          </div>
        </div>
        <div className={cn("rounded-md border p-5", subscription?.plan === "pro" && "border-2 border-primary")}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-md font-medium">专业版</div>
              <div className="mt-1 text-sm text-muted-foreground">{formatPoints(proSubscriptionPrice)} 积分 / 月</div>
            </div>
            {subscription?.plan === "pro" ? (
              <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">当前套餐</div>
            ) : null}
          </div>
          <div className="mt-5 space-y-3">
            <div className="rounded-md bg-primary/5 px-3 py-2 text-sm">可选择更多 AI 模型</div>
            <div className="rounded-md bg-primary/5 px-3 py-2 text-sm">最多同时运行 3 个任务</div>
            <div className="rounded-md bg-primary/5 px-3 py-2 text-sm">每日赠送 1000 积分</div>
          </div>
          {subscription?.plan === "pro" ? (
            <div className="mt-5 rounded-md border bg-muted/30 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">自动续费</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {subscription.auto_renew ? "已开启，套餐到期后自动续费" : "未开启，到期后不会自动续费"}
                  </div>
                </div>
                <Switch
                  checked={!!subscription.auto_renew}
                  onCheckedChange={(checked) => void handleToggleAutoRenew(checked)}
                  disabled={isAutoRenewLoading}
                />
              </div>
            </div>
          ) : (
            <Button
              className="mt-5 w-full"
              onClick={handleOpenPro}
              disabled={!canUpgradeToPro || isProLoading}
            >
              {isProLoading && <Spinner />}
              {canUpgradeToPro
                ? `开通专业版（${formatPoints(proSubscriptionPrice)} 积分）`
                : "积分不足"}
            </Button>
          )}
        </div>
      </div>
    </div>
  )

  const earnContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-md font-medium">兑换积分</div>
          </div>
        </div>
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
      <div className="rounded-md border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-md font-medium">邀请注册</div>
            <div className="mt-2 text-sm text-muted-foreground">
              将下方邀请链接分享给好友。好友通过该链接注册后，你将获得 5000 积分奖励。
            </div>
          </div>
          <div className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            +5,000
          </div>
        </div>
        <div className="mt-4 flex flex-row justify-between gap-2">
          <Input value={invitationLink} readOnly />
          <Button variant="outline" onClick={handleCopyInvitationLink}>复制邀请链接</Button>
        </div>
        <div className="mt-4">
          <div className="text-sm font-medium">
            已邀请 {formatPoints(invitationCount)} 人
          </div>
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
                  <div className="shrink-0 text-sm font-medium text-primary">
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
        </div>
      </div>
    </div>
  )

  const usageContent = (
    <ItemGroup className="flex max-h-full flex-col gap-2 overflow-y-auto">
      {transcations.map((transaction, index) => (
        <Item key={`${transaction.created_at || 0}-${transaction.kind || "unknown"}-${index}`} variant="outline" size="sm">
          <ItemContent>
            <ItemTitle className="flex flex-row w-full">
              <div className={cn("flex flex-1 flex-row items-center", positiveKinds.has(transaction.kind || ConstsTransactionKind.TransactionKindVMConsumption) ? "text-primary" : "")}>
                {formatSignedAmount(transaction.amount || ((transaction.amount_balance || 0) + (transaction.amount_daily || 0)), transaction.kind)}
              </div>
              <div className="flex flex-row items-center gap-1 text-muted-foreground text-xs font-normal">
                {transaction.remark || getTransactionLabel(transaction.kind)}
              </div>
              <div className="text-muted-foreground text-xs ml-4">
                {dayjs((transaction.created_at || 0) * 1000).format("YYYY-MM-DD HH:mm:ss")}
              </div>
            </ItemTitle>
          </ItemContent>
        </Item>
      ))}
      {hasNextPage && (
        <div ref={loadMoreRef} className="flex justify-center py-2">
          {isLoadingMore && <Spinner className="size-4" />}
        </div>
      )}
    </ItemGroup>
  )

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {variant === "header" ? (
          <Button className="hidden max-w-[260px] lg:flex" variant="ghost" size="sm">
            {triggerContent}
          </Button>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="cursor-pointer">
                {triggerContent}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </DialogTrigger>
      <DialogContent
        className="flex h-[60vh] max-h-[90vh] w-[90vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>钱包</DialogTitle>
          <DialogDescription>查看积分余额、充值方式和使用记录</DialogDescription>
        </DialogHeader>
        <SidebarProvider className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 w-full flex-1 overflow-hidden">
            <Sidebar collapsible="none" className="w-12 shrink-0 border-r md:w-44">
              <SidebarHeader>
                <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
                  <IconWallet className="size-4 shrink-0" />
                  <span className="hidden sm:inline">钱包</span>
                </div>
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {BALANCE_NAV.map((item) => (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={activeSection === item.id}
                            onClick={() => setActiveSection(item.id)}
                          >
                            <item.icon className="size-4 shrink-0" />
                            <span className="hidden sm:inline">{item.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="border-b px-4 py-3">
                <div className="text-sm font-medium">{sectionMeta.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">{sectionMeta.description}</div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {activeSection === "balance"
                  ? balanceContent
                  : activeSection === "earn"
                    ? earnContent
                    : activeSection === "plan"
                      ? planContent
                    : usageContent}
              </div>
            </main>
          </div>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
