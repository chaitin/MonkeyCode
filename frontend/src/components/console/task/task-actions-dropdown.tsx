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
import { useEffect, useState } from "react"

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
  renameLabel = "修改名称",
  stopLabel = "终止任务",
  deleteLabel = "删除任务",
  triggerClassName,
  contentClassName,
}: TaskActionsDropdownProps) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [renaming, setRenaming] = useState(false)
  const canStop =
    task.status === ConstsTaskStatus.TaskStatusPending ||
    task.status === ConstsTaskStatus.TaskStatusProcessing

  useEffect(() => {
    if (renameDialogOpen) {
      setTitle(getTaskDisplayName(task))
      return
    }
    setTitle("")
    setRenaming(false)
  }, [renameDialogOpen, task])

  const handleRename = async () => {
    if (!task.id) {
      toast.error("任务信息无效")
      return
    }

    const nextTitle = title.trim()
    if (!nextTitle) {
      toast.error("请输入任务名称")
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
          toast.success("任务名称修改成功")
          onRenameSuccess?.(nextTitle)
          setRenameDialogOpen(false)
        } else {
          toast.error(resp.message || "修改任务名称失败")
        }
      },
      () => {
        setRenaming(false)
        toast.error("修改任务名称失败")
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
              onSelect={() => setRenameDialogOpen(true)}
            >
              <IconPencil className="mr-1" />
              {renameLabel}
            </DropdownMenuItem>
          )}
          {canStop && onStop && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onStop(task)}
            >
              <IconPlayerStopFilled className="mr-1" />
              {stopLabel}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onDelete(task)}
            >
              <IconTrash className="mr-1" />
              {deleteLabel}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!renaming) {
            setRenameDialogOpen(open)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改任务名称</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="请输入任务名称"
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
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)} disabled={renaming}>
              取消
            </Button>
            <Button onClick={() => void handleRename()} disabled={renaming || !title.trim()}>
              {renaming && <IconLoader className="size-4 animate-spin" />}
              {renaming ? "提交中..." : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
