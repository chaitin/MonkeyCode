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
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import dayjs from "dayjs"

import { ConstsTransactionKind, type DomainInvitationItem, type DomainTransactionLog } from "@/api/Api"
import { useAppRuntime } from "@/components/app-runtime-provider"
import Icon from "@/components/common/Icon"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { captchaChallenge } from "@/utils/common"
import { CREDIT_RECHARGE_PACKAGES, formatRegionCurrency, getCreditRechargeAmount, getPricingRegion } from "@/utils/pricing"
import { useCommonData } from "../data-provider"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

const WALLET_NAV = [
  { id: "earn", icon: IconGift },
  { id: "usage", icon: IconCoin },
] as const

const COMMUNITY_GROUPS = [
  { id: "wechat", src: "/wechat.png", iconName: "wecom" },
  { id: "dingtalk", src: "/dingtalk.png", iconName: "dingtalk" },
  { id: "feishu", src: "/feishu.png", iconName: "lark" },
] as const

type WalletSectionId = (typeof WALLET_NAV)[number]["id"]

export default function WalletDialog() {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const pricingRegion = getPricingRegion(serverConfig?.region)
  const isGlobalRegion = serverConfig?.region === "global"
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
  const rechargeOptions = CREDIT_RECHARGE_PACKAGES.map((option) => ({
    ...option,
    amount: getCreditRechargeAmount(pricingRegion, option),
  }))
  const navLabels = {
    earn: t("walletDialog.nav.earn"),
    usage: t("walletDialog.nav.usage"),
  }

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
        return t("walletDialog.transactions.kinds.signupBonus")
      case ConstsTransactionKind.TransactionKindVoucherExchange:
        return t("walletDialog.transactions.kinds.voucherExchange")
      case ConstsTransactionKind.TransactionKindInvitationReward:
        return t("walletDialog.transactions.kinds.invitationReward")
      case ConstsTransactionKind.TransactionKindVMConsumption:
        return t("walletDialog.transactions.kinds.vmConsumption")
      case ConstsTransactionKind.TransactionKindModelConsumption:
        return t("walletDialog.transactions.kinds.modelConsumption")
      case ConstsTransactionKind.TransactionKindMCPToolConsumption:
        return t("walletDialog.transactions.kinds.mcpToolConsumption")
      case ConstsTransactionKind.TransactionKindProSubscription:
        return t("walletDialog.transactions.kinds.proSubscription")
      case ConstsTransactionKind.TransactionKindProAutoRenew:
        return t("walletDialog.transactions.kinds.proAutoRenew")
      case ConstsTransactionKind.TransactionKindUltraSubscription:
        return t("walletDialog.transactions.kinds.ultraSubscription")
      case ConstsTransactionKind.TransactionKindUltraAutoRenew:
        return t("walletDialog.transactions.kinds.ultraAutoRenew")
      case ConstsTransactionKind.TransactionKindProUpgradeRefund:
        return t("walletDialog.transactions.kinds.proUpgradeRefund")
      case ConstsTransactionKind.TransactionKindDailyGrant:
        return t("walletDialog.transactions.kinds.dailyGrant")
      case ConstsTransactionKind.TransactionKindTopUp:
        return t("walletDialog.transactions.kinds.topUp")
      case ConstsTransactionKind.TransactionKindCheckin:
        return t("walletDialog.transactions.kinds.checkin")
      case ConstsTransactionKind.TransactionKindViolationFine:
        return t("walletDialog.transactions.kinds.violationFine")
      default:
        return t("walletDialog.transactions.kinds.default")
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
      return t("walletDialog.invite.unknownRegistrationTime")
    }

    const parsed = dayjs.unix(timestamp)
    return parsed.isValid()
      ? t("walletDialog.invite.registeredAgo", { time: parsed.fromNow() })
      : t("walletDialog.invite.unknownRegistrationTime")
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
        toast.error(resp.message || t("walletDialog.toast.fetchTransactionsFailed"))
      }
    })
    setIsLoadingMore(false)
  }, [t])

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
        toast.error(resp.message || t("walletDialog.toast.fetchInvitationsFailed"))
      }
    })
    setIsInvitationsLoading(false)
  }, [t])

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
    if (!isGlobalRegion) {
      fetchInvitations()
    }
  }, [fetchInvitations, fetchTranscations, isGlobalRegion, reloadCheckinStatus, reloadSubscription, reloadWallet])

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
    toast.success(t("walletDialog.toast.invitationCopied"))
  }

  const handleExchange = async () => {
    if (!exchangeCode.trim()) {
      toast.error(t("walletDialog.toast.exchangeCodeRequired"))
      return
    }

    setIsExchangeLoading(true)
    await apiRequest("v1UsersWalletExchangeCreate", { code: exchangeCode.trim() }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("walletDialog.toast.exchangeSuccess"))
        setExchangeCode("")
        reloadWallet()
      } else {
        toast.error(resp.message || t("walletDialog.toast.exchangeFailed"))
      }
    })
    setIsExchangeLoading(false)
  }

  const handleRecharge = async () => {
    if (!selectedRechargeCredits) {
      toast.error(t("walletDialog.toast.selectRechargePackage"))
      return
    }

    setRechargingCredits(selectedRechargeCredits)
    await apiRequest("v1UsersWalletRechargeCreate", { credits: selectedRechargeCredits }, [], (resp) => {
      const paymentUrl = resp.data?.url
      if (resp.code === 0 && paymentUrl) {
        setShowRechargeDialog(false)
        window.open(paymentUrl, "_blank", "noopener,noreferrer")
      } else {
        toast.error(resp.message || t("walletDialog.toast.paymentUrlFailed"))
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
        toast.success(enabled ? t("walletDialog.toast.creditConsumptionEnabled") : t("walletDialog.toast.creditConsumptionDisabled"))
        return
      }

      toast.error(resp.message || t("walletDialog.toast.settingFailed"))
    }, () => {
      toast.error(t("walletDialog.toast.settingFailed"))
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
      toast.error(t("walletDialog.toast.captchaFailed"))
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
          toast.success(t("walletDialog.toast.checkinSuccess"))
          return
        }

        toast.error(resp.message || t("walletDialog.toast.checkinFailed"))
      },
      () => {
        toast.error(t("walletDialog.toast.checkinFailed"))
      },
    )

    setIsCheckinSubmitting(false)
  }

  const earnContent = (
    <div className="space-y-4">
      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-md font-medium">{t("walletDialog.earn.balanceTitle")}</div>
          <Button
            variant="default"
            size="sm"
            className="px-3"
            onClick={() => {
              setSelectedRechargeCredits(null)
              setShowRechargeDialog(true)
            }}
          >
            {t("walletDialog.earn.recharge")}
          </Button>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="rounded-md bg-muted/40 px-4 py-3">
            <div className="text-xs text-muted-foreground">{t("walletDialog.earn.balanceLabel")}</div>
            <div className="mt-2 text-lg font-medium tabular-nums">{formatPoints(balance)}</div>
          </div>
        </div>
      </div>
      {!isGlobalRegion ? (
        <div className="rounded-md border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-md font-medium">{t("walletDialog.invite.title")}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {t("walletDialog.invite.description")}
              </div>
            </div>
            <div className="rounded-full bg-brand-muted px-2.5 py-1 text-xs font-medium text-brand">
              +5,000
            </div>
          </div>
          <div className="mt-4 flex flex-row justify-between gap-2">
            <Input value={invitationLink} readOnly />
            <Button variant="outline" onClick={handleCopyInvitationLink}>{t("walletDialog.invite.copyLink")}</Button>
          </div>
          <div className="mt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/60"
              onClick={() => setIsInvitationListExpanded((prev) => !prev)}
            >
              <span className="text-sm font-medium">{t("walletDialog.invite.invitedCount", { count: formatPoints(invitationCount) })}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {isInvitationListExpanded ? t("walletDialog.invite.collapseList") : t("walletDialog.invite.expandList")}
                <IconChevronDown className={cn("size-4 transition-transform", isInvitationListExpanded && "rotate-180")} />
              </span>
            </button>
            {isInvitationListExpanded ? (
              <div className="mt-3 space-y-2">
                {isInvitationsLoading ? (
                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                    <Spinner />
                    <span className="ml-2">{t("walletDialog.invite.loading")}</span>
                  </div>
                ) : invitations.length > 0 ? (
                  invitations.map((invitation) => (
                    <div
                      key={invitation.id || `${invitation.name || "unknown"}-${invitation.invited_at || 0}`}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-8">
                          <AvatarImage src={invitation.avatar_url} alt={invitation.name || t("walletDialog.invite.avatarAlt")} />
                          <AvatarFallback>{getInvitationInitial(invitation.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {invitation.name || t("walletDialog.invite.unnamedUser")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatInvitationTime(invitation.invited_at)}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-sm font-medium text-brand">
                        {t("walletDialog.invite.creditReward", { points: formatPoints(invitation.credits || 0) })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-6 text-center text-sm text-muted-foreground">
                    {t("walletDialog.invite.empty")}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {!isGlobalRegion ? (
        <div className="rounded-md border p-4">
          <div>
            <div className="text-md font-medium">{t("walletDialog.community.title")}</div>
            <div className="mt-2 text-sm text-muted-foreground">
              {t("walletDialog.community.description")}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {COMMUNITY_GROUPS.map((group) => (
              <HoverCard key={group.id} openDelay={120} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <Button variant="outline">
                    <Icon name={group.iconName} className="size-4" />
                    {t(`walletDialog.community.groups.${group.id}.label`)}
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent className="w-auto p-3" side="top" align="center">
                  <div className="flex items-center justify-center">
                    <img
                      src={group.src}
                      alt={t(`walletDialog.community.groups.${group.id}.alt`)}
                      className="h-40 w-40 rounded-lg object-contain"
                    />
                  </div>
                </HoverCardContent>
              </HoverCard>
            ))}
          </div>
        </div>
      ) : null}
      <div className="rounded-md border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-md font-medium">{t("walletDialog.earn.dailyCheckin")}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {checkedInToday === true
                ? t("walletDialog.earn.checkinDoneDescription")
                : checkedInToday === false
                  ? t("walletDialog.earn.checkinAvailableDescription")
                  : t("walletDialog.earn.checkinUnknownDescription")}
            </div>
          </div>
          <Button
            variant={checkedInToday === true ? "outline" : "default"}
            className="sm:min-w-32"
            onClick={handleCheckin}
            disabled={loadingCheckinStatus || isCheckinSubmitting || checkedInToday !== false}
          >
            {isCheckinSubmitting && <Spinner />}
            {checkedInToday === true ? t("walletDialog.earn.checkinDone") : t("walletDialog.earn.checkinAction")}
          </Button>
        </div>
      </div>
      <div className="rounded-md border p-4">
        <div className="text-md font-medium">{t("walletDialog.earn.exchangeTitle")}</div>
        <div className="mt-4 flex gap-2">
          <Input
            placeholder={t("walletDialog.earn.exchangePlaceholder")}
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
            {t("walletDialog.earn.exchange")}
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
            <div className="text-sm font-medium">{t("walletDialog.usage.creditConsumptionTitle")}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("walletDialog.usage.creditConsumptionDescription")}
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
        title: t("walletDialog.sections.earn.title"),
        description: t("walletDialog.sections.earn.description"),
      }
    : {
        title: t("walletDialog.sections.usage.title"),
        description: t("walletDialog.sections.usage.description"),
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
            <DialogTitle>{t("walletDialog.dialog.title")}</DialogTitle>
            <DialogDescription>{t("walletDialog.dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 w-full flex-1 overflow-hidden">
            <aside className="w-12 shrink-0 border-r p-2 md:w-44">
              <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
                <IconCoin className="size-4 shrink-0" />
                <span className="hidden sm:inline">{t("walletDialog.dialog.sidebarTitle")}</span>
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
                    <span className="hidden sm:inline">{navLabels[item.id]}</span>
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
            <DialogTitle>{t("walletDialog.recharge.title")}</DialogTitle>
            <DialogDescription>{t("walletDialog.recharge.description")}</DialogDescription>
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
                  <div className="truncate text-sm font-medium">
                    {t("walletDialog.recharge.creditsLabel", { points: formatPoints(option.credits) })}
                  </div>
                  <div className="shrink-0 rounded-full bg-brand-muted px-2 py-0.5 text-xs font-medium text-brand">
                    {t(`walletDialog.recharge.discounts.${option.discountKey}`)}
                  </div>
                </div>
                <div
                  className={cn(
                    "shrink-0 text-brand text-base font-medium",
                    selectedRechargeCredits === option.credits && "font-bold",
                  )}
                >
                  {formatRegionCurrency(option.amount, pricingRegion)}
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
              {t("walletDialog.recharge.cancel")}
            </Button>
            <Button
              onClick={() => void handleRecharge()}
              disabled={!selectedRechargeCredits || rechargingCredits !== null}
            >
              {rechargingCredits !== null && <Spinner className="mr-2 size-4" />}
              {t("walletDialog.recharge.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
