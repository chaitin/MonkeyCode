import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useCommonData } from "@/components/console/data-provider"
import { cn } from "@/lib/utils"
import { useTranslation } from "react-i18next"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

function normalizePlan(plan?: string | null) {
  if (plan === "pro") {
    return "pro"
  }
  if (plan === "ultra" || plan === "flagship") {
    return "ultra"
  }
  return "basic"
}

export default function NavUser({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { user, subscription } = useCommonData()
  const planLabel = t(`consoleShell.rewards.plans.${normalizePlan(subscription?.plan)}`)
  const unknownUser = t("consoleShell.user.unknown")

  const handleOpenProfile = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "account" },
    }))
  }

  return (
    <SidebarMenu className={className}>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          className={cn("cursor-pointer", className)}
          onClick={handleOpenProfile}
        >
          <Avatar className="h-8 w-8 rounded-lg">
            <AvatarImage src={user?.avatar_url || "/logo-light.png"} alt={user?.name || unknownUser} />
            <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || "-"}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user?.name || unknownUser}</span>
            <span className="truncate text-xs">{planLabel}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
