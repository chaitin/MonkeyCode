import { useState, type FormEvent } from "react"
import {
  Delete02Icon,
  Edit02Icon,
  McpServerIcon,
  MoreHorizontalIcon,
  PlusSignIcon,
  TestTube01Icon,
  ToolboxIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { AuthorizationSelect } from "@/components/authorization-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"

type McpServerType = "system" | "user"
type McpAuthorizationMode = "none" | "independent" | "centralized"
type McpAuthorizationMethod = "oauth" | "httpHeader"
type ConnectionStatus = "connected" | "error" | "unknown"

type McpToolConfig = {
  id: string
  name: string
  description: string
  enabled: boolean
  pointsPerCall: number
}

type McpServer = {
  id: string
  name: string
  description: string
  type: McpServerType
  creator: string
  url: string
  authorizationMode: McpAuthorizationMode
  authorizationMethod: McpAuthorizationMethod | null
  hasHttpHeaders: boolean
  centralizedAuthorized: boolean
  authorization: AuthorizationSelection
  connectionStatus: ConnectionStatus
  toolCount: number
}

const ADMIN_CREATOR = "MonkeyAI Admin"

const TOOL_NAMES_BY_SERVER: Record<string, string[]> = {
  "mcp-google-drive": [
    "search_files",
    "read_file",
    "list_shared_drives",
    "list_files",
    "get_file_metadata",
    "download_file",
  ],
  "mcp-github": [
    "search_code",
    "get_file_contents",
    "list_issues",
    "create_issue",
    "list_pull_requests",
    "get_pull_request",
    "create_pull_request_review",
  ],
  "mcp-postgres": [
    "list_schemas",
    "list_tables",
    "describe_table",
    "query",
    "explain_query",
  ],
  "mcp-sentry": [
    "list_issues",
    "get_issue_details",
    "search_events",
    "list_projects",
  ],
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  search_files: "按名称、内容或类型搜索文件。",
  read_file: "读取指定文件的正文内容。",
  list_shared_drives: "列出当前账号可以访问的共享云端硬盘。",
  list_files: "列出指定目录或云端硬盘中的文件。",
  get_file_metadata: "获取文件的名称、类型、大小和更新时间等信息。",
  download_file: "下载指定文件的原始内容。",
  search_code: "在 GitHub 仓库中搜索代码。",
  get_file_contents: "读取 GitHub 仓库中的文件或目录内容。",
  list_issues: "列出仓库中的 Issue。",
  create_issue: "在指定仓库中创建 Issue。",
  list_pull_requests: "列出仓库中的 Pull Request。",
  get_pull_request: "获取指定 Pull Request 的详细信息。",
  create_pull_request_review: "为 Pull Request 创建评审。",
  list_schemas: "列出数据库中的 Schema。",
  list_tables: "列出指定 Schema 中的数据表。",
  describe_table: "查看数据表的字段、类型和约束。",
  query: "执行只读 SQL 查询并返回结果。",
  explain_query: "分析 SQL 查询的执行计划。",
  get_issue_details: "获取线上问题的详情和上下文。",
  search_events: "根据条件搜索错误和性能事件。",
  list_projects: "列出当前账号可以访问的项目。",
}

function createToolConfigs(server: McpServer): McpToolConfig[] {
  const knownNames = TOOL_NAMES_BY_SERVER[server.id] ?? []
  const namePrefix = server.name
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")

  return Array.from({ length: server.toolCount }, (_, index) => {
    const name = knownNames[index] ?? `${namePrefix}_tool_${index + 1}`

    return {
      id: `${server.id}-tool-${index + 1}`,
      name,
      description:
        TOOL_DESCRIPTIONS[name] ?? `执行 ${name.replaceAll("_", " ")} 操作。`,
      enabled: true,
      pointsPerCall: 0,
    }
  })
}

const INITIAL_MCP_SERVERS: McpServer[] = [
  {
    id: "mcp-google-drive",
    name: "Google Drive",
    description: "搜索和读取团队共享云盘中的文件与文档。",
    type: "system",
    creator: ADMIN_CREATOR,
    url: "https://mcp.example.com/google-drive/mcp",
    authorizationMode: "independent",
    authorizationMethod: "oauth",
    hasHttpHeaders: false,
    centralizedAuthorized: false,
    authorization: {
      groupIds: ["administrators", "product", "engineering"],
      memberIds: [],
    },
    connectionStatus: "connected",
    toolCount: 14,
  },
  {
    id: "mcp-github",
    name: "GitHub",
    description: "查询仓库、Issue、Pull Request，并执行研发协作操作。",
    type: "system",
    creator: ADMIN_CREATOR,
    url: "https://api.githubcopilot.com/mcp/",
    authorizationMode: "centralized",
    authorizationMethod: "oauth",
    hasHttpHeaders: false,
    centralizedAuthorized: true,
    authorization: {
      groupIds: ["administrators", "engineering"],
      memberIds: [],
    },
    connectionStatus: "connected",
    toolCount: 26,
  },
  {
    id: "mcp-postgres",
    name: "PostgreSQL",
    description: "以只读方式查询业务数据库中的结构化数据。",
    type: "system",
    creator: ADMIN_CREATOR,
    url: "https://mcp.example.com/postgres/mcp",
    authorizationMode: "centralized",
    authorizationMethod: "httpHeader",
    hasHttpHeaders: true,
    centralizedAuthorized: true,
    authorization: {
      groupIds: ["administrators", "engineering"],
      memberIds: [],
    },
    connectionStatus: "unknown",
    toolCount: 12,
  },
  {
    id: "mcp-sentry",
    name: "Sentry",
    description: "检索线上错误、事件详情和性能问题，辅助故障排查。",
    type: "system",
    creator: ADMIN_CREATOR,
    url: "https://mcp.sentry.example.com/sse",
    authorizationMode: "centralized",
    authorizationMethod: "httpHeader",
    hasHttpHeaders: true,
    centralizedAuthorized: true,
    authorization: {
      groupIds: ["engineering", "operations"],
      memberIds: [],
    },
    connectionStatus: "error",
    toolCount: 9,
  },
  {
    id: "mcp-user-notion",
    name: "Notion",
    description: "连接个人 Notion 工作区，读取页面和数据库内容。",
    type: "user",
    creator: "陈晨",
    url: "https://mcp.notion.com/mcp",
    authorizationMode: "independent",
    authorizationMethod: "oauth",
    hasHttpHeaders: false,
    centralizedAuthorized: false,
    authorization: { groupIds: [], memberIds: ["member-01"] },
    connectionStatus: "connected",
    toolCount: 8,
  },
  {
    id: "mcp-user-playwright",
    name: "Browser Automation",
    description: "通过远程浏览器服务访问网页并完成个人工作流。",
    type: "user",
    creator: "林玫",
    url: "https://mcp.browser.example.com/mcp",
    authorizationMode: "independent",
    authorizationMethod: "httpHeader",
    hasHttpHeaders: false,
    centralizedAuthorized: false,
    authorization: { groupIds: [], memberIds: ["member-04"] },
    connectionStatus: "connected",
    toolCount: 21,
  },
]

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

function isValidHttpHeaders(value: string) {
  try {
    const config: unknown = JSON.parse(value)

    return (
      typeof config === "object" &&
      config !== null &&
      !Array.isArray(config) &&
      Object.values(config).every((item) => typeof item === "string")
    )
  } catch {
    return false
  }
}

export function ToolsPage() {
  const { t } = useTranslation()
  const [servers, setServers] = useState(INITIAL_MCP_SERVERS)
  const [activeType, setActiveType] = useState<McpServerType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [serverPendingDeletion, setServerPendingDeletion] =
    useState<McpServer | null>(null)
  const [authorizationMode, setAuthorizationMode] =
    useState<McpAuthorizationMode>("independent")
  const [authorizationMethod, setAuthorizationMethod] =
    useState<McpAuthorizationMethod>("oauth")
  const [centralizedAuthorized, setCentralizedAuthorized] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: ["all-members"],
    memberIds: [],
  })
  const [testingServerId, setTestingServerId] = useState<string | null>(null)
  const [viewingServerId, setViewingServerId] = useState<string | null>(null)
  const [toolConfigs, setToolConfigs] = useState<
    Record<string, McpToolConfig[]>
  >(() =>
    Object.fromEntries(
      INITIAL_MCP_SERVERS.map((server) => [
        server.id,
        createToolConfigs(server),
      ])
    )
  )
  const [toolDrafts, setToolDrafts] = useState<McpToolConfig[]>([])
  const editingServer = servers.find((server) => server.id === editingServerId)
  const viewingServer = servers.find((server) => server.id === viewingServerId)

  const resetDraft = () => {
    setEditingServerId(null)
    setAuthorizationMode("independent")
    setAuthorizationMethod("oauth")
    setCentralizedAuthorized(false)
    setAuthorizationOpen(false)
    setAuthorization({ groupIds: ["all-members"], memberIds: [] })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) resetDraft()
  }

  const handleEditServer = (server: McpServer) => {
    if (server.type !== "system") return

    setEditingServerId(server.id)
    setAuthorizationMode(server.authorizationMode)
    setAuthorizationMethod(server.authorizationMethod ?? "oauth")
    setCentralizedAuthorized(server.centralizedAuthorized)
    setAuthorization(server.authorization)
    setAuthorizationOpen(false)
    setDialogOpen(true)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const url = String(formData.get("url") ?? "").trim()
    const httpHeaders = String(formData.get("httpHeaders") ?? "").trim()

    if (
      !name ||
      !description ||
      !url ||
      (authorizationMode === "centralized" &&
        authorizationMethod === "httpHeader" &&
        !httpHeaders &&
        !editingServer?.hasHttpHeaders) ||
      authorization.groupIds.length + authorization.memberIds.length === 0 ||
      editingServer?.type === "user"
    ) {
      return
    }

    if (httpHeaders && !isValidHttpHeaders(httpHeaders)) {
      const httpHeadersInput = form.elements.namedItem(
        "httpHeaders"
      ) as HTMLTextAreaElement | null
      httpHeadersInput?.setCustomValidity(t("pages.tools.httpHeadersInvalid"))
      httpHeadersInput?.reportValidity()
      return
    }

    const serverDraft = {
      name,
      description,
      url,
      authorizationMode,
      authorizationMethod:
        authorizationMode === "none" ? null : authorizationMethod,
      hasHttpHeaders:
        authorizationMode === "centralized" &&
        authorizationMethod === "httpHeader"
          ? Boolean(httpHeaders) || Boolean(editingServer?.hasHttpHeaders)
          : false,
      centralizedAuthorized:
        authorizationMode === "centralized" &&
        (authorizationMethod === "httpHeader" || centralizedAuthorized),
      authorization,
      connectionStatus: "unknown" as const,
    }

    if (editingServer) {
      setServers((current) =>
        current.map((server) =>
          server.id === editingServer.id
            ? { ...server, ...serverDraft }
            : server
        )
      )
    } else {
      setServers((current) => [
        ...current,
        {
          ...serverDraft,
          id: `mcp-server-${Date.now()}`,
          type: "system",
          creator: ADMIN_CREATOR,
          toolCount: 0,
        },
      ])
    }

    form.reset()
    handleDialogOpenChange(false)
  }

  const handleDeleteServer = () => {
    if (!serverPendingDeletion || serverPendingDeletion.type !== "system")
      return

    setServers((current) =>
      current.filter((server) => server.id !== serverPendingDeletion.id)
    )
    setServerPendingDeletion(null)
  }

  const handleTestConnection = (serverId: string) => {
    setTestingServerId(serverId)
    window.setTimeout(() => {
      setServers((current) =>
        current.map((server) =>
          server.id === serverId
            ? {
                ...server,
                connectionStatus: "connected",
                toolCount: Math.max(server.toolCount, 1),
              }
            : server
        )
      )
      setTestingServerId(null)
    }, 1200)
  }

  const handleViewTools = (server: McpServer) => {
    const configs = toolConfigs[server.id] ?? createToolConfigs(server)
    setToolDrafts(configs.map((tool) => ({ ...tool })))
    setViewingServerId(server.id)
  }

  const updateToolDraft = (
    toolId: string,
    update: Partial<Pick<McpToolConfig, "enabled" | "pointsPerCall">>
  ) => {
    setToolDrafts((current) =>
      current.map((tool) =>
        tool.id === toolId ? { ...tool, ...update } : tool
      )
    )
  }

  const handleSaveTools = () => {
    if (
      !viewingServer ||
      toolDrafts.some(
        (tool) => !Number.isFinite(tool.pointsPerCall) || tool.pointsPerCall < 0
      )
    ) {
      return
    }

    setToolConfigs((current) => ({
      ...current,
      [viewingServer.id]: toolDrafts.map((tool) => ({ ...tool })),
    }))
    setViewingServerId(null)
    setToolDrafts([])
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Tabs
        className="gap-4"
        value={activeType}
        onValueChange={(value) => setActiveType(value as McpServerType)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t("pages.tools.type")}>
            <TabsTrigger value="system">
              {t("pages.tools.systemTool")}
            </TabsTrigger>
            <TabsTrigger value="user">{t("pages.tools.userTool")}</TabsTrigger>
          </TabsList>

          {activeType === "system" && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    onClick={() => {
                      resetDraft()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.tools.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
              >
                <form
                  className="flex flex-col gap-6"
                  key={editingServer?.id ?? "new-mcp-server"}
                  onSubmit={handleSubmit}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {editingServer
                        ? t("pages.tools.editDialogTitle")
                        : t("pages.tools.dialogTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("pages.tools.dialogDescription")}
                    </DialogDescription>
                  </DialogHeader>

                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="mcp-name">
                        {t("pages.tools.name")}
                      </FieldLabel>
                      <Input
                        defaultValue={editingServer?.name}
                        id="mcp-name"
                        name="name"
                        placeholder={t("pages.tools.namePlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-description">
                        {t("pages.tools.toolDescription")}
                      </FieldLabel>
                      <Textarea
                        className="max-h-40 min-h-24 resize-y overflow-y-auto"
                        defaultValue={editingServer?.description}
                        id="mcp-description"
                        name="description"
                        placeholder={t("pages.tools.descriptionPlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-url">
                        {t("pages.tools.url")}
                      </FieldLabel>
                      <Input
                        defaultValue={editingServer?.url}
                        id="mcp-url"
                        name="url"
                        placeholder={t("pages.tools.urlPlaceholder")}
                        required
                        type="url"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t("pages.tools.authorization")}</FieldLabel>
                      <div className="grid grid-cols-2 gap-3">
                        <Tabs
                          value={authorizationMode}
                          onValueChange={(value) => {
                            setAuthorizationMode(value as McpAuthorizationMode)
                            setCentralizedAuthorized(false)
                          }}
                        >
                          <TabsList
                            aria-label={t("pages.tools.authorizationMode")}
                            className="w-full"
                          >
                            <TabsTrigger value="none">
                              {t("pages.tools.authorizationModes.none")}
                            </TabsTrigger>
                            <TabsTrigger value="independent">
                              {t("pages.tools.authorizationModes.independent")}
                            </TabsTrigger>
                            <TabsTrigger value="centralized">
                              {t("pages.tools.authorizationModes.centralized")}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        {authorizationMode !== "none" && (
                          <Tabs
                            value={authorizationMethod}
                            onValueChange={(value) => {
                              setAuthorizationMethod(
                                value as McpAuthorizationMethod
                              )
                              setCentralizedAuthorized(false)
                            }}
                          >
                            <TabsList
                              aria-label={t("pages.tools.authorizationMethod")}
                              className="w-full"
                            >
                              <TabsTrigger value="oauth">
                                {t("pages.tools.authorizationMethods.oauth")}
                              </TabsTrigger>
                              <TabsTrigger value="httpHeader">
                                {t(
                                  "pages.tools.authorizationMethods.httpHeader"
                                )}
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                        )}
                      </div>
                      <FieldDescription>
                        {t(
                          authorizationMode === "none"
                            ? "pages.tools.noAuthorizationDescription"
                            : authorizationMode === "independent"
                              ? "pages.tools.independentAuthorizationDescription"
                              : "pages.tools.centralizedAuthorizationDescription"
                        )}
                      </FieldDescription>
                      {authorizationMode ===
                      "none" ? null : authorizationMethod === "oauth" ? (
                        authorizationMode === "independent" ? (
                          <FieldDescription>
                            {t(
                              "pages.tools.independentMethodDescriptions.oauth"
                            )}
                          </FieldDescription>
                        ) : (
                          <Field orientation="horizontal">
                            <FieldContent>
                              <FieldLabel>
                                {t("pages.tools.oauthAuthorization")}
                              </FieldLabel>
                              <FieldDescription>
                                {t("pages.tools.oauthAuthorizationDescription")}
                              </FieldDescription>
                            </FieldContent>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge
                                variant={
                                  centralizedAuthorized
                                    ? "successOutline"
                                    : "warningOutline"
                                }
                              >
                                {centralizedAuthorized
                                  ? t("pages.tools.authorized")
                                  : t("pages.tools.notAuthorized")}
                              </Badge>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setCentralizedAuthorized(true)}
                              >
                                {centralizedAuthorized
                                  ? t("pages.tools.reauthorize")
                                  : t("pages.tools.connectAndAuthorize")}
                              </Button>
                            </div>
                          </Field>
                        )
                      ) : authorizationMode === "independent" ? (
                        <FieldDescription>
                          {t(
                            "pages.tools.independentMethodDescriptions.httpHeader"
                          )}
                        </FieldDescription>
                      ) : (
                        <Field>
                          <FieldLabel htmlFor="mcp-http-headers">
                            {t("pages.tools.httpHeaders")}
                          </FieldLabel>
                          <Textarea
                            className="max-h-48 min-h-28 resize-y overflow-y-auto font-mono"
                            defaultValue={
                              editingServer?.hasHttpHeaders
                                ? undefined
                                : t("pages.tools.httpHeadersDefaultValue")
                            }
                            id="mcp-http-headers"
                            name="httpHeaders"
                            placeholder={
                              editingServer?.hasHttpHeaders
                                ? t("pages.tools.httpHeadersUpdatePlaceholder")
                                : undefined
                            }
                            required={!editingServer?.hasHttpHeaders}
                            onInput={(event) =>
                              event.currentTarget.setCustomValidity("")
                            }
                          />
                          <FieldDescription>
                            {t("pages.tools.httpHeadersDescription")}
                          </FieldDescription>
                        </Field>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-authorization">
                        {t("pages.tools.availabilityScope")}
                      </FieldLabel>
                      <AuthorizationSelect
                        id="mcp-authorization"
                        open={authorizationOpen}
                        placeholder={t("pages.tools.authorizationPlaceholder")}
                        title={t("pages.tools.availabilityScope")}
                        value={authorization}
                        onOpenChange={setAuthorizationOpen}
                        onValueChange={setAuthorization}
                      />
                      <FieldDescription>
                        {t("pages.tools.availabilityScopeDescription")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>

                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.tools.cancel")}
                    </DialogClose>
                    <Button type="submit">
                      {editingServer
                        ? t("pages.tools.save")
                        : t("pages.tools.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {(["system", "user"] as const).map((tabType) => (
          <TabsContent key={tabType} value={tabType}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {servers
                .filter((server) => server.type === tabType)
                .map((server) => {
                  const authorizationNames = getAuthorizationNames(
                    server.authorization,
                    t
                  )
                  const connectionLabel = t(
                    `pages.tools.statuses.${server.connectionStatus}`
                  )
                  const connectionVariant =
                    server.connectionStatus === "connected"
                      ? "successOutline"
                      : server.connectionStatus === "error"
                        ? "destructiveOutline"
                        : "warningOutline"

                  return (
                    <Card className="h-full" key={server.id}>
                      <CardHeader>
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar size="lg">
                            <AvatarFallback>
                              {server.creator === ADMIN_CREATOR ? (
                                <HugeiconsIcon
                                  icon={McpServerIcon}
                                  strokeWidth={2}
                                />
                              ) : (
                                getCreatorInitials(server.creator)
                              )}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <CardTitle className="truncate" title={server.name}>
                              {server.name}
                            </CardTitle>
                            <CardDescription
                              className="truncate"
                              title={server.creator}
                            >
                              {server.creator}
                            </CardDescription>
                          </div>
                          {server.type === "system" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    aria-label={t("common.more")}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                  />
                                }
                              >
                                <HugeiconsIcon
                                  icon={MoreHorizontalIcon}
                                  strokeWidth={2}
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    onClick={() => handleViewTools(server)}
                                  >
                                    <HugeiconsIcon
                                      icon={ToolboxIcon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.tools.viewTools")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleEditServer(server)}
                                  >
                                    <HugeiconsIcon
                                      icon={Edit02Icon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.tools.edit")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={testingServerId === server.id}
                                    onClick={() =>
                                      handleTestConnection(server.id)
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={TestTube01Icon}
                                      strokeWidth={2}
                                    />
                                    {testingServerId === server.id
                                      ? t("pages.tools.testing")
                                      : t("pages.tools.testConnection")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() =>
                                      setServerPendingDeletion(server)
                                    }
                                  >
                                    <HugeiconsIcon
                                      icon={Delete02Icon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.tools.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-1 flex-col gap-4">
                        <p className="line-clamp-2 min-h-10 text-muted-foreground">
                          {server.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {server.authorizationMode === "centralized" &&
                            server.authorizationMethod === "oauth" && (
                              <Badge
                                variant={
                                  server.centralizedAuthorized
                                    ? "successOutline"
                                    : "warningOutline"
                                }
                              >
                                {server.centralizedAuthorized
                                  ? t("pages.tools.authorized")
                                  : t("pages.tools.notAuthorized")}
                              </Badge>
                            )}
                          <Badge variant={connectionVariant}>
                            {connectionLabel}
                          </Badge>
                          <Badge variant="outline">
                            {t("pages.tools.toolCount", {
                              count: server.toolCount,
                            })}
                          </Badge>
                        </div>
                      </CardContent>
                      <CardFooter className="min-w-0 gap-4 border-t">
                        <span
                          className="w-2/5 truncate text-muted-foreground"
                          title={t("pages.tools.availabilityScope")}
                        >
                          {t("pages.tools.availabilityScope")}
                        </span>
                        <span
                          className="w-3/5 truncate text-end font-medium"
                          title={authorizationNames}
                        >
                          {authorizationNames}
                        </span>
                      </CardFooter>
                    </Card>
                  )
                })}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog
        open={viewingServer !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setViewingServerId(null)
            setToolDrafts([])
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] sm:max-w-4xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader>
            <DialogTitle>
              {t("pages.tools.toolListTitle", {
                server: viewingServer?.name ?? "",
              })}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[min(60dvh,36rem)] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.tools.toolName")}</TableHead>
                  <TableHead className="w-24 text-center">
                    {t("pages.tools.toolEnabled")}
                  </TableHead>
                  {viewingServer?.authorizationMode === "centralized" && (
                    <TableHead className="w-36">
                      {t("pages.tools.pointsPerCall")}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {toolDrafts.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell className="max-w-72">
                      <div className="flex min-w-0 flex-col gap-1">
                        <span
                          className="truncate font-medium"
                          title={tool.name}
                        >
                          {tool.name}
                        </span>
                        <span
                          className="truncate text-xs text-muted-foreground"
                          title={tool.description}
                        >
                          {tool.description}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        aria-label={t("pages.tools.toggleTool", {
                          tool: tool.name,
                        })}
                        checked={tool.enabled}
                        onCheckedChange={(enabled) =>
                          updateToolDraft(tool.id, { enabled })
                        }
                      />
                    </TableCell>
                    {viewingServer?.authorizationMode === "centralized" && (
                      <TableCell>
                        <Input
                          aria-label={t("pages.tools.pointsFor", {
                            tool: tool.name,
                          })}
                          className="h-8"
                          disabled={!tool.enabled}
                          min="0"
                          step="1"
                          type="number"
                          value={tool.pointsPerCall}
                          onChange={(event) =>
                            updateToolDraft(tool.id, {
                              pointsPerCall: Number(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.tools.cancel")}
            </DialogClose>
            <Button
              disabled={toolDrafts.some(
                (tool) =>
                  !Number.isFinite(tool.pointsPerCall) || tool.pointsPerCall < 0
              )}
              type="button"
              onClick={handleSaveTools}
            >
              {t("pages.tools.saveToolSettings")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={serverPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setServerPendingDeletion(null)
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.tools.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.tools.deleteDialogDescription", {
                tool: serverPendingDeletion?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.tools.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteServer}
            >
              {t("pages.tools.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
