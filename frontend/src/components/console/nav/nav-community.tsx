import { Users } from "lucide-react"
import { useState } from "react"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import CommunityDialog from "./community-dialog"

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
  const [open, setOpen] = useState(false)

  return (
    <SidebarMenu className={menuClassName}>
      <SidebarMenuItem className={itemClassName}>
        <SidebarMenuButton
          tooltip="技术交流群"
          className={cn("w-full", buttonClassName)}
          onClick={() => setOpen(true)}
        >
          <Users className="size-4" />
          <span>技术交流群</span>
        </SidebarMenuButton>
        <CommunityDialog open={open} onOpenChange={setOpen} />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
