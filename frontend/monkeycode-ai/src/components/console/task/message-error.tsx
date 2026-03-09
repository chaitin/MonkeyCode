import { useState } from "react"
import type { MessageType } from "./message"
import { IconAlertTriangle, IconReload } from "@tabler/icons-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"

export const ErrorMessageItem = ({ message }: { message: MessageType }) => {
  const [open, setOpen] = useState(false)

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
            onClick={async () => {
              setOpen(false)
              const result = await message.onReloadSession?.()
              if (result) {
                message.onUserInput?.('继续执行刚才的工作')
              }
            }}
          >
            <IconReload className="size-3 mr-1" />
            尝试修复
          </Button>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

