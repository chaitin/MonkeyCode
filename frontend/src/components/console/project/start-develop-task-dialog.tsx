import { ConstsCliName, ConstsTaskType, type DomainProject } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { selectHost, selectImage, selectModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

interface StartDevelopTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
}

export default function StartDevelopTaskDialog({
  open,
  onOpenChange,
  project
}: StartDevelopTaskDialogProps) {
  const [submitting, setSubmitting] = useState<boolean>(false)
  const { images, models, hosts } = useCommonData()

  const handleSubmit = async () => {
    setSubmitting(true)

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: `你好，MonkeyCode`,
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
        project_id: project?.id,
      },
      task_type: ConstsTaskType.TaskTypeDevelop,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('对话任务已启动')
        onOpenChange(false)
        window.open(`/console/task/view?taskId=${resp.data?.id}`, "_blank")
      } else {
        toast.error(resp.message || '任务启动失败')
      }
    })

    setSubmitting(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发起对话</DialogTitle>
          <DialogDescription>
            与 AI 对话，对项目 "{project?.name}" 进行操作
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button 
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            开始对话
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
