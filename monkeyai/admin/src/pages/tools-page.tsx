import { api } from "@/lib/api"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  listResources,
  useResources,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { ResourceNotice } from "@/components/resource-notice"
import { useEffect, useRef, useState, type FormEvent } from "react"
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
  iconPath: string
  revision: number
  providerId: string
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
    providerId: row.provider_id,
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
    connectionStatus: row.connection_status,
    type: row.ownership_type,
    creator: row.owner_name ?? row.owner_user_id,
    enabled: row.enabled,
    toolCount: row.tool_count ?? 0,
    oauthConfig: row.oauth_config ?? {},
    callbackURL: row.callback_url ?? "",
  }
}

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
  const remote = useResources("/connectors", toServer)
  const pendingProvider = useRef("")
  const servers = remote.items
  const reload = remote.reload
  const subjects = useSubjects()
  const [activeType, setActiveType] = useState<McpServerType>("system")
  const [providers, setProviders] = useState<ResourceRow[]>([])
  const [providerError, setProviderError] = useState("")
  const [selectedProviderId, setSelectedProviderId] = useState("")
  const [oauthRequest, setOAuthRequest] = useState<string | null>(null)
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
    groupIds: [],
    memberIds: [],
  })
  const [testingServerId, setTestingServerId] = useState<string | null>(null)
  const [viewingServerId, setViewingServerId] = useState<string | null>(null)
  const [toolDrafts, setToolDrafts] = useState<McpToolConfig[]>([])
  const editingServer = servers.find((server) => server.id === editingServerId)
  const viewingServer = servers.find((server) => server.id === viewingServerId)

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    listResources(base + "/connector-providers")
      .then((r) => {
        if (!cancelled) {
          setProviders(r.items)
          setProviderError("")
        }
      })
      .catch((e) => {
        if (!cancelled) setProviderError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [dialogOpen])
  useEffect(() => {
    if (!oauthRequest) return
    const timer = window.setInterval(() => {
      api<{ status: string }>(
        base + `/connector-authorizations/${oauthRequest}`
      )
        .then((result) => {
          if (result.status !== "pending" && result.status !== "processing") {
            setOAuthRequest(null)
            setCentralizedAuthorized(result.status === "authorized")
            void reload().catch((e) => setProviderError(e.message))
          }
        })
        .catch(() => setOAuthRequest(null))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [oauthRequest, reload])
  const selectedProvider = providers.find((p) => p.id === selectedProviderId)
  const selectProvider = (id: string) => {
    setSelectedProviderId(id)
    const provider = providers.find((p) => p.id === id)
    if (provider) {
      setAuthorizationMode(provider.authorization_mode)
      setAuthorizationMethod(
        provider.authorization_method === "http_header" ? "httpHeader" : "oauth"
      )
    }
  }
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
    pendingProvider.current = ""
    setSelectedProviderId("")
    setEditingServerId(null)
    setAuthorizationMode("independent")
    setAuthorizationMethod("oauth")
    setCentralizedAuthorized(false)
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
    setCentralizedAuthorized(server.centralizedAuthorized)
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
    const httpHeaders = String(formData.get("httpHeaders") ?? "").trim()

    if (
      !name ||
      !description ||
      !url ||
      (authorizationMode === "centralized" &&
        authorizationMethod === "httpHeader" &&
        !httpHeaders &&
        !editingServer?.hasHttpHeaders) ||
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

    await remote.run(async () => {
      let providerId =
        editingServer?.providerId ||
        selectedProviderId ||
        pendingProvider.current
      if (!providerId) {
        const provider = await saveResource("/connector-providers", {
          name,
          description,
          url,
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
          oauth_client_secret: String(formData.get("oauthClientSecret") ?? ""),
        })
        providerId = provider.id
        pendingProvider.current = provider.id
      }
      const saved = await saveResource(
        editingServer ? `/connectors/${editingServer.id}` : "/connectors",
        {
          provider_id: providerId,
          name,
          description,
          url,
          grants: grants(authorization),
        },
        editingServer?.revision
      )
      const icon = formData.get("icon")
      if (icon instanceof File && icon.size > 0) {
        const provider = await api<ResourceRow>(
          base + `/connector-providers/${providerId}`
        )
        const data = new FormData()
        data.set("icon", icon)
        await api(base + `/connector-providers/${providerId}/icon`, {
          method: "PUT",
          headers: match(provider.revision),
          body: data,
        })
      }
      setEditingServerId(saved.id)
      await remote.reload()
      if (
        httpHeaders &&
        authorizationMode === "centralized" &&
        authorizationMethod === "httpHeader"
      )
        await api(base + `/connectors/${saved.id}/credential`, {
          method: "PUT",
          body: JSON.stringify({ http_headers: JSON.parse(httpHeaders) }),
        })
      if (editingServer || !saved.callback_url) {
        form.reset()
        handleDialogOpenChange(false)
      }
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
  const handleViewTools = async (server: McpServer) => {
    await remote.run(async () => {
      const result = await api<{
        items: {
          id: string
          name: string
          description: string
          enabled: boolean
          credits_per_call: number
        }[]
      }>(base + `/connectors/${server.id}/tools`)
      setToolDrafts(
        result.items.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          enabled: t.enabled,
          pointsPerCall: Number(t.credits_per_call),
        }))
      )
      setViewingServerId(server.id)
    })
  }
  const authorize = async () => {
    if (!editingServer) return
    const popup = window.open("about:blank", "_blank")
    if (popup) popup.opener = null
    const ok = await remote.run(async () => {
      const result = await api<{ id: string; authorization_url: string }>(
        base + `/connectors/${editingServer.id}/oauth/authorizations`,
        { method: "POST" }
      )
      setOAuthRequest(result.id)
      if (popup) popup.location.href = result.authorization_url
      else window.location.assign(result.authorization_url)
    })
    if (!ok) popup?.close()
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
        error={remote.error || subjects.error || providerError}
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
                  key={
                    editingServer?.id ?? `new-mcp-server-${selectedProviderId}`
                  }
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
                    {!editingServer && (
                      <Field>
                        <FieldLabel htmlFor="connector-provider">
                          {t("resources.providerTemplate")}
                        </FieldLabel>
                        <select
                          id="connector-provider"
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedProviderId}
                          onChange={(e) => selectProvider(e.target.value)}
                        >
                          <option value="">{t("resources.newProvider")}</option>
                          {providers
                            .filter((p) => p.enabled)
                            .map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
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
                        {t("resources.providerIcon")}
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
                        defaultValue={
                          editingServer?.url ?? selectedProvider?.url
                        }
                        readOnly={Boolean(editingServer || selectedProvider)}
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
                            if (!editingServer && !selectedProvider)
                              setAuthorizationMode(
                                value as McpAuthorizationMode
                              )
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
                              if (!editingServer && !selectedProvider)
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
                                    editingServer?.oauthConfig[key] ??
                                    selectedProvider?.oauth_config?.[key] ??
                                    ""
                                  }
                                  readOnly={Boolean(
                                    editingServer || selectedProvider
                                  )}
                                  required={
                                    !editingServer &&
                                    [
                                      "authorization_url",
                                      "token_url",
                                      "client_id",
                                    ].includes(key)
                                  }
                                />
                              </Field>
                            ))}
                          </>
                        )}
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
                                onClick={authorize}
                                disabled={
                                  !editingServer ||
                                  remote.pending ||
                                  Boolean(oauthRequest)
                                }
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
                    error={remote.error || subjects.error || providerError}
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
                  {Boolean(viewingServer) && (
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
                    {Boolean(viewingServer) && (
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
            error={remote.error || subjects.error || providerError}
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
