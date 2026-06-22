import { useEffect, useMemo, useState } from "react"
import { Blocks, MoreVertical, Plus, ServerCog } from "lucide-react"
import { IconPencil, IconRefresh, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import {
  Api,
  type DomainCreateTeamMCPUpstreamReq,
  type DomainMCPTool,
  type DomainTeamGroup,
  type DomainTeamMCPUpstream,
  type DomainUpdateTeamMCPUpstreamReq,
} from "@/api/Api"
import TeamMCPServerDialog from "@/components/manager/team-mcp-server-dialog"
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
import { Badge } from "@/components/ui/badge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTranslation } from "react-i18next"

type TeamMCPUpstreamPayload =
  | DomainCreateTeamMCPUpstreamReq
  | DomainUpdateTeamMCPUpstreamReq

type Translate = (key: string, options?: Record<string, unknown>) => string

export default function TeamManagerMCP() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<DomainTeamMCPUpstream[]>([])
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [syncingServerId, setSyncingServerId] = useState<string | null>(null)
  const [deletingServerId, setDeletingServerId] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState<DomainTeamMCPUpstream | null>(null)

  const loadData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true)
    }

    try {
      const api = new Api()
      const [upstreamsResp, groupsResp] = await Promise.all([
        api.api.v1TeamsMcpUpstreamsList(),
        api.api.v1TeamsGroupsList(),
      ])

      if (upstreamsResp.data?.code === 0) {
        setServers(upstreamsResp.data.data?.items || [])
      } else {
        toast.error(upstreamsResp.data?.message || t("managerMcp.toast.fetchServersFailed"))
      }

      if (groupsResp.data?.code === 0) {
        setGroups(groupsResp.data.data?.groups || [])
      } else {
        toast.error(groupsResp.data?.message || t("managerMcp.toast.fetchGroupsFailed"))
      }
    } catch {
      toast.error(t("managerMcp.toast.fetchConfigFailed"))
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const orderedServers = useMemo(
    () =>
      [...servers].sort((left, right) => {
        const leftTime = left.created_at || 0
        const rightTime = right.created_at || 0
        return rightTime - leftTime
      }),
    [servers]
  )

  const handleCreateServer = async (payload: TeamMCPUpstreamPayload) => {
    setCreating(true)
    try {
      const api = new Api()
      const resp = await api.api.v1TeamsMcpUpstreamsCreate(payload as DomainCreateTeamMCPUpstreamReq)
      if (resp.data?.code === 0) {
        toast.success(t("managerMcp.toast.created"))
        await loadData({ silent: true })
        return true
      }

      toast.error(resp.data?.message || t("managerMcp.toast.createFailed"))
      return false
    } catch {
      toast.error(t("managerMcp.toast.createFailed"))
      return false
    } finally {
      setCreating(false)
    }
  }

  const handleUpdateServer = async (payload: TeamMCPUpstreamPayload) => {
    if (!editingServer?.id) {
      toast.error(t("managerMcp.toast.incompleteServer"))
      return false
    }

    setUpdating(true)
    try {
      const api = new Api()
      const resp = await api.api.v1TeamsMcpUpstreamsUpdate(
        editingServer.id,
        payload as DomainUpdateTeamMCPUpstreamReq
      )
      if (resp.data?.code === 0) {
        toast.success(t("managerMcp.toast.updated"))
        await loadData({ silent: true })
        return true
      }

      toast.error(resp.data?.message || t("managerMcp.toast.updateFailed"))
      return false
    } catch {
      toast.error(t("managerMcp.toast.updateFailed"))
      return false
    } finally {
      setUpdating(false)
    }
  }

  const handleSyncServer = async (server: DomainTeamMCPUpstream) => {
    if (!server.id) {
      toast.error(t("managerMcp.toast.incompleteServer"))
      return
    }

    setSyncingServerId(server.id)
    try {
      const api = new Api()
      const resp = await api.api.v1TeamsMcpUpstreamsSyncCreate(server.id)
      if (resp.data?.code === 0) {
        toast.success(t("managerMcp.toast.synced"))
        await loadData({ silent: true })
        return
      }

      toast.error(resp.data?.message || t("managerMcp.toast.syncFailed"))
    } catch {
      toast.error(t("managerMcp.toast.syncFailed"))
    } finally {
      setSyncingServerId(null)
    }
  }

  const handleDeleteServer = async (server: DomainTeamMCPUpstream) => {
    if (!server.id) {
      toast.error(t("managerMcp.toast.incompleteServer"))
      return
    }

    setDeletingServerId(server.id)
    try {
      const api = new Api()
      const resp = await api.api.v1TeamsMcpUpstreamsDelete(server.id)
      if (resp.data?.code === 0) {
        toast.success(t("managerMcp.toast.deleted"))
        await loadData({ silent: true })
        return
      }

      toast.error(resp.data?.message || t("managerMcp.toast.deleteFailed"))
    } catch {
      toast.error(t("managerMcp.toast.deleteFailed"))
    } finally {
      setDeletingServerId(null)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <Card className="w-full shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Blocks />
              MCP
            </CardTitle>
            <CardDescription>
              {t("managerMcp.description")}
            </CardDescription>
            <CardAction>
              <Button type="button" onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4" />
                {t("managerMcp.actions.add")}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ServerListSkeleton />
            ) : orderedServers.length === 0 ? (
              <Empty className="bg-muted">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Blocks className="size-6" />
                  </EmptyMedia>
                  <EmptyTitle>{t("managerMcp.empty.title")}</EmptyTitle>
                  <EmptyDescription>{t("managerMcp.empty.description")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ItemGroup className="flex flex-col gap-4">
                {orderedServers.map((server) => (
                  <ServerItem
                    key={server.id || server.slug || server.name}
                    server={server}
                    syncing={syncingServerId === server.id}
                    deleting={deletingServerId === server.id}
                    onEdit={() => {
                      setEditingServer(server)
                      setEditDialogOpen(true)
                    }}
                    onSync={() => void handleSyncServer(server)}
                    onDelete={() => void handleDeleteServer(server)}
                  />
                ))}
              </ItemGroup>
            )}
          </CardContent>
        </Card>
      </div>

      <TeamMCPServerDialog
        groups={groups}
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={handleCreateServer}
        saving={creating}
      />
      <TeamMCPServerDialog
        groups={groups}
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) {
            setEditingServer(null)
          }
        }}
        onSubmit={handleUpdateServer}
        saving={updating}
        server={editingServer}
      />
    </>
  )
}

function ServerListSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-lg border p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-8 shrink-0" />
            <div className="grid flex-1 gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-3/5" />
              <div className="grid gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ServerItem({
  server,
  syncing,
  deleting,
  onEdit,
  onSync,
  onDelete,
}: {
  server: DomainTeamMCPUpstream
  syncing: boolean
  deleting: boolean
  onEdit: () => void
  onSync: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const tools = server.tools || []
  const groups = server.groups || []
  const editable = server.scope !== "platform"

  return (
    <Item variant="outline" className="items-start" size="sm">
      <ItemMedia className="hidden sm:flex">
        <div className="flex size-8 items-center justify-center rounded-md bg-muted">
          <ServerCog className="size-4" />
        </div>
      </ItemMedia>
      <ItemContent className="min-w-0 gap-3">
        <ItemHeader className="items-start gap-3">
          <div className="min-w-0">
            <ItemTitle className="w-full min-w-0 flex-wrap">
              <span className="truncate">{server.name || t("managerMcp.fallback.unnamedServer")}</span>
            </ItemTitle>
            {server.url ? (
              <div className="mt-1 break-all text-xs text-muted-foreground">{server.url}</div>
            ) : null}
          </div>
          <ItemActions className="shrink-0 gap-2">
            <UpstreamStateBadges server={server} />
            {editable ? (
              <>
                <Button type="button" variant="outline" size="sm" onClick={onSync} disabled={syncing || deleting}>
                  <IconRefresh className="size-4" />
                  {syncing ? t("managerMcp.actions.syncing") : t("managerMcp.actions.sync")}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" disabled={syncing || deleting}>
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onEdit} disabled={syncing || deleting}>
                      <IconPencil />
                      {t("managerMcp.actions.edit")}
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          className="text-destructive"
                          disabled={syncing || deleting}
                          onSelect={(event) => event.preventDefault()}
                        >
                          <IconTrash />
                          {deleting ? t("managerMcp.actions.deleting") : t("managerMcp.actions.delete")}
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("managerMcp.delete.title")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("managerMcp.delete.description", { name: server.name || t("managerMcp.fallback.unnamedServer") })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting}>{t("managerShell.common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={onDelete} disabled={deleting}>
                            {deleting ? t("managerMcp.delete.deleting") : t("managerMcp.delete.confirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : null}
          </ItemActions>
        </ItemHeader>

        {server.description ? (
          <ItemDescription className="line-clamp-none">{server.description}</ItemDescription>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {groups.length > 0 ? (
            groups.map((group) => (
              <Badge variant="outline" key={group.id || group.name}>
                {group.name}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">{t("managerMcp.groups.defaultGroup")}</span>
          )}
        </div>

        <ItemFooter className="items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <ToolList tools={tools} />
          </div>
        </ItemFooter>
      </ItemContent>
    </Item>
  )
}

function UpstreamStateBadges({ server }: { server: DomainTeamMCPUpstream }) {
  const { t } = useTranslation()

  return (
    <div className="hidden flex-wrap justify-end gap-2 md:flex">
      <Badge variant={server.enabled === false ? "secondary" : "outline"}>
        {server.enabled === false ? t("managerMcp.status.disabled") : t("managerMcp.status.enabled")}
      </Badge>
      {server.sync_status ? (
        <Badge variant="outline">{t("managerMcp.status.sync", { status: formatStatus(server.sync_status, t) })}</Badge>
      ) : null}
      {server.health_status ? (
        <Badge variant="outline">{t("managerMcp.status.health", { status: formatStatus(server.health_status, t) })}</Badge>
      ) : null}
    </div>
  )
}

function ToolList({ tools }: { tools: DomainMCPTool[] }) {
  const { t } = useTranslation()

  if (tools.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        {t("managerMcp.tools.empty")}
      </div>
    )
  }

  return tools.map((tool) => (
    <div
      key={tool.id || tool.namespaced_name || tool.name}
      className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
    >
      <div className="min-w-0">
        <div
          className={
            Boolean(tool.enabled)
              ? "flex items-center gap-2 text-sm font-medium leading-none"
              : "flex items-center gap-2 text-sm font-medium leading-none text-muted-foreground"
          }
        >
          <span className="truncate">{tool.name || tool.namespaced_name || t("managerMcp.tools.unnamed")}</span>
        </div>
        <Tooltip delayDuration={500}>
          <TooltipTrigger asChild>
            <div
              className={
                Boolean(tool.enabled)
                  ? "mt-1 line-clamp-1 text-xs text-muted-foreground"
                  : "mt-1 line-clamp-1 text-xs text-muted-foreground/60"
              }
            >
              {tool.description || t("managerMcp.tools.noDescription")}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-lg whitespace-pre-wrap break-words">
            {tool.description || t("managerMcp.tools.noDescription")}
          </TooltipContent>
        </Tooltip>
      </div>
      <Switch
        checked={Boolean(tool.enabled)}
        size="sm"
        disabled
        aria-label={t("managerMcp.tools.enabledAria", { name: tool.name || tool.namespaced_name || t("managerMcp.tools.unnamedAria") })}
      />
    </div>
  ))
}

function formatStatus(status: string, t: Translate) {
  const statusMap: Record<string, string> = {
    healthy: t("managerMcp.status.values.healthy"),
    unhealthy: t("managerMcp.status.values.unhealthy"),
    success: t("managerMcp.status.values.success"),
    failed: t("managerMcp.status.values.failed"),
    syncing: t("managerMcp.status.values.syncing"),
    pending: t("managerMcp.status.values.pending"),
  }

  return statusMap[status] || status
}
