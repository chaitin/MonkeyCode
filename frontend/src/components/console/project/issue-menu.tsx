import { type DomainProjectIssue, type DomainProject } from "@/api/Api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconDeviceImacCode, IconLoader, IconSparkles, IconTrash } from "@tabler/icons-react"
import { MoreVertical } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import IssueDesignDialog from "./issue-design-dialog"
import IssueDevelopDialog from "./issue-dev-dialog"

interface IssueMenuProps {
  issue?: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onTaskCreated?: () => void
  onIssueDeleted?: () => void
}

export default function IssueMenu({ issue, projectId, project, onTaskCreated, onIssueDeleted }: IssueMenuProps) {
  const [designDialogOpen, setDesignDialogOpen] = useState(false)
  const [developDialogOpen, setDevelopDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDeleteIssue = async () => {
    if (!issue?.id) {
      toast.error("需求信息不完整")
      return
    }

    setDeleting(true)
    try {
      const response = await fetch(`/api/v1/users/projects/${projectId}/issues/${issue.id}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      })

      if (response.status === 401) {
        window.location.href = "/login"
        return
      }

      const resp = await response.json().catch(() => null)
      if (response.ok && resp?.code === 0) {
        toast.success("需求已删除")
        onIssueDeleted?.()
      } else {
        toast.error(resp?.message || "删除需求失败")
      }
    } catch (error) {
      toast.error((error as Error)?.message || "删除需求失败")
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  if (!issue) {
    return null
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onClick={() => setDesignDialogOpen(true)}>
            <IconSparkles />
            启动设计任务
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDevelopDialogOpen(true)}>
            <IconDeviceImacCode />
            启动开发任务
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)}>
            <IconTrash />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => !deleting && setDeleteDialogOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除需求</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除需求「{issue.title || "未命名需求"}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                handleDeleteIssue()
              }}
            >
              {deleting && <IconLoader className="size-4 animate-spin" />}
              {deleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <IssueDesignDialog
        open={designDialogOpen}
        onOpenChange={setDesignDialogOpen}
        issue={issue}
        projectId={projectId}
        project={project}
        onConfirm={onTaskCreated}
      />
      <IssueDevelopDialog
        open={developDialogOpen}
        onOpenChange={setDevelopDialogOpen}
        issue={issue}
        projectId={projectId}
        project={project}
        onConfirm={onTaskCreated}
      />
    </>
  )
}
