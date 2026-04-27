import { ConstsGitPlatform, ConstsOwnerType, type DomainBranch, type DomainModel, type DomainProject, type DomainSubscriptionResp } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { canUseModelBySubscription, getBrandFromModelName, getModelPricingItem, getOwnerTypeBadge, selectPreferredTaskModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconChevronDown, IconHelpCircle } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { readStoredTaskDialogParams, writeStoredTaskDialogParams } from "@/components/console/task/task-dialog-params-storage"

const OPEN_WALLET_DIALOG_EVENT = "open-wallet-dialog"

function getDefaultModelId(models: DomainModel[], subscription: DomainSubscriptionResp | null) {
  const storedParams = readStoredTaskDialogParams()
  if (
    storedParams.modelId
    && models.some((model) => model.id === storedParams.modelId)
    && canUseModelBySubscription(models.find((model) => model.id === storedParams.modelId), subscription)
  ) {
    return storedParams.modelId
  }

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

  const persistSelectedModel = useCallback(() => {
    const storedParams = readStoredTaskDialogParams()
    writeStoredTaskDialogParams({
      ...storedParams,
      modelId: selectedModelId,
    })
  }, [selectedModelId])

  return {
    selectedModel,
    selectedModelId,
    setSelectedModelId,
    persistSelectedModel,
  }
}

export function useProjectBranchSelection(open: boolean, project?: DomainProject) {
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
          toast.error("无法获取仓库信息")
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
          toast.error("获取分支列表失败: " + resp.message)
        }
      })
    } catch (error) {
      console.error("Fetch branches error:", error)
      toast.error("获取分支列表失败")
    } finally {
      if (requestId === branchRequestIdRef.current) {
        setLoadingBranches(false)
      }
    }
  }, [project?.git_identity_id, project?.repo_url, project?.platform, project?.full_name])

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
  return (
    <>
      {project && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>项目</Label>
            <Input value={project.name || "-"} readOnly className="bg-muted" />
          </div>
          <div className="space-y-2">
            <Label>仓库地址</Label>
            <Input value={project.repo_url || "-"} readOnly className="bg-muted" />
          </div>
        </div>
      )}
      {project && project.platform !== ConstsGitPlatform.GitPlatformInternal && (
        <div className="space-y-2">
          <Label>选择分支</Label>
          <Select value={selectedBranch} onValueChange={selectBranch} disabled={loadingBranches || branches.length === 0}>
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
    </>
  )
}

export function IssueTaskModelSelect({
  models,
  selectedModel,
  selectedModelId,
  setSelectedModelId,
}: {
  models: DomainModel[]
  selectedModel?: DomainModel
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
}) {
  const handleOpenModelPricing = () => {
    window.dispatchEvent(new CustomEvent(OPEN_WALLET_DIALOG_EVENT, {
      detail: { section: "pricing" },
    }))
  }

  return (
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
                {models.map((model) => {
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
                })}
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
  )
}
