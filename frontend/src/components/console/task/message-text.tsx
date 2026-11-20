import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { Markdown } from "@/components/common/markdown"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

export const TextMessageItem = ({ message, fileLinkEnvid, onWorkspaceFileClick }: { message: MessageType, fileLinkEnvid?: string, onWorkspaceFileClick?: (path: string) => void }) => {
  const { t } = useTranslation()
  const content = typeof message.data.content === "string" ? message.data.content : ""

  const handleCopy = async () => {
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      toast.success(t("taskDetail.messages.copyAgentResponseSuccess"))
    } catch (error) {
      toast.error(t("taskDetail.messages.copyAgentResponseFailed"))
      console.error("Copy agent response failed:", error)
    }
  }

  return (
    <div className="group/agent-response relative flex flex-col w-full rounded-md px-1 max-w-[100%] mt-0.5 pb-6">
      <div className="text-sm">
        <Markdown allowHtml fileLinkEnvid={fileLinkEnvid} onWorkspaceFileClick={onWorkspaceFileClick}>{content}</Markdown>
      </div>
      {content && (
        <div className="absolute bottom-0 right-0 flex justify-end opacity-0 transition-opacity group-hover/agent-response:opacity-100 group-focus-within/agent-response:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground hover:text-foreground"
                aria-label={t("taskDetail.messages.copyAgentResponse")}
                onClick={handleCopy}
              >
                <IconCopy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("taskDetail.messages.copyAgentResponse")}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
