import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, ConstsHostStatus, ConstsOwnerType, type DomainProject, type DomainBranch } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import ModelSelect from "@/components/console/task/model-select"
import { getTaskContentLimitErrorMessage, MAX_TASK_CONTENT_LENGTH } from "@/components/console/task/task-content-limit"
import { TASK_PROMPT_PLACEHOLDER, selectHost, selectImage, selectPreferredTaskModel } from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles } from "@tabler/icons-react"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
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
  const [selectedBranch, setSelectedBranch] = useState<string>('main')
  const [loadingBranches, setLoadingBranches] = useState<boolean>(false)
  const [branchFetchFailed, setBranchFetchFailed] = useState<boolean>(false)
  const [userMessage, setUserMessage] = useState<string>('')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [selectedHostId, setSelectedHostId] = useState<string>('')
  const { images, models, hosts, subscription } = useCommonData()
  const branchRequestIdRef = useRef(0)
  const branchTouchedRef = useRef(false)
  const prevOpenRef = useRef(false)
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  )
  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic
  const selectDefaultHostId = useCallback(() => {
    if (IS_OFFLINE_EDITION) {
      return hosts.find((host) => host.id && host.status === ConstsHostStatus.HostStatusOnline)?.id || ""
    }

    return selectHost(hosts, true)
  }, [hosts])
  const userMessageLength = userMessage.length
  const userMessageTooLong = userMessageLength > MAX_TASK_CONTENT_LENGTH
  const branchSourceKey = useMemo(() => {
    if (!project?.id) return ""
    return [
      project.id,
      project.platform,
      project.git_identity_id || "",
      project.full_name || "",
      project.repo_url || "",
    ].join(":")
  }, [project?.id, project?.platform, project?.git_identity_id, project?.full_name, project?.repo_url])

  const selectBranch = (branch: string) => {
    branchTouchedRef.current = true
    setSelectedBranch(branch)
  }

  const fetchBranches = useCallback(async () => {
    const requestId = ++branchRequestIdRef.current
    branchTouchedRef.current = false

    if (!project?.git_identity_id || !project?.repo_url) {
      setBranches([])
      setBranchFetchFailed(false)
      setLoadingBranches(false)
      return
    }

    // internal 平台不需要获取分支列表
    if (project.platform === ConstsGitPlatform.GitPlatformInternal) {
      setSelectedBranch('')
      setBranches([])
      setBranchFetchFailed(false)
      return
    }

    setLoadingBranches(true)
    setBranchFetchFailed(false)
    setBranches([])
    setSelectedBranch('main')
    
    try {
      // 直接使用 full_name 字段
      const escapedRepoFullName = project?.full_name || ''
      
      if (!escapedRepoFullName) {
        if (requestId === branchRequestIdRef.current) {
          setBranchFetchFailed(true)
          setLoadingBranches(false)
        }
        return
      }

      // URL 编码仓库名称
      const encodedRepoName = encodeURIComponent(escapedRepoFullName)

      await apiRequest('v1UsersGitIdentitiesBranchesDetail', {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (requestId !== branchRequestIdRef.current) return

        if (resp.code === 0 && resp.data) {
          const branchList = resp.data.map((b: DomainBranch) => b.name || '').filter(Boolean)
          setBranches(branchList)

          if (branchList.length === 0) {
            setBranchFetchFailed(true)
            if (!branchTouchedRef.current) {
              setSelectedBranch('main')
            }
            return
          }
          
          if (!branchTouchedRef.current) {
            // 优先选择 main 或 master，否则选择第一个
            if (branchList.includes('main')) {
              setSelectedBranch('main')
            } else if (branchList.includes('master')) {
              setSelectedBranch('master')
            } else if (branchList.length > 0) {
              setSelectedBranch(branchList[0])
            }
          }
        } else {
          setBranchFetchFailed(true)
          if (!branchTouchedRef.current) {
            setSelectedBranch('main')
          }
          toast.error('获取分支列表失败: ' + resp.message)
        }
      })
    } catch (error) {
      console.error('Fetch branches error:', error)
      if (requestId === branchRequestIdRef.current) {
        setBranchFetchFailed(true)
        if (!branchTouchedRef.current) {
          setSelectedBranch('main')
        }
        toast.error('获取分支列表失败')
      }
    } finally {
      if (requestId === branchRequestIdRef.current) {
        setLoadingBranches(false)
      }
    }
  }, [project?.git_identity_id, project?.repo_url, project?.platform, project?.full_name])

  useEffect(() => {
    if (open) {
      const justOpened = !prevOpenRef.current
      prevOpenRef.current = true
      if (justOpened) {
        setUserMessage('')
        setSelectedModelId(selectPreferredTaskModel(models, subscription))
        setSelectedHostId(selectDefaultHostId())
        setSelectedBranch('main')
      }
    } else {
      prevOpenRef.current = false
      branchRequestIdRef.current += 1
      setSelectedHostId('')
    }
  }, [open, models, subscription, selectDefaultHostId])

  useEffect(() => {
    if (!open) {
      return
    }

    if (!selectedHostId) {
      setSelectedHostId(selectDefaultHostId())
      return
    }

    const hostIsValid = selectedHostId === "public_host"
      ? !IS_OFFLINE_EDITION
      : hosts.some((host) => host.id === selectedHostId && host.status === ConstsHostStatus.HostStatusOnline)

    if (!hostIsValid) {
      setSelectedHostId(selectDefaultHostId())
    }
  }, [hosts, open, selectedHostId, selectDefaultHostId])

  useEffect(() => {
    if (!IS_OFFLINE_EDITION && selectedPublicModel && selectedHostId !== "public_host") {
      setSelectedHostId("public_host")
    }
  }, [selectedPublicModel, selectedHostId])

  useEffect(() => {
    if (!open || !branchSourceKey) return
    fetchBranches()
  }, [open, branchSourceKey, fetchBranches])

  const handleSubmit = async () => {
    if (!userMessage.trim()) {
      toast.error('请输入任务内容')
      return
    }

    if (userMessageTooLong) {
      toast.error(getTaskContentLimitErrorMessage())
      return
    }

    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && loadingBranches) {
      toast.error('分支列表加载中，请稍后')
      return
    }

    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch.trim()) {
      toast.error('请输入分支名称')
      return
    }

    if (!selectedModelId) {
      toast.error('请选择大模型')
      return
    }

    if (!selectedHostId) {
      toast.error('请选择宿主机')
      return
    }

    if (!IS_OFFLINE_EDITION && selectedPublicModel && selectedHostId !== "public_host") {
      toast.warning('内置模型只能在内置宿主机上使用')
      return
    }

    setSubmitting(true)

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: userMessage.trim(),
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId,
      image_id: selectImage(images, false),
      host_id: selectedHostId,
      repo: {
        branch: project?.platform === ConstsGitPlatform.GitPlatformInternal ? '' : selectedBranch.trim(),
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
      <DialogContent className="flex flex-col">
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
              {loadingBranches ? (
                <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <span>加载中...</span>
                </div>
              ) : branchFetchFailed || branches.length === 0 ? (
                <Input
                  value={selectedBranch}
                  onChange={(e) => selectBranch(e.target.value)}
                  placeholder="请输入分支名称"
                  required
                />
              ) : (
                <Select value={selectedBranch} onValueChange={selectBranch}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择分支" />
                  </SelectTrigger>
                  <SelectContent className="break-all">
                    {branches.map((branch) => (
                      <SelectItem key={branch} value={branch}>
                        {branch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label>大模型</Label>
            <ModelSelect
              models={models}
              selectedModel={selectedModel}
              selectedModelId={selectedModelId}
              setSelectedModelId={setSelectedModelId}
              subscription={subscription}
            />
          </div>
          <div className="space-y-2">
            <Label>宿主机</Label>
            <Select value={selectedHostId} onValueChange={setSelectedHostId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择宿主机" />
              </SelectTrigger>
              <SelectContent>
                {!IS_OFFLINE_EDITION && (
                  <SelectItem value="public_host">
                    <div className="flex items-center gap-2">
                      <span>MonkeyCode</span>
                      <Badge className="!text-primary-foreground">免费</Badge>
                    </div>
                  </SelectItem>
                )}
                {hosts.map((host) => (
                  <SelectItem
                    key={host.id}
                    value={host.id!}
                    disabled={host.status !== ConstsHostStatus.HostStatusOnline || (!IS_OFFLINE_EDITION && selectedPublicModel)}
                  >
                    <div className="flex items-center gap-2">
                      <span>{host.remark || `${host.name}-${host.external_ip}`}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>任务内容</Label>
            <div className="space-y-1">
              <Textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder={TASK_PROMPT_PLACEHOLDER}
                rows={4}
                className="resize-none break-all"
                aria-invalid={userMessageTooLong}
              />
              {userMessageTooLong && (
                <div className="px-1 text-xs text-destructive">
                  已超出 {userMessageLength - MAX_TASK_CONTENT_LENGTH} 字，最多 {MAX_TASK_CONTENT_LENGTH} 字，无法发送。
                </div>
              )}
            </div>
          </div>
         </div>
         
         <DialogFooter>
          <Button 
            onClick={handleSubmit}
            disabled={submitting || userMessageTooLong}
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
