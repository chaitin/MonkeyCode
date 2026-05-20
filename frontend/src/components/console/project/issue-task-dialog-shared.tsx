import { ConstsGitPlatform, type DomainBranch, type DomainModel, type DomainProject, type DomainSubscriptionResp } from "@/api/Api"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import ModelSelect from "@/components/console/task/model-select"
import { selectPreferredTaskModel } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

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
  subscription,
}: {
  models: DomainModel[]
  selectedModel?: DomainModel
  selectedModelId: string
  setSelectedModelId: (modelId: string) => void
  subscription?: DomainSubscriptionResp | null
}) {
  return (
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
  )
}
