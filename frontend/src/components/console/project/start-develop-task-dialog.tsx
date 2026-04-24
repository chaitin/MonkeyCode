import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, ConstsOwnerType, type DomainProject, type DomainBranch } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { TASK_PROMPT_PLACEHOLDER, canUseModelBySubscription, getBrandFromModelName, getModelPricingItem, getOwnerTypeBadge, selectHost, selectImage, selectPreferredTaskModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconChevronDown, IconHelpCircle, IconSparkles } from "@tabler/icons-react"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"
import { readStoredTaskDialogParams, writeStoredTaskDialogParams } from "@/components/console/task/task-dialog-params-storage"

interface StartDevelopTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
}

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

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
  const { images, models, hosts, subscription } = useCommonData()
  const branchRequestIdRef = useRef(0)
  const branchTouchedRef = useRef(false)
  const prevOpenRef = useRef(false)
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  )
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

  const handleOpenModelPricing = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "pricing" },
    }))
  }

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
        const storedParams = readStoredTaskDialogParams()
        setUserMessage('')
        setSelectedModelId(
          storedParams.modelId
            && models.some((model) => model.id === storedParams.modelId)
            && canUseModelBySubscription(models.find((model) => model.id === storedParams.modelId), subscription)
            ? storedParams.modelId
            : selectPreferredTaskModel(models, subscription)
        )
        setSelectedBranch('main')
      }
    } else {
      prevOpenRef.current = false
      branchRequestIdRef.current += 1
    }
  }, [open, models, subscription])

  useEffect(() => {
    if (!open || !branchSourceKey) return
    fetchBranches()
  }, [open, branchSourceKey, fetchBranches])

  const handleSubmit = async () => {
    if (!userMessage.trim()) {
      toast.error('请输入任务内容')
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

    const storedParams = readStoredTaskDialogParams()
    writeStoredTaskDialogParams({
      ...storedParams,
      modelId: selectedModelId,
    })

    setSubmitting(true)

    // 创建任务
    await apiRequest('v1UsersTasksCreate', {
      content: userMessage.trim(),
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId,
      image_id: selectImage(images, false),
      host_id: selectHost(hosts, false),
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
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">
                      {selectedModel ? (
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <Icon name={getBrandFromModelName(selectedModel.model || "")} className="size-4" />
                          <span className="truncate">{selectedModel.model}</span>
                        </div>
                      ) : (
                        <span className="truncate text-muted-foreground">选择大模型</span>
                      )}
                      <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-[320px]">
                    <DropdownMenuRadioGroup value={selectedModelId} onValueChange={setSelectedModelId}>
                      {models.map((model) => (
                        (() => {
                          const showPricingSummary = model.owner?.type === ConstsOwnerType.OwnerTypePublic
                          const pricing = showPricingSummary ? getModelPricingItem(model.model) : undefined
                          const pricingTags = pricing?.tags ?? []

                          return (
                            <DropdownMenuRadioItem
                              key={model.id}
                              value={model.id || ""}
                              className="w-full justify-between gap-3 pr-2 [&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Icon name={getBrandFromModelName(model.model || "")} className="size-4" />
                                <span className="truncate">{model.model}</span>
                              </div>
                              <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
                                {showPricingSummary && pricingTags.map((tag) => (
                                  <Badge
                                    key={`${model.id}-${tag}`}
                                    variant="default"
                                    className="shrink-0 !bg-primary !text-primary-foreground"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {model.owner?.type !== ConstsOwnerType.OwnerTypePublic && getOwnerTypeBadge(model.owner)}
                              </div>
                            </DropdownMenuRadioItem>
                          )
                        })()
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="shrink-0"
                onClick={handleOpenModelPricing}
                aria-label="查看模型定价"
              >
                <IconHelpCircle className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>任务内容</Label>
            <Textarea
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              placeholder={TASK_PROMPT_PLACEHOLDER}
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
