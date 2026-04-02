import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Dialog } from "@radix-ui/react-dialog";
import { DialogTrigger } from "@/components/ui/dialog";
import { DialogContent } from "@/components/ui/dialog";
import { IconCoin, IconInfoCircle, IconWallet } from "@tabler/icons-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Label } from "@/components/ui/label";
import { ConstsTransactionKind, type DomainTransactionLog } from "@/api/Api";
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCommonData } from "../data-provider";

interface NavBalanceProps {
  variant?: "sidebar" | "header";
}

export default function NavBalance({ variant = "sidebar" }: NavBalanceProps) {
  const [transcations, setTranscations] = useState<DomainTransactionLog[]>([]);
  const [exchangeCode, setExchangeCode] = useState("");
  const [isExchangeLoading, setIsExchangeLoading] = useState(false);
  const [isProLoading, setIsProLoading] = useState(false);
  const [selectedRechargeCredits, setSelectedRechargeCredits] = useState<number | null>(null);
  const [rechargingCredits, setRechargingCredits] = useState<number | null>(null);
  const [page, setPage] = useState<number>(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { balance, dailyBalance, loadingSubscription, reloadSubscription, reloadWallet, subscription, user } = useCommonData();

  const positiveKinds = new Set([
    ConstsTransactionKind.TransactionKindSignupBonus,
    ConstsTransactionKind.TransactionKindVoucherExchange,
    ConstsTransactionKind.TransactionKindInvitationReward,
    ConstsTransactionKind.TransactionKindDailyGrant,
  ])

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()

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

  const getSubscriptionSourceLabel = (source?: string) => {
    switch (source) {
      case "points_exchange":
        return "积分兑换"
      case "team_member":
        return "团队成员"
      case "admin_grant":
        return "管理员发放"
      default:
        return "未知"
    }
  }

  const formatSubscriptionExpiry = (expiresAt?: string) => {
    if (!expiresAt) {
      return "长期有效"
    }

    const parsed = dayjs(expiresAt)
      return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : expiresAt
  }

  const remainingPoints = balance + dailyBalance
  const triggerPlanLabel = getTriggerPlanLabel(subscription?.plan)
  const proSubscriptionPrice = 10000
  const canUpgradeToPro = remainingPoints >= proSubscriptionPrice
  const invitationLink = `https://monkeycode-ai.com/?ic=${user.id}`
  const rechargeOptions = [
    { credits: 10000, price: 50 },
    { credits: 50000, price: 200 },
    { credits: 300000, price: 1000 },
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
    const direction = normalized === 0
      ? (positiveKinds.has(kind || ConstsTransactionKind.TransactionKindVMConsumption) ? 1 : -1)
      : Math.sign(normalized)
    const sign = direction >= 0 ? "+" : "-"
    return `${sign}${formatPoints(Math.abs(normalized))}`
  }

  const getTransactionChanges = (transaction: DomainTransactionLog) => {
    const changes = [
      transaction.amount_principal ? `总钱包 ${formatSignedAmount(transaction.amount_principal, transaction.kind)}` : null,
      transaction.amount_daily ? `当日钱包 ${formatSignedAmount(transaction.amount_daily, transaction.kind)}` : null,
    ].filter(Boolean)

    if (changes.length > 0) {
      return changes
    }

    const total = formatSignedAmount(transaction.amount, transaction.kind)
    return total ? [`积分 ${total}`] : []
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

  const handleRecharge = async () => {
    if (!selectedRechargeCredits) {
      toast.error("请选择充值套餐");
      return;
    }

    const pendingWindow = window.open("", "_blank", "noopener,noreferrer")
    setRechargingCredits(selectedRechargeCredits)
    await apiRequest('v1UsersWalletRechargeCreate', { credits: selectedRechargeCredits }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        if (pendingWindow) {
          pendingWindow.location.href = paymentUrl
        } else {
          window.open(paymentUrl, "_blank", "noopener,noreferrer")
        }
      } else {
        pendingWindow?.close()
        toast.error(resp.message || "获取支付链接失败")
      }
    }, () => {
      pendingWindow?.close()
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

  const handleOpenChange = (open: boolean) => {
    if (open) {
      reloadWallet();
      reloadSubscription();
      setPage(1);
      setTranscations([]);
      setHasNextPage(false);
      fetchTranscations(1, true);
    } else {
      setPage(1)
    }
  };


  const handleCopyInvitationLink = () => {
    navigator.clipboard.writeText(invitationLink);
    toast.success("邀请链接已复制到剪贴板");
  }

  const triggerContent = (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconWallet className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-5"} />
        <span className="truncate">{triggerPlanLabel}</span>
      </div>
      <div className="text-primary flex shrink-0 items-center gap-1.5 tabular-nums">
        <IconCoin className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-4"} />
        <span>{formatPoints(remainingPoints)}</span>
      </div>
    </div>
  );

  return (
    <Dialog onOpenChange={handleOpenChange}>
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
      <DialogContent>
        <Tabs defaultValue="balance" className="w-full">
          <TabsList>
            <TabsTrigger value="balance">积分余额</TabsTrigger>
            <TabsTrigger value="usage">使用记录</TabsTrigger>
          </TabsList>

          <TabsContent value="balance" className="mt-2 space-y-4">
            <div className="rounded-md border p-4">
              {loadingSubscription ? (
                <div className="text-sm text-muted-foreground">加载中...</div>
              ) : (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">总积分</div>
                    <div>{formatPoints(balance)} 点</div>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">今日积分</div>
                    <div>{formatPoints(dailyBalance)} 点</div>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">当前身份</div>
                    <div>{getPlanLabel(subscription?.plan)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-muted-foreground">有效期至</div>
                    <div>{formatSubscriptionExpiry(subscription?.expires_at)}</div>
                  </div>
                  {subscription?.plan !== "pro" && (
                    <div className="pt-2">
                      <div className="mb-2 text-xs text-muted-foreground">
                        消耗 {formatPoints(proSubscriptionPrice)} 积分兑换 1 个月专业版
                      </div>
                      <Button onClick={handleOpenPro} disabled={!canUpgradeToPro || isProLoading}>
                        {isProLoading && <Spinner />}
                        开通专业版
                      </Button>
                    </div>
                  )}
                  {subscription?.source && (
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-muted-foreground">开通方式</div>
                      <div>{getSubscriptionSourceLabel(subscription.source)}</div>
                    </div>
                  )}
                  {subscription?.plan === "pro" && (
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-muted-foreground">自动续费</div>
                      <div>{subscription.auto_renew ? "已开启" : "已关闭"}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>充值积分</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {rechargeOptions.map((option) => (
                  <button
                    key={option.credits}
                    type="button"
                    className={cn(
                      "rounded-md border p-4 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                      selectedRechargeCredits === option.credits && "border-primary bg-accent",
                    )}
                    onClick={() => setSelectedRechargeCredits(option.credits)}
                    disabled={rechargingCredits !== null}
                  >
                    <div className="text-sm text-muted-foreground">充值 {formatPoints(option.credits)} 积分</div>
                    <div className="mt-2 text-lg font-medium">¥ {option.price}</div>
                  </button>
                ))}
              </div>
              <Button
                onClick={() => void handleRecharge()}
                disabled={!selectedRechargeCredits || rechargingCredits !== null}
              >
                {rechargingCredits !== null && <Spinner />}
                确认充值
              </Button>
            </div>
            <div className="space-y-2">
              <Label>兑换积分</Label>
              <div className="flex gap-2">
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
            <div className="space-y-2">
              <Label>邀请注册</Label>
              <div className="flex flex-row justify-between gap-2">
                <Input value="邀请一个新用户注册并激活，可获得 5000 积分" readOnly />
              </div>
              <div className="flex flex-row justify-between gap-2">
                <Input value={invitationLink} readOnly />
                <Button variant="outline" onClick={handleCopyInvitationLink}>复制邀请链接</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="usage" className="mt-2">
            <ItemGroup className="flex flex-col gap-2 overflow-y-auto max-h-[320px] -mx-2 px-2">
              {transcations.map((transaction, index) => (
                <Item key={`${transaction.created_at || 0}-${transaction.kind || "unknown"}-${index}`} variant="outline" size="sm">
                  <ItemContent>
                    <ItemTitle className="flex flex-row w-full">
                      <div className={cn("flex flex-1 flex-row items-center", positiveKinds.has(transaction.kind || ConstsTransactionKind.TransactionKindVMConsumption) ? "text-primary" : "")}>
                        {formatSignedAmount(transaction.amount || ((transaction.amount_principal || 0) + (transaction.amount_daily || 0)), transaction.kind)}
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex flex-row items-center gap-1 text-muted-foreground text-xs font-normal cursor-pointer">
                            {getTransactionLabel(transaction.kind)}
                            <IconInfoCircle className="size-3" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {transaction.remark}
                        </TooltipContent>
                      </Tooltip>
                      <div className="text-muted-foreground text-xs ml-4">
                        {dayjs((transaction.created_at || 0) * 1000).format("YYYY-MM-DD HH:mm:ss")}
                      </div>
                    </ItemTitle>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {getTransactionChanges(transaction).join(" / ")}
                    </div>
                  </ItemContent>
                </Item>
              ))}
              {hasNextPage && (
                <div ref={loadMoreRef} className="flex justify-center py-2">
                  {isLoadingMore && <Spinner className="size-4" />}
                </div>
              )}
            </ItemGroup>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
