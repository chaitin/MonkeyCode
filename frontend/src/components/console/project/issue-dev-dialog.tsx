import { type DomainProjectIssue, type DomainProject, ConstsCliName, ConstsGitPlatform, ConstsTaskType, type DomainBranch } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { selectHost, selectImage, selectPreferredTaskModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"
import { toast } from "sonner"

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
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false)
  const { images, models, hosts, reloadProjects, reloadUnlinkedTasks, subscription } = useCommonData()

  const fetchBranches = async () => {
    if (!project?.git_identity_id || !project?.repo_url) {
      return
    }

    if (project.platform === ConstsGitPlatform.GitPlatformInternal) {
      setSelectedBranch('')
      setBranches([])
      return
    }

    setLoadingBranches(true)
    try {
      const escapedRepoFullName = project?.full_name || ''
      if (!escapedRepoFullName) {
        toast.error('无法获取仓库信息')
        setLoadingBranches(false)
        return
      }
      const encodedRepoName = encodeURIComponent(escapedRepoFullName)
      await apiRequest('v1UsersGitIdentitiesBranchesDetail', {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (resp.code === 0 && resp.data) {
          const branchList = resp.data.map((b: DomainBranch) => b.name || '').filter(Boolean)
          setBranches(branchList)
          if (branchList.includes('main')) {
            setSelectedBranch('main')
          } else if (branchList.includes('master')) {
            setSelectedBranch('master')
          } else if (branchList.length > 0) {
            setSelectedBranch(branchList[0])
          }
        } else {
          toast.error('获取分支列表失败: ' + resp.message)
        }
      })
    } catch (error) {
      console.error('Fetch branches error:', error)
      toast.error('获取分支列表失败')
    } finally {
      setLoadingBranches(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchBranches()
    }
  }, [open, project])

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
    if (project && project.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch) {
      toast.error('请选择分支')
      return
    }

    const preferredModelId = selectPreferredTaskModel(models, subscription)
    if (!preferredModelId) {
      toast.error('未找到可用的大模型')
      return
    }

    setSubmitting(true)
  
    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: renderPrompt,
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: preferredModelId,
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
      task_type: ConstsTaskType.TaskTypeDevelop,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('开发任务已启动')
        reloadProjects()
        reloadUnlinkedTasks()
        onConfirm?.()
        handleOpenChange(false)
        navigate(`/console/task/${resp.data?.id}`)
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true)
      } else {
        toast.error(resp.message || '任务启动失败')
      }
    })

    setSubmitting(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>开发任务 (AI)</DialogTitle>
          <DialogDescription>
            AI 将根据需求和技术方案自动生成开发任务
          </DialogDescription>
        </DialogHeader>
        {project && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>项目</Label>
              <Input value={project?.name || '-'} readOnly className="bg-muted" />
            </div>
            <div className="space-y-2">
              <Label>仓库地址</Label>
              <Input value={project?.repo_url || '-'} readOnly className="bg-muted" />
            </div>
          </div>
        )}
        {project && project.platform !== ConstsGitPlatform.GitPlatformInternal && (
          <div className="space-y-2">
            <Label>选择分支</Label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={loadingBranches || branches.length === 0}>
              <SelectTrigger className="w-full">
                {loadingBranches ? (
                  <div className="flex items-center gap-2">
                    <Spinner className="size-4" />
                    <span>加载中...</span>
                  </div>
                ) : (
                  <SelectValue placeholder="请选择分支" />
                )}
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? <Spinner /> : <IconSparkles className="size-4" />}
            开始开发
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
