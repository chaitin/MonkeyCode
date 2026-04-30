import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"
import { IconFile } from "@tabler/icons-react"
import { isTaskImageAttachment, type TaskUserInputAttachment } from "./task-shared"
import React from "react"
import { TaskAttachmentPreviewDialog, type TaskAttachmentPreviewFile } from "./task-attachment-preview-dialog"

export const UserInputMessageItem = ({ message }: { message: MessageType }) => {
  const [previewFile, setPreviewFile] = React.useState<TaskAttachmentPreviewFile | null>(null)
  const attachments = Array.isArray(message.data.attachments)
    ? message.data.attachments.filter((attachment): attachment is TaskUserInputAttachment => (
      !!attachment
      && typeof attachment.url === "string"
      && attachment.url.trim() !== ""
      && typeof attachment.filename === "string"
      && attachment.filename.trim() !== ""
    ))
    : []

  return (
    <div className="flex flex-col w-fit rounded-md bg-accent/50 px-4 py-3 max-w-[80%] break-all">
      {message.data.content && (
        <div className="user-message-markdown break-all">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p({children, ...props}) {
                if (typeof children === 'string') {
                  return (children as string).split('\n').map((line: string, index: number) => (
                    <p key={index} {...props}>{line}</p>
                  ))
                } else {
                  return <p {...props}>{children}</p>
                }
              }
            }}>
            {message.data.content}
          </ReactMarkdown>
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
