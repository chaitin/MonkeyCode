import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, type DomainProject, type DomainBranch } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { selectHost, selectImage, selectModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
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
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false)
  const [userMessage, setUserMessage] = useState<string>('')
  const { images, models, hosts } = useCommonData()

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

  useEffect(() => {
    if (open) {
      fetchBranches()
      setUserMessage('')
    }
  }, [open, project])

  const handleSubmit = async () => {
    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch) {
      toast.error('请选择分支')
      return
    }

    setSubmitting(true)

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: userMessage.trim(),
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectModel(models, false),
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
          <DialogTitle>启动 AI 任务</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>项目</Label>
            <Input 
              value={project?.name || '-'} 
              readOnly 
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label>仓库地址</Label>
            <Input 
              value={project?.repo_url || '-'} 
              readOnly 
              className="bg-muted"
            />
          </div>
          {(project?.platform !== ConstsGitPlatform.GitPlatformInternal) && (
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
          <div className="space-y-2">
            <Label>任务内容</Label>
            <Textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder="请输入任务内容"
              rows={4}
              className="resize-none"
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
  )
}
