import { ConstsGitPlatform, ConstsHostStatus, ConstsOwnerType, type DomainBranch, type DomainHost, type DomainImage, type DomainModel, type DomainProject, type DomainSubscriptionResp } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import ModelSelect from "@/components/console/task/model-select"
import { getHostBadges, getImageShortName, getOSFromImageName, getOwnerTypeBadge, selectHost, selectImage, selectPreferredTaskModel } from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import { apiRequest } from "@/utils/requestUtils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

function getDefaultModelId(models: DomainModel[], subscription: DomainSubscriptionResp | null) {
  return selectPreferredTaskModel(models, subscription)
}

export function useIssueTaskModelSelection(
  open: boolean,
  models: DomainModel[],
  subscription: DomainSubscriptionResp | null,
) {
  const [selectedModelId, setSelectedModelIdState] = useState("")
  const modelTouchedRef = useRef(false)
  const prevOpenRef = useRef(false)

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  )

  const setSelectedModelId = useCallback((modelId: string) => {
    modelTouchedRef.current = true
    setSelectedModelIdState(modelId)
  }, [])

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false
      modelTouchedRef.current = false
      return
    }

    const justOpened = !prevOpenRef.current
    prevOpenRef.current = true

    if (justOpened) {
      modelTouchedRef.current = false
      setSelectedModelIdState(getDefaultModelId(models, subscription))
      return
    }

    const hasSelectedModel = !!selectedModelId && models.some((model) => model.id === selectedModelId)
    if (!modelTouchedRef.current && models.length > 0 && !hasSelectedModel) {
      setSelectedModelIdState(getDefaultModelId(models, subscription))
    }
  }, [models, open, selectedModelId, subscription])

  return {
    selectedModel,
    selectedModelId,
    setSelectedModelId,
  }
}

export function useIssueTaskImageSelection(
  open: boolean,
  images: DomainImage[],
  projectImageId?: string,
) {
  const [selectedImageId, setSelectedImageId] = useState("")

  useEffect(() => {
    if (!open) {
      setSelectedImageId("")
      return
    }

    const selectedImageIsValid = images.some((image) => image.id === selectedImageId)
    if (selectedImageIsValid) {
      return
    }

    const projectImageIsValid = !!projectImageId && images.some((image) => image.id === projectImageId)
    setSelectedImageId(projectImageIsValid ? projectImageId : selectImage(images, true))
  }, [images, open, projectImageId, selectedImageId])

  return {
    selectedImageId,
    setSelectedImageId,
  }
}

function getDefaultIssueTaskHostId(hosts: DomainHost[]) {
  if (IS_OFFLINE_EDITION) {
    return hosts.find((host) => host.id && host.status === ConstsHostStatus.HostStatusOnline)?.id || ""
  }

  return selectHost(hosts, false)
}

export function useIssueTaskHostSelection(
  open: boolean,
  hosts: DomainHost[],
  selectedModel?: DomainModel,
) {
  const [selectedHostId, setSelectedHostId] = useState("")
  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic

  useEffect(() => {
    if (!open) {
      setSelectedHostId("")
      return
    }

    if (!IS_OFFLINE_EDITION && selectedPublicModel) {
      setSelectedHostId("public_host")
      return
    }

    const selectedHostIsValid = selectedHostId === "public_host"
      ? !IS_OFFLINE_EDITION
      : hosts.some((host) => host.id === selectedHostId && host.status === ConstsHostStatus.HostStatusOnline)

    if (!selectedHostIsValid) {
      setSelectedHostId(getDefaultIssueTaskHostId(hosts))
    }
  }, [hosts, open, selectedHostId, selectedPublicModel])

  return {
    selectedHostId,
    setSelectedHostId,
  }
}

