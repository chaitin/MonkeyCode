import { Badge } from "@/components/ui/badge"
import { IconAlertTriangle } from "@tabler/icons-react"
import type { MessageType } from "./message"

export const AlertMessageItem = ({ message }: { message: MessageType }) => {
  const level = message.data.level ?? "info"

  return (
    <Badge className={level === "warning"
      ? "max-w-[80%] bg-yellow-100 text-yellow-900 whitespace-normal dark:bg-yellow-950/40 dark:text-yellow-200"
      : "max-w-[80%] bg-muted text-muted-foreground whitespace-normal"
    }>
      {level === "warning" && <IconAlertTriangle className="size-4" />}
      <div className="min-w-0 flex-1 line-clamp-1 break-all">
        {message.data.text}
      </div>
    </Badge>
  )
}
