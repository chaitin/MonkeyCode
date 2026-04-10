import { Users } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

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
  const communityGroups = [
    { src: "/wechat.png", alt: "微信二维码", label: "微信群" },
    { src: "/feishu.png", alt: "飞书群二维码", label: "飞书群" },
    { src: "/dingtalk.png", alt: "钉钉群二维码", label: "钉钉群" },
  ]

  return (
    <SidebarMenu className={menuClassName}>
      <SidebarMenuItem className={itemClassName}>
        <Dialog>
          <DialogTrigger asChild>
            <SidebarMenuButton tooltip="技术交流群" className={cn("w-full", buttonClassName)}>
              <Users className="size-4" />
              <span>技术交流群</span>
            </SidebarMenuButton>
          </DialogTrigger>
          <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-4 sm:max-w-lg sm:p-6">
            <DialogHeader className="pb-0 pr-8">
              <DialogTitle>扫码加入技术交流群</DialogTitle>
            </DialogHeader>
            <div className="mt-4 flex-1 overflow-y-auto pr-1">
              <div className="flex flex-col gap-4">
                {communityGroups.map((group) => (
                  <div key={group.label} className="flex flex-col items-center gap-3 rounded-xl border px-4 py-4">
                    <div className="text-sm font-medium">{group.label}</div>
                    <img
                      src={group.src}
                      alt={group.alt}
                      className="h-36 w-36 rounded-lg object-contain"
                    />
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
