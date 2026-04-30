import {
  Api,
  ConstsCliName,
  ConstsGitPlatform,
  ConstsHostStatus,
  ConstsOwnerType,
  ConstsTaskSubType,
  ConstsTaskType,
  ConstsUserRole,
  type DomainAuthRepository,
  type DomainGitIdentity,
  type DomainSkill,
} from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSettingsDialog } from "@/pages/console/user/page"
import { defaultSkills } from "@/utils/config"
import {
  canUseModelBySubscription,
  getBrandFromModelName,
  getGitPlatformIcon,
  getHostBadges,
  getImageShortName,
  getModelPricingItem,
  getOSFromImageName,
  getOwnerTypeBadge,
  getRepoIcon,
  getRepoNameFromUrl,
  getSkillTagIcon,
  TASK_PROMPT_PLACEHOLDER,
  selectHost,
  selectImage,
  selectPreferredTaskModel,
} from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { readStoredTaskDialogParams, writeStoredTaskDialogParams } from "./task-dialog-params-storage"
import {
  IconBug,
  IconChevronDown,
  IconHelpCircle,
  IconLink,
  IconPuzzle,
  IconReload,
  IconSourceCode,
  IconTerminal2,
  IconUpload,
  IconUser,
  IconVocabulary,
  IconXboxX,
} from "@tabler/icons-react"
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { TaskConcurrentLimitDialog } from "./task-concurrent-limit-dialog"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

interface CreateDefaultTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SkillItemProps {
  skill: DomainSkill
  selectedSkills: string[]
  onSkillChange: (skillId: string, checked: boolean) => void
}

interface RepoOption {
  gitIdentityId: string
  username: string
  repository: DomainAuthRepository
}

function SkillItem({ skill, selectedSkills, onSkillChange }: SkillItemProps) {
  if (!skill.id) {
    return null
  }

  const isChecked = selectedSkills.includes(skill.id)

  return (
    <div
      className="flex cursor-pointer flex-row items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
      onClick={() => onSkillChange(skill.id!, !isChecked)}
    >
      <Checkbox checked={isChecked} disabled={defaultSkills.includes(skill.id)} />
      <div className="min-w-0">
        <div className="text-sm">{skill.name}</div>
        <div className="line-clamp-1 break-all text-xs text-muted-foreground">
          {skill.description}
        </div>
      </div>
    </div>
  )
}

function isIdentityWithRepos(identity: DomainGitIdentity): boolean {
  return [
    ConstsGitPlatform.GitPlatformGithub,
    ConstsGitPlatform.GitPlatformGitee,
    ConstsGitPlatform.GitPlatformGitea,
    ConstsGitPlatform.GitPlatformGitLab,
  ].includes(identity.platform as ConstsGitPlatform)
}

