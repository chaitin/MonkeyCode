import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, ConstsInterfaceType, ConstsOwnerType, type DomainModel, type DomainProject, type DomainBranch } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { getBrandFromModelName, getInterfaceTypeBadge, getModelHealthBadge, getOwnerTypeBadge, selectHost, selectImage, selectModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"

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
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false)
  const [userMessage, setUserMessage] = useState<string>('')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const { images, models, hosts } = useCommonData()

  const modelsWithEconomy = useMemo(() => {
    const economyModel = {
      id: "economy",
      model: "免费模型",
      owner: { type: "public" as const },
      is_default: false,
      interface_type: ConstsInterfaceType.InterfaceTypeOpenAIChat,
      last_check_success: true
    } as DomainModel
    return [economyModel, ...models]
  }, [models])

  const fetchBranches = async () => {
    if (!project?.git_identity_id || !project?.repo_url) {
      return
    }

    // internal 平台不需要获取分支列表
    if (project.platform === ConstsGitPlatform.GitPlatformInternal) {
      setSelectedBranch('')
      setBranches([])
      return
    }

    setLoadingBranches(true)
    
    try {
      // 直接使用 full_name 字段
      const escapedRepoFullName = project?.full_name || ''
      
      if (!escapedRepoFullName) {
        toast.error('无法获取仓库信息')
        setLoadingBranches(false)
        return
      }

      // URL 编码仓库名称
      const encodedRepoName = encodeURIComponent(escapedRepoFullName)

      await apiRequest('v1UsersGitIdentitiesBranchesDetail', {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (resp.code === 0 && resp.data) {
          const branchList = resp.data.map((b: DomainBranch) => b.name || '').filter(Boolean)
          setBranches(branchList)
          
          // 优先选择 main 或 master，否则选择第一个
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

  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (open) {
      const justOpened = !prevOpenRef.current
      prevOpenRef.current = true
      if (justOpened) {
        setUserMessage('')
        setSelectedModelId(selectModel(modelsWithEconomy, true))
      }
      fetchBranches()
    } else {
      prevOpenRef.current = false
    }
  }, [open, project, modelsWithEconomy])

  const handleSubmit = async () => {
    if (!userMessage.trim()) {
      toast.error('请输入任务内容')
      return
    }

    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch) {
      toast.error('请选择分支')
      return
    }

    setSubmitting(true)

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: userMessage.trim(),
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId || selectModel(modelsWithEconomy, true),
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
        project_id: project?.id,
      },
      task_type: ConstsTaskType.TaskTypeDevelop,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('对话任务已启动')
        onOpenChange(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>启动 AI 任务</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>项目</Label>
            <Input 
              value={project?.name || '-'} 
              readOnly 
              className="bg-muted break-all"
            />
          </div>
          {(project?.platform !== ConstsGitPlatform.GitPlatformInternal) && (
            <div className="space-y-2">
              <Label>代码仓库分支</Label>
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
                <SelectContent className="break-all">
                  {branches.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
               </Select>
             </div>
           )}
          <div className="space-y-2">
            <Label>大模型</Label>
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择大模型" />
              </SelectTrigger>
              <SelectContent>
                {modelsWithEconomy.map((model) => (
                  <SelectItem key={model.id} value={model.id || ""}>
                    {model.id === "economy" ? (
                      <img src="/logo-colored.png" className="size-4" alt="" />
                    ) : (
                      <Icon name={getBrandFromModelName(model.model || '')} className="size-4" />
                    )}
                    {getModelHealthBadge(model)}
                    {model.model}
                    {model.is_default && <Badge>默认</Badge>}
                    {model.owner?.type === ConstsOwnerType.OwnerTypePublic ? (
                      <Badge>推荐</Badge>
                    ) : (
                      getOwnerTypeBadge(model.owner)
                    )}
                    {model.id !== "economy" && getInterfaceTypeBadge(model.interface_type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>任务内容</Label>
            <Textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="请输入任务内容"
              rows={4}
              className="resize-none break-all"
            />
          </div>
         </div>
         
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
    <TaskConcurrentLimitDialog
      open={limitDialogOpen}
      onOpenChange={setLimitDialogOpen}
    />
    </>
  )
}
