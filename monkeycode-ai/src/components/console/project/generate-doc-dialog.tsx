import { ConstsCliName, ConstsTaskSubType, ConstsTaskType } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { packAndUploadFilesAsZip, selectHost, selectImage, selectModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

interface GenerateDocDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
}

export default function GenerateDocDialog({
  open,
  onOpenChange,
  projectId,
  projectName
}: GenerateDocDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState<boolean>(false)
  const { images, models, hosts } = useCommonData()

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open)
    if (!open) {
      // 重置表单状态
      setSelectedFiles([])
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)

    let repoInfo: { zip_url?: string; repo_filename?: string } = {}
    
    if (selectedFiles.length > 0) {
      try {
        const { accessUrl, filename } = await packAndUploadFilesAsZip(selectedFiles)
        repoInfo = {
          zip_url: accessUrl,
          repo_filename: filename,
        }
      } catch (error) {
        toast.error((error as Error).message)
        setSubmitting(false)
        return
      }
    }

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: `为项目 "${projectName}" 生成设计文档`,
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectModel(models, false),
      image_id: selectImage(images, false),
      host_id: selectHost(hosts, false),
      repo: repoInfo,
      resource: {
        core: 2,
        memory: 8 * 1024 * 1024 * 1024,
        life: 2 * 60 * 60,
      },
      extra: {
        project_id: projectId,
      },
      task_type: ConstsTaskType.TaskTypeDesign,
      sub_type: ConstsTaskSubType.TaskSubTypeGenerateDocs,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('文档生成任务已启动')
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
          <DialogTitle>生成项目文档</DialogTitle>
          <DialogDescription>
            AI 将根据你的需求为你生成项目架构设计文档
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button 
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            生成文档
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

