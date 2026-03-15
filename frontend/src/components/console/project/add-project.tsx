import {
  ConstsGitPlatform,
  type DomainAuthRepository,
  type DomainGitIdentity,
} from "@/api/Api"
import { Button } from "@/components/ui/button"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getGitPlatformIcon } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconCheck, IconChevronDown, IconGitBranch, IconLoader } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSettingsDialog } from "@/pages/console/user/page"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"

interface RepoOption {
  gitIdentityId: string
  username: string
  repository: DomainAuthRepository
}

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddProjectDialogProps) {
  const [name, setName] = useState("")
  const [selectedSource, setSelectedSource] = useState<string>("")
  const [identityRepoOptions, setIdentityRepoOptions] = useState<RepoOption[]>([])
  const [loadingIdentityRepos, setLoadingIdentityRepos] = useState(false)
  const [selectedRepoValue, setSelectedRepoValue] = useState("")
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setOpen: setSettingsOpen } = useSettingsDialog()

  const { identities } = useCommonData()

  const selectedIdentityId = selectedSource

  const selectedIdentity = useMemo(
    () => identities.find((i) => i.id === selectedIdentityId),
    [identities, selectedIdentityId]
  )

  const selectedRepo = identityRepoOptions.find(
    (o) => `${o.gitIdentityId}:${o.repository.url || ""}` === selectedRepoValue
  )
  const selectedRepoLabel = selectedRepo
    ? (selectedRepo.repository.full_name || selectedRepo.repository.url || "").replace(
        `${selectedRepo.username}/`,
        ""
      )
    : ""

  const identityLabel = (identity: DomainGitIdentity) =>
    identity.remark || identity.username || identity.base_url || "未命名身份"

  const loadReposForIdentity = useCallback(
    async (identityId: string) => {
      setLoadingIdentityRepos(true)
      setIdentityRepoOptions([])

      await apiRequest(
        "v1UsersGitIdentitiesDetail",
        {},
        [identityId],
        (detailResp) => {
          if (detailResp.code !== 0) {
            setLoadingIdentityRepos(false)
            return
          }
          const identity = identities.find((i) => i.id === identityId)
          const authorizedRepositories = detailResp.data?.authorized_repositories || []
          const repos: RepoOption[] = []
          for (const repo of authorizedRepositories) {
            if (!repo.url?.trim()) continue
            repos.push({
              gitIdentityId: identityId,
              username: identity?.username || identity?.remark || "未命名身份",
              repository: repo,
            })
          }
          setIdentityRepoOptions(repos)
          setLoadingIdentityRepos(false)
        },
        () => setLoadingIdentityRepos(false)
      )
    },
    [identities]
  )

  useEffect(() => {
    if (open && selectedIdentityId) {
      loadReposForIdentity(selectedIdentityId)
    } else if (open && !selectedIdentityId) {
      setIdentityRepoOptions([])
    }
  }, [open, selectedIdentityId, loadReposForIdentity])

  useEffect(() => {
    if (selectedIdentityId) {
      setSelectedRepoValue("")
    }
  }, [selectedIdentityId])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("请输入项目名称")
      return
    }

    const createReq: {
      name: string
      description?: string
      platform?: ConstsGitPlatform
      git_identity_id?: string
      repo_url?: string
    } = { name: name.trim() }

    if (!selectedIdentityId) {
      toast.error("请选择身份")
      return
    }
    if (!selectedRepoValue) {
      toast.error("请选择要关联的仓库")
      return
    }
    const repo = identityRepoOptions.find(
      (o) => `${o.gitIdentityId}:${o.repository.url || ""}` === selectedRepoValue
    )
    if (!repo?.repository.url) {
      toast.error("请选择可用仓库")
      return
    }
    createReq.platform = selectedIdentity?.platform as ConstsGitPlatform
    createReq.git_identity_id = repo.gitIdentityId
    createReq.repo_url = repo.repository.url

    setLoading(true)
    await apiRequest(
      "v1UsersProjectsCreate",
      createReq,
      [],
      (resp) => {
        if (resp.code === 0) {
          toast.success("项目创建成功")
          onOpenChange(false)
          setName("")
          setSelectedSource("")
          setSelectedRepoValue("")
          setIdentityRepoOptions([])
          onSuccess?.()
          if (resp.data?.id) {
            navigate(`/console/project/${resp.data.id}`)
          }
        } else {
          toast.error(resp.message || "创建项目失败")
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName("")
    setSelectedSource("")
    setSelectedRepoValue("")
    setIdentityRepoOptions([])
  }

  const canSubmit = name.trim() && selectedIdentityId && selectedRepoValue

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>创建项目</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">项目名称</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入项目名称"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>代码仓库</Label>
              {identities.length > 0 ? (
                <RadioGroup
                  value={selectedSource}
                  onValueChange={(v) => {
                    setSelectedSource(v)
                    setSelectedRepoValue("")
                    setIdentityRepoOptions([])
                  }}
                  className="grid grid-cols-2 gap-2"
                  disabled={loading}
                >
                  {identities.map((identity) => (
                    <label
                      key={identity.id}
                      htmlFor={`repo-source-${identity.id}`}
                      className={cn(
                        "flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-muted/30",
                        selectedSource === identity.id && "text-primary"
                      )}
                    >
                      <RadioGroupItem
                        value={identity.id || ""}
                        id={`repo-source-${identity.id}`}
                        className="shrink-0"
                      />
                      {getGitPlatformIcon(identity.platform)}
                      <span className="truncate">{identityLabel(identity)}</span>
                    </label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-dashed bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    尚未绑定 Git 账号，请先绑定
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      setSettingsOpen(true)
                    }}
                  >
                    去设置
                  </Button>
                </div>
              )}
            </div>

            {selectedIdentityId ? (
              <div className="flex flex-col gap-2">
                <Label>选择仓库</Label>
                <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen} modal={true}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={repoPopoverOpen}
                          className="w-full justify-between font-normal"
                          disabled={loading}
                        >
                          <span className={cn(!selectedRepoValue && "text-muted-foreground")}>
                            {loadingIdentityRepos
                              ? "正在获取仓库..."
                              : selectedRepoValue
                                ? selectedRepoLabel
                                : identityRepoOptions.length === 0
                                  ? "暂无仓库，点击重试"
                                  : "请选择仓库"}
                          </span>
                          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        {loadingIdentityRepos ? (
                          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground justify-center">
                            <Spinner />
                            正在获取仓库...
                          </div>
                        ) : identityRepoOptions.length === 0 ? (
                          <div className="p-4">
                            <p className="mb-3 text-sm">暂无仓库或获取失败，请点击重试。</p>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => loadReposForIdentity(selectedIdentityId)}
                            >
                              重试
                            </Button>
                          </div>
                        ) : (
                          <Command>
                            <CommandInput placeholder="搜索仓库..." />
                            <CommandList className="max-h-48">
                              <CommandEmpty>未找到匹配的仓库</CommandEmpty>
                              {identityRepoOptions.map((option) => {
                                const value = `${option.gitIdentityId}:${option.repository.url || ""}`
                                const repoName = (
                                  option.repository.full_name || option.repository.url || ""
                                ).replace(`${option.username}/`, "")
                                const desc = option.repository.description
                                return (
                                  <CommandItem
                                    key={value}
                                    value={`${repoName} ${desc || ""} ${option.username}`}
                                    onSelect={() => {
                                      setSelectedRepoValue(value)
                                      setRepoPopoverOpen(false)
                                    }}
                                    className={cn(
                                      "cursor-pointer flex flex-col items-start gap-0.5 py-1",
                                      selectedRepoValue === value &&
                                        "bg-muted/50 data-[selected=true]:bg-muted/70"
                                    )}
                                  >
                                    <div className="flex items-center gap-2 w-full min-w-0">
                                      <IconGitBranch className="size-4 shrink-0" />
                                      <span className="truncate flex-1 text-sm">{repoName}</span>
                                      <IconCheck
                                        className={cn(
                                          "size-4 shrink-0",
                                          selectedRepoValue === value ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                    </div>
                                    <span
                                      className="text-xs text-muted-foreground truncate w-full pl-6"
                                      title={desc || undefined}
                                    >
                                      {desc || "暂无描述"}
                                    </span>
                                  </CommandItem>
                                )
                              })}
                            </CommandList>
                          </Command>
                        )}
                      </PopoverContent>
                    </Popover>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || !canSubmit}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
