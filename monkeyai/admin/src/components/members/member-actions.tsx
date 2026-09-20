import { useState } from "react"
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"
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
  treeRowHovered,
  onToggleStatus,
  onToggleRole,
}: {
  user: MemberActionUser
  savingID: string
  currentUserID?: string
  treeRowHovered?: boolean
  onToggleStatus: (user: MemberActionUser) => void
  onToggleRole: (user: MemberActionUser) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isCurrentUser = user.id === currentUserID

  return (
    <DropdownMenu onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size={treeRowHovered !== undefined ? "icon-xs" : "icon-sm"}
            className={cn(
              treeRowHovered !== undefined &&
                "opacity-0 transition-[opacity,background-color] duration-150 ease-in-out focus-visible:opacity-100 motion-reduce:transition-none",
              (treeRowHovered || open) && "opacity-100"
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
          className={treeRowHovered !== undefined ? "size-3" : undefined}
          strokeWidth={2}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isCurrentUser}
            onClick={() => onToggleStatus(user)}
          >
            {t(
              user.status === "disabled"
                ? "pages.membersAndGroups.enableMember"
                : "pages.membersAndGroups.disableMember"
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isCurrentUser}
            onClick={() => onToggleRole(user)}
          >
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
