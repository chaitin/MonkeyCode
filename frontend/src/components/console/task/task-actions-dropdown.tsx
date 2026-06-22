import { type DomainProjectTask, ConstsTaskStatus } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { getTaskDisplayName } from "@/utils/common"
import { toast } from "sonner"
import { IconDotsVertical, IconLoader, IconPencil, IconPlayerStopFilled, IconTrash } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

type TaskActionsDropdownProps = {
  task: DomainProjectTask
  onStop?: (task: DomainProjectTask) => void
  onDelete?: (task: DomainProjectTask) => void
  onRenameSuccess?: (title: string) => void
  renameLabel?: string
  stopLabel?: string
  deleteLabel?: string
  triggerClassName?: string
  contentClassName?: string
}

export function TaskActionsDropdown({
  task,
  onStop,
  onDelete,
  onRenameSuccess,
  renameLabel,
  stopLabel,
  deleteLabel,
  triggerClassName,
  contentClassName,
}: TaskActionsDropdownProps) {
  const { t } = useTranslation()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [renaming, setRenaming] = useState(false)
  const resolvedRenameLabel = renameLabel ?? t("taskWorkflow.actions.rename")
  const resolvedStopLabel = stopLabel ?? t("taskWorkflow.actions.stop")
  const resolvedDeleteLabel = deleteLabel ?? t("taskWorkflow.actions.delete")
  const canStop =
    task.status === ConstsTaskStatus.TaskStatusPending ||
    task.status === ConstsTaskStatus.TaskStatusProcessing

  const openRenameDialog = () => {
    setTitle(getTaskDisplayName(task))
    setRenameDialogOpen(true)
  }

  const closeRenameDialog = () => {
    setRenameDialogOpen(false)
    setTitle("")
    setRenaming(false)
  }

  const handleRename = async () => {
    if (!task.id) {
      toast.error(t("taskWorkflow.rename.invalidTask"))
      return
    }

    const nextTitle = title.trim()
    if (!nextTitle) {
      toast.error(t("taskWorkflow.rename.emptyName"))
      return
    }

    setRenaming(true)
    await apiRequest(
      "v1UsersTasksUpdate",
      { title: nextTitle },
      [task.id],
      (resp) => {
        setRenaming(false)
        if (resp.code === 0) {
          toast.success(t("taskWorkflow.rename.success"))
          onRenameSuccess?.(nextTitle)
          closeRenameDialog()
        } else {
          toast.error(resp.message || t("taskWorkflow.rename.failed"))
        }
      },
      () => {
        setRenaming(false)
        toast.error(t("taskWorkflow.rename.failed"))
      }
    )
  }

  if (!onStop && !onDelete && !onRenameSuccess) {
    return null
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-5 shrink-0", triggerClassName)}
            onClick={(e) => e.preventDefault()}
          >
            <IconDotsVertical className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn("py-1", contentClassName)}>
          {onRenameSuccess && (
            <DropdownMenuItem
              onSelect={openRenameDialog}
            >
              <IconPencil className="mr-1" />
              {resolvedRenameLabel}
            </DropdownMenuItem>
          )}
          {canStop && onStop && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onStop(task)}
            >
              <IconPlayerStopFilled className="mr-1" />
              {resolvedStopLabel}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(task)}
            >
              <IconTrash className="mr-1" />
              {resolvedDeleteLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (renaming) {
            return
          }
          if (open) {
            openRenameDialog()
          } else {
            closeRenameDialog()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("taskWorkflow.rename.title")}</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("taskWorkflow.rename.emptyName")}
            disabled={renaming}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void handleRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog} disabled={renaming}>
              {t("taskWorkflow.rename.cancel")}
            </Button>
            <Button onClick={() => void handleRename()} disabled={renaming || !title.trim()}>
              {renaming && <IconLoader className="size-4 animate-spin" />}
              {renaming ? t("taskWorkflow.rename.submitting") : t("taskWorkflow.rename.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
