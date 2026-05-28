import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IconCamera, IconCoin, IconCrown, IconLockCode, IconLogout, IconMail, IconPencil } from "@tabler/icons-react";
import { useEffect, useState, useRef, useCallback, type ChangeEvent } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Api } from "@/api/Api";
import dayjs from "dayjs";
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useCommonData } from "../data-provider";
import { getSubscriptionPlanLabel, getSubscriptionPlanShortLabel, isValidEmail } from "@/utils/common";
import { useNavigate } from "react-router-dom";
import SubscriptionPlanDialog from "./subscription-plan-dialog";
import { IS_OFFLINE_EDITION } from "@/utils/edition";

interface NavBalanceProps {
  variant?: "sidebar" | "header";
  hideTrigger?: boolean;
  triggerMode?: "wallet" | "account";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialSection?: WalletSectionId;
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

type WalletSectionId = "account" | "profile" | "plan" | "balance"

export default function NavBalance({
  variant = "sidebar",
  hideTrigger = false,
  triggerMode = "wallet",
  open,
  onOpenChange,
  initialSection = "account",
}: NavBalanceProps) {
  const [dialogOpenInternal, setDialogOpenInternal] = useState(false);
  const [showSubscriptionPlanDialog, setShowSubscriptionPlanDialog] = useState(false);
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
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const previousDialogOpenRef = useRef(false);
  const navigate = useNavigate()
  const {
    balance,
    reloadSubscription,
    reloadUser,
    reloadWallet,
    subscription,
    user,
  } = useCommonData();
  const requiresCurrentPassword = !!user?.has_password
  const passwordActionLabel = requiresCurrentPassword ? "修改密码" : "设置密码"

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()
  const formatSubscriptionExpiry = (expiresAt?: string) => {
    if (!expiresAt) {
      return "长期有效"
    }

    const parsed = dayjs(expiresAt)
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : expiresAt
  }

  const remainingPoints = balance
  const triggerPlanLabel = getSubscriptionPlanShortLabel(subscription?.plan)

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

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""

    if (!file) {
      return
    }

    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件")
      return
    }

    setUploadingAvatar(true)

    try {
      const api = new Api()
      const uploadResp = await api.api.v1UploaderCreate({
        usage: "avatar",
        file,
      })

      const uploadResult = uploadResp.data as { code?: number; message?: string; data?: string }
      const avatarUrl = uploadResult?.data
      if (uploadResult?.code !== 0 || !avatarUrl) {
        toast.error(uploadResult?.message || "头像上传失败")
        return
      }

      const updateResp = await api.api.v1UsersUpdate({
        avatar_url: avatarUrl,
      })
      const updateResult = updateResp.data as { code?: number; message?: string }

      if (updateResult?.code === 0) {
        let avatarSynced = false

        for (let i = 0; i < 8; i += 1) {
          const latestUser = await reloadUser()
          if (latestUser?.avatar_url === avatarUrl) {
            avatarSynced = true
            break
          }

          await new Promise((resolve) => {
            window.setTimeout(resolve, 400)
          })
        }

        if (avatarSynced) {
          toast.success("头像修改成功")
        } else {
          toast.warning("头像已更新，界面稍后会自动同步")
        }
      } else {
        toast.error(updateResult?.message || "头像更新失败")
      }
    } catch (error) {
      toast.error("头像上传失败，请重试")
      console.error(error)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const dialogOpen = open ?? dialogOpenInternal
  const setDialogOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) {
      setDialogOpenInternal(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  const initializeDialog = useCallback((section: WalletSectionId = "account") => {
    if (section === "plan") {
      setShowSubscriptionPlanDialog(true)
      return
    }

    reloadWallet();
    reloadSubscription();
  }, [reloadSubscription, reloadWallet])

  const openDialog = useCallback((section: WalletSectionId = "account") => {
    if (section === "plan") {
      initializeDialog(section)
      return
    }

    initializeDialog(section)
    setDialogOpen(true)
  }, [initializeDialog, setDialogOpen])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      if (open === undefined || !hideTrigger) {
        openDialog(initialSection)
      } else {
        setDialogOpen(true)
      }
    } else {
      setDialogOpen(false)
    }
  };

  useEffect(() => {
    if (open !== undefined || hideTrigger) {
      return
    }

    const handleOpenWallet = (event: Event) => {
      const customEvent = event as CustomEvent<{ section?: string }>
      const section = customEvent.detail?.section
      if (section === "earn" || section === "usage") {
        return
      }

      openDialog((section as WalletSectionId | undefined) || "account")
    }

    window.addEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    return () => {
      window.removeEventListener(OPEN_WALLET_DIALOG_EVENT, handleOpenWallet as EventListener)
    }
  }, [hideTrigger, open, openDialog])

