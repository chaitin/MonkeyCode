import { type DomainProjectIssue, type DomainProject } from "@/api/Api"
import { Button } from "@/components/ui/button"
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { IconDeviceImacCode, IconSparkles, IconTrash } from "@tabler/icons-react"
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

  if (!issue) {
    return null
  }

  const handleDeleteIssue = () => {
    if (!issue.id) {
      toast.error("需求 ID 不存在，无法删除")
      setDeleteDialogOpen(false)
      return
    }

    setDeleting(true)
    apiRequest(
      "v1UsersProjectsIssuesDelete",
      {},
      [projectId, issue.id],
      (resp) => {
        setDeleting(false)
        setDeleteDialogOpen(false)
        if (resp.code === 0) {
          toast.success("需求已删除")
          onIssueDeleted?.()
        } else {
          toast.error(resp.message || "删除需求失败")
        }
      },
      () => {
        setDeleting(false)
        setDeleteDialogOpen(false)
        toast.error("删除需求失败")
      }
    )
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
              onClick={(event) => {
                event.preventDefault()
                handleDeleteIssue()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Spinner />
                  删除中...
                </>
              ) : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
