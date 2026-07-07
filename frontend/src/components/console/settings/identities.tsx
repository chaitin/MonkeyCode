import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import AddIdentity from "@/components/console/settings/add-identity"
import EditIdentity from "@/components/console/settings/edit-identity"

import { ChevronDown, MoreVertical } from "lucide-react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { type DomainGitIdentity, ConstsGitPlatform } from "@/api/Api"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { IconAlertHexagon, IconPasswordFingerprint, IconPencil, IconPlugConnected, IconRefresh, IconTrash } from "@tabler/icons-react"
import { getGitPlatformIcon, getGithubAppInstallUrl } from "@/utils/common"
import { IS_OFFLINE_EDITION } from "@/utils/edition"
import Icon from "@/components/common/Icon"
import { useCommonData } from "../data-provider"
import { Spinner } from "@/components/ui/spinner"
import { useTranslation } from "react-i18next"
import { useAppRuntime } from "@/components/app-runtime-provider"

export default function Identities() {
  const { t } = useTranslation()
  const { serverConfig } = useAppRuntime()
  const isGlobalRegion = serverConfig?.region === "global"
  const githubAppInstallUrl = getGithubAppInstallUrl(isGlobalRegion)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [giteeBindLoading, setGiteeBindLoading] = useState(false)
  const [giteaBindLoading, setGiteaBindLoading] = useState(false)
  const [gitlabBindLoading, setGitlabBindLoading] = useState(false)

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingIdentity, setEditingIdentity] = useState<DomainGitIdentity | null>(null)

  const { identities, reloadIdentities, loadingIdentities } = useCommonData();

  const hasGitHubIdentity = identities.some(
    (identity) => identity.platform === ConstsGitPlatform.GitPlatformGithub
  )
  const hasGiteeIdentity = identities.some(
    (identity) => identity.platform === ConstsGitPlatform.GitPlatformGitee
  )
  const hasGiteaIdentity = identities.some(
    (identity) => identity.platform === ConstsGitPlatform.GitPlatformGitea
  )
  const hasGitLabIdentity = identities.some(
    (identity) => identity.platform === ConstsGitPlatform.GitPlatformGitLab
  )
  const showPlatformConnectCards = !IS_OFFLINE_EDITION
  const hasPlatformConnectCards =
    showPlatformConnectCards &&
    (!hasGitHubIdentity || !hasGiteeIdentity || !hasGiteaIdentity || !hasGitLabIdentity)

  const openAuthorizePopup = (url: string) => {
    const popup = window.open(url, "_blank")
    if (!popup) return

    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed)
        reloadIdentities()
      }
    }, 500)
  }

  const handleGithubBind = () => {
    if (!githubAppInstallUrl) return
    openAuthorizePopup(githubAppInstallUrl)
  }

  const handleGiteeBind = () => {
    setGiteeBindLoading(true)
    apiRequest('v1GiteeAuthorizeUrlList', {}, [], (resp) => {
      setGiteeBindLoading(false)
      if (resp.code === 0 && resp.data?.url) {
        openAuthorizePopup(resp.data.url)
      } else {
        toast.error(resp.message || t("consoleSettings.identities.toast.authorizeUrlFailed", { platform: "Gitee" }))
      }
    }, () => {
      setGiteeBindLoading(false)
    })
  }

  const handleGiteaBind = () => {
    setGiteaBindLoading(true)
    apiRequest('v1GiteaAuthorizeUrlList', {}, [], (resp) => {
      setGiteaBindLoading(false)
      if (resp.code === 0 && resp.data?.url) {
        openAuthorizePopup(resp.data.url)
      } else {
        toast.error(resp.message || t("consoleSettings.identities.toast.authorizeUrlFailed", { platform: "Gitea" }))
      }
    }, () => {
      setGiteaBindLoading(false)
    })
  }

  const handleGitLabBind = (baseUrl = "https://gitlab.com") => {
    setGitlabBindLoading(true)
    apiRequest('v1GitlabAuthorizeUrlList', { base: baseUrl }, [], (resp) => {
      setGitlabBindLoading(false)
      if (resp.code === 0 && resp.data?.url) {
        openAuthorizePopup(resp.data.url)
      } else {
        toast.error(resp.message || t("consoleSettings.identities.toast.authorizeUrlFailed", { platform: "GitLab" }))
      }
    }, () => {
      setGitlabBindLoading(false)
    })
  }

  const handleCnbBind = () => {
    apiRequest('v1CnbAuthorizeUrlList', {}, [], (resp) => {
      if (resp.code === 0 && resp.data?.url) {
        openAuthorizePopup(resp.data.url)
      } else {
        toast.error(resp.message || t("consoleSettings.identities.toast.authorizeUrlFailed", { platform: "CNB" }))
      }
    })
  }

  const handleRebind = (identity: DomainGitIdentity) => {
    switch (identity.platform) {
      case ConstsGitPlatform.GitPlatformGithub:
        handleGithubBind()
        break
      case ConstsGitPlatform.GitPlatformGitee:
        handleGiteeBind()
        break
      case ConstsGitPlatform.GitPlatformGitea:
        handleGiteaBind()
        break
      case ConstsGitPlatform.GitPlatformGitLab:
        handleGitLabBind(identity.base_url || "https://gitlab.com")
        break
      case ConstsGitPlatform.GitPlatformCnb:
        handleCnbBind()
        break
      default:
        toast.error(t("consoleSettings.identities.toast.authorizeUrlFailed", { platform: identity.platform || "" }))
        break
    }
  }

  const handleEdit = (identity: DomainGitIdentity) => {
    setEditingIdentity(identity)
    setIsEditDialogOpen(true)
  }

  const handleEditCancel = () => {
    setEditingIdentity(null)
    setIsEditDialogOpen(false)
  }

  const handleDelete = (identity: DomainGitIdentity) => {
    if (!identity.id) {
      toast.error(t("consoleSettings.identities.toast.incomplete"))
      return
    }

    apiRequest('v1UsersGitIdentitiesDelete', {}, [identity.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.identities.toast.removeSuccess"))
        reloadIdentities()
      } else {
        toast.error(t("consoleSettings.identities.toast.removeFailed", { message: resp.message }))
      }
    })
  }
  const loadIdentities = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            {t("consoleSettings.identities.loading")}
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  } 

  const noIdentities = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertHexagon />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            {t("consoleSettings.identities.empty")}
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const githubConnectCard = () => (
    <Item variant="outline" className="hover:border-primary/50 border-dashed" size="sm">
      <ItemMedia className="hidden sm:flex">
        <Avatar>
          <AvatarFallback>
            <Icon name="GitHub-Uncolor" className="fill-foreground size-4" />
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2 break-all">
          GitHub
          <Badge variant="secondary" className="font-normal">{t("consoleSettings.identities.status.unbound")}</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          {t("consoleSettings.identities.connectDescription", { platform: "GitHub" })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGithubBind}
          disabled={!githubAppInstallUrl}
        >
          {t("consoleSettings.identities.actions.bind")}
        </Button>
      </ItemActions>
    </Item>
  )

  const giteeConnectCard = () => (
    <Item variant="outline" className="hover:border-primary/50 border-dashed" size="sm">
      <ItemMedia className="hidden sm:flex">
        <Avatar>
          <AvatarFallback>
            <Icon name="Gitee" className="size-4" />
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2 break-all">
          Gitee
          <Badge variant="secondary" className="font-normal">{t("consoleSettings.identities.status.unbound")}</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          {t("consoleSettings.identities.connectDescription", { platform: "Gitee" })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGiteeBind}
          disabled={giteeBindLoading}
        >
          {giteeBindLoading ? t("consoleSettings.identities.actions.fetching") : t("consoleSettings.identities.actions.bind")}
        </Button>
      </ItemActions>
    </Item>
  )

  const giteaConnectCard = () => (
    <Item variant="outline" className="hover:border-primary/50 border-dashed" size="sm">
      <ItemMedia className="hidden sm:flex">
        <Avatar>
          <AvatarFallback>
            <Icon name="Gitea" className="size-4" />
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2 break-all">
          Gitea
          <Badge variant="secondary" className="font-normal">{t("consoleSettings.identities.status.unbound")}</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          {t("consoleSettings.identities.connectDescription", { platform: "Gitea" })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGiteaBind}
          disabled={giteaBindLoading}
        >
          {giteaBindLoading ? t("consoleSettings.identities.actions.fetching") : t("consoleSettings.identities.actions.bind")}
        </Button>
      </ItemActions>
    </Item>
  )

  const gitlabConnectCard = () => (
    <Item variant="outline" className="hover:border-primary/50 border-dashed" size="sm">
      <ItemMedia className="hidden sm:flex">
        <Avatar>
          <AvatarFallback>
            <Icon name="GitLab" className="size-4" />
          </AvatarFallback>
        </Avatar>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2 break-all">
          GitLab
          <Badge variant="secondary" className="font-normal">{t("consoleSettings.identities.status.unbound")}</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          {t("consoleSettings.identities.connectDescription", { platform: "GitLab" })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleGitLabBind()}
          disabled={gitlabBindLoading}
        >
          {gitlabBindLoading ? t("consoleSettings.identities.actions.fetching") : t("consoleSettings.identities.actions.bind")}
        </Button>
      </ItemActions>
    </Item>
  )

  const identityItems = () =>
    identities.map((identity) => (
      <Item key={identity.id} variant="outline" className="hover:border-primary/50" size="sm">
        <ItemMedia className="hidden sm:flex">
          <Avatar>
            <AvatarFallback>
              {getGitPlatformIcon(identity.platform)}
            </AvatarFallback>
          </Avatar>
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="break-all">
            {identity.remark || identity.username}
          </ItemTitle>
          <ItemDescription className="hidden md:block">
            {identity.base_url}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {identity.is_installation_app === true && (
                <DropdownMenuItem onClick={() => handleRebind(identity)}>
                  <IconRefresh />
                  {t("consoleSettings.identities.actions.rebind")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => handleEdit(identity)}>
                <IconPencil />
                {t("consoleSettings.identities.actions.edit")}
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={(e) => { e.preventDefault() }}
                  >
                    <IconTrash />
                    {t("consoleSettings.identities.actions.remove")}
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("consoleSettings.identities.delete.title")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("consoleSettings.identities.delete.description", { name: identity.username })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("consoleSettings.identities.actions.cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        handleDelete(identity)
                      }}
                    >
                      {t("consoleSettings.identities.delete.confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>
    ))


  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <IconPasswordFingerprint />
            {t("consoleSettings.identities.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.identities.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {t("consoleSettings.identities.actions.bind")}
                <ChevronDown className="ml-1 size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 min-w-48">
              {showPlatformConnectCards && (
                <>
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={handleGithubBind}
                    disabled={!githubAppInstallUrl}
                  >
                    <Icon name="GitHub-Uncolor" className="fill-foreground size-4" />
                    {t("consoleSettings.identities.actions.bindPlatform", { platform: "GitHub" })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={handleGiteeBind}
                    disabled={giteeBindLoading}
                  >
                    <Icon name="Gitee" className="size-4" />
                    {t("consoleSettings.identities.actions.bindPlatform", { platform: "Gitee" })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={handleGiteaBind}
                    disabled={giteaBindLoading}
                  >
                    <Icon name="Gitea" className="size-4" />
                    {t("consoleSettings.identities.actions.bindPlatform", { platform: "Gitea" })}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    onClick={() => handleGitLabBind()}
                    disabled={gitlabBindLoading}
                  >
                    <Icon name="GitLab" className="size-4" />
                    {t("consoleSettings.identities.actions.bindPlatform", { platform: "GitLab" })}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem className="whitespace-nowrap" onClick={() => setIsDialogOpen(true)}>
                <IconPlugConnected className="size-4" />
                {t("consoleSettings.identities.actions.bindOther")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AddIdentity
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onRefresh={reloadIdentities}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingIdentities ? (
          loadIdentities()
        ) : identities.length === 0 && !hasPlatformConnectCards ? (
          noIdentities()
        ) : (
          <ItemGroup className="flex flex-col gap-4">
            {showPlatformConnectCards && !hasGitHubIdentity && githubConnectCard()}
            {showPlatformConnectCards && !hasGiteeIdentity && giteeConnectCard()}
            {showPlatformConnectCards && !hasGiteaIdentity && giteaConnectCard()}
            {showPlatformConnectCards && !hasGitLabIdentity && gitlabConnectCard()}
            {identityItems()}
          </ItemGroup>
        )}
      </div>
      <EditIdentity
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleEditCancel()
          }
        }}
        identity={editingIdentity}
        onRefresh={reloadIdentities}
      />
    </div>
  )
}
