import {
  ConstsCliName,
  ConstsGitPlatform,
  ConstsHostStatus,
  ConstsOwnerType,
  ConstsTaskType,
  ConstsUserRole,
  type DomainGitIdentity,
  type DomainSkillListItem,
} from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSettingsDialog } from "@/pages/console/user/settings-dialog-context"
import { defaultSkills } from "@/utils/config"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import {
  findIdentitiesForRepoUrl,
  getGitPlatformIcon,
  getHostBadges,
  getImageShortName,
  getOSFromImageName,
  getOwnerTypeBadge,
  getRepoIcon,
  getRepoNameFromUrl,
  selectHost,
  selectImage,
  selectPreferredTaskModel,
  uploadFileWithPresignedUrl,
} from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { readStoredTaskDialogParams, writeStoredTaskDialogParams } from "./task-dialog-params-storage"
import { MAX_TASK_CONTENT_LENGTH } from "./task-content-limit"
import {
  IconChevronDown,
  IconLink,
  IconSourceCode,
  IconUpload,
  IconUser,
  IconXboxX,
} from "@tabler/icons-react"
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { TaskConcurrentLimitDialog } from "./task-concurrent-limit-dialog"
import ModelSelect from "./model-select"
import { IdentityRepoSubmenu } from "./identity-repo-submenu"
import { ALL_SKILLS_TAG, TaskSkillSelector } from "./task-skill-selector"
import { filterSelectableSkillIds } from "./task-skill-selection"

type DomainSkill = DomainSkillListItem & { tags?: string[] }

interface CreateDefaultTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function isIdentityWithRepos(identity: DomainGitIdentity): boolean {
  return [
    ConstsGitPlatform.GitPlatformGithub,
    ConstsGitPlatform.GitPlatformGitee,
    ConstsGitPlatform.GitPlatformGitea,
    ConstsGitPlatform.GitPlatformGitLab,
    ConstsGitPlatform.GitPlatformCodeup,
    ConstsGitPlatform.GitPlatformCnb,
    ConstsGitPlatform.GitPlatformAtomgit,
  ].includes(identity.platform as ConstsGitPlatform)
}

