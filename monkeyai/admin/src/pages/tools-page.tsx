import { ConnectorCredentials } from "@/components/connector-credentials"
import { api } from "@/lib/api"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  useResources,
  useSubjects,
  type ResourceRow,
  type Credential,
} from "@/lib/resources"
import { ResourceNotice } from "@/components/resource-notice"
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  iconPath: string
  revision: number
  credentials: Credential[]
  oauthConfig: Record<string, string>
  callbackURL: string
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
  enabled: boolean
  toolCount: number
}

function toServer(row: ResourceRow): McpServer {
  return {
    id: row.id,
    revision: row.revision,
    iconPath: row.icon_path,
    credentials: row.credentials ?? [],
    name: row.name,
    description: row.description,
    url: row.url,
    authorizationMode: row.authorization_mode,
    authorizationMethod:
      row.authorization_method === "http_header"
        ? "httpHeader"
        : row.authorization_method,
    hasHttpHeaders: row.credential_configured,
    centralizedAuthorized: row.credential_configured,
    authorization: selection(row.grants),
    connectionStatus:
      row.connection_status ??
      row.credentials?.[0]?.connection_status ??
      "unknown",
    type: row.ownership_type,
    creator: row.user.name || row.user.email || row.user.id,
    enabled: row.enabled,
    toolCount: row.tool_count ?? 0,
    oauthConfig: row.oauth_config ?? {},
    callbackURL: row.callback_url ?? "",
  }
}

function getCreatorInitials(creator: string) {
  return creator.trim().slice(0, 2).toUpperCase()
}

