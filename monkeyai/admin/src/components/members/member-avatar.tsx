import {
  UserRoundCheckIcon,
  UserRoundCogIcon,
  UserRoundXIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import type { MemberActionUser } from "@/components/members/member-actions"
import { memberIconColor } from "@/lib/member-appearance"
import { cn } from "@/lib/utils"

export function MemberAvatar({
  role,
  status,
  size,
}: {
  role: MemberActionUser["role"]
  status: MemberActionUser["status"]
  size: "sm" | "lg"
}) {
  const icon =
    status === "disabled"
      ? UserRoundXIcon
      : role === "admin"
        ? UserRoundCogIcon
        : UserRoundCheckIcon
  return (
    <Avatar size={size}>
      <AvatarFallback>
        <HugeiconsIcon
          icon={icon}
          className={cn(
            size === "sm" ? "size-4" : "size-6",
            memberIconColor({ role, status })
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </AvatarFallback>
    </Avatar>
  )
}
