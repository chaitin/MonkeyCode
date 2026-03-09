import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { IconPasswordFingerprint, IconPencil, IconPlugConnected, IconTrash } from "@tabler/icons-react"
import { getGitPlatformIcon, getGithubAppInstallUrl } from "@/utils/common"
import Icon from "@/components/common/Icon"
import { useCommonData } from "../data-provider"
import { Spinner } from "@/components/ui/spinner"

export default function Identities() {
  const githubAppInstallUrl = getGithubAppInstallUrl()
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

  const handleGiteeBind = () => {
    setGiteeBindLoading(true)
    apiRequest('v1GiteeAuthorizeUrlList', {}, [], (resp) => {
      setGiteeBindLoading(false)
      if (resp.code === 0 && resp.data?.url) {
        const popup = window.open(resp.data.url, "_blank")
        if (popup) {
          const checkClosed = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkClosed)
              reloadIdentities()
            }
          }, 500)
        }
      } else {
        toast.error(resp.message || "获取 Gitee 授权地址失败")
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
        const popup = window.open(resp.data.url, "_blank")
        if (popup) {
          const checkClosed = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkClosed)
              reloadIdentities()
            }
          }, 500)
        }
      } else {
        toast.error(resp.message || "获取 Gitea 授权地址失败")
      }
    }, () => {
      setGiteaBindLoading(false)
    })
  }

  const handleGitLabBind = () => {
    setGitlabBindLoading(true)
    apiRequest('v1GitlabAuthorizeUrlList', { base: 'https://gitlab.com' }, [], (resp) => {
      setGitlabBindLoading(false)
      if (resp.code === 0 && resp.data?.url) {
        const popup = window.open(resp.data.url, "_blank")
        if (popup) {
          const checkClosed = setInterval(() => {
            if (popup.closed) {
              clearInterval(checkClosed)
              reloadIdentities()
            }
          }, 500)
        }
      } else {
        toast.error(resp.message || "获取 GitLab 授权地址失败")
      }
    }, () => {
      setGitlabBindLoading(false)
    })
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
      toast.error("身份信息不完整")
      return
    }

    apiRequest('v1UsersGitIdentitiesDelete', {}, [identity.id], (resp) => {
      if (resp.code === 0) {
        toast.success("身份移除成功")
        reloadIdentities()
      } else {
        toast.error("移除身份失败: " + resp.message)
      }
    })
  }
  const loadIdentities = () => {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            正在加载身份列表...
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
          <Badge variant="secondary" className="font-normal">未绑定</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          点击绑定 GitHub 身份，用于同步代码、提交代码等操作
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={() => githubAppInstallUrl && window.open(githubAppInstallUrl, "_blank")}
          disabled={!githubAppInstallUrl}
        >
          绑定
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
          <Badge variant="secondary" className="font-normal">未绑定</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          点击绑定 Gitee 身份，用于同步代码、提交代码等操作
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGiteeBind}
          disabled={giteeBindLoading}
        >
          {giteeBindLoading ? "获取中..." : "绑定"}
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
          <Badge variant="secondary" className="font-normal">未绑定</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          点击绑定 Gitea 身份，用于同步代码、提交代码等操作
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGiteaBind}
          disabled={giteaBindLoading}
        >
          {giteaBindLoading ? "获取中..." : "绑定"}
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
          <Badge variant="secondary" className="font-normal">未绑定</Badge>
        </ItemTitle>
        <ItemDescription className="hidden md:block">
          点击绑定 GitLab 身份，用于同步代码、提交代码等操作
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="outline"
          size="sm"
          onClick={handleGitLabBind}
          disabled={gitlabBindLoading}
        >
          {gitlabBindLoading ? "获取中..." : "绑定"}
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
              <DropdownMenuItem onClick={() => handleEdit(identity)}>
                <IconPencil />
                修改
              </DropdownMenuItem>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={(e) => { e.preventDefault() }}
                  >
                    <IconTrash />
                    移除
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认移除</AlertDialogTitle>
                    <AlertDialogDescription>
                      确定要移除身份 "{identity.username}" 吗？此操作不可撤销。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        handleDelete(identity)
                      }}
                    >
                      确认移除
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
    <Card className="w-full shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPasswordFingerprint />
          Git 平台身份凭证
        </CardTitle>
        <CardDescription>
          用于在 Git 仓库中提交代码和拉取代码的身份凭证
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                绑定
                <ChevronDown className="ml-1 size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => githubAppInstallUrl && window.open(githubAppInstallUrl, "_blank")}
                disabled={!githubAppInstallUrl}
              >
                <Icon name="GitHub-Uncolor" className="fill-foreground size-4" />
                绑定 GitHub 身份
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleGiteeBind}
                disabled={giteeBindLoading}
              >
                <Icon name="Gitee" className="size-4" />
                绑定 Gitee 身份
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleGiteaBind}
                disabled={giteaBindLoading}
              >
                <Icon name="Gitea" className="size-4" />
                绑定 Gitea 身份
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleGitLabBind}
                disabled={gitlabBindLoading}
              >
                <Icon name="GitLab" className="size-4" />
                绑定 GitLab 身份
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
                <IconPlugConnected className="size-4" />
                绑定其他平台
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AddIdentity
            open={isDialogOpen}
            onOpenChange={setIsDialogOpen}
            onRefresh={reloadIdentities}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {loadingIdentities ? (
          loadIdentities()
        ) : (
          <ItemGroup className="flex flex-col gap-4">
            {!hasGitHubIdentity && githubConnectCard()}
            {!hasGiteeIdentity && giteeConnectCard()}
            {!hasGiteaIdentity && giteaConnectCard()}
            {!hasGitLabIdentity && gitlabConnectCard()}
            {identityItems()}
          </ItemGroup>
        )}
      </CardContent>
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
    </Card>
  )
}
