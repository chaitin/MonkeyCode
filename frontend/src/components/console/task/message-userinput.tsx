import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { IconCopy, IconFile } from "@tabler/icons-react"
import { isTaskImageAttachment, type TaskUserInputAttachment } from "./task-shared"
import React from "react"
import { TaskAttachmentPreviewDialog, type TaskAttachmentPreviewFile } from "./task-attachment-preview-dialog"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"
import { Markdown } from "@/components/common/markdown"

export const UserInputMessageItem = ({ message, fileLinkEnvid, onWorkspaceFileClick }: { message: MessageType, fileLinkEnvid?: string, onWorkspaceFileClick?: (path: string) => void }) => {
  const { t } = useTranslation()
  const [previewFile, setPreviewFile] = React.useState<TaskAttachmentPreviewFile | null>(null)
  const content = typeof message.data.content === "string" ? message.data.content : ""
  const attachments = Array.isArray(message.data.attachments)
    ? message.data.attachments.filter((attachment): attachment is TaskUserInputAttachment => (
      !!attachment
      && typeof attachment.url === "string"
      && attachment.url.trim() !== ""
      && typeof attachment.filename === "string"
      && attachment.filename.trim() !== ""
    ))
    : []

  const handleCopy = async () => {
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      toast.success(t("taskDetail.messages.copyUserInputSuccess"))
    } catch (error) {
      toast.error(t("taskDetail.messages.copyUserInputFailed"))
      console.error("Copy user input failed:", error)
    }
  }

  return (
    <div className="group/user-input relative inline-flex w-fit max-w-[80%] flex-col pb-7">
      <div className="flex flex-col rounded-md bg-accent/50 px-4 py-3 break-all">
        {content && (
          <div className="user-message-markdown break-all">
            <Markdown fileLinkEnvid={fileLinkEnvid} onWorkspaceFileClick={onWorkspaceFileClick}>
              {content}
            </Markdown>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {attachments.map((attachment, index) => (
              <button
                type="button"
                key={`${attachment.url}-${index}`}
                className="group/attachment flex max-w-full cursor-pointer items-center gap-2 rounded-md border bg-background/70 px-2 py-1.5 text-left text-xs text-foreground hover:bg-background"
                onClick={() => setPreviewFile({
                  name: attachment.filename,
                  accessUrl: attachment.url,
                })}
              >
                {isTaskImageAttachment(attachment.filename) ? (
                  <img src={attachment.url} alt={attachment.filename} className="size-4 shrink-0 rounded object-cover" />
                ) : (
                  <IconFile className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate group-hover/attachment:text-primary">{attachment.filename}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {content && (
        <div className="absolute bottom-0 right-0 flex justify-end opacity-0 transition-opacity group-hover/user-input:opacity-100 group-focus-within/user-input:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6 text-muted-foreground hover:text-foreground"
                aria-label={t("taskDetail.messages.copyUserInput")}
                onClick={handleCopy}
              >
                <IconCopy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("taskDetail.messages.copyUserInput")}</TooltipContent>
          </Tooltip>
        </div>
      )}
      <TaskAttachmentPreviewDialog
        open={!!previewFile}
        file={previewFile}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null)
          }
        }}
      />
    </div>
  )
}