  useEffect(() => {
    if (dialogOpen && !previousDialogOpenRef.current && (open !== undefined || hideTrigger)) {
      initializeDialog(initialSection)
    }

    previousDialogOpenRef.current = dialogOpen
  }, [dialogOpen, initialSection, initializeDialog])

  const triggerContent = triggerMode === "account" ? (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={user?.avatar_url || "/logo-light.png"} alt={user?.name || "未知用户"} />
        <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || "-"}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">{user?.name || "未知用户"}</span>
        {!IS_OFFLINE_EDITION && <span className="truncate text-xs">{triggerPlanLabel}</span>}
      </div>
      {!IS_OFFLINE_EDITION && (
        <div className="shrink-0 rounded-md bg-brand-muted px-2 py-1 text-xs font-medium text-brand tabular-nums group-data-[collapsible=icon]:hidden">
          {formatPoints(remainingPoints)}
        </div>
      )}
    </div>
  ) : (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconCrown className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-4"} />
        <span className="truncate">{triggerPlanLabel}</span>
      </div>
      <div className="text-brand flex shrink-0 items-center gap-1.5 tabular-nums">
        <IconCoin className={variant === "header" ? "h-[1.2rem] w-[1.2rem]" : "size-4"} />
        <span>{formatPoints(remainingPoints)}</span>
      </div>
    </div>
  );

  const accountContent = (
    <div>
      <section className="pt-3 pb-3">
        <div className="min-w-0 flex items-center gap-3">
          <button
            type="button"
            className="group relative shrink-0"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
          >
            <Avatar className="size-12 rounded-xl">
              <AvatarImage src={user?.avatar_url || "/logo-light.png"} alt={user?.name || "未知用户"} />
              <AvatarFallback className="rounded-xl text-base">{user?.name?.charAt(0) || "-"}</AvatarFallback>
            </Avatar>
            <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
              {uploadingAvatar ? <Spinner className="size-4" /> : <IconCamera className="size-4" />}
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="group inline-flex max-w-full items-center gap-1 truncate text-left text-base font-semibold transition-colors hover:text-primary"
              onClick={() => {
                setNewName(user?.name || "")
                setShowChangeNameDialog(true)
              }}
            >
              <span className="truncate">{user?.name || "未知用户"}</span>
              <IconPencil className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
            </button>
            <div className="mt-1 truncate text-xs text-muted-foreground">{user?.id || "-"}</div>
          </div>
        </div>
      </section>

      <section className="divide-y divide-border/60 border-y border-border/60">
        {!IS_OFFLINE_EDITION && (
          <>
            <div className="flex min-h-12 items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">当前套餐</div>
                <div className="mt-1 truncate text-sm font-medium">
                  {getSubscriptionPlanLabel(subscription?.plan)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {formatSubscriptionExpiry(subscription?.expires_at) === "长期有效"
                      ? "长期有效"
                      : `${formatSubscriptionExpiry(subscription?.expires_at)} 前有效`}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => setShowSubscriptionPlanDialog(true)}
              >
                升级套餐
              </Button>
            </div>

            <div className="flex min-h-12 items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">当前积分</div>
                <div className="mt-1 truncate text-sm font-medium tabular-nums">{formatPoints(remainingPoints)}</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
                    detail: { section: "earn" },
                  }))
                }}
              >
                充值
              </Button>
            </div>
          </>
        )}

        <div className="flex min-h-12 items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">邮箱</div>
            <div className="mt-1 truncate text-sm font-medium">{user?.email || "未绑定"}</div>
          </div>
          {!user?.email ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-3 text-xs"
              onClick={() => {
                setBindEmail("")
                setShowBindEmailDialog(true)
              }}
            >
              <IconMail className="size-4" />
              绑定邮箱
            </Button>
          ) : null}
        </div>

        <div className="flex min-h-12 items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">团队</div>
            <div className="mt-1 truncate text-sm font-medium">{user?.team?.name || "个人空间"}</div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 pt-3">
        <Button
          variant="outline"
          className="justify-center"
          onClick={() => setShowChangePasswordDialog(true)}
        >
          <IconLockCode className="size-4" />
          {passwordActionLabel}
        </Button>
        <Button
          variant="outline"
          className="justify-center text-destructive hover:text-destructive"
          onClick={() => setShowLogoutDialog(true)}
        >
          <IconLogout className="size-4" />
          登出
        </Button>
      </section>
    </div>
  )

  return (
    <>
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
        className="flex max-h-[90vh] w-[90vw] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>我的账户</DialogTitle>
          <DialogDescription>查看账户资料、积分余额、套餐与使用记录</DialogDescription>
        </DialogHeader>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <div className="text-sm font-medium">我的账户</div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
            {accountContent}
          </div>
        </main>
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
      <SubscriptionPlanDialog open={showSubscriptionPlanDialog} onOpenChange={setShowSubscriptionPlanDialog} />
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
    </>
  )
}
