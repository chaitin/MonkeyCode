import { type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import EditCollaboratorsDialog from "@/components/console/project/edit-collaborators"
import EditProjectNameDialog from "@/components/console/project/edit-project-name"
import StartDevelopTaskDialog from "@/components/console/project/start-develop-task-dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { isProjectRepoUnbound } from "@/utils/project"
import { apiRequest } from "@/utils/requestUtils"
import { IconBrandGithub, IconLoader, IconPencil, IconSparkles, IconTrash, IconUsers } from "@tabler/icons-react"
import { MoreVertical } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

interface ProjectInfoProps {
  project?: DomainProject
  onRefresh: () => void
}

const ProjectInfo = ({
  project,
  onRefresh,
}: ProjectInfoProps) => {
  const [isEditNameDialogOpen, setIsEditNameDialogOpen] = useState(false)
  const [isEditCollaboratorsDialogOpen, setIsEditCollaboratorsDialogOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<DomainProject | undefined>(undefined)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingProject, setDeletingProject] = useState<DomainProject | undefined>(undefined)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [conversationDialogOpen, setConversationDialogOpen] = useState(false)
  const navigate = useNavigate()
  const { projects, reloadProjects } = useCommonData()

  const handleEditProjectName = () => {
    if (!project) return
    setEditingProject(project)
    setIsEditNameDialogOpen(true)
  }

  const handleEditCollaborators = () => {
    if (!project) return
    setEditingProject(project)
    setIsEditCollaboratorsDialogOpen(true)
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
        toast.success("项目已删除")
        setDeleteDialogOpen(false)
        setDeletingProject(undefined)
        // 找到删除后的第一个项目
        const remainingProjects = projects.filter(p => p.id !== deletingProject.id)
        reloadProjects()
        if (remainingProjects.length > 0) {
          navigate(`/console/project/${remainingProjects[0].id}/docs/`)
        } else {
          navigate('/console/tasks')
        }
      } else {
        toast.error(resp.message || "删除项目失败")
      }
    })
    setDeleteLoading(false)
  }

  const handleStartConversation = () => {
    if (!project || isRepoUnbound) return
    setConversationDialogOpen(true)
  }

  const isRepoUnbound = isProjectRepoUnbound(project)

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
              <span className="text-amber-600">未绑定仓库</span>
            ) || (
              <span>{project?.description || "暂无描述"}</span>
            )}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          
        <Button 
            variant="secondary" 
            size="sm" 
            disabled={isRepoUnbound}
            onClick={handleStartConversation}
          >
            <IconSparkles className="size-4" />
            启动 AI
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
                修改名称
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleEditCollaborators}>
                <IconUsers />
                项目成员
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={handleDeleteClick}
              >
                <IconTrash />
                移除项目
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

      <EditCollaboratorsDialog
        open={isEditCollaboratorsDialogOpen}
        onOpenChange={setIsEditCollaboratorsDialogOpen}
        project={editingProject}
        onSuccess={onRefresh}
      />

      {/* 删除项目确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除项目 "{deletingProject?.name}" 吗？此操作不可撤销，项目内的所有数据都将被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading && <IconLoader className="size-4 animate-spin mr-2" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <StartDevelopTaskDialog
        open={conversationDialogOpen}
        onOpenChange={setConversationDialogOpen}
        project={project}
      />
    </>
  )
}

export default ProjectInfo
