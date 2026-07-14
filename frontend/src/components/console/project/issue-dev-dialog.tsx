import { type DomainProjectIssue, type DomainProject, ConstsCliName, ConstsGitPlatform, ConstsTaskType } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"
import { IssueTaskHostSelect, IssueTaskImageSelect, IssueTaskModelSelect, IssueTaskProjectFields, useIssueTaskHostSelection, useIssueTaskImageSelection, useIssueTaskModelSelection, useProjectBranchSelection } from "./issue-task-dialog-shared"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface IssueDevelopDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onConfirm?: () => void
}

export default function IssueDevelopDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  project,
  onConfirm
}: IssueDevelopDialogProps) {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { images, models, hosts, reloadProjects, reloadUnlinkedTasks, subscription } = useCommonData()
  const { branches, loadingBranches, selectedBranch, selectBranch } = useProjectBranchSelection(open, project)
  const { selectedModel, selectedModelId, setSelectedModelId } = useIssueTaskModelSelection(open, models, subscription)
  const { selectedHostId, setSelectedHostId } = useIssueTaskHostSelection(open, hosts, selectedModel)
  const { selectedImageId, setSelectedImageId } = useIssueTaskImageSelection(open, images, project?.image_id)
  const { t } = useTranslation()

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open)
  }

  const renderPrompt = useMemo(() => {
    let prompt = t("consoleProject.issueTask.develop.promptTitle", { title: issue?.title || "" })

    if (issue?.requirement_document) {
      prompt += `

${t("consoleProject.issueTask.develop.requirementSection")}
\`\`\`
${issue?.requirement_document?.replaceAll("`", "\\`")}
\`\`\`


${t("consoleProject.issueTask.develop.designSection")}
\`\`\`
${issue?.design_document?.replaceAll("`", "\\`")}
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

    if (!selectedImageId) {
      toast.error(t("consoleProject.issueTask.toast.imageRequired"))
      return
    }

    if (!selectedHostId) {
      toast.error(t("consoleProject.issueTask.toast.hostRequired"))
      return
    }

    setSubmitting(true)
  
    await apiRequest('v1UsersTasksCreate', {
      content: renderPrompt,
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId,
      image_id: selectedImageId,
      host_id: selectedHostId,
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
      task_type: ConstsTaskType.TaskTypeDevelop,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issueTask.develop.toast.started"))
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
          <DialogTitle>{t("consoleProject.issueTask.develop.title")}</DialogTitle>
          <DialogDescription>
            {t("consoleProject.issueTask.develop.description")}
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
          <IssueTaskHostSelect
            hosts={hosts}
            selectedHostId={selectedHostId}
            selectedModel={selectedModel}
            setSelectedHostId={setSelectedHostId}
          />
          <IssueTaskImageSelect
            images={images}
            selectedImageId={selectedImageId}
            setSelectedImageId={setSelectedImageId}
          />
        </div>
        <DialogFooter className="shrink-0 border-t pt-4">
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            {t("consoleProject.issueTask.develop.start")}
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
