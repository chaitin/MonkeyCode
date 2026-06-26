import { type DomainProjectIssue, type DomainProject, ConstsCliName, ConstsGitPlatform, ConstsTaskSubType, ConstsTaskType } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { selectHost, selectImage } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"
import { IssueTaskModelSelect, IssueTaskProjectFields, useIssueTaskModelSelection, useProjectBranchSelection } from "./issue-task-dialog-shared"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface IssueDesignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onConfirm?: () => void
}

export default function IssueDesignDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  project,
  onConfirm
}: IssueDesignDialogProps) {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { images, models, hosts, reloadProjects, reloadUnlinkedTasks, subscription } = useCommonData()
  const { branches, loadingBranches, selectedBranch, selectBranch } = useProjectBranchSelection(open, project)
  const { selectedModel, selectedModelId, setSelectedModelId } = useIssueTaskModelSelection(open, models, subscription)
  const { t } = useTranslation()

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open)
  }

  const renderPrompt = useMemo(() => {
    let prompt = t("consoleProject.issueTask.design.promptTitle", { title: issue?.title || "" })

    if (issue?.requirement_document) {
      prompt += `

${t("consoleProject.issueTask.design.requirementSection")}
\`\`\`
${issue?.requirement_document?.replaceAll("`", "\\`")}
\`\`\`
`
    }

    return prompt
}, [issue, t])

  const handleConfirm = async () => {
    if (project && project.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch) {
      toast.error(t("consoleProject.issueTask.toast.branchRequired"))
      return
    }

    if (!selectedModelId) {
      toast.error(t("consoleProject.issueTask.toast.modelRequired"))
      return
    }

    setSubmitting(true)
  
    await apiRequest('v1UsersTasksCreate', {
      content: renderPrompt,
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId,
      image_id: selectImage(images, false),
      host_id: selectHost(hosts, false),
      repo: {
        branch: project?.platform === ConstsGitPlatform.GitPlatformInternal ? '' : selectedBranch,
      },
      resource: {
        core: 2,
        memory: 8 * 1024 * 1024 * 1024,
        life: 2 * 60 * 60,
      },
      extra: {
        project_id: projectId,
        issue_id: issue?.id,
      },
      task_type: ConstsTaskType.TaskTypeDesign,
      sub_type: ConstsTaskSubType.TaskSubTypeGenerateDesign,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issueTask.design.toast.started"))
        reloadProjects()
        reloadUnlinkedTasks()
        onConfirm?.()
        handleOpenChange(false)
        navigate(`/console/task/${resp.data?.id}`)
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true)
      } else {
        toast.error(resp.message || t("consoleProject.issueTask.toast.startFailed"))
      }
    })

    setSubmitting(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("consoleProject.issueTask.design.title")}</DialogTitle>
          <DialogDescription>
            {t("consoleProject.issueTask.design.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <IssueTaskProjectFields
            branches={branches}
            loadingBranches={loadingBranches}
            project={project}
            selectedBranch={selectedBranch}
            selectBranch={selectBranch}
          />
          <IssueTaskModelSelect
            models={models}
            selectedModel={selectedModel}
            selectedModelId={selectedModelId}
            setSelectedModelId={setSelectedModelId}
            subscription={subscription}
          />
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            {t("consoleProject.issueTask.design.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <TaskConcurrentLimitDialog
      open={limitDialogOpen}
      onOpenChange={setLimitDialogOpen}
    />
    </>
  )
}
