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
import { IconCheck, IconChevronDown, IconGitBranch, IconLoader, IconReload } from "@tabler/icons-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useSettingsDialog } from "@/pages/console/user/settings-dialog-context"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { useCommonData } from "@/components/console/data-provider"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()

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
    identity.remark || identity.username || identity.base_url || t("consoleProject.create.unnamedIdentity")

  const loadReposForIdentity = useCallback(
    async (identityId: string, flush = false) => {
      setLoadingIdentityRepos(true)
      setIdentityRepoOptions([])

      await apiRequest(
        "v1UsersGitIdentitiesDetail",
        flush ? { flush: true } : {},
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
              username: identity?.username || identity?.remark || t("consoleProject.create.unnamedIdentity"),
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
      toast.error(t("consoleProject.create.toast.nameRequired"))
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
      toast.error(t("consoleProject.create.toast.identityRequired"))
      return
    }
    if (!selectedRepoValue) {
      toast.error(t("consoleProject.create.toast.repositoryRequired"))
      return
    }
    const repo = identityRepoOptions.find(
      (o) => `${o.gitIdentityId}:${o.repository.url || ""}` === selectedRepoValue
    )
    if (!repo?.repository.url) {
      toast.error(t("consoleProject.create.toast.availableRepositoryRequired"))
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
          toast.success(t("consoleProject.create.toast.created"))
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
          toast.error(resp.message || t("consoleProject.create.toast.createFailed"))
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
          <DialogTitle>{t("consoleProject.create.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("consoleProject.create.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("consoleProject.create.namePlaceholder")}
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>{t("consoleProject.create.repository")}</Label>
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
                    {t("consoleProject.create.noGitIdentity")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false)
                      setSettingsOpen(true)
                    }}
                  >
                    {t("consoleProject.create.goSettings")}
                  </Button>
                </div>
              )}
            </div>

            {selectedIdentityId ? (
              <div className="flex flex-col gap-2">
                <Label>{t("consoleProject.create.selectRepositoryLabel")}</Label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Popover open={repoPopoverOpen} onOpenChange={setRepoPopoverOpen} modal={true}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={repoPopoverOpen}
                          className="w-full justify-between font-normal"
                          disabled={loading}
                        >
                          <span className={cn("truncate", !selectedRepoValue && "text-muted-foreground")}>
                            {loadingIdentityRepos
                              ? t("consoleProject.create.loadingRepositories")
                              : selectedRepoValue
                                ? selectedRepoLabel
                                : identityRepoOptions.length === 0
                                  ? t("consoleProject.create.noRepositoriesRetry")
                                  : t("consoleProject.create.selectRepository")}
                          </span>
                          <IconChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        {loadingIdentityRepos ? (
                          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                            <Spinner />
                            {t("consoleProject.create.loadingRepositories")}
                          </div>
                        ) : identityRepoOptions.length === 0 ? (
                          <div className="p-4">
                            <p className="mb-3 text-sm">{t("consoleProject.create.noRepositoriesDescription")}</p>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => loadReposForIdentity(selectedIdentityId)}
                            >
                              {t("consoleProject.common.retry")}
                            </Button>
                          </div>
                        ) : (
                          <Command>
                            <CommandInput placeholder={t("consoleProject.create.searchRepository")} />
                            <CommandList className="max-h-48 p-1">
                              <CommandEmpty>{t("consoleProject.create.repositoryNotFound")}</CommandEmpty>
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
                                      "cursor-pointer flex flex-col items-start gap-0.5 py-1 [&>svg:last-child]:hidden",
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
                                      {desc || t("consoleProject.create.noDescription")}
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
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => loadReposForIdentity(selectedIdentityId, true)}
                    disabled={loading || loadingIdentityRepos || !selectedIdentityId}
                    aria-label={t("consoleProject.create.refreshRepositoriesAria")}
                  >
                    <IconReload className={cn("size-4", loadingIdentityRepos && "animate-spin")} />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading || !canSubmit}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