export function useProjectBranchSelection(open: boolean, project?: DomainProject) {
  const { t } = useTranslation()
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState("")
  const [loadingBranches, setLoadingBranches] = useState(false)
  const branchRequestIdRef = useRef(0)
  const branchTouchedRef = useRef(false)

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

  const selectBranch = useCallback((branch: string) => {
    branchTouchedRef.current = true
    setSelectedBranch(branch)
  }, [])

  const fetchBranches = useCallback(async () => {
    const requestId = ++branchRequestIdRef.current
    branchTouchedRef.current = false

    if (!project?.git_identity_id || !project?.repo_url) {
      setBranches([])
      setLoadingBranches(false)
      return
    }

    if (project.platform === ConstsGitPlatform.GitPlatformInternal) {
      setSelectedBranch("")
      setBranches([])
      setLoadingBranches(false)
      return
    }

    setLoadingBranches(true)
    try {
      const escapedRepoFullName = project.full_name || ""
      if (!escapedRepoFullName) {
        if (requestId === branchRequestIdRef.current) {
          toast.error(t("consoleProject.issueTask.toast.repositoryUnavailable"))
          setLoadingBranches(false)
        }
        return
      }

      const encodedRepoName = encodeURIComponent(escapedRepoFullName)
      await apiRequest("v1UsersGitIdentitiesBranchesDetail", {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (requestId !== branchRequestIdRef.current) return

        if (resp.code === 0 && resp.data) {
          const branchList = resp.data.map((branch: DomainBranch) => branch.name || "").filter(Boolean)
          setBranches(branchList)

          if (branchTouchedRef.current) return

          if (branchList.includes("main")) {
            setSelectedBranch("main")
          } else if (branchList.includes("master")) {
            setSelectedBranch("master")
          } else if (branchList.length > 0) {
            setSelectedBranch(branchList[0])
          }
        } else {
          toast.error(t("consoleProject.issueTask.toast.fetchBranchesFailedWithMessage", { message: resp.message || t("consoleProject.common.unknownError") }))
        }
      })
    } catch (error) {
      console.error("Fetch branches error:", error)
      toast.error(t("consoleProject.issueTask.toast.fetchBranchesFailed"))
    } finally {
      if (requestId === branchRequestIdRef.current) {
        setLoadingBranches(false)
      }
    }
  }, [project?.git_identity_id, project?.repo_url, project?.platform, project?.full_name, t])

  useEffect(() => {
    if (!open) {
      branchRequestIdRef.current += 1
      branchTouchedRef.current = false
      return
    }
    if (!branchSourceKey) return
    fetchBranches()
  }, [branchSourceKey, fetchBranches, open])

  return {
    branches,
    loadingBranches,
    selectedBranch,
    selectBranch,
  }
}

export function IssueTaskProjectFields({
  branches,
  loadingBranches,
  project,
  selectedBranch,
  selectBranch,
}: {
  branches: string[]
  loadingBranches: boolean
  project?: DomainProject
  selectedBranch: string
  selectBranch: (branch: string) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      {project && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("consoleProject.issueTask.project")}</Label>
            <Input value={project.name || "-"} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>{t("consoleProject.issueTask.repositoryUrl")}</Label>
            <Input value={project.repo_url || "-"} readOnly className="bg-muted" />
          </div>
        </div>
      )}
      {project && project.platform !== ConstsGitPlatform.GitPlatformInternal && (
        <div className="space-y-2">
          <Label>{t("consoleProject.issueTask.branch")}</Label>
          <Select value={selectedBranch} onValueChange={selectBranch} disabled={loadingBranches || branches.length === 0}>
            <SelectTrigger className="w-full">
              {loadingBranches ? (
                <div className="flex items-center gap-2">
                  <Spinner className="size-4" />
                  <span>{t("consoleProject.common.loading")}</span>
                </div>
              ) : (
                <SelectValue placeholder={t("consoleProject.issueTask.selectBranch")} />
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
    </>
  )
}

export function IssueTaskModelSelect({
  models,
  selectedModel,
  selectedModelId,
  setSelectedModelId,
  subscription,
}: {
  models: DomainModel[]
  selectedModel?: DomainModel
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
  subscription?: DomainSubscriptionResp | null
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <Label>{t("consoleProject.issueTask.model")}</Label>
      <ModelSelect
        models={models}
        selectedModel={selectedModel}
        selectedModelId={selectedModelId}
        setSelectedModelId={setSelectedModelId}
        subscription={subscription}
      />
    </div>
  )
}

export function IssueTaskImageSelect({
  images,
  selectedImageId,
  setSelectedImageId,
}: {
  images: DomainImage[]
  selectedImageId: string
  setSelectedImageId: (imageId: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <Label>{t("consoleProject.issueTask.image")}</Label>
      <Select value={selectedImageId} onValueChange={setSelectedImageId}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("consoleProject.issueTask.selectImage")} />
        </SelectTrigger>
        <SelectContent>
          {images.filter((image) => image.id).map((image) => (
            <SelectItem key={image.id} value={image.id!}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <Icon name={getOSFromImageName(image.name || "")} className="size-4" />
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
  )
}

export function IssueTaskHostSelect({
  hosts,
  selectedHostId,
  selectedModel,
  setSelectedHostId,
}: {
  hosts: DomainHost[]
  selectedHostId: string
  selectedModel?: DomainModel
  setSelectedHostId: (hostId: string) => void
}) {
  const { t } = useTranslation()
  const selectedPublicModel = selectedModel?.owner?.type === ConstsOwnerType.OwnerTypePublic

  return (
    <div className="space-y-2">
      <Label>{t("consoleProject.issueTask.host")}</Label>
      <Select value={selectedHostId} onValueChange={setSelectedHostId}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("consoleProject.issueTask.selectHost")} />
        </SelectTrigger>
        <SelectContent>
          {!IS_OFFLINE_EDITION && (
            <SelectItem value="public_host">
              <div className="flex items-center gap-2">
                <span>MonkeyCode</span>
                <Badge className="!text-primary-foreground">{t("consoleProject.issueTask.free")}</Badge>
              </div>
            </SelectItem>
          )}
          {hosts.filter((host) => host.id).map((host) => (
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
    </div>
  )
}
