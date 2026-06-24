import { ConstsCliName, ConstsTaskType, ConstsGitPlatform, ConstsHostStatus, ConstsOwnerType, type DomainProject, type DomainBranch, type DomainSkillListItem } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import ModelSelect from "@/components/console/task/model-select"
import { MAX_TASK_CONTENT_LENGTH } from "@/components/console/task/task-content-limit"
import {
  getImageShortName,
  getOSFromImageName,
  getOwnerTypeBadge,
  selectHost,
  selectImage,
  selectPreferredTaskModel,
} from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { defaultSkills } from "@/utils/config"
import { apiRequest } from "@/utils/requestUtils"
import { cn } from "@/lib/utils"
import { IconChevronDown, IconSparkles } from "@tabler/icons-react"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { TaskConcurrentLimitDialog } from "@/components/console/task/task-concurrent-limit-dialog"
import { ALL_SKILLS_TAG, TaskSkillSelector } from "@/components/console/task/task-skill-selector"
import { filterSelectableSkillIds } from "@/components/console/task/task-skill-selection"
import { useTranslation } from "react-i18next"

type DomainSkill = DomainSkillListItem & { tags?: string[] }

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
  const [selectedImageId, setSelectedImageId] = useState<string>('')
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<string[]>(defaultSkills)
  const [skillList, setSkillList] = useState<DomainSkill[]>([])
  const [activeSkillTag, setActiveSkillTag] = useState(ALL_SKILLS_TAG)
  const { images, models, hosts, subscription } = useCommonData()
  const { t } = useTranslation()
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
      const escapedRepoFullName = project?.full_name || ''
      
      if (!escapedRepoFullName) {
        if (requestId === branchRequestIdRef.current) {
          setBranchFetchFailed(true)
          setLoadingBranches(false)
        }
        return
      }

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
          toast.error(t("consoleProject.startTask.toast.fetchBranchesFailedWithMessage", { message: resp.message || t("consoleProject.common.unknownError") }))
        }
      })
    } catch (error) {
      console.error('Fetch branches error:', error)
      if (requestId === branchRequestIdRef.current) {
        setBranchFetchFailed(true)
        if (!branchTouchedRef.current) {
          setSelectedBranch('main')
        }
        toast.error(t("consoleProject.startTask.toast.fetchBranchesFailed"))
      }
    } finally {
      if (requestId === branchRequestIdRef.current) {
        setLoadingBranches(false)
      }
    }
  }, [project?.git_identity_id, project?.repo_url, project?.platform, project?.full_name, t])

  useEffect(() => {
    if (open) {
      const justOpened = !prevOpenRef.current
      prevOpenRef.current = true
      if (justOpened) {
        setUserMessage('')
        setSelectedModelId(selectPreferredTaskModel(models, subscription))
        setSelectedHostId(selectDefaultHostId())
        setSelectedImageId(selectImage(images, true))
        setSelectedBranch('main')
        setSkillPopoverOpen(false)
        setSelectedSkill(
          skillList.length > 0
            ? filterSelectableSkillIds(defaultSkills, skillList)
            : defaultSkills
        )
        setActiveSkillTag(ALL_SKILLS_TAG)
      }
    } else {
      prevOpenRef.current = false
      branchRequestIdRef.current += 1
      setSelectedHostId('')
      setSelectedImageId('')
      setSkillPopoverOpen(false)
    }
  }, [open, models, subscription, images, selectDefaultHostId, skillList])

  useEffect(() => {
    if (!open) {
      return
    }

    if (skillList.length === 0) {
      apiRequest("v1SkillsList", {}, [], (resp) => {
        if (resp.code === 0) {
          const skills = resp.data || []
          setSkillList(skills)
          setSelectedSkill((prev) => filterSelectableSkillIds(prev, skills))
        } else {
          toast.error(resp.message || t("taskWorkflow.toast.fetchSkillsFailed"))
        }
      })
      return
    }

    setSelectedSkill((prev) => filterSelectableSkillIds(prev, skillList))
  }, [open, skillList, skillList.length, t])

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
    if (!open) {
      return
    }

    if (!selectedImageId || !images.some((image) => image.id === selectedImageId)) {
      setSelectedImageId(selectImage(images, true))
    }
  }, [images, open, selectedImageId])

  useEffect(() => {
    if (!open || !branchSourceKey) return
    fetchBranches()
  }, [open, branchSourceKey, fetchBranches])

  const skillTags = useMemo(() => {
    const tagCountMap = new Map<string, number>()

    skillList.forEach((skill) => {
      (skill.tags || []).forEach((tag) => {
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1)
      })
    })

    const sortedTags = Array.from(tagCountMap.keys()).sort(
      (a, b) => (tagCountMap.get(b) || 0) - (tagCountMap.get(a) || 0)
    )

    return [ALL_SKILLS_TAG, ...sortedTags]
  }, [skillList])

  useEffect(() => {
    if (!skillTags.includes(activeSkillTag)) {
      setActiveSkillTag(skillTags[0] || ALL_SKILLS_TAG)
    }
  }, [activeSkillTag, skillTags])

  const handleSkillChange = (skillId: string, checked: boolean) => {
    if (defaultSkills.includes(skillId)) {
      return
    }

    setSelectedSkill((prev) => {
      if (checked) {
        return prev.includes(skillId) ? prev : [...prev, skillId]
      }
      return prev.filter((id) => id !== skillId)
    })
  }

  const handleSubmit = async () => {
    if (!userMessage.trim()) {
      toast.error(t("consoleProject.startTask.toast.contentRequired"))
      return
    }

    if (userMessageTooLong) {
      toast.error(t("consoleProject.startTask.toast.contentTooLong", { max: MAX_TASK_CONTENT_LENGTH }))
      return
    }

    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && loadingBranches) {
      toast.error(t("consoleProject.startTask.toast.branchesLoading"))
      return
    }

    if (project?.platform !== ConstsGitPlatform.GitPlatformInternal && !selectedBranch.trim()) {
      toast.error(t("consoleProject.startTask.toast.branchRequired"))
      return
    }

    if (!selectedModelId) {
      toast.error(t("consoleProject.startTask.toast.modelRequired"))
      return
    }

    if (!selectedHostId) {
      toast.error(t("consoleProject.startTask.toast.hostRequired"))
      return
    }

    if (!selectedImageId) {
      toast.error(t("consoleProject.startTask.toast.imageRequired"))
      return
    }

    if (!IS_OFFLINE_EDITION && selectedPublicModel && selectedHostId !== "public_host") {
      toast.warning(t("consoleProject.startTask.toast.publicModelHostOnly"))
      return
    }

    setSubmitting(true)

    await apiRequest('v1UsersTasksCreate', {
      content: userMessage.trim(),
      cli_name: ConstsCliName.CliNameOpencode,
      model_id: selectedModelId,
      image_id: selectedImageId,
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
        skill_ids: selectedSkill,
      },
      task_type: ConstsTaskType.TaskTypeDevelop,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.startTask.toast.started"))
        onOpenChange(false)
        navigate(`/console/task/${resp.data?.id}`)
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true)
      } else {
        toast.error(resp.message || t("consoleProject.startTask.toast.startFailed"))
      }
    })

    setSubmitting(false)
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("consoleProject.startTask.title")}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("consoleProject.startTask.project")}</Label>
            <Input 
              value={project?.name || '-'} 
              readOnly 
              className="bg-muted break-all"
            />
          </div>
          {(project?.platform !== ConstsGitPlatform.GitPlatformInternal) && (
            <div className="space-y-2">
              <Label>{t("consoleProject.startTask.branch")}</Label>
              {loadingBranches ? (
                <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  <span>{t("consoleProject.common.loading")}</span>
                </div>
              ) : branchFetchFailed || branches.length === 0 ? (
                <Input
                  value={selectedBranch}
                  onChange={(e) => selectBranch(e.target.value)}
                  placeholder={t("consoleProject.startTask.branchPlaceholder")}
                  required
                />
              ) : (
                <Select value={selectedBranch} onValueChange={selectBranch}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleProject.startTask.selectBranch")} />
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
          <Collapsible
            open={advancedOptionsOpen}
            onOpenChange={setAdvancedOptionsOpen}
            className="rounded-lg border"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="flex h-auto w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-transparent aria-expanded:bg-transparent"
              >
                <span className="font-medium">{t("consoleProject.startTask.advancedOptions")}</span>
                <IconChevronDown
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    advancedOptionsOpen && "rotate-180"
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 border-t px-3 py-3">
              <div className="space-y-2">
                <Label>{t("taskWorkflow.skill.label")}</Label>
                <TaskSkillSelector
                  open={skillPopoverOpen}
                  onOpenChange={setSkillPopoverOpen}
                  selectedSkills={selectedSkill}
                  skills={skillList}
                  skillTags={skillTags}
                  activeSkillTag={activeSkillTag}
                  onActiveSkillTagChange={setActiveSkillTag}
                  onSkillChange={handleSkillChange}
                  triggerClassName="w-full justify-start rounded-md"
                />
              </div>
              <div className="space-y-2">
                <Label>{t("consoleProject.startTask.model")}</Label>
                <ModelSelect
                  models={models}
                  selectedModel={selectedModel}
                  selectedModelId={selectedModelId}
                  setSelectedModelId={setSelectedModelId}
                  subscription={subscription}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("consoleProject.startTask.host")}</Label>
                <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleProject.startTask.selectHost")} />
                  </SelectTrigger>
                  <SelectContent>
                    {!IS_OFFLINE_EDITION && (
                      <SelectItem value="public_host">
                        <div className="flex items-center gap-2">
                          <span>MonkeyCode</span>
                          <Badge className="!text-primary-foreground">{t("consoleProject.startTask.free")}</Badge>
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
                <Label>{t("consoleProject.startTask.image")}</Label>
                <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleProject.startTask.selectImage")} />
                  </SelectTrigger>
                  <SelectContent>
                    {images.filter((image) => image.id).map((image) => (
                      <SelectItem key={image.id} value={image.id!}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Icon name={getOSFromImageName(image.name || "")} className="h-4 w-4" />
                              <span>{image.remark || getImageShortName(image.name || "")}</span>
                              {getOwnerTypeBadge(image.owner)}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right">{image.name}</TooltipContent>
                        </Tooltip>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-2">
            <Label>{t("consoleProject.startTask.content")}</Label>
            <div className="space-y-1">
              <Textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                placeholder={t("consoleProject.startTask.contentPlaceholder")}
                rows={4}
                className="resize-none break-all"
                aria-invalid={userMessageTooLong}
              />
              {userMessageTooLong && (
                <div className="px-1 text-xs text-destructive">
                  {t("consoleProject.startTask.contentTooLong", {
                    over: userMessageLength - MAX_TASK_CONTENT_LENGTH,
                    max: MAX_TASK_CONTENT_LENGTH,
                  })}
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
            {t("consoleProject.startTask.start")}
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
