import { IconReload } from "@tabler/icons-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { DomainAuthRepository, DomainGitIdentity } from "@/api/Api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { useIdentityRepos } from "@/hooks/useIdentityRepos"
import { cn } from "@/lib/utils"
import { getGitPlatformIcon, getRepoIcon } from "@/utils/common"

export interface RepoSelectPayload {
  repoUrl: string
  repoName: string
  gitIdentityId: string
  repository: DomainAuthRepository
}

interface IdentityRepoSubmenuProps {
  identity: DomainGitIdentity
  onSelectRepo: (payload: RepoSelectPayload) => void
}

/**
 * IdentityRepoSubmenu 渲染单个 Git 身份的仓库二级菜单，内部用 useIdentityRepos 做服务端
 * 分页：搜索框走后端 keyword 过滤，"加载更多" 按需翻页。仅在子菜单展开时才发起请求（懒加载）。
 */
export function IdentityRepoSubmenu({ identity, onSelectRepo }: IdentityRepoSubmenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const identityId = identity.id || ""

  const { repos, loading, loadingMore, hasNext, total, keyword, setKeyword, loadMore, reload } =
    useIdentityRepos(identityId, { enabled: open && !!identityId })

  const username = identity.username || t("taskWorkflow.repo.unnamedIdentity")
  const identityLabel =
    identity.remark || identity.username || identity.base_url || t("taskWorkflow.repo.unnamedIdentity")

  return (
    <DropdownMenuSub onOpenChange={setOpen}>
      <DropdownMenuSubTrigger className="w-full">
        {getGitPlatformIcon(identity.platform)}
        <span className="truncate">{identityLabel}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="max-h-[320px] min-w-[380px] overflow-y-auto p-0">
          <div className="flex flex-col bg-popover p-2">
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("taskWorkflow.repo.searchPlaceholder")}
                className="text-sm w-full min-w-0"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="shrink-0"
                disabled={loading}
                aria-label={t("taskWorkflow.repo.refreshList")}
                onClick={(e) => {
                  e.stopPropagation()
                  reload(true)
                }}
              >
                <IconReload className={cn("size-4", loading && "animate-spin")} />
              </Button>
            </div>
            <Separator className="my-2" />
            <div className="grid gap-2 overflow-y-auto max-h-[240px]">
              {loading && repos.length === 0 ? (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Spinner className="size-5" />
                    </EmptyMedia>
                    <EmptyDescription>{t("taskWorkflow.repo.loading")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : repos.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {keyword.trim() ? t("taskWorkflow.repo.noMatches") : t("taskWorkflow.repo.empty")}
                </div>
              ) : (
                <>
                  {repos.map((repo) => {
                    const repoUrl = repo.url?.trim() || ""
                    if (!repoUrl) {
                      return null
                    }
                    const repoName = (repo.full_name || repoUrl).replace(`${username}/`, "")
                    const desc = repo.description
                    return (
                      <DropdownMenuItem
                        key={`${identityId}:${repoUrl}`}
                        onSelect={() =>
                          onSelectRepo({ repoUrl, repoName, gitIdentityId: identityId, repository: repo })
                        }
                        className="flex flex-col items-start gap-0.5 py-1 cursor-pointer min-w-0 max-w-full"
                      >
                        <div className="flex items-center gap-2 w-full min-w-0 max-w-[320px]">
                          {getRepoIcon(repoUrl)}
                          <span className="truncate flex-1 text-sm" title={repoName}>
                            {repoName}
                          </span>
                        </div>
                        <span
                          className="text-xs text-muted-foreground truncate w-full max-w-[400px] pl-6"
                          title={desc || undefined}
                        >
                          {desc || t("taskWorkflow.repo.noDescription")}
                        </span>
                      </DropdownMenuItem>
                    )
                  })}
                  {hasNext ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-center text-muted-foreground"
                      disabled={loadingMore}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        loadMore()
                      }}
                    >
                      {loadingMore ? <Spinner className="size-4" /> : null}
                      {t("taskWorkflow.repo.loadMore", { loaded: repos.length, total })}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  )
}
