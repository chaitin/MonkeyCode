import { useEffect, useState } from "react"
import { Blocks, MoreVertical, Plus, ServerCog } from "lucide-react"

import { Api, type DomainCreateUserMCPUpstreamReq, type DomainMCPTool, type DomainMCPUpstream } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Switch } from "@/components/ui/switch"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"
import { IconPencil, IconTrash } from "@tabler/icons-react"
import AddMcpServerDialog from "./add-mcp-server-dialog"

export default function ToolsAndMcp() {
  const [servers, setServers] = useState<DomainMCPUpstream[]>([])
  const [loading, setLoading] = useState(true)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [syncingServerId, setSyncingServerId] = useState<string | null>(null)
  const [deletingServerId, setDeletingServerId] = useState<string | null>(null)
  const [togglingToolId, setTogglingToolId] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState<DomainMCPUpstream | null>(null)

  const loadData = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoading(true)
    }
    try {
      const api = new Api()
      const upstreamsResp = await api.api.v1UsersMcpUpstreamsList({ limit: 100 })

      if (upstreamsResp.data?.code === 0) {
        setServers(upstreamsResp.data?.data?.items || [])
      } else {
        toast.error(upstreamsResp.data?.message || "加载 MCP 服务失败")
      }
    } catch {
      toast.error("加载 MCP 配置失败")
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleAddServer = async (
    payload: DomainCreateUserMCPUpstreamReq
  ): Promise<boolean> => {
    setIsCreating(true)
    try {
      const api = new Api()
      const resp = await api.api.v1UsersMcpUpstreamsCreate(payload)
      if (resp.data?.code === 0) {
        toast.success("MCP 服务器创建成功")
        await loadData()
        return true
      }

      toast.error(resp.data?.message || "MCP 服务器创建失败")
      return false
    } catch {
      toast.error("MCP 服务器创建失败")
      return false
    } finally {
      setIsCreating(false)
    }
  }

  const handleEditServer = async (
    payload: DomainCreateUserMCPUpstreamReq
  ): Promise<boolean> => {
    if (!editingServer?.id) {
      toast.error("MCP 服务器信息不完整")
      return false
    }

    setIsUpdating(true)
    try {
      const api = new Api()
      const resp = await api.api.v1UsersMcpUpstreamsUpdate(editingServer.id, payload)
      if (resp.data?.code === 0) {
        toast.success("MCP 服务器修改成功")
        await loadData()
        return true
      }

      toast.error(resp.data?.message || "MCP 服务器修改失败")
      return false
    } catch {
      toast.error("MCP 服务器修改失败")
      return false
    } finally {
      setIsUpdating(false)
    }
  }

  const handleSyncServer = async (server: DomainMCPUpstream) => {
    if (!server.id) {
      toast.error("MCP 服务器信息不完整")
      return
    }

    setSyncingServerId(server.id)
    try {
      const api = new Api()
      const resp = await api.api.v1UsersMcpUpstreamsSyncCreate(server.id)
      if (resp.data?.code === 0) {
        toast.success("MCP 服务器同步成功")
        await loadData({ silent: true })
      } else {
        toast.error(resp.data?.message || "MCP 服务器同步失败")
      }
    } catch {
      toast.error("MCP 服务器同步失败")
    } finally {
      setSyncingServerId(null)
    }
  }

  const handleDeleteServer = async (server: DomainMCPUpstream) => {
    if (!server.id) {
      toast.error("MCP 服务器信息不完整")
      return
    }

    setDeletingServerId(server.id)
    try {
      const api = new Api()
      const resp = await api.api.v1UsersMcpUpstreamsDelete(server.id)
      if (resp.data?.code === 0) {
        toast.success("MCP 服务器删除成功")
        await loadData({ silent: true })
      } else {
        toast.error(resp.data?.message || "MCP 服务器删除失败")
      }
    } catch {
      toast.error("MCP 服务器删除失败")
    } finally {
      setDeletingServerId(null)
    }
  }

  const handleToggleTool = async (tool: DomainMCPTool, enabled: boolean) => {
    if (!tool.id) {
      toast.error("工具信息不完整")
      return
    }

    setTogglingToolId(tool.id)
    try {
      const api = new Api()
      const resp = await api.api.v1UsersMcpToolsUpdate(tool.id, { enabled })
      if (resp.data?.code === 0) {
        setServers((current) =>
          current.map((server) => ({
            ...server,
            tools: (server.tools || []).map((item) =>
              item.id === tool.id
                ? {
                    ...item,
                    enabled,
                  }
                : item
            ),
          }))
        )
      } else {
        toast.error(resp.data?.message || "工具开关更新失败")
      }
    } catch {
      toast.error("工具开关更新失败")
    } finally {
      setTogglingToolId(null)
    }
  }

  const renderToolList = ({
    items,
    interactive = false,
  }: {
    items: DomainMCPTool[]
    interactive?: boolean
  }) => {
    if (items.length === 0) {
      return (
        <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          暂无工具
        </div>
      )
    }

    return items.map((tool) => (
      <div
        key={tool.id || tool.name}
        className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2"
      >
        <div className="min-w-0">
          <div
            className={Boolean(tool.enabled)
              ? "flex items-center gap-2 text-sm font-medium leading-none"
              : "flex items-center gap-2 text-sm font-medium leading-none text-muted-foreground"}
          >
            <span className="truncate">{tool.name}</span>
            {tool.price && tool.price > 0 ? (
              <Badge variant="default" className="shrink-0">
                {tool.price / 1000} 积分/次
              </Badge>
            ) : null}
          </div>
          <TooltipProvider delayDuration={500}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={Boolean(tool.enabled)
                    ? "mt-1 line-clamp-1 text-xs text-muted-foreground"
                    : "mt-1 line-clamp-1 text-xs text-muted-foreground/60"}
                >
                  {tool.description || "暂无描述"}
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-lg whitespace-pre-wrap break-words">
                {tool.description || "暂无描述"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {interactive ? (
          <div className="flex items-center gap-2">
            {togglingToolId === tool.id ? (
              <Spinner className="size-3.5 text-muted-foreground" />
            ) : null}
            <Switch
              checked={Boolean(tool.enabled)}
              size="sm"
              disabled={togglingToolId === tool.id}
              aria-label={`${tool.name} 启用状态`}
              onCheckedChange={(checked) => handleToggleTool(tool, checked)}
            />
          </div>
        ) : (
          <Switch
            checked={Boolean(tool.enabled)}
            size="sm"
            disabled
            aria-label={`${tool.name} 启用状态`}
          />
        )}
      </div>
    ))
  }

  const renderServerCard = ({
    key,
    name,
    url,
    description,
    tools,
    editable,
    isPlatform,
    onEdit,
    onSync,
    onDelete,
    syncing,
    deleting,
    toolInteractive = false,
  }: {
    key: string
    name: string
    url?: string
    description?: string
    tools: DomainMCPTool[]
    editable: boolean
    isPlatform?: boolean
    onEdit?: () => void
    onSync?: () => void
    onDelete?: () => void
    syncing?: boolean
    deleting?: boolean
    toolInteractive?: boolean
  }) => {
    return (
      <Item key={key} variant="outline" className="items-start" size="sm">
        <ItemMedia className="hidden sm:flex">
          <div className="flex size-8 items-center justify-center rounded-md bg-muted">
            <ServerCog className="size-4" />
          </div>
        </ItemMedia>

        <ItemContent className="min-w-0 gap-3">
          <ItemHeader className="items-start gap-3">
            <div className="min-w-0">
              <ItemTitle className="w-full min-w-0 flex-wrap">
                <span className="truncate">{name}</span>
              </ItemTitle>
              {url ? (
                <div className="mt-1 break-all text-xs text-muted-foreground">
                  {url}
                </div>
              ) : null}
            </div>
            {isPlatform ? (
              <ItemActions className="shrink-0">
                <Badge variant="outline">内置 MCP 服务</Badge>
              </ItemActions>
            ) : null}
            {editable ? (
              <ItemActions className="shrink-0 gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <>
                      <Spinner className="size-3.5" />
                      同步中
                    </>
                  ) : (
                    "同步"
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={onEdit} disabled={syncing || deleting}>
                      <IconPencil />
                      修改
                    </DropdownMenuItem>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={(e) => { e.preventDefault() }}
                          disabled={syncing || deleting}
                        >
                          <IconTrash />
                          {deleting ? "删除中" : "删除"}
                        </DropdownMenuItem>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除</AlertDialogTitle>
                          <AlertDialogDescription>
                            确定要删除 MCP 服务器 "{name}" 吗？此操作不可撤销。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={onDelete} disabled={deleting}>
                            {deleting ? "删除中..." : "确认删除"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            ) : null}
          </ItemHeader>

          {description ? (
            <ItemDescription className="line-clamp-none">
              {description}
            </ItemDescription>
          ) : null}

          <ItemFooter className="items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              {renderToolList({ items: tools, interactive: toolInteractive })}
            </div>
          </ItemFooter>
        </ItemContent>
      </Item>
    )
  }

  const loadServers = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            正在加载 MCP 服务列表...
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const orderedServers = [...servers].sort((left, right) => {
    const leftIsPlatform = left.scope === "platform"
    const rightIsPlatform = right.scope === "platform"

    if (leftIsPlatform === rightIsPlatform) {
      return 0
    }

    return leftIsPlatform ? -1 : 1
  })

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-2 font-semibold leading-none">
              <Blocks />
              MCP 与工具
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              管理 MCP 服务器及其提供的工具能力。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsAddDialogOpen(true)}
          >
            <Plus className="size-4" />
            添加
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {loading ? (
            loadServers()
          ) : (
            <ItemGroup className="flex flex-col gap-4">
              {orderedServers.map((server) =>
                renderServerCard({
                  key: server.id || server.name || server.url || Math.random().toString(36),
                  name: server.name || "未命名 MCP 服务",
                  url: server.url,
                  description: server.description,
                  tools: server.tools || [],
                  editable: server.scope !== "platform",
                  isPlatform: server.scope === "platform",
                  toolInteractive: true,
                  onEdit: () => {
                    setEditingServer(server)
                    setIsEditDialogOpen(true)
                  },
                  onSync: () => handleSyncServer(server),
                  onDelete: () => handleDeleteServer(server),
                  syncing: syncingServerId === server.id,
                  deleting: deletingServerId === server.id,
                })
              )}
            </ItemGroup>
          )}
        </div>
      </div>
      <AddMcpServerDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onSubmit={handleAddServer}
        saving={isCreating}
      />
      <AddMcpServerDialog
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          setIsEditDialogOpen(open)
          if (!open) {
            setEditingServer(null)
          }
        }}
        onSubmit={handleEditServer}
        saving={isUpdating}
        server={editingServer}
      />
    </>
  )
}