export default function CreateDefaultTaskDialog({
  open,
  onOpenChange,
}: CreateDefaultTaskDialogProps) {
  const navigate = useNavigate()
  const { projects, unlinkedTasks, identities, models, hosts, images, user, subscription, reloadProjects, reloadUnlinkedTasks } = useCommonData()
  const { setOpen: setSettingsOpen } = useSettingsDialog()
  const { t } = useTranslation()

  const [content, setContent] = useState("")
  const taskType = ConstsTaskType.TaskTypeDevelop
  const [codeDropdownOpen, setCodeDropdownOpen] = useState(false)
  const [skillPopoverOpen, setSkillPopoverOpen] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [selectedRepo, setSelectedRepo] = useState("")
  const [selectedRepoDisplayName, setSelectedRepoDisplayName] = useState("")
  const [selectedRepoFromMyRepos, setSelectedRepoFromMyRepos] = useState(false)
  const [selectedSkill, setSelectedSkill] = useState<string[]>(defaultSkills)
  const [skillList, setSkillList] = useState<DomainSkill[]>([])
  const [activeSkillTag, setActiveSkillTag] = useState(ALL_SKILLS_TAG)
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
  const modelTouchedRef = useRef(false)

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

  const setDefaultConfig = useCallback(() => {
    const storedParams = readStoredTaskDialogParams()
    const nextImageId = (
      storedParams.imageId
      && images.some((image) => image.id === storedParams.imageId)
    )
      ? storedParams.imageId
      : selectImage(images, true)

    setSelectedImageId(nextImageId)

    if (user.role === ConstsUserRole.UserRoleSubAccount) {
      const nextHostId = hosts.some((host) => host.id === storedParams.hostId && host.status === ConstsHostStatus.HostStatusOnline)
        ? (storedParams.hostId || "public_host")
        : IS_OFFLINE_EDITION
          ? (hosts.find((host) => host.id && host.status === ConstsHostStatus.HostStatusOnline)?.id || "")
          : selectHost(hosts, true)

      setSelectedHostId(nextHostId)
      return
    }

    setSelectedHostId(selectHost(hosts, false))
  }, [hosts, images, user.role])

  useEffect(() => {
    if (!open) {

      modelTouchedRef.current = false
      setContent("")
      setCodeDropdownOpen(false)
      setSkillPopoverOpen(false)
      setSearchInput("")
      setSelectedRepo("")
      setSelectedRepoDisplayName("")
      setSelectedRepoFromMyRepos(false)
      setSelectedZipFile(null)
      setSelectedSkill(
        skillList.length > 0
          ? filterSelectableSkillIds(defaultSkills, skillList)
          : defaultSkills
      )
      setActiveSkillTag(ALL_SKILLS_TAG)
      setAdvancedOptionsOpen(false)
      setSelectedModelId("")
      setSelectedHostId("")
      setSelectedImageId("")
      setSelectedIdentityId("")
      setBranch("")
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
    } else {
      setSelectedSkill((prev) => filterSelectableSkillIds(prev, skillList))
    }
  }, [open, skillList, skillList.length, t])

  useEffect(() => {
    if (!open || modelTouchedRef.current || models.length === 0) {
      return
    }

    setSelectedModelId(selectPreferredTaskModel(models, subscription))
  }, [models, open, subscription])

  useEffect(() => {
    if (!open) {
      return
    }


    setDefaultConfig()
  }, [open, setDefaultConfig])

  useEffect(() => {
    const userChoiceStillValid =
      selectedIdentityId === "none" ||
      identities.some((identity) => identity.id === selectedIdentityId)
    if (userChoiceStillValid) {
      return
    }
    const matched = findIdentitiesForRepoUrl(selectedRepo, identities)

    setSelectedIdentityId(matched[0]?.id || "none")
  }, [selectedRepo, identities, selectedIdentityId])


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
        return [...prev, skillId]
      }
      return prev.filter((id) => id !== skillId)
    })
  }

  const handleModelChange = (modelId: string) => {
    modelTouchedRef.current = true
    setSelectedModelId(modelId)
  }

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  )
  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic
  const showRepoAdvancedOptions = Boolean(selectedRepo && !selectedRepoDisplayName.endsWith(".zip"))
  const contentLength = content.length
  const contentTooLong = contentLength > MAX_TASK_CONTENT_LENGTH

  const validateTaskContent = () => {
    if (!content.trim()) {
      toast.error(t("taskWorkflow.toast.missingContent"))
      return false
    }

    if (contentTooLong) {
      toast.error(t("taskWorkflow.input.contentTooLong", { maxCount: MAX_TASK_CONTENT_LENGTH }))
      return false
    }

    return true
  }

  useEffect(() => {
    if (!IS_OFFLINE_EDITION && selectedPublicModel && selectedHostId && selectedHostId !== "public_host") {

      setSelectedHostId("public_host")
    }
  }, [selectedPublicModel, selectedHostId])

  const handleConfirmExecute = () => {
    if (!validateTaskContent()) {
      return
    }

    void executeTask()
  }

  const executeTask = async () => {
    if (!validateTaskContent()) {
      return
    }

    if (!selectedModelId) {
      toast.error(t("taskWorkflow.toast.missingModel"))
      return
    }

    if (!selectedImageId) {
      toast.error(t("taskWorkflow.toast.missingImage"))
      return
    }

    if (!selectedRepoDisplayName.endsWith(".zip") && selectedRepo && !selectedIdentityId) {
      setSelectedIdentityId("none")
    }

    if (!IS_OFFLINE_EDITION && selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic && selectedHostId !== "public_host") {
      toast.warning(t("taskWorkflow.toast.builtinModelHostOnly"))
      return
    }

    const storedParams = readStoredTaskDialogParams()
    writeStoredTaskDialogParams({
      hostId: user.role === ConstsUserRole.UserRoleSubAccount ? selectedHostId : storedParams.hostId,
      imageId: selectedImageId,
    })

    let zipUrl = selectedRepo
    if (selectedZipFile) {
      setCreatingTask(true)
      try {
        const uploadedFile = await uploadFileWithPresignedUrl(selectedZipFile)
        zipUrl = uploadedFile.accessUrl
      } catch (error) {
        toast.error(t("taskWorkflow.toast.uploadFailed", { message: (error as Error).message }))
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
        toast.success(t("taskWorkflow.toast.taskStarted"))
        reloadProjects()
        reloadUnlinkedTasks()
        onOpenChange(false)
        navigate(`/console/task/${resp.data?.id}`)
      } else if (resp.code === 10811) {
        setLimitDialogOpen(true)
      } else {
        toast.error(resp.message || t("taskWorkflow.toast.taskStartFailed"))
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
      toast.error(t("taskWorkflow.toast.invalidZipFile"))
      return
    }

    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      toast.error(t("taskWorkflow.toast.zipTooLarge"))
      return
    }

    setSelectedZipFile(file)
    setSelectedRepo(`local-upload://${file.name}`)
    setSelectedRepoDisplayName(file.name)
    setSelectedRepoFromMyRepos(false)
    setCodeDropdownOpen(false)
    toast.success(t("taskWorkflow.toast.zipSelected"))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t("taskWorkflow.dialog.create.title")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={handleZipFileSelect}
          />
          <div className="space-y-1">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("taskWorkflow.input.placeholder")}
              className="min-h-36 max-h-60 resize-none overflow-y-auto break-all field-sizing-fixed"
              aria-invalid={contentTooLong}
            />
            {contentTooLong && (
              <div className="px-1 text-xs text-destructive">
                {t("taskWorkflow.input.contentTooLongInline", {
                  overCount: contentLength - MAX_TASK_CONTENT_LENGTH,
                  maxCount: MAX_TASK_CONTENT_LENGTH,
                })}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu open={codeDropdownOpen} onOpenChange={setCodeDropdownOpen}>
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
                      : t("taskWorkflow.input.code")}
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
                    {t("taskWorkflow.input.clearSelection")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                  <IconUpload className="size-4" />
                  {t("taskWorkflow.input.zipFile")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconUser className="size-4" />
                    {t("taskWorkflow.repo.myRepositories")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="min-w-[220px] p-0">
                      {selectableIdentities.length === 0 ? (
                        <div className="flex items-center justify-between gap-3 px-3 py-3">
                          <span className="text-sm text-muted-foreground">{t("taskWorkflow.repo.unboundGitAccount")}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCodeDropdownOpen(false)
                              setSettingsOpen(true)
                            }}
                          >
                            {t("taskWorkflow.repo.goToSettings")}
                          </Button>
                        </div>
                      ) : (
                        selectableIdentities.map((identity) => (
                          <IdentityRepoSubmenu
                            key={identity.id || ""}
                            identity={identity}
                            onSelectRepo={({ repoUrl, repoName, gitIdentityId }) => {
                              setSelectedRepo(repoUrl)
                              setSelectedRepoDisplayName(repoName)
                              setSelectedRepoFromMyRepos(true)
                              setSelectedZipFile(null)
                              setSelectedIdentityId(gitIdentityId)
                            }}
                          />
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="w-full">
                    <IconLink className="size-4" />
                    {t("taskWorkflow.repo.otherRepositories")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent className="p-2">
                      <Input
                        placeholder={t("taskWorkflow.repo.otherRepoPlaceholder")}
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
                              toast.error(t("taskWorkflow.toast.invalidRepoUrl"))
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

            <TaskSkillSelector
              enableWheelScrollFallback
              open={skillPopoverOpen}
              onOpenChange={setSkillPopoverOpen}
              selectedSkills={selectedSkill}
              skills={skillList}
              skillTags={skillTags}
              activeSkillTag={activeSkillTag}
              onActiveSkillTagChange={setActiveSkillTag}
              onSkillChange={handleSkillChange}
              triggerClassName="rounded-md"
            />

          </div>

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
                  <span className="font-medium">{t("taskWorkflow.dialog.params.advancedOptions")}</span>
                  <IconChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      advancedOptionsOpen && "rotate-180"
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 border-t px-3 py-3">
                    <Field>
                      <FieldLabel>{t("taskWorkflow.dialog.params.model")}</FieldLabel>
                      <FieldContent>
                        <ModelSelect
                          models={models}
                          selectedModel={selectedModel}
                          selectedModelId={selectedModelId}
                          setSelectedModelId={handleModelChange}
                          subscription={subscription}
                        />
                      </FieldContent>
                    </Field>

                    {showRepoAdvancedOptions && (
                      <>
                        <Field>
                          <FieldLabel>{t("taskWorkflow.dialog.params.branch")}</FieldLabel>
                          <FieldContent>
                            <Input
                              value={branch}
                              onChange={(e) => setBranch(e.target.value)}
                              placeholder={t("taskWorkflow.dialog.params.branchPlaceholder")}
                              className="text-sm"
                            />
                          </FieldContent>
                        </Field>

                        {!selectedRepoFromMyRepos && (
                          <Field>
                            <FieldLabel>{t("taskWorkflow.dialog.params.identity")}</FieldLabel>
                            <FieldContent>
                              <Select value={selectedIdentityId || "none"} onValueChange={setSelectedIdentityId}>
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder={t("taskWorkflow.dialog.params.selectIdentity")} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">{t("taskWorkflow.dialog.params.anonymous")}</SelectItem>
                                  {(() => {
                                    const matched = findIdentitiesForRepoUrl(selectedRepo, identities)
                                    return matched.length > 0 ? (
                                      matched.map((identity) => (
                                        <SelectItem key={identity.id} value={identity.id as string}>
                                          {getGitPlatformIcon(identity.platform || "")}
                                          {identity.remark || identity.username}
                                        </SelectItem>
                                      ))
                                    ) : (
                                      <SelectItem value="unknown" disabled>{t("taskWorkflow.dialog.params.noIdentity")}</SelectItem>
                                    )
                                  })()}
                                </SelectContent>
                              </Select>
                            </FieldContent>
                          </Field>
                        )}
                      </>
                    )}

                    {user.role === ConstsUserRole.UserRoleSubAccount && (
                      <Field>
                        <FieldLabel>{t("taskWorkflow.dialog.params.host")}</FieldLabel>
                        <FieldContent>
                          <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder={t("taskWorkflow.dialog.params.selectHost")} />
                            </SelectTrigger>
                            <SelectContent>
                              {!IS_OFFLINE_EDITION && (
                                <SelectItem value="public_host">
                                  <div className="flex items-center gap-2">
                                    <span>MonkeyCode</span>
                                    <Badge className="!text-primary-foreground">{t("taskWorkflow.dialog.params.free")}</Badge>
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
                                    {getHostBadges(host)}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FieldContent>
                      </Field>
                    )}

                    <Field>
                      <FieldLabel>{t("taskWorkflow.dialog.params.image")}</FieldLabel>
                      <FieldContent>
                        <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t("taskWorkflow.dialog.params.selectImage")} />
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
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("taskWorkflow.dialog.params.cancel")}
          </Button>
          <Button onClick={handleConfirmExecute} disabled={!content.trim() || creatingTask || contentTooLong}>
            {creatingTask && <Spinner />}
            {t("taskWorkflow.dialog.create.startTask")}
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
