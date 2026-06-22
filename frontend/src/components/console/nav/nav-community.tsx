import { Users } from "lucide-react"
import { useState } from "react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import CommunityDialog from "./community-dialog"
import { useTranslation } from "react-i18next"

interface NavCommunityProps {
  menuClassName?: string
  itemClassName?: string
  buttonClassName?: string
}

export default function NavCommunity({
  menuClassName,
  itemClassName,
  buttonClassName,
}: NavCommunityProps = {}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <SidebarMenu className={menuClassName}>
      <SidebarMenuItem className={itemClassName}>
        <SidebarMenuButton
          tooltip={t("consoleShell.community.title")}
          className={cn("w-full", buttonClassName)}
          onClick={() => setOpen(true)}
        >
          <Users className="size-4" />
          <span>{t("consoleShell.community.title")}</span>
        </SidebarMenuButton>
        <CommunityDialog open={open} onOpenChange={setOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
