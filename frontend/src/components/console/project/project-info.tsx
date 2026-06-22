import { type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import AutoReviewDialog from "@/components/console/project/auto-review-dialog"
import EditProjectEnvDialog from "@/components/console/project/edit-project-env"
import EditProjectImageDialog from "@/components/console/project/edit-project-image"
import EditProjectNameDialog from "@/components/console/project/edit-project-name"
import StartDevelopTaskDialog from "@/components/console/project/start-develop-task-dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isProjectRepoUnbound } from "@/utils/project"
import { apiRequest } from "@/utils/requestUtils"
import { IconBrandGithub, IconDeviceImacCode, IconLoader, IconPencil, IconSettings, IconSparkles, IconTrash, IconViewfinder } from "@tabler/icons-react"
import { MoreVertical } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface ProjectInfoProps {
  project?: DomainProject
  onRefresh: () => void
}

const ProjectInfo = ({
  project,
  onRefresh,
}: ProjectInfoProps) => {
  const [isEditNameDialogOpen, setIsEditNameDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<DomainProject | undefined>(undefined)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingProject, setDeletingProject] = useState<DomainProject | undefined>(undefined)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [conversationDialogOpen, setConversationDialogOpen] = useState(false)
  const [envDialogOpen, setEnvDialogOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [autoReviewDialogOpen, setAutoReviewDialogOpen] = useState(false)
  const navigate = useNavigate()
  const { projects, reloadProjects, reloadUnlinkedTasks } = useCommonData()
  const { t } = useTranslation()

  const handleEditProjectName = () => {
    if (!project) return
    setEditingProject(project)
    setIsEditNameDialogOpen(true)
  }

  const handleEditEnv = () => {
    if (!project) return
    setEditingProject(project)
    setEnvDialogOpen(true)
  }

  const handleEditImage = () => {
    if (!project) return
    setEditingProject(project)
    setImageDialogOpen(true)
  }

  const handleDeleteClick = () => {
    if (!project) return
    setDeletingProject(project)
    setDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = async () => {
    if (!deletingProject?.id) return

    setDeleteLoading(true)
    await apiRequest('v1UsersProjectsDelete', {}, [deletingProject.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.delete.toast.deleted"))
        setDeleteDialogOpen(false)
        setDeletingProject(undefined)
        const remainingProjects = projects.filter(p => p.id !== deletingProject.id)
        reloadProjects()
        if (remainingProjects.length > 0) {
          navigate(`/console/project/${remainingProjects[0].id}`)
        } else {
          navigate('/console/tasks')
        }
      } else {
        toast.error(resp.message || t("consoleProject.delete.toast.deleteFailed"))
      }
    })
    setDeleteLoading(false)
  }

  const handleStartConversation = () => {
    if (!project || isRepoUnbound) return
    setConversationDialogOpen(true)
  }

  const handleAutoReview = () => {
    if (!project) return
    setAutoReviewDialogOpen(true)
  }

  const isRepoUnbound = isProjectRepoUnbound(project)
  const autoReviewLabel = project?.auto_review_enabled
    ? t("consoleProject.info.autoReviewEnabled")
    : t("consoleProject.info.autoReviewDisabled")

  return (
    <>
      <Item variant="outline" key={project?.id}>
        <ItemMedia>
          <Avatar>
            <AvatarImage src="" />
            <AvatarFallback>
              {project?.platform === "github"
                ? <IconBrandGithub className="size-5" />
                : (project?.name || " ").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="font-bold">
            {project?.name || "-"}
          </ItemTitle>
          <ItemDescription className="flex flex-row gap-2 items-center">
            {isRepoUnbound && (
              <span className="text-warning">{t("consoleProject.info.unboundRepository")}</span>
            ) || (
              <span>{project?.description || t("consoleProject.info.noDescription")}</span>
            )}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={project?.auto_review_enabled ? "secondary" : "ghost"}
                size="sm"
                disabled={isRepoUnbound}
                onClick={handleAutoReview}
                className={`cursor-pointer disabled:cursor-not-allowed ${project?.auto_review_enabled ? "" : "text-muted-foreground"}`}
              >
                <IconViewfinder className="size-4" />
                {autoReviewLabel}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {autoReviewLabel}
            </TooltipContent>
          </Tooltip>
          <Button
            variant="secondary"
            size="sm"
            disabled={isRepoUnbound}
            onClick={handleStartConversation}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            <IconSparkles className="size-4" />
            {t("consoleProject.info.startAi")}
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleEditProjectName}>
                <IconPencil />
                {t("consoleProject.info.editName")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEditEnv}>
                <IconSettings />
                {t("consoleProject.info.env")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEditImage}>
                <IconDeviceImacCode />
                {t("consoleProject.info.image")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={handleDeleteClick}
              >
                <IconTrash />
                {t("consoleProject.info.remove")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>

      <EditProjectNameDialog
        open={isEditNameDialogOpen}
        onOpenChange={setIsEditNameDialogOpen}
        project={editingProject}
        onSuccess={onRefresh}
      />

      <EditProjectEnvDialog
        open={envDialogOpen}
        onOpenChange={setEnvDialogOpen}
        project={editingProject}
        onSuccess={onRefresh}
      />

      <EditProjectImageDialog
        open={imageDialogOpen}
        onOpenChange={setImageDialogOpen}
        project={editingProject}
        onSuccess={onRefresh}
      />

      <AutoReviewDialog
        open={autoReviewDialogOpen}
        onOpenChange={setAutoReviewDialogOpen}
        project={project}
        onSuccess={onRefresh}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleProject.delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleProject.delete.description", { name: deletingProject?.name || "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>{t("consoleProject.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading && <IconLoader className="size-4 animate-spin mr-2" />}
              {t("consoleProject.delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StartDevelopTaskDialog
        open={conversationDialogOpen}
        onOpenChange={(open) => {
          setConversationDialogOpen(open)
          if (!open) {
            reloadProjects()
            reloadUnlinkedTasks()
          }
        }}
        project={project}
      />
    </>
  )
}

export default ProjectInfo
