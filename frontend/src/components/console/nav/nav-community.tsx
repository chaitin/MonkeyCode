import { Users } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>技术交流群</DialogTitle>
              <DialogDescription>扫码加入技术交流群</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-4">
              <div className="flex flex-wrap justify-center gap-6">
                <div className="flex flex-col items-center gap-2">
                  <img
                    src="/wechat.png"
                    alt="微信二维码"
                    className="h-32 w-32 rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">微信群</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <img
                    src="/feishu.png"
                    alt="飞书群二维码"
                    className="h-32 w-32 rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">飞书群</span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <img
                    src="/dingtalk.png"
                    alt="钉钉群二维码"
                    className="h-32 w-32 rounded-md"
                  />
                  <span className="text-xs text-muted-foreground">钉钉群</span>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