export function ToolsPage() {
  const { t } = useTranslation()
  const remote = useResources("/connectors", toServer)
  const servers = remote.items
  const reload = remote.reload
  const subjects = useSubjects()
  const [activeType, setActiveType] = useState<McpServerType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [serverPendingDeletion, setServerPendingDeletion] =
    useState<McpServer | null>(null)
  const [authorizationMode, setAuthorizationMode] =
    useState<McpAuthorizationMode>("independent")
  const [authorizationMethod, setAuthorizationMethod] =
    useState<McpAuthorizationMethod>("oauth")
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const [testingServerId, setTestingServerId] = useState<string | null>(null)
  const [viewingServerId, setViewingServerId] = useState<string | null>(null)
  const [contexts, setContexts] = useState<Credential[]>([])
  const [contextID, setContextID] = useState("")
  const [credentialServer, setCredentialServer] = useState<McpServer | null>(
    null
  )
  const [toolDrafts, setToolDrafts] = useState<McpToolConfig[]>([])
  const editingServer = servers.find((server) => server.id === editingServerId)
  const viewingServer = servers.find((server) => server.id === viewingServerId)

  const setConnectionEnabled = async (server: McpServer) => {
    await remote.run(async () => {
      await api(base + `/connectors/${server.id}/enabled`, {
        method: "PATCH",
        headers: match(server.revision),
        body: JSON.stringify({ enabled: !server.enabled }),
      })
    })
  }
  const resetDraft = () => {
    setEditingServerId(null)
    setAuthorizationMode("independent")
    setAuthorizationMethod("oauth")
    setAuthorizationOpen(false)
    setAuthorization({ groupIds: [], memberIds: [] })
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
    setAuthorization(server.authorization)
    setAuthorizationOpen(false)
    setDialogOpen(true)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const url = String(formData.get("url") ?? "").trim()
    if (!name || !url || editingServer?.type === "user") return
    await remote.run(async () => {
      const secret = String(formData.get("oauthClientSecret") ?? "")
      const saved = await saveResource(
        editingServer ? `/connectors/${editingServer.id}` : "/connectors",
        {
          name,
          description,
          url,
          grants: grants(authorization),
          authorization_mode: authorizationMode,
          authorization_method:
            authorizationMode === "none"
              ? null
              : authorizationMethod === "httpHeader"
                ? "http_header"
                : "oauth",
          oauth_config: {
            authorization_url: String(
              formData.get("oauthAuthorizationURL") ?? ""
            ),
            token_url: String(formData.get("oauthTokenURL") ?? ""),
            client_id: String(formData.get("oauthClientID") ?? ""),
            scopes: String(formData.get("oauthScopes") ?? ""),
          },
          ...(secret || !editingServer ? { oauth_client_secret: secret } : {}),
        },
        editingServer?.revision
      )
      setEditingServerId(saved.id)
      await remote.reload()
      const icon = formData.get("icon")
      if (icon instanceof File && icon.size > 0) {
        const data = new FormData()
        data.set("icon", icon)
        await api(base + `/connectors/${saved.id}/icon`, {
          method: "PUT",
          headers: match(saved.revision),
          body: data,
        })
      }
      if (saved.authorization_mode === "centralized") {
        handleDialogOpenChange(false)
        setCredentialServer(toServer(saved))
      } else if (!saved.callback_url || editingServer)
        handleDialogOpenChange(false)
    })
  }
  const handleDeleteServer = async () => {
    if (!serverPendingDeletion) return
    await remote.run(async () => {
      await api(base + `/connectors/${serverPendingDeletion.id}`, {
        method: "DELETE",
        headers: match(serverPendingDeletion.revision),
      })
      setServerPendingDeletion(null)
    })
  }
  const handleTestConnection = async (id: string) => {
    setTestingServerId(id)
    await remote.run(async () => {
      await api(base + `/connectors/${id}/test`, { method: "POST" })
    })
    setTestingServerId(null)
  }
  const loadTools = async (server: McpServer, credential = "") => {
    const path =
      `/connectors/${server.id}` +
      (credential ? `/credentials/${credential}` : "") +
      "/tools"
    const result = await api<{
      items: {
        id: string
        name: string
        description: string
        enabled: boolean
        credits_per_call: number
      }[]
    }>(base + path)
    setToolDrafts(
      result.items.map((tool) => ({
        ...tool,
        pointsPerCall: Number(tool.credits_per_call),
      }))
    )
    setContextID(credential)
  }
  const handleViewTools = async (server: McpServer) => {
    setToolDrafts([])
    setContexts([])
    setContextID("")
    setViewingServerId(server.id)
    await remote.run(async () => {
      if (server.authorizationMode === "independent") {
        const result = await api<{ items: Credential[] }>(
          base + `/connectors/${server.id}/tool-contexts`
        )
        setContexts(result.items)
      } else await loadTools(server)
    })
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

  const handleSaveTools = async () => {
    if (!viewingServer) return
    await remote.run(async () => {
      for (const tool of toolDrafts) {
        await api(base + `/connectors/${viewingServer.id}/tools/${tool.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            enabled: tool.enabled,
            credits_per_call: tool.pointsPerCall,
          }),
        })
      }
      setViewingServerId(null)
    })
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <ResourceNotice
        error={remote.error || subjects.error}
        loading={remote.loading}
        pending={remote.pending}
      />
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
                      <FieldLabel htmlFor="mcp-icon">
                        {t("resources.connectorIcon")}
                      </FieldLabel>
                      <Input
                        id="mcp-icon"
                        name="icon"
                        type="file"
                        accept="image/png,image/jpeg"
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
                      <div className="flex flex-wrap gap-3">
                        <Tabs
                          value={authorizationMode}
                          onValueChange={(value) => {
                            setAuthorizationMode(value as McpAuthorizationMode)
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
                      {authorizationMode !== "none" &&
                        authorizationMethod === "oauth" && (
                          <>
                            {editingServer?.callbackURL ? (
                              <Field>
                                <FieldLabel htmlFor="mcp-callback-url">
                                  {t("resources.callbackURL")}
                                </FieldLabel>
                                <Input
                                  id="mcp-callback-url"
                                  readOnly
                                  value={editingServer.callbackURL}
                                  onFocus={(event) =>
                                    event.currentTarget.select()
                                  }
                                />
                                <FieldDescription>
                                  {t("resources.callbackURLDescription")}
                                </FieldDescription>
                              </Field>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                {t("resources.saveBeforeAuthorize")}
                              </p>
                            )}
                            {(
                              [
                                [
                                  "oauthAuthorizationURL",
                                  "authorization_url",
                                  "OAuth Authorization URL",
                                ],
                                [
                                  "oauthTokenURL",
                                  "token_url",
                                  "OAuth Token URL",
                                ],
                                [
                                  "oauthClientID",
                                  "client_id",
                                  "OAuth Client ID",
                                ],
                                ["oauthScopes", "scopes", "OAuth Scopes"],
                                [
                                  "oauthClientSecret",
                                  "secret",
                                  "OAuth Client Secret",
                                ],
                              ] as const
                            ).map(([name, key, label]) => (
                              <Field key={name}>
                                <FieldLabel htmlFor={name}>{label}</FieldLabel>
                                <Input
                                  id={name}
                                  name={name}
                                  type={key === "secret" ? "password" : "text"}
                                  defaultValue={
                                    editingServer?.oauthConfig[key] ?? ""
                                  }
                                  required={[
                                    "authorization_url",
                                    "token_url",
                                    "client_id",
                                  ].includes(key)}
                                />
                              </Field>
                            ))}
                          </>
                        )}
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="mcp-authorization">
                        {t("pages.tools.availabilityScope")}
                      </FieldLabel>
                      <AuthorizationSelect
                        groups={subjects.groups}
                        members={subjects.members}
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

                  <ResourceNotice
                    error={remote.error || subjects.error}
                    loading={false}
                    pending={remote.pending}
                  />
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.tools.cancel")}
                    </DialogClose>
                    <Button type="submit" disabled={remote.pending}>
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
                    t,
                    subjects.flatGroups,
                    subjects.members
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
                            {server.iconPath && (
                              <AvatarImage src={server.iconPath} alt="" />
                            )}
                            <AvatarFallback>
                              {server.type === "system" ? (
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
                          {
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
                                <DropdownMenuGroup
                                  hidden={server.type !== "system"}
                                >
                                  <DropdownMenuItem
                                    onClick={() => setConnectionEnabled(server)}
                                  >
                                    {t(
                                      server.enabled
                                        ? "resources.disable"
                                        : "resources.enable"
                                    )}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleViewTools(server)}
                                  >
                                    <HugeiconsIcon
                                      icon={ToolboxIcon}
                                      strokeWidth={2}
                                    />
                                    {t("pages.tools.viewTools")}
                                  </DropdownMenuItem>
                                  {server.authorizationMode ===
                                    "centralized" && (
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setCredentialServer(server)
                                      }
                                    >
                                      {t("resources.credentials", {
                                        defaultValue: "管理凭证",
                                      })}
                                    </DropdownMenuItem>
                                  )}
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
                                    disabled={
                                      testingServerId === server.id ||
                                      server.authorizationMode ===
                                        "independent" ||
                                      !server.enabled
                                    }
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
                                <DropdownMenuSeparator
                                  hidden={server.type !== "system"}
                                />
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
                          }
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
                            {server.authorizationMode === "independent"
                              ? t("pages.tools.authorizationModes.independent")
                              : connectionLabel}
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

      {credentialServer && (
        <ConnectorCredentials
          connector={credentialServer}
          onClose={() => setCredentialServer(null)}
          onChange={reload}
        />
      )}
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

          {viewingServer?.authorizationMode === "independent" && (
            <Field>
              <FieldLabel htmlFor="tool-context">
                {t("resources.selectCredential", { defaultValue: "选择凭证" })}
              </FieldLabel>
              <select
                id="tool-context"
                className="h-9 rounded-md border bg-background px-3"
                value={contextID}
                onChange={(e) => {
                  const id = e.target.value
                  setContextID(id)
                  setToolDrafts([])
                  if (id) void remote.run(() => loadTools(viewingServer, id))
                }}
              >
                <option value="">
                  {t("resources.selectCredential", {
                    defaultValue: "选择凭证",
                  })}
                </option>
                {contexts.map((credential) => (
                  <option key={credential.id} value={credential.id}>
                    {[
                      credential.name,
                      credential.user?.name || credential.user?.email,
                      credential.id,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ResourceNotice
            error={remote.error}
            pending={remote.pending}
            loading={false}
          />
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

          <ResourceNotice
            error={remote.error || subjects.error}
            loading={false}
            pending={remote.pending}
          />
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.tools.cancel")}
            </DialogClose>
            <Button
              disabled={
                remote.pending ||
                toolDrafts.some(
                  (tool) =>
                    !Number.isFinite(tool.pointsPerCall) ||
                    tool.pointsPerCall < 0
                )
              }
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