export default function CreateDefaultTaskDialog({
  open,
  onOpenChange,
}: CreateDefaultTaskDialogProps) {
  const navigate = useNavigate()
  const { projects, unlinkedTasks, identities, models, hosts, images, user, subscription, reloadProjects, reloadUnlinkedTasks } = useCommonData()
  const { setOpen: setSettingsOpen } = useSettingsDialog()

  const [content, setContent] = useState("")
  const [taskType, setTaskType] = useState<ConstsTaskType>(ConstsTaskType.TaskTypeDevelop)
  const [taskTypePopoverOpen, setTaskTypePopoverOpen] = useState(false)
  const [codeDropdownOpen, setCodeDropdownOpen] = useState(false)
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [selectedRepo, setSelectedRepo] = useState("")
  const [selectedRepoDisplayName, setSelectedRepoDisplayName] = useState("")
  const [selectedRepoFromMyRepos, setSelectedRepoFromMyRepos] = useState(false)
  const [reposByIdentity, setReposByIdentity] = useState<Record<string, RepoOption[]>>({})
  const [loadingByIdentity, setLoadingByIdentity] = useState<Record<string, boolean>>({})
  const [identitySearch, setIdentitySearch] = useState<Record<string, string>>({})
  const [selectedSkill, setSelectedSkill] = useState<string[]>(defaultSkills)
  const [skillList, setSkillList] = useState<DomainSkill[]>([])
  const [activeSkillTag, setActiveSkillTag] = useState("全部")
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState("")
  const [selectedHostId, setSelectedHostId] = useState("")
  const [selectedImageId, setSelectedImageId] = useState("")
  const [selectedIdentityId, setSelectedIdentityId] = useState("")
  const [branch, setBranch] = useState("")
  const [creatingTask, setCreatingTask] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectableIdentities = useMemo(
    () => identities.filter(isIdentityWithRepos),
    [identities]
  )

  const repoCandidates = useMemo(() => {
    const repos = [
      ...projects.map((project) => project.repo_url || ""),
      ...unlinkedTasks.map((task) => task.repo_url || ""),
    ].filter(Boolean)

    return repos.filter((repo, index, arr) => arr.indexOf(repo) === index)
  }, [projects, unlinkedTasks])

  useEffect(() => {
    if (!open) {
      setContent("")
      setTaskType(ConstsTaskType.TaskTypeDevelop)
      setTaskTypePopoverOpen(false)
      setCodeDropdownOpen(false)
      setSkillPopoverOpen(false)
      setSearchInput("")
      setSelectedRepo("")
      setSelectedRepoDisplayName("")
      setSelectedRepoFromMyRepos(false)
      setSelectedZipFile(null)
      setIdentitySearch({})
      setSelectedSkill(defaultSkills)
      setActiveSkillTag("全部")
      setAdvancedOptionsOpen(false)
      setSelectedModelId("")
      setSelectedHostId("")
      setSelectedImageId("")
      setSelectedIdentityId("")
      setBranch("")
      return
    }

    if (skillList.length > 0) {
      return
    }

    apiRequest("v1SkillsList", {}, [], (resp) => {
      if (resp.code === 0) {
        setSkillList(resp.data || [])
      } else {
        toast.error(resp.message || "获取技能列表失败")
      }
    })
  }, [open, skillList.length])

  useEffect(() => {
    if (!open) {
      return
    }

    setDefaultConfig()
  }, [open])

  useEffect(() => {
    const matchedIdentities = identities.filter((identity) => {
      return selectedRepo.startsWith(identity.base_url || "")
    })
    const userChoiceStillValid =
      selectedIdentityId === "none" || matchedIdentities.some((identity) => identity.id === selectedIdentityId)

    if (!userChoiceStillValid) {
      setSelectedIdentityId(matchedIdentities[0]?.id || "none")
    }
  }, [selectedRepo, identities, selectedIdentityId])

  const loadReposForAllIdentities = async (flush = false, targetIdentityId?: string) => {
    const targetIdentities = selectableIdentities.filter((identity) => {
      if (!identity.id) {
        return false
      }
      return targetIdentityId ? identity.id === targetIdentityId : true
    })

    if (targetIdentities.length === 0) {
      return
    }

    setLoadingByIdentity((prev) => {
      const next = { ...prev }
      targetIdentities.forEach((identity) => {
        if (identity.id) {
          next[identity.id] = true
        }
      })
      return next
    })

    if (!targetIdentityId) {
      setReposByIdentity({})
    }

    const nextRepos: Record<string, RepoOption[]> = {}
    const nextLoading: Record<string, boolean> = {}

    for (const identity of targetIdentities) {
      const identityId = identity.id
      if (!identityId) {
        continue
      }

      await new Promise<void>((resolve) => {
        apiRequest(
          "v1UsersGitIdentitiesDetail",
          flush ? { flush: true } : {},
          [identityId],
          (detailResp) => {
            if (detailResp.code !== 0) {
              nextLoading[identityId] = false
              resolve()
              return
            }

            const authorizedRepositories = detailResp.data?.authorized_repositories || []
            nextRepos[identityId] = authorizedRepositories
              .filter((repo: DomainAuthRepository) => !!repo.url?.trim())
              .map((repo: DomainAuthRepository) => ({
                gitIdentityId: identityId,
                username: identity.username || "未命名身份",
                repository: repo,
              }))
            nextLoading[identityId] = false
            resolve()
          },
          () => {
            nextLoading[identityId] = false
            resolve()
          }
        )
      })
    }

    setReposByIdentity((prev) => ({ ...prev, ...nextRepos }))
    setLoadingByIdentity((prev) => ({ ...prev, ...nextLoading }))
  }

  const skillTags = useMemo(() => {
    const tagCountMap = new Map<string, number>()

    skillList.forEach((skill) => {
      ;(skill.tags || []).forEach((tag) => {
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1)
      })
    })

    const sortedTags = Array.from(tagCountMap.keys()).sort(
      (a, b) => (tagCountMap.get(b) || 0) - (tagCountMap.get(a) || 0)
    )

    return ["全部", ...sortedTags]
  }, [skillList])

  useEffect(() => {
    if (!skillTags.includes(activeSkillTag)) {
      setActiveSkillTag(skillTags[0] || "全部")
    }
  }, [activeSkillTag, skillTags])

  const handleSkillChange = (skillId: string, checked: boolean) => {
    if (defaultSkills.includes(skillId)) {
      return
    }

    setSelectedSkill((prev) => {
      if (checked) {
        return [...prev, skillId]
      }
      return prev.filter((id) => id !== skillId)
    })
  }

  const setDefaultConfig = () => {
    const storedParams = readStoredTaskDialogParams()
    const defaultModelId = selectPreferredTaskModel(models, subscription)
    const nextModelId = (
      storedParams.modelId
      && models.some((model) => model.id === storedParams.modelId)
      && canUseModelBySubscription(models.find((model) => model.id === storedParams.modelId), subscription)
    )
      ? storedParams.modelId
      : defaultModelId

    setSelectedModelId(nextModelId)

    if (user.role === ConstsUserRole.UserRoleSubAccount) {
      const nextHostId = (
        storedParams.hostId === "public_host"
        || hosts.some((host) => host.id === storedParams.hostId && host.status === ConstsHostStatus.HostStatusOnline)
      )
        ? (storedParams.hostId || "public_host")
        : selectHost(hosts, true)
      const nextImageId = (
        storedParams.imageId
        && images.some((image) => image.id === storedParams.imageId)
      )
        ? storedParams.imageId
        : selectImage(images, true)

      setSelectedHostId(nextHostId)
      setSelectedImageId(nextImageId)
      return
    }

    setSelectedHostId(selectHost(hosts, false))
    setSelectedImageId(selectImage(images, false))
  }

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  )
  const handleOpenModelPricing = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "pricing" },
    }))
  }
  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic
  const showRepoAdvancedOptions = Boolean(selectedRepo && !selectedRepoDisplayName.endsWith(".zip"))
  const showEnvironmentAdvancedOptions = user.role === ConstsUserRole.UserRoleSubAccount
  const showAdvancedOptions = showRepoAdvancedOptions || showEnvironmentAdvancedOptions

  useEffect(() => {
    if (selectedPublicModel && selectedHostId && selectedHostId !== "public_host") {
      setSelectedHostId("public_host")
    }
  }, [selectedPublicModel, selectedHostId])

  useEffect(() => {
    if (!showAdvancedOptions) {
      setAdvancedOptionsOpen(false)
    }
  }, [showAdvancedOptions])

  const handleConfirmExecute = () => {
    void executeTask()
  }

  const executeTask = async () => {
    if (!content.trim()) {
      toast.error("请输入任务内容")
      return
    }

    if (!selectedModelId) {
      toast.error("请选择大模型")
      return
    }

    if (!selectedRepoDisplayName.endsWith(".zip") && selectedRepo && !selectedIdentityId) {
      setSelectedIdentityId("none")
    }

    if (selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic && selectedHostId !== "public_host") {
      toast.warning("内置模型只能在内置宿主机上使用")
      return
    }

    const storedParams = readStoredTaskDialogParams()
    writeStoredTaskDialogParams({
      modelId: selectedModelId,
      hostId: user.role === ConstsUserRole.UserRoleSubAccount ? selectedHostId : storedParams.hostId,
      imageId: user.role === ConstsUserRole.UserRoleSubAccount ? selectedImageId : storedParams.imageId,
    })

    let zipUrl = selectedRepo
    if (selectedZipFile) {
      setCreatingTask(true)
      try {
        const api = new Api()
        const presignResponse = await api.api.v1UploaderPresignCreate({
          filename: selectedZipFile.name,
        })

        if (presignResponse.data?.code !== 0 || !presignResponse.data?.data) {
          toast.error("获取上传地址失败: " + (presignResponse.data?.message || "未知错误"))
          setCreatingTask(false)
          return
        }

        const { upload_url, access_url } = presignResponse.data.data

        if (!upload_url || !access_url) {
          toast.error("获取上传地址失败: 返回数据不完整")
          setCreatingTask(false)
          return
        }

        const uploadResponse = await fetch(upload_url, {
          method: "PUT",
          body: selectedZipFile,
        })

        if (!uploadResponse.ok) {
          toast.error("文件上传失败: " + uploadResponse.statusText)
          setCreatingTask(false)
          return
        }

        zipUrl = access_url
      } catch (error) {
        toast.error("上传失败: " + (error as Error).message)
        setCreatingTask(false)
        return
      }
    } else {
      setCreatingTask(true)
    }

    await apiRequest("v1UsersTasksCreate", {
      cli_name: ConstsCliName.CliNameOpencode,
      content: content.trim(),
      git_identity_id: (selectedIdentityId && selectedIdentityId !== "none") ? selectedIdentityId : undefined,
      host_id: selectedHostId,
      image_id: selectedImageId,
      model_id: selectedModelId,
      task_type: taskType,
      sub_type: taskType === ConstsTaskType.TaskTypeDesign ? ConstsTaskSubType.TaskSubTypeGenerateRequirement : undefined,
      repo: selectedRepoDisplayName.endsWith(".zip") ? {
        zip_url: zipUrl,
        repo_filename: selectedRepoDisplayName,
      } : {
        repo_url: selectedRepo || undefined,
        branch: branch || undefined,
      },
      extra: {
        skill_ids: selectedSkill,
      },
      resource: {
        core: 2,
        memory: 8 * 1024 * 1024 * 1024,
        life: 3 * 60 * 60,
      },
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("任务启动成功")
        reloadProjects()
        reloadUnlinkedTasks()
        onOpenChange(false)
        navigate(`/console/task/${resp.data?.id}`)
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true)
      } else {
        toast.error(resp.message || "任务启动失败")
      }
    })

    setCreatingTask(false)
  }

  const handleZipFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      return
    }

    e.target.value = ""

    if (!file.name.endsWith(".zip")) {
      toast.error("请选择 ZIP 格式的文件")
      return
    }

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      toast.error("文件大小不能超过 10MB")
      return
    }

    setSelectedZipFile(file)
    setSelectedRepo(`local-upload://${file.name}`)
    setSelectedRepoDisplayName(file.name)
    setSelectedRepoFromMyRepos(false)
    setCodeDropdownOpen(false)
    toast.success("ZIP 文件已选择，后续再接实际上传")
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建任务</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={handleZipFileSelect}
          />
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={TASK_PROMPT_PLACEHOLDER}
            className="min-h-36 resize-none"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Popover open={taskTypePopoverOpen} onOpenChange={setTaskTypePopoverOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="rounded-md text-primary hover:text-primary">
                  {taskType === ConstsTaskType.TaskTypeDevelop && <><IconTerminal2 /><span>开发</span></>}
                  {taskType === ConstsTaskType.TaskTypeDesign && <><IconVocabulary /><span>设计</span></>}
                  {taskType === ConstsTaskType.TaskTypeReview && <><IconBug /><span>审查</span></>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0" align="start">
                <Command>
                  <CommandList>
                    <CommandGroup>
                      <CommandItem
                        value={ConstsTaskType.TaskTypeDevelop}
                        onSelect={() => {
                          setTaskType(ConstsTaskType.TaskTypeDevelop)
                          setTaskTypePopoverOpen(false)
                        }}
                      >
                        <div className="flex flex-row items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-full bg-accent">
                            <IconTerminal2 className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col">
                            <div className="font-bold">开发</div>
                            <div className="text-xs text-muted-foreground">根据需求执行开发编码任务</div>
                          </div>
                        </div>
                      </CommandItem>
                      <CommandItem
                        value={ConstsTaskType.TaskTypeDesign}
                        onSelect={() => {
                          setTaskType(ConstsTaskType.TaskTypeDesign)
                          setTaskTypePopoverOpen(false)
                        }}
                      >
                        <div className="flex flex-row items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-full bg-accent">
                            <IconVocabulary className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col">
                            <div className="font-bold">设计</div>
                            <div className="text-xs text-muted-foreground">进行架构设计，输出技术方案与设计文档</div>
                          </div>
                        </div>
                      </CommandItem>
                      <CommandItem
                        value={ConstsTaskType.TaskTypeReview}
                        onSelect={() => {
                          setTaskType(ConstsTaskType.TaskTypeReview)
                          setTaskTypePopoverOpen(false)
                        }}
                      >
                        <div className="flex flex-row items-center gap-2">
                          <div className="flex size-8 items-center justify-center rounded-full bg-accent">
                            <IconBug className="size-5 text-foreground" />
                          </div>
                          <div className="flex flex-col">
                            <div className="font-bold">审查</div>
                            <div className="text-xs text-muted-foreground">审查代码，识别风险，提出改进建议</div>
                          </div>
                        </div>
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            <DropdownMenu
              open={codeDropdownOpen}
              onOpenChange={(nextOpen) => {
                setCodeDropdownOpen(nextOpen)
                if (nextOpen) {
                  loadReposForAllIdentities()
                  setIdentitySearch({})
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "max-w-[240px] rounded-md",
                    selectedRepo && "text-primary hover:text-primary"
                  )}
                >
                  <IconSourceCode />
                  <span className="line-clamp-1 break-all text-ellipsis">
                    {selectedRepo
                      ? selectedRepoDisplayName || getRepoNameFromUrl(selectedRepo)
                      : "代码"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {selectedRepo && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSelectedRepo("")
                      setSelectedRepoDisplayName("")
                      setSelectedRepoFromMyRepos(false)
      setSelectedZipFile(null)
                    }}
                  >
                    <IconXboxX className="size-4" />
                    清空选择
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <IconUpload className="size-4" />
                  ZIP 文件
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconUser className="size-4" />
                    我的仓库
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="min-w-[220px] p-0">
                      {selectableIdentities.length === 0 ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <span className="text-sm text-muted-foreground">尚未绑定 Git 账号，请先绑定</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCodeDropdownOpen(false)
                              setSettingsOpen(true)
                            }}
                          >
                            去设置
                          </Button>
                        </div>
                      ) : (
                        selectableIdentities.map((identity) => {
                          const identityId = identity.id || ""
                          const repos = reposByIdentity[identityId] || []
                          const isLoading = loadingByIdentity[identityId]
                          const search = identitySearch[identityId] ?? ""
                          const identityLabel =
                            identity.remark || identity.username || identity.base_url || "未命名身份"
                          const filteredRepos = repos.filter((option) => {
                            const kw = search.trim().toLowerCase()
                            if (!kw) {
                              return true
                            }

                            const name = (option.repository.full_name || option.repository.url || "").toLowerCase()
                            const desc = (option.repository.description || "").toLowerCase()
                            const user = (option.username || "").toLowerCase()
                            return name.includes(kw) || desc.includes(kw) || user.includes(kw)
                          })

                          return (
                            <DropdownMenuSub key={identityId}>
                              <DropdownMenuSubTrigger className="w-full">
                                {getGitPlatformIcon(identity.platform)}
                                <span className="truncate">{identityLabel}</span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuPortal>
                                <DropdownMenuSubContent className="max-h-[320px] min-w-[380px] overflow-y-auto p-0">
                                  <div className="flex flex-col bg-popover p-2">
                                    <div className="flex items-center gap-2">
                                      <Input
                                        placeholder="搜索仓库..."
                                        className="min-w-0 text-sm"
                                        value={search}
                                        onChange={(e) => {
                                          setIdentitySearch((prev) => ({
                                            ...prev,
                                            [identityId]: e.target.value,
                                          }))
                                        }}
                                        onKeyDown={(e) => e.stopPropagation()}
                                      />
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="outline"
                                        className="shrink-0"
                                        disabled={isLoading}
                                        aria-label="刷新仓库列表"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          void loadReposForAllIdentities(true, identityId)
                                        }}
                                      >
                                        <IconReload className={cn("size-4", isLoading && "animate-spin")} />
                                      </Button>
                                    </div>
                                    <Separator className="my-2" />
                                    <div className="grid max-h-[240px] gap-2 overflow-y-auto">
                                      {isLoading ? (
                                        <Empty className="border border-dashed">
                                          <EmptyHeader>
                                            <EmptyMedia variant="icon">
                                              <Spinner className="size-5" />
                                            </EmptyMedia>
                                            <EmptyDescription>加载中...</EmptyDescription>
                                          </EmptyHeader>
                                        </Empty>
                                      ) : repos.length === 0 ? (
                                        <div className="py-6 text-center text-sm text-muted-foreground">
                                          没有仓库
                                        </div>
                                      ) : filteredRepos.length === 0 ? (
                                        <div className="py-6 text-center text-sm text-muted-foreground">
                                          {search.trim() ? "未找到匹配的仓库" : null}
                                        </div>
                                      ) : (
                                        filteredRepos.map((option) => {
                                          const repoUrl = option.repository.url?.trim() || ""
                                          if (!repoUrl) {
                                            return null
                                          }

                                          const repoName = (
                                            option.repository.full_name || repoUrl
                                          ).replace(`${option.username}/`, "")

                                          return (
                                            <DropdownMenuItem
                                              key={`${option.gitIdentityId}:${repoUrl}`}
                                              onSelect={() => {
                                                setSelectedRepo(repoUrl)
                                                setSelectedRepoDisplayName(repoName)
                                                setSelectedRepoFromMyRepos(true)
                                                setSelectedZipFile(null)
                                                setSelectedIdentityId(option.gitIdentityId)
                                              }}
                                              className="flex min-w-0 max-w-full flex-col items-start gap-0.5 py-1"
                                            >
                                              <div className="flex w-full min-w-0 max-w-[320px] items-center gap-2">
                                                {getRepoIcon(repoUrl)}
                                                <span className="flex-1 truncate text-sm" title={repoName}>
                                                  {repoName}
                                                </span>
                                              </div>
                                              <span
                                                className="w-full max-w-[400px] truncate pl-6 text-xs text-muted-foreground"
                                                title={option.repository.description || undefined}
                                              >
                                                {option.repository.description || "暂无描述"}
                                              </span>
                                            </DropdownMenuItem>
                                          )
                                        })
                                      )}
                                    </div>
                                  </div>
                                </DropdownMenuSubContent>
                              </DropdownMenuPortal>
                            </DropdownMenuSub>
                          )
                        })
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconLink className="size-4" />
                    其他仓库
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="p-2">
                      <Input
                        placeholder="输入代码仓库地址，按回车键确认"
                        className="w-full text-sm"
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === "Enter") {
                            try {
                              new URL(searchInput)
                              setSelectedRepo(searchInput)
                              setSelectedRepoDisplayName("")
                            } catch {
                              toast.error("请输入正确的仓库地址")
                            }
                          }
                        }}
                      />
                      <Separator className="my-2" />
                      {repoCandidates
                        .filter((repo) => repo.includes(searchInput))
                        .map((repo) => (
                          <DropdownMenuItem
                            key={repo}
                            onSelect={() => {
                              setSelectedRepo(repo)
                              setSelectedRepoDisplayName("")
                              setSelectedRepoFromMyRepos(false)
                              setSelectedZipFile(null)
                            }}
                          >
                            {getRepoIcon(repo)}
                            {repo}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover open={skillPopoverOpen} onOpenChange={setSkillPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "rounded-md",
                    selectedSkill.length > 0 && "text-primary hover:text-primary"
                  )}
                >
                  <IconPuzzle />
                  <span>{selectedSkill.length > 0 ? `${selectedSkill.length} 个技能` : "技能"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[90vw] max-w-xl flex-col overflow-hidden p-2"
                align="start"
              >
                <Tabs
                  value={activeSkillTag}
                  onValueChange={setActiveSkillTag}
                  className="flex min-h-0 w-full flex-1 flex-col"
                >
                  <TabsList className="no-scrollbar h-7 w-full justify-start gap-1 overflow-x-auto overflow-y-hidden bg-background p-0 whitespace-nowrap group-data-horizontal/tabs:h-7">
                    {skillTags.map((tag) => (
                      <TabsTrigger
                        key={tag}
                        value={tag}
                        className="h-6 shrink-0 justify-start px-2 text-xs hover:bg-sidebar-accent data-[state=active]:bg-accent data-[state=active]:shadow-none"
                      >
                        {getSkillTagIcon(tag)}
                        {tag}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {skillTags.map((tag) => (
                    <TabsContent
                      key={tag}
                      value={tag}
                      className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-1"
                    >
                      {skillList
                        .filter((skill) => tag === "全部" || (skill.tags || []).includes(tag))
                        .map((skill) => (
                          <SkillItem
                            key={skill.id}
                            skill={skill}
                            selectedSkills={selectedSkill}
                            onSkillChange={handleSkillChange}
                          />
                        ))}
                    </TabsContent>
                  ))}
                </Tabs>
              </PopoverContent>
            </Popover>

            <div className="ml-auto flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="max-w-[220px] rounded-md"
                  >
                    {selectedModel ? (
                      <>
                        <Icon name={getBrandFromModelName(selectedModel.model || "")} className="size-4" />
                        <span className="truncate">{selectedModel.model}</span>
                      </>
                    ) : (
                      <span className="truncate">大模型</span>
                    )}
                    <IconChevronDown className="size-3.5 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[320px]">
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
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0 rounded-md"
                    onClick={handleOpenModelPricing}
                    aria-label="查看模型定价"
                  >
                    <IconHelpCircle className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>查看模型定价</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {showAdvancedOptions && (
            <>
              <Separator />
              <div className="space-y-4">
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
                      <span className="font-medium">高级选项</span>
                      <IconChevronDown
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          advancedOptionsOpen && "rotate-180"
                        )}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 border-t px-3 py-3">
                    {showRepoAdvancedOptions && (
                      <>
                        <Field>
                          <FieldLabel>仓库分支</FieldLabel>
                          <FieldContent>
                            <Input
                              value={branch}
                              onChange={(e) => setBranch(e.target.value)}
                              placeholder="不填则为主分支"
                              className="text-sm"
                            />
                          </FieldContent>
                        </Field>

                        {!selectedRepoFromMyRepos && (
                          <Field>
                            <FieldLabel>仓库身份凭证</FieldLabel>
                            <FieldContent>
                              <Select value={selectedIdentityId || "none"} onValueChange={setSelectedIdentityId}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="选择身份" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">匿名</SelectItem>
                                  {identities.filter((identity) => selectedRepo.startsWith(identity.base_url || "")).length > 0 ? (
                                    identities
                                      .filter((identity) => selectedRepo.startsWith(identity.base_url || ""))
                                      .map((identity) => (
                                        <SelectItem key={identity.id} value={identity.id as string}>
                                          {getGitPlatformIcon(identity.platform || "")}
                                          {identity.remark || identity.username}
                                        </SelectItem>
                                      ))
                                  ) : (
                                    <SelectItem value="unknown" disabled>该仓库未配置身份凭证</SelectItem>
                                  )}
                                </SelectContent>
                              </Select>
                            </FieldContent>
                          </Field>
                        )}
                      </>
                    )}

                    {user.role === ConstsUserRole.UserRoleSubAccount && (
                      <Field>
                        <FieldLabel>宿主机</FieldLabel>
                        <FieldContent>
                          <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="选择开发工具" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="public_host">
                                <div className="flex items-center gap-2">
                                  <span>MonkeyCode</span>
                                  <Badge className="!text-primary-foreground">免费</Badge>
                                </div>
                              </SelectItem>
                              {hosts.map((host) => (
                                <SelectItem
                                  key={host.id}
                                  value={host.id!}
                                  disabled={host.status !== ConstsHostStatus.HostStatusOnline || selectedPublicModel}
                                >
                                  <div className="flex items-center gap-2">
                                    <span>{host.remark || `${host.name}-${host.external_ip}`}</span>
                                    {getHostBadges(host)}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldContent>
                      </Field>
                    )}

                    {user.role === ConstsUserRole.UserRoleSubAccount && (
                      <Field>
                        <FieldLabel>系统镜像</FieldLabel>
                        <FieldContent>
                          <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="选择开发工具" />
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
                        </FieldContent>
                      </Field>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirmExecute} disabled={!content.trim() || creatingTask}>
            {creatingTask && <Spinner />}
            开始任务
          </Button>
        </DialogFooter>
      </DialogContent>
      <TaskConcurrentLimitDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
      />
    </Dialog>
  )
}
