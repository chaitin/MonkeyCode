import React from "react"
import "@/utils/plain-text-markdown.css"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react"
import type { MessageType } from "./message"
import { useTranslation } from "react-i18next"

export const ThoughtMessageItem = ({ message, isLatest = false }: { message: MessageType; isLatest?: boolean }) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = React.useState(!isLatest)

  React.useEffect(() => {
    setCollapsed(!isLatest)
  }, [isLatest])

  return (
    <div className="flex flex-col w-full max-w-[80%] rounded-md border border-dashed bg-muted/20 py-2 px-3 mt-0.5">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="text-xs font-semibold text-foreground">
          {t("taskDetail.thought.title")}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-5 text-foreground"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? t("taskDetail.thought.expand") : t("taskDetail.thought.collapse")}
        >
          {collapsed ? <IconChevronDown className="size-3.5" /> : <IconChevronUp className="size-3.5" />}
        </Button>
      </div>
      <div className={cn("min-w-0 text-xs text-foreground break-all", collapsed ? "line-clamp-1 whitespace-nowrap overflow-hidden text-ellipsis" : "whitespace-pre-wrap")}>
        {message.data.content || ""}
      </div>
    </div>
  )
}
