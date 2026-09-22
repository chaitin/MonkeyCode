import { useState } from "react"
import {
  MoreHorizontalIcon,
  PowerIcon,
  PowerOffIcon,
  ResetPasswordIcon,
  UserRoundCogIcon,
  UserRoundIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export type MemberActionUser = {
  id: string
  name: string
  email: string
  role: "admin" | "user"
  status: "active" | "disabled"
}

export function MemberActions({
  user,
  savingID,
  currentUserID,
  treeActionsVisible,
  onMenuOpenChange,
  onToggleStatus,
  onToggleRole,
  onResetPassword,
}: {
  user: MemberActionUser
  savingID: string
  currentUserID?: string
  treeActionsVisible?: boolean
  onMenuOpenChange?: (open: boolean) => void
  onToggleStatus: (user: MemberActionUser) => void
  onToggleRole: (user: MemberActionUser) => void
  onResetPassword: (user: MemberActionUser) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isCurrentUser = user.id === currentUserID

  return (
    <DropdownMenu
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        onMenuOpenChange?.(nextOpen)
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={treeActionsVisible !== undefined ? "icon-xs" : "icon-sm"}
            className={cn(
              "cursor-pointer hover:bg-foreground/5 aria-expanded:bg-foreground/5 dark:hover:bg-foreground/5",
              treeActionsVisible !== undefined &&
                "pointer-events-none opacity-0 transition-none focus-visible:pointer-events-auto focus-visible:opacity-100",
              (treeActionsVisible || open) &&
                "pointer-events-auto opacity-100 transition-opacity duration-100 ease-out motion-reduce:transition-none"
            )}
            disabled={savingID === user.id}
            aria-label={t("pages.membersAndGroups.memberActions", {
              member: user.name,
            })}
          />
        }
      >
        <HugeiconsIcon
          icon={MoreHorizontalIcon}
          className={treeActionsVisible !== undefined ? "size-4" : undefined}
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isCurrentUser}
            onClick={() => onToggleStatus(user)}
          >
            <HugeiconsIcon
              icon={user.status === "disabled" ? PowerIcon : PowerOffIcon}
              strokeWidth={2}
            />
            {t(
              user.status === "disabled"
                ? "pages.membersAndGroups.enableMember"
                : "pages.membersAndGroups.disableMember"
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onResetPassword(user)}>
            <HugeiconsIcon icon={ResetPasswordIcon} strokeWidth={2} />
            {t("pages.membersAndGroups.resetPassword")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCurrentUser}
            onClick={() => onToggleRole(user)}
          >
            <HugeiconsIcon
              icon={user.role === "admin" ? UserRoundIcon : UserRoundCogIcon}
              strokeWidth={2}
            />
            {t(
              user.role === "admin"
                ? "pages.membersAndGroups.removeAdministrator"
                : "pages.membersAndGroups.makeAdministrator"
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
