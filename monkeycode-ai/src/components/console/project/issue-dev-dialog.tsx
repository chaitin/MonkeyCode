import { type DomainProjectIssue, ConstsCliName, ConstsTaskType } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { selectHost, selectImage, selectModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

interface IssueDevelopDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: DomainProjectIssue
  projectId: string
  onConfirm?: () => void
}

export default function IssueDevelopDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  onConfirm
}: IssueDevelopDialogProps) {
  const [submitting, setSubmitting] = useState<boolean>(false)
  const { images, models, hosts } = useCommonData()

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open)
  }

  const renderPrompt = useMemo(() => {
    let prompt = `为需求 "${issue?.title}" 执行开发任务`

    if (issue?.requirement_document) {
      prompt += `

详细描述如下:
\`\`\`
${issue?.requirement_document?.replaceAll("`", "\\`")}
\`\`\`


技术方案如下:
\`\`\`
${issue?.design_document?.replaceAll("`", "\\`")}
\`\`\`
`
    }

    return prompt
}, [issue])

  const handleConfirm = async () => {
    setSubmitting(true)
  
    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: renderPrompt,
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectModel(models, false),
      image_id: selectImage(images, false),
      host_id: selectHost(hosts, false),
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
        toast.success('开发任务已启动')
        onConfirm?.()
        handleOpenChange(false)
        window.open(`/console/task/develop/${resp.data?.id}`, "_blank")
      } else {
        toast.error(resp.message || '任务启动失败')
      }
    })

    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>开发任务 (AI)</DialogTitle>
          <DialogDescription>
            AI 将根据需求和技术方案自动生成开发任务
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            开始开发
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
