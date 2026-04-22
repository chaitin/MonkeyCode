import { useState } from "react"
import type { MessageType } from "./message"
import { IconAlertTriangle, IconReload } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

export const ErrorMessageItem = ({ message }: { message: MessageType }) => {
  const [open, setOpen] = useState(false)
  const [repairing, setRepairing] = useState(false)

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={100} closeDelay={200}>
      <HoverCardTrigger asChild>
        <Badge variant="destructive" className="max-w-[80%] cursor-pointer hover:text-primary">
          <IconAlertTriangle className="size-4" />
          <div className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all">
            {message.data.details}
          </div>
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="max-w-[500px] w-auto p-4 flex flex-col gap-4" side="bottom" align="start">
        <Label>错误详情</Label>

        <pre className="bg-muted px-3 py-2 rounded-md whitespace-pre-wrap break-all text-xs overflow-y-auto max-h-[70vh]">
          {message.data.details}
        </pre>

        <div className="flex flex-row gap-2 items-center">
          <p className="text-sm text-muted-foreground flex-1">你可以尝试重新加载开发工具来解决错误</p>
          <Button
            variant="default"
            size="sm"
            className="cursor-pointer"
            disabled={repairing}
            onClick={async () => {
              if (repairing) return

              setRepairing(true)

              try {
                const reloaded = await message.onReloadSession?.()
                if (!reloaded) {
                  toast.error("修复失败")
                  return
                }

                const sent = await message.onUserInput?.("继续执行刚才的任务")
                if (!sent) {
                  toast.error("修复失败")
                  return
                }

                setOpen(false)
              } catch {
                toast.error("修复失败")
              } finally {
                setRepairing(false)
              }
            }}
          >
            <IconReload className={repairing ? "size-3 mr-1 animate-spin" : "size-3 mr-1"} />
            {repairing ? "正在修复" : "尝试修复"}
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
