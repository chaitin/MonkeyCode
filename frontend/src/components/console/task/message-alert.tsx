import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { IconAlertTriangle, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import type { MessageType } from "./message"

export const AlertMessageItem = ({ message }: { message: MessageType }) => {
  const { t } = useTranslation()
  const level = message.data.level ?? "info"
  const text = message.data.text || ""

  const handleCopy = async () => {
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      toast.success(t("taskDetail.alert.copySuccess"))
    } catch (error) {
      toast.error(t("taskDetail.alert.copyFailed"))
      console.error("Copy alert message failed:", error)
    }
  }

  return (
    <Badge className={level === "warning"
      ? "group/alert-message max-w-[80%] bg-yellow-100 text-yellow-900 whitespace-normal dark:bg-yellow-950/40 dark:text-yellow-200"
      : "group/alert-message max-w-[80%] bg-muted text-muted-foreground whitespace-normal"
    }>
      {level === "warning" && <IconAlertTriangle className="size-4" />}
      <div className="min-w-0 flex-1 line-clamp-1 break-all">
        {text}
      </div>
      {text && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-5 shrink-0 opacity-0 transition-opacity hover:bg-black/5 group-hover/alert-message:opacity-100 group-focus-within/alert-message:opacity-100 dark:hover:bg-white/10"
              aria-label={t("taskDetail.alert.copy")}
              onClick={handleCopy}
            >
              <IconCopy className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("taskDetail.alert.copy")}</TooltipContent>
        </Tooltip>
      )}
    </Badge>
  )
}
