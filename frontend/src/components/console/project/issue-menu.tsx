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
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()

  if (!issue) {
    return null
  }

  const handleDeleteIssue = () => {
    if (!issue.id) {
      toast.error(t("consoleProject.issue.delete.toast.missingId"))
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
          toast.success(t("consoleProject.issue.delete.toast.deleted"))
          onIssueDeleted?.()
        } else {
          toast.error(resp.message || t("consoleProject.issue.delete.toast.deleteFailed"))
        }
      },
      () => {
        setDeleting(false)
        setDeleteDialogOpen(false)
        toast.error(t("consoleProject.issue.delete.toast.deleteFailed"))
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
            {t("consoleProject.issue.actions.startDesign")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDevelopDialogOpen(true)}>
            <IconDeviceImacCode />
            {t("consoleProject.issue.actions.startDevelop")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDeleteDialogOpen(true)}>
            <IconTrash />
            {t("consoleProject.issue.actions.delete")}
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
            <AlertDialogTitle>{t("consoleProject.issue.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleProject.issue.delete.description", { title: issue.title || t("consoleProject.issue.untitled") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("consoleProject.common.cancel")}</AlertDialogCancel>
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
                  {t("consoleProject.issue.delete.deleting")}
                </>
              ) : t("consoleProject.issue.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
