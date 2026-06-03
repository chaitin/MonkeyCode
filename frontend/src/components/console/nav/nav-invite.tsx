import * as React from "react"
import { Copy, UserPlus } from "lucide-react"
import { toast } from "sonner"
import dayjs from "dayjs"

import type { DomainInvitationItem } from "@/api/Api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { apiRequest } from "@/utils/requestUtils"
import {
  markPointsActivityOpened,
  POINTS_ACTIVITY_STORAGE_KEYS,
  shouldHidePointsActivity,
} from "./points-activity-visibility"

export default function NavInvite() {
  const { user } = useCommonData()
  const [hidden, setHidden] = React.useState(() => shouldHidePointsActivity(POINTS_ACTIVITY_STORAGE_KEYS.invite))
  const [open, setOpen] = React.useState(false)
  const [invitations, setInvitations] = React.useState<DomainInvitationItem[]>([])
  const [invitationCount, setInvitationCount] = React.useState(0)
  const [isInvitationsLoading, setIsInvitationsLoading] = React.useState(false)
  const [hasLoadedInvitations, setHasLoadedInvitations] = React.useState(false)
  const invitationLink = `https://monkeycode-ai.com/?ic=${user.id || ""}`

  const formatPoints = (value: number) => Math.ceil(value).toLocaleString()
  const getInvitationInitial = (name?: string) => name?.trim().charAt(0).toUpperCase() || "?"
  const formatInvitationTime = (timestamp?: number) => {
    if (!timestamp) {
      return "注册时间未知"
    }

    const parsed = dayjs.unix(timestamp)
    return parsed.isValid() ? `${parsed.fromNow()}注册` : "注册时间未知"
  }

  const fetchInvitations = React.useCallback(async () => {
    setIsInvitationsLoading(true)
    await apiRequest("v1UsersInvitationsList", {
      page: 1,
      size: 20,
    }, [], (resp) => {
      if (resp.code === 0) {
        const items = resp.data?.items || []
        setInvitations(items)
        setInvitationCount(resp.data?.count || items.length)
        setHasLoadedInvitations(true)
      } else {
        toast.error(resp.message || "获取邀请用户列表失败")
      }
    })
    setHasLoadedInvitations(true)
    setIsInvitationsLoading(false)
  }, [])

  React.useEffect(() => {
    if (!open) {
      return
    }

    fetchInvitations()
  }, [fetchInvitations, open])

  const handleCopyInvitationLink = async () => {
    try {
      await navigator.clipboard.writeText(invitationLink)
      toast.success("邀请链接已复制到剪贴板")
    } catch {
      toast.error("复制失败，请手动复制")
    }
  }

  const handleOpenInviteDialog = () => {
    markPointsActivityOpened(POINTS_ACTIVITY_STORAGE_KEYS.invite)
    setHidden(true)
    setOpen(true)
  }

  if (hidden && !open) {
    return null
  }

  return (
    <>
      {!hidden && (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="邀请注册赚积分"
              onClick={handleOpenInviteDialog}
              className="border border-amber-300/70 bg-amber-100 text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_1px_2px_rgba(245,158,11,0.18)] transition-colors hover:border-amber-400 hover:bg-amber-200 hover:text-amber-950 active:border-amber-500 active:bg-[#fcd76a] dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100 dark:hover:border-amber-400 dark:hover:bg-amber-500/20 dark:active:border-amber-300 dark:active:bg-amber-500/26"
            >
              <UserPlus className="size-4 text-amber-700 dark:text-amber-300" />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-medium">邀请注册赚积分</span>
                <span className="ml-auto rounded-full border border-amber-300/80 bg-white/80 px-2 py-0.5 text-[11px] font-semibold leading-none text-amber-700 shadow-sm dark:border-amber-400/40 dark:bg-amber-100/10 dark:text-amber-200">
                  +5000
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>邀请注册赚积分</DialogTitle>
            <DialogDescription>
              将邀请链接分享给好友，好友通过该链接注册后，你将获得 5000 积分奖励。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input value={invitationLink} readOnly />
            <Button variant="outline" onClick={handleCopyInvitationLink}>
              <Copy className="size-4" />
              复制
            </Button>
          </div>
          <div className="rounded-md border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div className="text-sm font-medium">已邀请 {formatPoints(invitationCount)} 人</div>
              <div className="text-xs text-muted-foreground">最多展示 20 位</div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {isInvitationsLoading || !hasLoadedInvitations ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Spinner />
                  <span className="ml-2">加载邀请用户中...</span>
                </div>
              ) : invitations.length > 0 ? (
                <div className="space-y-2">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id || `${invitation.name || "unknown"}-${invitation.invited_at || 0}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-muted/50"
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
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  暂无邀请记录
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
