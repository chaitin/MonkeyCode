import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, ConstsHostStatus, ConstsOwnerType, type DomainProject, type DomainBranch, type DomainTeamSkill } from "@/api/Api"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import ModelSelect from "@/components/console/task/model-select"
import { getTaskContentLimitErrorMessage, MAX_TASK_CONTENT_LENGTH } from "@/components/console/task/task-content-limit"
import { TASK_PROMPT_PLACEHOLDER, selectHost, selectImage, selectPreferredTaskModel } from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { apiRequest } from "@/utils/requestUtils"
import { IconSparkles, IconWand } from "@tabler/icons-react"
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
  const [skills, setSkills] = useState<DomainTeamSkill[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
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
        setSelectedSkillIds([])
      }
    } else {
      prevOpenRef.current = false
      branchRequestIdRef.current += 1
      setSelectedHostId('')
    }
  }, [open, models, subscription, selectDefaultHostId])

  // 拉用户当前 team 下可见的 skill 列表（PackageURL 为 1h TTL 预签名 URL）
  // 直接 fetch 是因为 Api.ts 的 v1SkillsList 类型还是旧契约，这里不想触发生成器重跑
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/v1/skills', { credentials: 'include' })
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return
        if (body?.code === 0) {
          setSkills(body.data?.skills || [])
        } else {
          setSkills([])
        }
      })
      .catch(() => {
        if (!cancelled) setSkills([])
      })
    return () => { cancelled = true }
  }, [open])

  const toggleSkill = (id: string, checked: boolean) => {
    setSelectedSkillIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id]
      return prev.filter((x) => x !== id)
    })
  }

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
        skill_ids: selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
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
            <Label>Skills <span className="text-xs text-muted-foreground">(测试用)</span></Label>
            <Popover open={skillPopoverOpen} onOpenChange={setSkillPopoverOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-start">
                  <IconWand className="size-4" />
                  {selectedSkillIds.length > 0
                    ? `已选 ${selectedSkillIds.length} 个 Skill`
                    : '选择 Skill'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-2">
                {skills.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">暂无可用 Skill</div>
                ) : (
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {skills.map((s) => {
                      const id = s.id || ''
                      const checked = selectedSkillIds.includes(id)
                      return (
                        <label
                          key={id}
                          className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-accent"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleSkill(id, !!v)}
                            className="mt-0.5"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{s.name}</div>
                            {s.description && (
                              <div className="text-xs text-muted-foreground line-clamp-2">{s.description}</div>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
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
