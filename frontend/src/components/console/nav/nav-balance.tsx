import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IconCoin, IconCrown, IconGift, IconLockCode, IconLogout, IconMail, IconUserHexagon, IconCpu } from "@tabler/icons-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ConstsTransactionKind, type DomainInvitationItem, type DomainTransactionLog } from "@/api/Api";
import { Item, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
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
import { captchaChallenge, getSubscriptionPlanLabel, getSubscriptionPlanShortLabel, hasProSubscription, isValidEmail } from "@/utils/common";
import { useNavigate } from "react-router-dom";

interface NavBalanceProps {
  variant?: "sidebar" | "header";
  hideTrigger?: boolean;
  triggerMode?: "wallet" | "account";
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

const BALANCE_NAV = [
  { id: "account", name: "我的账户", icon: IconUserHexagon },
  { id: "plan", name: "我的套餐", icon: IconCrown },
  { id: "earn", name: "赚积分", icon: IconGift },
  { id: "usage", name: "积分记录", icon: IconCoin },
  { id: "pricing", name: "模型定价", icon: IconCpu },
] as const

const MODEL_PRICING = [
  { model: "minimax-m2.7", credits: 0 },
  { model: "gpt5.4", credits: 1000 },
  { model: "gpt5.2", credits: 600 },
  { model: "gpt5.3-codex", credits: 600 },
  { model: "gpt5.1", credits: 500 },
  { model: "glm-5.1", credits: 600 },
  { model: "glm-5", credits: 400 },
  { model: "glm-4.7", credits: 200 },
  { model: "qwen3-max", credits: 400 },
  { model: "qwen3.6-plus", credits: 200 },
  { model: "kimi-k2.5", credits: 400 },
] as const

type BalanceSectionId = (typeof BALANCE_NAV)[number]["id"]
type WalletSectionId = BalanceSectionId | "profile" | "plan" | "balance"

export default function NavBalance({ variant = "sidebar", hideTrigger = false, triggerMode = "wallet" }: NavBalanceProps) {
  const [transcations, setTranscations] = useState<DomainTransactionLog[]>([]);
  const [invitations, setInvitations] = useState<DomainInvitationItem[]>([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const [isInvitationsLoading, setIsInvitationsLoading] = useState(false);
  const [isCheckinSubmitting, setIsCheckinSubmitting] = useState(false);
  const [exchangeCode, setExchangeCode] = useState("");
  const [isExchangeLoading, setIsExchangeLoading] = useState(false);
  const [isProLoading, setIsProLoading] = useState(false);
  const [isFlagshipLoading, setIsFlagshipLoading] = useState(false);
  const [isAutoRenewLoading, setIsAutoRenewLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<BalanceSectionId>("account");
  const [selectedRechargeCredits, setSelectedRechargeCredits] = useState<number | null>(null);
  const [rechargingCredits, setRechargingCredits] = useState<number | null>(null);
  const [showRechargeDialog, setShowRechargeDialog] = useState(false);
  const [page, setPage] = useState<number>(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [confirmSubscriptionPlan, setConfirmSubscriptionPlan] = useState<"pro" | "ultra" | null>(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [showBindEmailDialog, setShowBindEmailDialog] = useState(false);
  const [bindEmail, setBindEmail] = useState("");
  const [bindingEmail, setBindingEmail] = useState(false);
  const [showChangeNameDialog, setShowChangeNameDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [changingName, setChangingName] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate()
  const {
    balance,
    checkedInToday,
    dailyBalance,
    loadingCheckinStatus,
    loadingSubscription,
    reloadCheckinStatus,
    reloadSubscription,
    reloadUser,
    reloadWallet,
    subscription,
    user,
  } = useCommonData();
  const requiresCurrentPassword = !!user?.has_password
  const passwordActionLabel = requiresCurrentPassword ? "修改密码" : "设置密码"

  const positiveKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindSignupBonus,
    ConstsTransactionKind.TransactionKindVoucherExchange,
    ConstsTransactionKind.TransactionKindInvitationReward,
    ConstsTransactionKind.TransactionKindDailyGrant,
    ConstsTransactionKind.TransactionKindTopUp,
    ConstsTransactionKind.TransactionKindCheckin,
  ])

  const negativeKinds = new Set<string>([
    ConstsTransactionKind.TransactionKindVMConsumption,
    ConstsTransactionKind.TransactionKindModelConsumption,
    ConstsTransactionKind.TransactionKindProSubscription,
    ConstsTransactionKind.TransactionKindProAutoRenew,
    ConstsTransactionKind.TransactionKindUltraSubscription,
    ConstsTransactionKind.TransactionKindUltraAutoRenew,
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

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()
  const formatPlanPoints = (value: number) => {
    const normalized = Math.ceil(value)
    if (normalized >= 10000) {
      const wan = normalized / 10000
      return `${Number.isInteger(wan) ? wan : wan.toFixed(1).replace(/\.0$/, "")} 万`
    }
    if (normalized >= 1000) {
      const qian = normalized / 1000
      return `${Number.isInteger(qian) ? qian : qian.toFixed(1).replace(/\.0$/, "")} 千`
    }
    return normalized.toString()
  }
  const getInvitationInitial = (name?: string) => name?.trim().charAt(0).toUpperCase() || "?"

  const formatSubscriptionExpiry = (expiresAt?: string) => {
    if (!expiresAt) {
      return "长期有效"
    }

    const parsed = dayjs(expiresAt)
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : expiresAt
  }

  const remainingPoints = balance + dailyBalance
  const triggerPlanLabel = getSubscriptionPlanShortLabel(subscription?.plan)
  const hasAdvancedPlan = hasProSubscription(subscription)
  const isProPlan = subscription?.plan === "pro"
  const isFlagshipPlan = subscription?.plan === "flagship" || subscription?.plan === "ultra"
  const isTeamUser = !!user?.team?.id
  const proSubscriptionPrice = 10000
  const flagshipSubscriptionPrice = 100000
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
      case ConstsTransactionKind.TransactionKindUltraSubscription:
        return "兑换旗舰版"
      case ConstsTransactionKind.TransactionKindUltraAutoRenew:
        return "旗舰版自动续费"
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

  const handleLogout = () => {
    apiRequest("v1UsersLogoutCreate", {}, [], (resp) => {
      if (resp.code === 0) {
        navigate("/")
      } else {
        toast.error("登出失败: " + resp.message)
      }
    })
  }

  const handleChangePassword = async () => {
    if (requiresCurrentPassword && !currentPassword) {
      toast.error("请输入当前密码")
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error("新密码和确认密码不一致")
      return
    }

    if (newPassword.length < 8) {
      toast.error("新密码长度至少为8位")
      return
    }

    setChangingPassword(true)
    await apiRequest("v1UsersPasswordsChangeUpdate", {
      current_password: requiresCurrentPassword ? currentPassword : undefined,
      new_password: newPassword,
    }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success("密码修改成功")
        setShowChangePasswordDialog(false)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      } else {
        toast.error(`密码修改失败：${resp?.message || "未知错误"}`)
      }
    })
    setChangingPassword(false)
  }

  const handleBindEmail = async () => {
    const email = bindEmail.trim()
    if (!isValidEmail(email)) {
      toast.error("请输入正确的邮箱地址")
      return
    }

    setBindingEmail(true)
    await apiRequest("v1UsersEmailBindRequestUpdate", {
      email,
    }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success("绑定邮件已发送，请前往邮箱完成验证")
        setShowBindEmailDialog(false)
        setBindEmail("")
      } else {
        toast.error(`绑定邮箱失败：${resp?.message || "未知错误"}`)
      }
    })
    setBindingEmail(false)
  }

  const handleChangeName = async () => {
    if (!newName.trim()) {
      toast.error("昵称不能为空")
      return
    }

    setChangingName(true)
    await apiRequest("v1UsersUpdate", { name: newName.trim() }, [], (resp) => {
      if (resp?.code === 0) {
        toast.success("昵称修改成功")
        reloadUser?.()
        setShowChangeNameDialog(false)
        setNewName("")
      } else {
        toast.error(`昵称修改失败：${resp?.message || "未知错误"}`)
      }
    })
    setChangingName(false)
  }

  const fetchTranscations = useCallback(async (pageToLoad: number, replace = false) => {
    setIsLoadingMore(true);
    await apiRequest('v1UsersWalletTransactionList', { 
      size: 20, 
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

  const normalizeSection = useCallback((section: WalletSectionId): BalanceSectionId => {
    if (section === "profile" || section === "balance") {
      return "account"
    }
    return section
  }, [])

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
    setIsProLoading(true);
    await apiRequest('v1UsersSubscriptionCreate', { plan: "pro" }, [], (resp) => {
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

  const handleOpenFlagship = async () => {
    setIsFlagshipLoading(true);
    await apiRequest('v1UsersSubscriptionCreate', { plan: "ultra" }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("开通旗舰版成功");
        reloadWallet();
        reloadSubscription();
        fetchTranscations(1, true);
      } else {
        toast.error(resp.message || "开通旗舰版失败");
      }
    })
    setIsFlagshipLoading(false);
  }

  const handleConfirmSubscription = async () => {
    if (confirmSubscriptionPlan === "pro") {
      await handleOpenPro()
    } else if (confirmSubscriptionPlan === "ultra") {
      await handleOpenFlagship()
    }
    setConfirmSubscriptionPlan(null)
  }

  const handleToggleAutoRenew = async (checked: boolean) => {
    if (!hasAdvancedPlan) {
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
        setShowRechargeDialog(false)
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || "获取支付链接失败")
      }
    })
    setRechargingCredits(null)
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

  useEffect(() => {
    if (!dialogOpen || activeSection !== "usage") {
      return;
    }

    const currentRef = loadMoreRef.current;
    const rootRef = contentScrollRef.current;
    if (!currentRef || !rootRef) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      {
        root: rootRef,
        threshold: 0,
        rootMargin: "0px 0px 120px 0px",
      }
    );

    observer.observe(currentRef);

    return () => {
      observer.unobserve(currentRef);
      observer.disconnect();
    };
  }, [activeSection, dialogOpen, hasNextPage, loadMore, transcations.length]);

  const openDialog = useCallback((section: WalletSectionId = "account") => {
    setActiveSection(normalizeSection(section))
    setDialogOpen(true)
    reloadWallet();
    reloadSubscription();
    setPage(1);
    setTranscations([]);
    setHasNextPage(false);
    fetchTranscations(1, true);
    fetchInvitations();
    reloadCheckinStatus();
  }, [fetchInvitations, fetchTranscations, normalizeSection, reloadCheckinStatus, reloadSubscription, reloadWallet])

  const handleOpenChange = (open: boolean) => {
    if (open) {
      openDialog("account")
    } else {
      setDialogOpen(false)
      setPage(1)
    }
  };

  useEffect(() => {
    const handleOpenWallet = (event: Event) => {
      const customEvent = event as CustomEvent<{ section?: WalletSectionId }>
      openDialog(customEvent.detail?.section || "account")
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

  const triggerContent = triggerMode === "account" ? (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt={user?.name || "未知用户"} />
        <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || "-"}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{user?.name || "未知用户"}</span>
        <span className="truncate text-xs">{triggerPlanLabel}</span>
      </div>
      <div className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary tabular-nums group-data-[collapsible=icon]:hidden">
        {formatPoints(remainingPoints)}
      </div>
    </div>
  ) : (
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

  const sectionMeta = activeSection === "account"
    ? {
        title: "我的账户",
        description: "查看账户资料、积分余额，并进行账号操作",
      }
    : activeSection === "plan"
      ? {
          title: "我的套餐",
          description: "查看基础版、专业版与旗舰版权益，以及当前套餐状态",
      }
    : activeSection === "earn"
      ? {
          title: "赚积分",
          description: "通过兑换码和邀请注册获得积分",
        }
    : activeSection === "usage"
      ? {
        title: "积分记录",
        description: "查看积分充值、消耗和奖励记录",
      }
    : {
        title: "模型定价",
        description: "查看不同模型每百万 token 对应的积分消耗",
      }

  const accountContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Avatar className="size-14 rounded-xl">
              <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt={user?.name || "未知用户"} />
              <AvatarFallback className="rounded-xl text-base">{user?.name?.charAt(0) || "-"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">{user?.name || "未知用户"}</div>
              <div className="mt-1 truncate text-sm text-muted-foreground">{user?.email || "暂未绑定邮箱"}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  hasAdvancedPlan ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}>
                  {triggerPlanLabel}
                </div>
                {hasAdvancedPlan && (
                  <div className="text-xs text-muted-foreground">
                    有效期至 {formatSubscriptionExpiry(subscription?.expires_at)}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[320px] lg:max-w-[360px]">
            <div className="rounded-md bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">当前套餐</div>
              <div className="mt-2 text-sm font-medium">{getSubscriptionPlanLabel(subscription?.plan)}</div>
            </div>
            <div className="rounded-md bg-muted/40 px-4 py-3">
              <div className="text-xs text-muted-foreground">自动续费</div>
              <div className="mt-2 text-sm font-medium">
                {loadingSubscription
                  ? "加载中..."
                  : hasAdvancedPlan
                  ? subscription?.auto_renew ? "已开启" : "已关闭"
                  : "未启用"}
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-4 py-3 sm:col-span-2">
              <div className="text-xs text-muted-foreground">会员状态</div>
              <div className="mt-2 text-sm font-medium">
                {loadingSubscription
                  ? "加载中..."
                  : hasAdvancedPlan
                  ? `${triggerPlanLabel}将于 ${formatSubscriptionExpiry(subscription?.expires_at)} 到期`
                  : "当前为基础版，可升级到专业版或旗舰版"}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">用户名</div>
            <div className="mt-2 truncate text-sm font-medium">{user?.name || "-"}</div>
          </div>
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">邮箱</div>
            <div className="mt-2 truncate text-sm font-medium">{user?.email || "未绑定"}</div>
          </div>
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">团队</div>
            <div className="mt-2 truncate text-sm font-medium">{user?.team?.name || "个人空间"}</div>
          </div>
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">团队 ID</div>
            <div className="mt-2 truncate text-sm font-medium">{user?.team?.id || "-"}</div>
          </div>
        </div>
      </div>
      <div className="space-y-4 rounded-md border p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border p-5 md:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-md font-medium">积分概览</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  充值时会在弹框中选择具体档位并跳转支付页面。
                </div>
              </div>
              <Button
                className="shrink-0"
                onClick={() => {
                  setSelectedRechargeCredits(null)
                  setShowRechargeDialog(true)
                }}
              >
                充值积分
              </Button>
            </div>
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
            <div className="text-md font-medium">当前可用</div>
            <div className="mt-3 text-3xl font-semibold tabular-nums">{formatPoints(remainingPoints)}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              侧边栏展示的是总积分与今日积分之和，便于直接判断当前还能使用多少积分。
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-md border p-5">
        <div>
          <div>
            <div className="text-md font-medium">账号操作</div>
            <div className="mt-1 text-sm text-muted-foreground">
              维护账户资料与登录信息。
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => {
              setNewName(user?.name || "")
              setShowChangeNameDialog(true)
            }}
          >
            <IconUserHexagon className="size-4" />
            修改昵称
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            disabled={!!user?.email}
            onClick={() => {
              if (!user?.email) {
                setBindEmail("")
                setShowBindEmailDialog(true)
              }
            }}
          >
            <IconMail className="size-4" />
            {user?.email ? "邮箱已绑定" : "绑定邮箱"}
          </Button>
          <Button
            variant="outline"
            className="justify-start"
            onClick={() => setShowChangePasswordDialog(true)}
          >
            <IconLockCode className="size-4" />
            {passwordActionLabel}
          </Button>
          <Button
            variant="outline"
            className="justify-start text-destructive hover:text-destructive"
            onClick={() => setShowLogoutDialog(true)}
          >
            <IconLogout className="size-4" />
            登出
          </Button>
        </div>
      </div>
    </div>
  )

  const planContent = (
    <div className="flex flex-1 flex-col gap-4">
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
      <div className="flex-1 grid gap-4 md:grid-cols-3">
          <div className={cn("flex h-full flex-col rounded-md border p-5", !hasAdvancedPlan && "border-2 border-primary")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-md font-medium">基础版</div>
              </div>
              {!hasAdvancedPlan && (
                <Badge>当前套餐</Badge>
              )}
            </div>
            <div className="mt-5 flex-1 space-y-3">
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">价格</div>
                <div className="mt-1 text-sm font-medium">免费</div>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">并发任务限制</div>
                <div className="mt-1 text-sm font-medium">1 个任务</div>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2">
                <div className="text-xs text-muted-foreground">每日积分</div>
                <div className="mt-1 text-sm font-medium">无</div>
              </div>
            </div>
          </div>
          <div className={cn("flex h-full flex-col rounded-md border p-5", isProPlan && "border-2 border-primary")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-md font-medium">专业版</div>
              </div>
              {isProPlan ? (
                <Badge>当前套餐</Badge>
              ) : null}
            </div>
            <div className="mt-5 flex-1 space-y-3">
              <div className="rounded-md bg-primary/5 px-3 py-2">
                <div className="text-xs text-muted-foreground">价格</div>
                <div className="mt-1 text-sm font-medium">{formatPlanPoints(proSubscriptionPrice)}积分/月</div>
              </div>
              <div className="rounded-md bg-primary/5 px-3 py-2">
                <div className="text-xs text-muted-foreground">并发任务限制</div>
                <div className="mt-1 text-sm font-medium">3 个任务</div>
              </div>
              <div className="rounded-md bg-primary/5 px-3 py-2">
                <div className="text-xs text-muted-foreground">每日积分</div>
                <div className="mt-1 text-sm font-medium">每日赠送 {formatPlanPoints(2000)}积分</div>
                <div className="mt-1 text-xs text-muted-foreground">仅限当日有效，不累计</div>
              </div>
            </div>
            {isProPlan ? null : isFlagshipPlan ? (
              <div className="mt-5 rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                当前已是更高等级的旗舰版套餐，已包含专业版权益。
              </div>
            ) : (
                <Button
                  className="mt-5 w-full"
                  onClick={() => setConfirmSubscriptionPlan("pro")}
                  disabled={isProLoading}
                >
                  {isProLoading && <Spinner />}
                开通专业版
              </Button>
            )}
          </div>
          <div className={cn("flex h-full flex-col rounded-md border p-5", isFlagshipPlan && "border-2 border-primary")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-md font-medium">旗舰版</div>
              </div>
              {isFlagshipPlan ? (
                <Badge>当前套餐</Badge>
              ) : null}
            </div>
            <div className="mt-5 flex-1 space-y-3">
              <div className="rounded-md bg-primary/10 px-3 py-2">
                <div className="text-xs text-muted-foreground">价格</div>
                <div className="mt-1 text-sm font-medium">{formatPlanPoints(flagshipSubscriptionPrice)}积分/月</div>
              </div>
              <div className="rounded-md bg-primary/10 px-3 py-2">
                <div className="text-xs text-muted-foreground">并发任务限制</div>
                <div className="mt-1 text-sm font-medium">3 个任务</div>
              </div>
              <div className="rounded-md bg-primary/10 px-3 py-2">
                <div className="text-xs text-muted-foreground">每日积分</div>
                <div className="mt-1 text-sm font-medium">每日赠送 {formatPlanPoints(30000)}积分</div>
                <div className="mt-1 text-xs text-muted-foreground">仅限当日有效，不累计</div>
              </div>
            </div>
            {isFlagshipPlan ? null : (
                <Button
                  className="mt-5 w-full"
                  onClick={() => setConfirmSubscriptionPlan("ultra")}
                  disabled={isFlagshipLoading}
                >
                  {isFlagshipLoading && <Spinner />}
                开通旗舰版
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
            <div className="text-md font-medium">每日签到</div>
            <div className="mt-2 text-sm text-muted-foreground">
              每天可签到 1 次，完成后获得 100 积分奖励。
            </div>
          </div>
          <div className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            checkedInToday === true
              ? "bg-primary/10 text-primary"
              : checkedInToday === false
                ? "bg-amber-100 text-amber-900"
                : "bg-muted text-muted-foreground",
          )}>
            {loadingCheckinStatus
              ? "状态加载中..."
              : checkedInToday === true
                ? "今日已签到"
                : checkedInToday === false
                  ? "今日未签到"
                  : "状态获取失败"}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 rounded-md bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">{dayjs().format("YYYY-MM-DD")} 签到状态</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {checkedInToday === true
                ? "今天已经领取过签到积分，明天可再次签到。"
                : checkedInToday === false
                  ? "今日尚未签到，点击右侧按钮即可领取积分。"
                  : "暂时无法确认签到状态，请稍后重试。"}
            </div>
          </div>
          <Button
            className="sm:min-w-28"
            onClick={handleCheckin}
            disabled={loadingCheckinStatus || isCheckinSubmitting || checkedInToday !== false}
          >
            {isCheckinSubmitting && <Spinner />}
            {checkedInToday === true ? "今日已签到" : "签到领 100 积分"}
          </Button>
        </div>
      </div>
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
                      ? "text-red-600"
                      : "text-green-600",
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
  )

  const pricingContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-5">
        <div className="text-md font-medium">计费说明</div>
        <div className="mt-2 text-sm text-muted-foreground">
          以下价格单位为每百万 token 消耗多少积分。免费模型不会扣减积分。
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MODEL_PRICING.map((item) => (
          <div key={item.model} className="rounded-md border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm font-medium">{item.model}</div>
                <div className="mt-1 text-xs text-muted-foreground">每百万 token</div>
              </div>
              <div
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium",
                  item.credits === 0 ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
              >
                {item.credits === 0 ? "免费" : `${formatPoints(item.credits)} 积分`}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          {variant === "header" ? (
            <Button className="hidden max-w-[260px] lg:flex" variant="ghost" size="sm">
              {triggerContent}
            </Button>
          ) : (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  size={triggerMode === "account" ? "lg" : "default"}
                  isActive={triggerMode === "account" && dialogOpen}
                  tooltip={triggerMode === "account" ? "账户" : "账户与余额"}
                >
                  {triggerContent}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </DialogTrigger>
      )}
      <DialogContent
        className="flex h-[60vh] max-h-[90vh] w-[90vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>我的账户</DialogTitle>
          <DialogDescription>查看账户资料、积分余额、套餐与使用记录</DialogDescription>
        </DialogHeader>
        <SidebarProvider className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 w-full flex-1 overflow-hidden">
            <Sidebar collapsible="none" className="w-12 shrink-0 border-r md:w-44">
              <SidebarHeader>
                <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
                  <IconUserHexagon className="size-4 shrink-0" />
                  <span className="hidden sm:inline">账户</span>
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
              <div ref={contentScrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                {activeSection === "account"
                  ? accountContent
                  : activeSection === "plan"
                    ? planContent
                  : activeSection === "earn"
                    ? earnContent
                    : activeSection === "usage"
                      ? usageContent
                      : pricingContent}
              </div>
            </main>
          </div>
        </SidebarProvider>
      </DialogContent>
      <AlertDialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认登出</AlertDialogTitle>
            <AlertDialogDescription>
              您确定要登出吗？登出后需要重新登录才能继续使用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout}>
              确认登出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmSubscriptionPlan !== null} onOpenChange={(open) => !open && setConfirmSubscriptionPlan(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认开通套餐</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSubscriptionPlan === "pro"
                ? `确认开通专业版，价格为 ${formatPlanPoints(proSubscriptionPrice)}积分/月？`
                : confirmSubscriptionPlan === "ultra"
                  ? `确认开通旗舰版，价格为 ${formatPlanPoints(flagshipSubscriptionPrice)}积分/月？`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isProLoading || isFlagshipLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmSubscription()
              }}
              disabled={isProLoading || isFlagshipLoading}
            >
              {(isProLoading || isFlagshipLoading) && <Spinner className="mr-2 size-4" />}
              确认开通
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={showChangeNameDialog} onOpenChange={setShowChangeNameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改昵称</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wallet-new-name">昵称</Label>
              <Input
                id="wallet-new-name"
                type="text"
                placeholder="请输入新昵称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoComplete="name"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowChangeNameDialog(false)
                setNewName("")
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleChangeName}
              disabled={changingName || !newName.trim()}
            >
              {changingName && <Spinner className="mr-2 size-4" />}
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={showBindEmailDialog} onOpenChange={setShowBindEmailDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>绑定邮箱</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wallet-bind-email">邮箱</Label>
              <Input
                id="wallet-bind-email"
                type="email"
                placeholder="请输入要绑定的邮箱"
                value={bindEmail}
                onChange={(e) => setBindEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowBindEmailDialog(false)
                setBindEmail("")
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleBindEmail}
              disabled={bindingEmail || !bindEmail.trim()}
            >
              {bindingEmail && <Spinner className="mr-2 size-4" />}
              发送验证邮件
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={showRechargeDialog}
        onOpenChange={(open) => {
          setShowRechargeDialog(open)
          if (!open && rechargingCredits === null) {
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
                  "w-full rounded-md border p-4 text-left transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60",
                  selectedRechargeCredits === option.credits && "border-2 border-primary",
                )}
                onClick={() => setSelectedRechargeCredits(option.credits)}
                disabled={rechargingCredits !== null}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-sm font-medium">{formatPoints(option.credits)} 积分</div>
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
      <Dialog open={showChangePasswordDialog} onOpenChange={setShowChangePasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{passwordActionLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {requiresCurrentPassword && (
              <div className="space-y-2">
                <Label htmlFor="wallet-current-password">当前密码</Label>
                <Input
                  id="wallet-current-password"
                  type="password"
                  placeholder="请输入当前密码"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="wallet-new-password">新密码</Label>
              <Input
                id="wallet-new-password"
                type="password"
                placeholder="请输入新密码"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wallet-confirm-password">确认新密码</Label>
              <Input
                id="wallet-confirm-password"
                type="password"
                placeholder="请再次输入新密码"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowChangePasswordDialog(false)
                setCurrentPassword("")
                setNewPassword("")
                setConfirmPassword("")
              }}
            >
              取消
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={changingPassword || (requiresCurrentPassword && !currentPassword) || !newPassword || !confirmPassword}
            >
              {changingPassword && <Spinner className="mr-2 size-4" />}
              确认修改
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
