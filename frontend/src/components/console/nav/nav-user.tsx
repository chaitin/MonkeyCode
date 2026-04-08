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

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

export default function NavUser({ className }: { className?: string }) {
  const { user, subscription } = useCommonData()
  const planLabel = subscription?.plan === "pro" ? "专业版" : "基础版"

  const handleOpenProfile = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "profile" },
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
            <AvatarImage src={user?.avatar_url || "/logo-colored.png"} alt={user?.name || "未知用户"} />
            <AvatarFallback className="rounded-lg">{user?.name?.charAt(0) || "-"}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user?.name || "未知用户"}</span>
            <span className="truncate text-xs">{planLabel}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
