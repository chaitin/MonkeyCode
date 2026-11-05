import {
  ConnectorCredentials,
  type ConnectorCredentialsHandle,
  type ConnectorCredentialInput,
} from "@/components/connector-credentials"
import { useAppToast } from "@/components/animated-toast-provider"
import { api } from "@/lib/api"
import { SystemProxySelect } from "@/components/proxy-settings"
import { loadProxies, type SystemProxy } from "@/lib/proxy-settings"
import {
  base,
  grants,
  selection,
  match,
  saveResource,
  savePackageGrants,
  localized,
  useSubjects,
  type ResourceRow,
  type Credential,
} from "@/lib/resources"
import { getCreatorInitial } from "@/lib/utils"
import { ResourceNotice } from "@/components/resource-notice"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { TableLoading } from "@/components/table-loading"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"
import {
  ArrowRight01Icon,
  Delete02Icon,
  Edit02Icon,
  McpServerIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  ToolboxIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { ResourcePackageBadge } from "@/components/resource-package-badge"
import { ResourceAuthorizationBadge } from "@/components/resource-authorization-badge"

import { AuthorizationSelect } from "@/components/authorization-select"
import { ResourceEditorFooter } from "@/components/resource-editor-footer"
import {
  ResourceAvatarField,
  type ResourceAvatarDraft,
} from "@/components/resource-avatar-field"
import { SkillTagSelect } from "@/components/skill-tag-select"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { useSkillTags } from "@/hooks/use-skill-tags"
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ResourceList } from "@/components/resource-list"
import { useResourceList } from "@/hooks/use-resource-list"
import { useResourceBatch } from "@/hooks/use-resource-batch"
import { ResourceBatchActions } from "@/components/resource-batch-actions"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { AuthorizationSelection } from "@/lib/authorization-groups"

type McpServerType = "system" | "user"
type McpAuthorizationMode = "none" | "independent" | "centralized"
type McpAuthorizationMethod = "oauth" | "httpHeader"
type OAuthClientMode = "dynamic" | "manual"

const DEFAULT_TOKEN_AUTH_METHOD = "__default"
const NO_TOOL_CONTEXT = "__none"

function oauthFormConfig(
  mode: OAuthClientMode,
  formData: FormData,
  existing?: Record<string, string>
): Record<string, string> {
  if (mode === "dynamic") return { mode: "dynamic" }
  const tokenAuthMethod = String(formData.get("oauthTokenAuthMethod") ?? "")
  return {
    mode:
      !existing || existing.mode === "dynamic"
        ? "manual"
        : (existing.mode ?? ""),
    authorization_url: String(
      formData.get("oauthAuthorizationURL") ?? ""
    ).trim(),
    token_url: String(formData.get("oauthTokenURL") ?? "").trim(),
    client_id: String(formData.get("oauthClientID") ?? "").trim(),
    registration_url: String(formData.get("oauthRegistrationURL") ?? "").trim(),
    token_endpoint_auth_method:
      tokenAuthMethod === "__default" ? "" : tokenAuthMethod,
    scopes: String(formData.get("oauthScopes") ?? "").trim(),
  }
}
type ConnectionStatus = "connected" | "error" | "unknown"

function oauthConfigChanged(
  mode: OAuthClientMode,
  server: McpServer,
  next: Record<string, string>
) {
  if (mode === "dynamic") {
    return server.oauthConfig.mode !== "dynamic"
  }
  if (server.oauthConfig.mode === "dynamic") return true
  const keys = [
    "authorization_url",
    "token_url",
    "client_id",
    "registration_url",
    "token_endpoint_auth_method",
    "scopes",
  ]
  return keys.some(
    (key) => (next[key] ?? "") !== (server.oauthConfig[key] ?? "")
  )
}

type McpToolConfig = {
  id: string
  name: string
  description: string
  enabled: boolean
  pointsPerCall: number
}

type McpServer = {
  origin?: ResourceRow["origin"]
  publisher?: string
  retired?: boolean
  iconPath: string
  grants: ResourceRow["grants"]
  revision: number
  credentials: Credential[]
  oauthConfig: Record<string, string>
  callbackURL: string
  id: string
  name: string
  description: string
  tagIds: string[]
  type: McpServerType
  creator: string
  url: string
  proxyId: string
  authHeaderName?: string
  timeoutMs?: number
  authorizationMode: McpAuthorizationMode
  authorizationMethod: McpAuthorizationMethod | null
  hasHttpHeaders: boolean
  centralizedAuthorized: boolean
  authorization: AuthorizationSelection
  connectionStatus: ConnectionStatus
  enabled: boolean
  toolCount: number
  enabledToolCount: number
}

function toServer(row: ResourceRow, language: string): McpServer {
  const text = localized(row, language)
  return {
    id: row.id,
    origin: row.origin,
    publisher: row.publisher,
    retired: row.retired,
    revision: row.revision,
    grants: row.grants,
    iconPath: row.icon_path,
    credentials: row.credentials ?? [],
    name: text.name,
    description: text.description,
    tagIds: (row.tags ?? []).map((tag) => tag.id),
    url: row.url,
    proxyId: row.proxy_id ?? "",
    authHeaderName: row.auth_header_name,
    timeoutMs: row.timeout_ms,
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
    enabledToolCount: row.enabled_tool_count ?? 0,
    oauthConfig: row.oauth_config ?? {},
    callbackURL: row.callback_url ?? "",
  }
}

export function ToolsPage() {
  const { t, i18n } = useTranslation()
  const { showToast } = useAppToast()
  const { tags: availableTags } = useSkillTags()
  const remote = useResourceList("/connectors")
  const batch = useResourceBatch("connector", remote)
  const servers = remote.items.map((row) => toServer(row, i18n.language))
  const reload = remote.reload
  const subjects = useSubjects()
  const authorizationGroupNames = new Map(
    subjects.flatGroups.map((group) => [group.value, group.labelKey])
  )
  const authorizationMemberNames = new Map(
    subjects.members.map((member) => [member.id, member.name || member.email])
  )
  const activeType = remote.type
  const [proxies, setProxies] = useState<SystemProxy[]>([])
  const [proxyError, setProxyError] = useState("")
  useEffect(() => {
    loadProxies()
      .then(setProxies)
      .catch((reason: Error) => setProxyError(reason.message))
  }, [])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<McpServer | null>(null)
  const [serverPendingDeletion, setServerPendingDeletion] =
    useState<McpServer | null>(null)
  const [authorizationMode, setAuthorizationMode] =
    useState<McpAuthorizationMode>("none")
  const [authorizationMethod, setAuthorizationMethod] =
    useState<McpAuthorizationMethod>("httpHeader")
  const [oauthClientMode, setOAuthClientMode] =
    useState<OAuthClientMode>("dynamic")
  const [tagsOpen, setTagsOpen] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<ResourceAvatarDraft>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [authorizationOverride, setAuthorization] =
    useState<AuthorizationSelection | null>(null)
  const authorization: AuthorizationSelection = authorizationOverride ?? {
    groupIds: subjects.groups.slice(0, 1).map((group) => group.value),
    memberIds: [],
  }
  const [viewingServer, setViewingServer] = useState<McpServer | null>(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const toolsBusy = toolsLoading || remote.pending
  const [contexts, setContexts] = useState<Credential[]>([])
  const [contextID, setContextID] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  const credentialsRef = useRef<ConnectorCredentialsHandle>(null)
  const [credentialActionContainer, setCredentialActionContainer] =
    useState<HTMLDivElement | null>(null)
  const [credentialBusy, setCredentialBusy] = useState(false)
  const editorPending = remote.pending || credentialBusy
  const refreshConnector = useCallback(
    async (id: string, refreshList = true) => {
      const saved = toServer(
        await api<ResourceRow>(base + `/connectors/${id}`),
        i18n.language
      )
      setEditingServer(saved)
      if (refreshList) await reload()
      return saved
    },
    [i18n.language, reload]
  )
  const [toolDrafts, setToolDrafts] = useState<McpToolConfig[]>([])
  const importedServer = editingServer?.origin === "package"
  const readOnlyTools = viewingServer?.origin === "package"
  const manualOAuthConfig =
    editingServer?.oauthConfig.mode === "dynamic"
      ? {}
      : (editingServer?.oauthConfig ?? {})
  const authenticationModeItems = [
    {
      value: "none",
      label: t("pages.tools.authorizationModes.none"),
      description: t("pages.tools.noAuthorizationDescription"),
    },
    {
      value: "independent",
      label: t("pages.tools.authorizationModes.independent"),
      description: t("pages.tools.independentAuthorizationDescription"),
    },
    {
      value: "centralized",
      label: t("pages.tools.authorizationModes.centralized"),
      description: t("pages.tools.centralizedAuthorizationDescription"),
    },
  ]
  const selectedAuthenticationMode = authenticationModeItems.find(
    (item) => item.value === authorizationMode
  )
  const authenticationProtocolItems = [
    {
      value: "httpHeader",
      label: t("pages.tools.authorizationMethods.httpHeader"),
    },
    { value: "oauth", label: t("pages.tools.authorizationMethods.oauth") },
  ]
  const oauthClientModeItems = [
    {
      value: "dynamic",
      label: t("resources.oauthClientDynamic"),
      description: t("resources.oauthDiscoveryHint"),
    },
    {
      value: "manual",
      label: t("resources.oauthClientManual"),
      description: t("resources.oauthManualHint"),
    },
  ]
  const oauthTokenAuthItems = [
    {
      value: DEFAULT_TOKEN_AUTH_METHOD,
      label: t(
        manualOAuthConfig.registration_url
          ? "resources.oauthTokenAuthLegacyDefault"
          : "resources.oauthTokenAuthDefault"
      ),
    },
    { value: "none", label: "none (PKCE)" },
    { value: "client_secret_post", label: "client_secret_post" },
    { value: "client_secret_basic", label: "client_secret_basic" },
  ]
  const contextItems = [
    {
      value: NO_TOOL_CONTEXT,
      label: t("resources.selectCredential", { defaultValue: "选择凭证" }),
    },
    ...contexts.map((credential) => ({
      value: credential.id,
      label: [
        credential.name,
        credential.user?.name || credential.user?.email,
        credential.id,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  ]

  const setConnectorEnabled = async (server: McpServer, enabled: boolean) => {
    if (server.type !== "system" || server.enabled === enabled) return
    await remote.run(async () => {
      await api(base + `/connectors/${server.id}/enabled`, {
        method: "PATCH",
        headers: match(server.revision),
        body: JSON.stringify({ enabled }),
      })
    }, t("resources.operationCompleted"))
  }
  const resetDraft = () => {
    setEditingServer(null)
    setAdvancedOpen(false)
    setAuthorizationMode("none")
    setAuthorizationMethod("httpHeader")
    setOAuthClientMode("dynamic")
    setTagsOpen(false)
    setTagIds([])
    setAvatarDraft(null)
    setAuthorization(null)
  }

  const handleDialogOpenChange = (open: boolean) => {
    if (editorPending) return
    setDialogOpen(open)
    if (!open) resetDraft()
  }

  const handleEditServer = (server: McpServer) => {
    if (server.type !== "system") return

    setEditingServer(server)
    setAdvancedOpen(false)
    setAvatarDraft(null)
    setAuthorizationMode(server.authorizationMode)
    setAuthorizationMethod(server.authorizationMethod ?? "httpHeader")
    setOAuthClientMode(
      server.oauthConfig.mode === "dynamic" ? "dynamic" : "manual"
    )
    setAuthorization(server.authorization)
    setTagIds(server.tagIds)
    setTagsOpen(false)
    setDialogOpen(true)
  }

  const persistConnector = async (formData: FormData): Promise<McpServer> => {
    const credential =
      authorizationMode === "centralized"
        ? credentialsRef.current?.getValue(String(formData.get("name") ?? ""))
        : undefined
    if (editingServer?.origin === "package") {
      const name = String(formData.get("name") ?? "").trim()
      const description = String(formData.get("description") ?? "").trim()
      const url = String(formData.get("url") ?? "").trim()
      const proxyId = String(formData.get("proxyId") ?? "").replace(
        /^__direct__$/,
        ""
      )
      const secret = String(formData.get("oauthClientSecret") ?? "")
      const authHeaderName = String(formData.get("authHeaderName") ?? "").trim()
      const nextMethod =
        authorizationMode === "none"
          ? null
          : authorizationMethod === "httpHeader"
            ? "http_header"
            : "oauth"
      const nextOAuth = oauthFormConfig(
        oauthClientMode,
        formData,
        editingServer.oauthConfig
      )
      const overrides: Record<string, unknown> = credential
        ? { credential }
        : {}
      if (name !== editingServer.name) overrides.name = name
      if (description !== editingServer.description) {
        overrides.description = description
      }
      if (url !== editingServer.url) overrides.url = url
      if (proxyId !== (editingServer.proxyId ?? "")) {
        overrides.proxy_id = proxyId
      }
      if (authorizationMode !== editingServer.authorizationMode) {
        overrides.authorization_mode = authorizationMode
      }
      if (nextMethod !== editingServer.authorizationMethod) {
        overrides.authorization_method = nextMethod
      }
      if (
        authorizationMode === "independent" &&
        nextMethod === "http_header" &&
        authHeaderName !== (editingServer.authHeaderName ?? "")
      ) {
        overrides.auth_header_name = authHeaderName
      }
      if (
        nextMethod === "oauth" &&
        oauthConfigChanged(oauthClientMode, editingServer, nextOAuth)
      ) {
        overrides.oauth_config = nextOAuth
      }
      if (secret) overrides.oauth_client_secret = secret
      const nextTagIds = [...tagIds].sort()
      const currentTagIds = [...editingServer.tagIds].sort()
      if (
        nextTagIds.length !== currentTagIds.length ||
        nextTagIds.some((id, index) => id !== currentTagIds[index])
      ) {
        overrides.tag_ids = tagIds
      }
      let saved = Object.keys(overrides).length
        ? toServer(
            await saveResource(
              `/connectors/${editingServer.id}`,
              overrides,
              editingServer.revision
            ),
            i18n.language
          )
        : editingServer
      setEditingServer(saved)
      credentialsRef.current?.accept(saved, credential)
      const scope = await savePackageGrants("connector", saved, authorization)
      saved = {
        ...saved,
        grants: scope.grants,
        revision: scope.revision,
        authorization: selection(scope.grants),
      }
      setEditingServer(saved)
      return saved
    }
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const url = String(formData.get("url") ?? "").trim()
    if (!name || !url || editingServer?.type === "user")
      throw new Error(t("resources.credentialConnectorRequired"))
    const secret = String(formData.get("oauthClientSecret") ?? "")
    let saved = await saveResource(
      editingServer ? `/connectors/${editingServer.id}` : "/connectors",
      {
        name,
        description,
        url,
        ...(credential ? { credential } : {}),
        proxy_id: String(formData.get("proxyId") ?? "").replace(
          /^__direct__$/,
          ""
        ),
        tag_ids: tagIds,
        grants: grants(authorization),
        authorization_mode: authorizationMode,
        authorization_method:
          authorizationMode === "none"
            ? null
            : authorizationMethod === "httpHeader"
              ? "http_header"
              : "oauth",
        ...(authorizationMode === "independent" &&
        authorizationMethod === "httpHeader"
          ? {
              auth_header_name: String(
                formData.get("authHeaderName") ?? ""
              ).trim(),
            }
          : {}),
        oauth_config: oauthFormConfig(
          oauthClientMode,
          formData,
          editingServer?.oauthConfig
        ),
        ...(oauthClientMode === "manual" && (secret || !editingServer)
          ? { oauth_client_secret: secret }
          : {}),
      },
      editingServer?.revision
    )
    setEditingServer(toServer(saved, i18n.language))
    credentialsRef.current?.accept(toServer(saved, i18n.language), credential)
    const icon = avatarDraft?.file
    if (icon instanceof File && icon.size > 0) {
      const data = new FormData()
      data.set("icon", icon)
      saved = await api<ResourceRow>(base + `/connectors/${saved.id}/icon`, {
        method: "PUT",
        headers: match(saved.revision),
        body: data,
      })
      setEditingServer(toServer(saved, i18n.language))
      setAvatarDraft(null)
    }
    return toServer(saved, i18n.language)
  }
  const prepareConnector = async () => {
    if (!formRef.current?.reportValidity()) return null
    const formData = new FormData(formRef.current)
    let saved: McpServer | null = null
    await remote.run(async () => {
      saved = await persistConnector(formData)
    })
    return saved
  }
  const revokeCredential = async (credential: ConnectorCredentialInput) => {
    if (!editingServer) return null
    let saved: McpServer | null = null
    await remote.run(async () => {
      saved = toServer(
        await saveResource(
          `/connectors/${editingServer.id}`,
          { credential },
          editingServer.revision
        ),
        i18n.language
      )
      setEditingServer(saved)
    })
    return saved
  }
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (editorPending) return
    const formData = new FormData(event.currentTarget)
    await remote.run(async () => {
      if (authorizationMode === "centralized")
        credentialsRef.current?.validate()
      const saved = await persistConnector(formData)
      if (saved.authorizationMode === "centralized") {
        const credential = saved.credentials[0]
        if (
          (saved.authorizationMethod === "oauth" && !credential) ||
          (credential &&
            (credential.authorization_status !== "authorized" ||
              credential.connection_status === "error"))
        )
          return
      }
      setDialogOpen(false)
      resetDraft()
      showToast({ status: "success", title: t("resources.operationCompleted") })
    })
  }
  const handleDeleteServer = async () => {
    if (!serverPendingDeletion || serverPendingDeletion.origin === "package")
      return
    await remote.run(async () => {
      await api(base + `/connectors/${serverPendingDeletion.id}`, {
        method: "DELETE",
        headers: match(serverPendingDeletion.revision),
      })
      if (servers.length === 1) remote.previousPage(serverPendingDeletion.type)
      setServerPendingDeletion(null)
    }, t("resources.operationCompleted"))
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
    if (toolsBusy) return
    setToolDrafts([])
    setContexts([])
    setContextID("")
    setViewingServer(server)
    setToolsLoading(true)
    try {
      if (server.authorizationMode === "independent") {
        const result = await api<{ items: Credential[] }>(
          base + `/connectors/${server.id}/tool-contexts`
        )
        setContexts(result.items)
      } else {
        await api(base + `/connectors/${server.id}/test`, { method: "POST" })
        await loadTools(server)
      }
      await reload()
    } catch (error) {
      showToast({
        status: "error",
        title: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setToolsLoading(false)
    }
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
    if (!viewingServer || viewingServer.origin === "package" || toolsBusy)
      return
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
      setViewingServer(null)
    }, t("resources.operationCompleted"))
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={batch.page}
        error={subjects.error}
        typeLabel={t("pages.tools.type")}
        systemLabel={t("pages.tools.systemTool")}
        userLabel={t("pages.tools.userTool")}
        searchPlaceholder={t("resources.searchPlaceholder", {
          resource: t("pages.tools.title"),
        })}
        searchClassName="sm:max-w-44 sm:flex-none"
        actions={
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ResourceBatchActions
              key={batch.key}
              {...batch.actions}
              groups={subjects.groups}
              members={subjects.members}
            />
            {activeType === "system" && (
              <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                <DialogTrigger
                  render={
                    <Button
                      className="shrink-0"
                      disabled={remote.pending}
                      onClick={() => {
                        batch.exit()
                        resetDraft()
                      }}
                    />
                  }
                >
                  <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                  {t("pages.tools.add")}
                </DialogTrigger>
                <DialogContent
                  className="max-h-[calc(100vh-2rem)] grid-cols-1 overflow-y-auto sm:max-w-2xl"
                  closeLabel={t("common.close")}
                  aria-describedby={
                    importedServer ? "imported-connector-readonly" : undefined
                  }
                >
                  <form
                    ref={formRef}
                    className="flex min-w-0 flex-col gap-6"
                    onSubmit={handleSubmit}
                  >
                    <DialogHeader>
                      <DialogTitle>
                        {editingServer
                          ? t("pages.tools.editDialogTitle")
                          : t("pages.tools.dialogTitle")}
                      </DialogTitle>
                    </DialogHeader>

                    <FieldGroup className="gap-4">
                      <div
                        data-resource-basics=""
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_var(--resource-avatar-size,7.5rem)] items-start !gap-x-3 !gap-y-1 sm:!gap-x-4 sm:!gap-y-3"
                      >
                        <fieldset disabled={editorPending} className="contents">
                          <Field className="contents">
                            <FieldLabel htmlFor="mcp-name">
                              {t("pages.tools.name")}
                            </FieldLabel>
                            <Input
                              defaultValue={editingServer?.name}
                              id="mcp-name"
                              className="sm:mb-1"
                              name="name"
                              placeholder={t("pages.tools.namePlaceholder")}
                              required
                            />
                          </Field>
                          <Field className="contents">
                            <FieldLabel htmlFor="mcp-description">
                              {t("pages.tools.toolDescription")}
                            </FieldLabel>
                            <Input
                              defaultValue={editingServer?.description}
                              id="mcp-description"
                              name="description"
                              placeholder={t(
                                "pages.tools.descriptionPlaceholder"
                              )}
                              required={!importedServer}
                            />
                          </Field>
                        </fieldset>
                        <ResourceAvatarField
                          id="mcp-avatar"
                          src={editingServer?.iconPath || ""}
                          value={avatarDraft}
                          onValueChange={setAvatarDraft}
                          disabled={importedServer || editorPending}
                          loading={editorPending && !!avatarDraft}
                          acceptedTypes={["image/png", "image/jpeg"]}
                          invalidImageMessage={t(
                            "resources.connectorAvatarInvalid"
                          )}
                          fallback={
                            <HugeiconsIcon
                              icon={McpServerIcon}
                              className="size-8"
                              strokeWidth={2}
                            />
                          }
                        />
                      </div>
                      <fieldset disabled={editorPending} className="contents">
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
                        <Field className="min-w-0 rounded-lg border p-4">
                          <div className="flex items-center justify-between gap-2">
                            <FieldLabel className="shrink-0">
                              {t("pages.tools.authorization")}
                            </FieldLabel>
                            <div
                              ref={setCredentialActionContainer}
                              className="flex min-w-0 flex-wrap items-center justify-end gap-2"
                            />
                          </div>
                          <div className="flex flex-wrap gap-3">
                            <Item
                              variant="outline"
                              size="sm"
                              className="flex-nowrap"
                            >
                              <ItemContent className="min-w-0">
                                <ItemTitle>
                                  <label htmlFor="mcp-authentication-mode">
                                    {t("pages.tools.authorizationMethod")}
                                  </label>
                                </ItemTitle>
                              </ItemContent>
                              <ItemActions>
                                <Select
                                  items={authenticationModeItems}
                                  value={authorizationMode}
                                  disabled={remote.pending}
                                  onValueChange={(value) => {
                                    if (value)
                                      setAuthorizationMode(
                                        value as McpAuthorizationMode
                                      )
                                  }}
                                >
                                  <SelectTrigger
                                    id="mcp-authentication-mode"
                                    className="w-28 sm:w-36"
                                  >
                                    <SelectValue>
                                      {selectedAuthenticationMode?.label}
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent
                                    align="end"
                                    alignItemWithTrigger={false}
                                    className="w-80 max-w-[calc(100vw-2rem)]"
                                  >
                                    <SelectGroup>
                                      {authenticationModeItems.map((item) => (
                                        <SelectItem
                                          key={item.value}
                                          value={item.value}
                                          label={item.label}
                                          aria-label={item.label}
                                          aria-describedby={`mcp-authentication-option-${item.value}-description`}
                                          className="py-2"
                                        >
                                          <span className="flex min-w-0 flex-col gap-1">
                                            <span className="font-medium">
                                              {item.label}
                                            </span>
                                            <span
                                              id={`mcp-authentication-option-${item.value}-description`}
                                              className="whitespace-normal text-xs text-muted-foreground"
                                            >
                                              {item.description}
                                            </span>
                                          </span>
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </ItemActions>
                            </Item>
                            {authorizationMode !== "none" && (
                              <Item
                                variant="outline"
                                size="sm"
                                className="flex-nowrap"
                              >
                                <ItemContent className="min-w-0">
                                  <ItemTitle>
                                    <label htmlFor="mcp-authentication-protocol">
                                      {t("pages.tools.authenticationProtocol")}
                                    </label>
                                  </ItemTitle>
                                </ItemContent>
                                <ItemActions>
                                  <Select
                                    items={authenticationProtocolItems}
                                    value={authorizationMethod}
                                    disabled={remote.pending}
                                    onValueChange={(value) => {
                                      if (value)
                                        setAuthorizationMethod(
                                          value as McpAuthorizationMethod
                                        )
                                    }}
                                  >
                                    <SelectTrigger
                                      id="mcp-authentication-protocol"
                                      className="w-28 sm:w-36"
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent
                                      align="end"
                                      alignItemWithTrigger={false}
                                    >
                                      <SelectGroup>
                                        {authenticationProtocolItems.map(
                                          (item) => (
                                            <SelectItem
                                              key={item.value}
                                              value={item.value}
                                            >
                                              {item.label}
                                            </SelectItem>
                                          )
                                        )}
                                      </SelectGroup>
                                    </SelectContent>
                                  </Select>
                                </ItemActions>
                              </Item>
                            )}
                          </div>
                          {authorizationMode === "independent" &&
                            authorizationMethod === "httpHeader" && (
                              <Field>
                                <FieldLabel htmlFor="mcp-auth-header-name">
                                  {t("resources.authHeaderName")}
                                </FieldLabel>
                                <Input
                                  defaultValue={editingServer?.authHeaderName}
                                  id="mcp-auth-header-name"
                                  name="authHeaderName"
                                  placeholder={t(
                                    "resources.authHeaderNamePlaceholder"
                                  )}
                                />
                              </Field>
                            )}
                          <div
                            className={
                              authorizationMode !== "none" &&
                              authorizationMethod === "oauth"
                                ? "flex min-w-0 flex-col gap-3 rounded-lg border p-4"
                                : "contents"
                            }
                          >
                            {authorizationMode !== "none" &&
                              authorizationMethod === "oauth" && (
                                <>
                                  <FieldLabel>
                                    {t(
                                      "pages.tools.authorizationMethods.oauth"
                                    )}
                                  </FieldLabel>
                                  <Item
                                    variant="outline"
                                    size="sm"
                                    className="flex-col items-stretch sm:flex-row sm:flex-nowrap sm:items-center"
                                  >
                                    <ItemContent className="min-w-0">
                                      <ItemTitle>
                                        <label htmlFor="mcp-oauth-client-mode">
                                          {t("resources.oauthClientMode")}
                                        </label>
                                      </ItemTitle>
                                    </ItemContent>
                                    <ItemActions>
                                      <Select
                                        items={oauthClientModeItems}
                                        value={oauthClientMode}
                                        disabled={editorPending}
                                        onValueChange={(value) => {
                                          if (value)
                                            setOAuthClientMode(
                                              value as OAuthClientMode
                                            )
                                        }}
                                      >
                                        <SelectTrigger
                                          id="mcp-oauth-client-mode"
                                          className="w-full sm:w-52"
                                        >
                                          <SelectValue className="min-w-0 truncate">
                                            {
                                              oauthClientModeItems.find(
                                                (item) =>
                                                  item.value === oauthClientMode
                                              )?.label
                                            }
                                          </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent
                                          align="end"
                                          alignItemWithTrigger={false}
                                          className="w-80 max-w-[calc(100vw-2rem)]"
                                        >
                                          <SelectGroup>
                                            {oauthClientModeItems.map(
                                              (item) => (
                                                <SelectItem
                                                  key={item.value}
                                                  value={item.value}
                                                  label={item.label}
                                                  aria-label={item.label}
                                                  aria-describedby={`mcp-oauth-client-option-${item.value}-description`}
                                                  className="py-2"
                                                >
                                                  <span className="flex min-w-0 flex-col gap-1">
                                                    <span className="font-medium">
                                                      {item.label}
                                                    </span>
                                                    <span
                                                      id={`mcp-oauth-client-option-${item.value}-description`}
                                                      className="whitespace-normal text-xs text-muted-foreground"
                                                    >
                                                      {item.description}
                                                    </span>
                                                  </span>
                                                </SelectItem>
                                              )
                                            )}
                                          </SelectGroup>
                                        </SelectContent>
                                      </Select>
                                    </ItemActions>
                                  </Item>
                                  {oauthClientMode === "manual" && (
                                    <>
                                      {editingServer?.callbackURL && (
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
                                            {t(
                                              "resources.callbackURLDescription"
                                            )}
                                          </FieldDescription>
                                        </Field>
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
                                          [
                                            "oauthRegistrationURL",
                                            "registration_url",
                                            "OAuth Registration URL",
                                          ],
                                          [
                                            "oauthScopes",
                                            "scopes",
                                            "OAuth Scopes",
                                          ],
                                          [
                                            "oauthClientSecret",
                                            "secret",
                                            "OAuth Client Secret",
                                          ],
                                        ] as const
                                      )
                                        .filter(
                                          ([, key]) =>
                                            key !== "registration_url" ||
                                            manualOAuthConfig.registration_url
                                        )
                                        .map(([name, key, label]) => (
                                          <Field key={name}>
                                            <FieldLabel htmlFor={name}>
                                              {label}
                                            </FieldLabel>
                                            <Input
                                              id={name}
                                              name={name}
                                              type={
                                                key === "secret"
                                                  ? "password"
                                                  : "text"
                                              }
                                              defaultValue={
                                                manualOAuthConfig[key] ?? ""
                                              }
                                              required={[
                                                "authorization_url",
                                                "token_url",
                                                ...(!manualOAuthConfig.registration_url
                                                  ? ["client_id"]
                                                  : []),
                                              ].includes(key)}
                                            />
                                          </Field>
                                        ))}
                                      <Field>
                                        <FieldLabel htmlFor="oauthTokenAuthMethod">
                                          {t("resources.oauthTokenAuthMethod")}
                                        </FieldLabel>
                                        <Select
                                          name="oauthTokenAuthMethod"
                                          items={oauthTokenAuthItems}
                                          defaultValue={
                                            manualOAuthConfig.token_endpoint_auth_method ||
                                            DEFAULT_TOKEN_AUTH_METHOD
                                          }
                                        >
                                          <SelectTrigger
                                            id="oauthTokenAuthMethod"
                                            className="w-full min-w-0"
                                          >
                                            <SelectValue className="min-w-0 truncate" />
                                          </SelectTrigger>
                                          <SelectContent
                                            alignItemWithTrigger={false}
                                            align="start"
                                          >
                                            <SelectGroup>
                                              {oauthTokenAuthItems.map(
                                                (item) => (
                                                  <SelectItem
                                                    key={item.value}
                                                    value={item.value}
                                                  >
                                                    {item.label}
                                                  </SelectItem>
                                                )
                                              )}
                                            </SelectGroup>
                                          </SelectContent>
                                        </Select>
                                      </Field>
                                    </>
                                  )}
                                </>
                              )}
                            <ConnectorCredentials
                              ref={credentialsRef}
                              connector={editingServer}
                              method={authorizationMethod}
                              active={authorizationMode === "centralized"}
                              disabled={editorPending}
                              onPrepare={prepareConnector}
                              onChange={refreshConnector}
                              onRevoke={revokeCredential}
                              onBusyChange={setCredentialBusy}
                              actionContainer={credentialActionContainer}
                            />
                          </div>
                        </Field>
                      </fieldset>
                      <div className="grid min-w-0 grid-cols-2 gap-4">
                        <fieldset disabled={editorPending} className="min-w-0">
                          <Field>
                            <FieldLabel htmlFor="mcp-tags">
                              {t("pages.skills.tags")}
                            </FieldLabel>
                            <SkillTagSelect
                              id="mcp-tags"
                              open={tagsOpen}
                              options={availableTags}
                              placeholder={t("pages.skills.tagsPlaceholder")}
                              value={tagIds}
                              onOpenChange={setTagsOpen}
                              onValueChange={setTagIds}
                            />
                          </Field>
                        </fieldset>
                        <Field className="min-w-0">
                          <FieldLabel htmlFor="mcp-authorization">
                            {t("pages.models.authorizedScope")}
                          </FieldLabel>
                          <AuthorizationSelect
                            groups={subjects.groups}
                            members={subjects.members}
                            id="mcp-authorization"
                            disabled={editorPending}
                            value={authorization}
                            onValueChange={setAuthorization}
                          />
                          {importedServer && editingServer.retired && (
                            <p className="text-sm text-amber-700 dark:text-amber-400">
                              {t("resources.retiredGrantsOnly")}
                            </p>
                          )}
                        </Field>
                      </div>
                      <Collapsible
                        open={advancedOpen}
                        onOpenChange={setAdvancedOpen}
                        className="rounded-lg border"
                      >
                        <CollapsibleTrigger
                          id="mcp-advanced-trigger"
                          type="button"
                          disabled={editorPending}
                          className="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                        >
                          <span className="font-medium">
                            {t("pages.models.advancedOptions")}
                          </span>
                          <HugeiconsIcon
                            className="ms-auto size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
                            icon={ArrowRight01Icon}
                            strokeWidth={2}
                          />
                        </CollapsibleTrigger>
                        <CollapsibleContent
                          id="mcp-advanced-options"
                          keepMounted
                          className="border-t p-4"
                        >
                          <fieldset
                            disabled={editorPending}
                            className="min-w-0"
                          >
                            <Field>
                              <FieldLabel htmlFor="mcp-proxy">
                                {t("pages.models.networkProxy")}
                              </FieldLabel>
                              <SystemProxySelect
                                id="mcp-proxy"
                                selected={editingServer?.proxyId ?? ""}
                                proxies={proxies}
                              />
                              {proxyError && (
                                <p role="alert" className="text-destructive">
                                  {proxyError}
                                </p>
                              )}
                            </Field>
                          </fieldset>
                        </CollapsibleContent>
                      </Collapsible>
                    </FieldGroup>

                    <ResourceNotice
                      error={remote.error || subjects.error}
                      loading={false}
                      pending={false}
                    />
                    <ResourceEditorFooter
                      id="imported-connector-readonly"
                      reason={
                        importedServer
                          ? t("resources.importedConnectorReadOnly")
                          : undefined
                      }
                    >
                      <DialogClose
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            disabled={editorPending}
                          />
                        }
                      >
                        {t("pages.tools.cancel")}
                      </DialogClose>
                      <Button
                        type="submit"
                        loading={editorPending}
                        disabled={editorPending}
                      >
                        {editingServer
                          ? t("pages.tools.save")
                          : t("pages.tools.create")}
                      </Button>
                    </ResourceEditorFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {servers.map((server) => {
            return (
              <ResourceCard
                key={server.id}
                disabled={!server.enabled}
                {...batch.cardProps(server.id, server.name, server.type)}
              >
                <CardHeader>
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar size="lg">
                      {server.iconPath && (
                        <AvatarImage
                          src={server.iconPath}
                          alt=""
                          className="m-0.5 size-9 self-center"
                        />
                      )}
                      <AvatarFallback
                        className={
                          server.type === "user"
                            ? "text-lg font-normal"
                            : undefined
                        }
                      >
                        {server.type === "system" ? (
                          <HugeiconsIcon icon={McpServerIcon} strokeWidth={2} />
                        ) : (
                          getCreatorInitial(server.creator)
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex min-w-0 items-center gap-2">
                        <span className="truncate" title={server.name}>
                          {server.name}
                        </span>
                        {!server.enabled && (
                          <Badge variant="outline">
                            {t("resources.batch.disabled")}
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription
                        className="truncate"
                        title={server.creator}
                      >
                        {server.creator}
                      </CardDescription>
                    </div>
                    {batch.actions.selecting && server.type === "system" ? (
                      <Checkbox
                        checked={batch.isSelected(server.id)}
                        disabled={remote.pending}
                        aria-label={t("resources.batch.selectResource", {
                          name: server.name,
                        })}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={() => batch.toggle(server.id)}
                      />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ResourceCardMenuButton
                              aria-label={t("common.more")}
                            />
                          }
                        >
                          <HugeiconsIcon
                            icon={MoreHorizontalIcon}
                            strokeWidth={2}
                          />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuGroup hidden={server.type !== "system"}>
                            <DropdownMenuItem
                              disabled={server.enabled || remote.pending}
                              onClick={() => setConnectorEnabled(server, true)}
                            >
                              <HugeiconsIcon icon={PlayIcon} strokeWidth={2} />
                              {t("resources.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!server.enabled || remote.pending}
                              onClick={() => setConnectorEnabled(server, false)}
                            >
                              <HugeiconsIcon icon={PauseIcon} strokeWidth={2} />
                              {t("resources.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={
                                toolsBusy ||
                                server.authorizationMode === "independent"
                              }
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
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator
                            hidden={server.type !== "system"}
                          />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={server.origin === "package"}
                              onClick={() => setServerPendingDeletion(server)}
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
                <CardContent>
                  <p
                    className="truncate text-muted-foreground"
                    title={server.description}
                  >
                    {server.description?.trim() || t("resources.noDescription")}
                  </p>
                </CardContent>
                <CardFooter className="min-w-0 border-t">
                  <ResourceTagSummary
                    tagIds={server.tagIds}
                    leading={
                      <>
                        <ResourceAuthorizationBadge
                          grants={server.grants}
                          groupNames={authorizationGroupNames}
                          memberNames={authorizationMemberNames}
                          fallback={
                            server.type === "user" ? server.creator : undefined
                          }
                        />
                        {server.origin === "package" && (
                          <ResourcePackageBadge kind="connector" />
                        )}
                        <Badge
                          variant="outline"
                          className={
                            server.authorizationMode === "centralized"
                              ? "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-800 dark:bg-lime-950 dark:text-lime-200"
                              : server.authorizationMode === "none"
                                ? "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200"
                                : "border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-200"
                          }
                        >
                          {t(
                            `pages.tools.authorizationModes.${server.authorizationMode}`
                          )}
                        </Badge>
                        {server.authorizationMode === "centralized" && (
                          <Badge
                            variant="outline"
                            className={
                              server.enabledToolCount > 0
                                ? "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-200"
                                : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
                            }
                          >
                            {t("pages.tools.toolCountSummary", {
                              enabled: server.enabledToolCount,
                              total: server.toolCount,
                            })}
                          </Badge>
                        )}
                      </>
                    }
                  />
                </CardFooter>
              </ResourceCard>
            )
          })}
        </div>
      </ResourceList>

      <Dialog
        open={viewingServer !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingServer(null)
            setToolDrafts([])
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] sm:max-w-4xl"
          closeLabel={t("common.close")}
          aria-describedby={
            readOnlyTools ? "imported-connector-tools-readonly" : undefined
          }
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
              <Select
                items={contextItems}
                value={contextID || NO_TOOL_CONTEXT}
                onValueChange={(value) => {
                  if (value === null) return
                  const id = value === NO_TOOL_CONTEXT ? "" : value
                  setContextID(id)
                  setToolDrafts([])
                  if (id) void remote.run(() => loadTools(viewingServer, id))
                }}
              >
                <SelectTrigger id="tool-context" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false} align="start">
                  <SelectGroup>
                    {contextItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="max-h-[min(60vh,36rem)] overflow-y-auto rounded-md border">
            <Table aria-busy={toolsBusy}>
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
                {toolsLoading && !toolDrafts.length && (
                  <TableRow>
                    <TableCell
                      colSpan={
                        viewingServer?.authorizationMode === "centralized"
                          ? 3
                          : 2
                      }
                      className="h-28 text-center"
                    >
                      <TableLoading />
                    </TableCell>
                  </TableRow>
                )}
                {toolDrafts.map((tool) => (
                  <TableRow key={tool.id}>
                    <TableCell className="max-w-72">
                      <div className="flex min-w-0 flex-col gap-0.5">
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
                        disabled={readOnlyTools || toolsBusy}
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
                          disabled={readOnlyTools || toolsBusy || !tool.enabled}
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
            pending={false}
          />
          <ResourceEditorFooter
            id="imported-connector-tools-readonly"
            leading={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    toolsBusy || readOnlyTools || toolDrafts.length === 0
                  }
                  onClick={() =>
                    setToolDrafts((current) =>
                      current.map((tool) => ({ ...tool, enabled: true }))
                    )
                  }
                >
                  {t("pages.tools.enableAllTools")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    toolsBusy || readOnlyTools || toolDrafts.length === 0
                  }
                  onClick={() =>
                    setToolDrafts((current) =>
                      current.map((tool) => ({ ...tool, enabled: false }))
                    )
                  }
                >
                  {t("pages.tools.disableAllTools")}
                </Button>
              </div>
            }
            reason={
              readOnlyTools
                ? t("resources.importedConnectorReadOnly")
                : undefined
            }
          >
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("pages.tools.cancel")}
            </DialogClose>
            <Button
              disabled={
                toolsBusy ||
                readOnlyTools ||
                toolDrafts.some(
                  (tool) =>
                    !Number.isFinite(tool.pointsPerCall) ||
                    tool.pointsPerCall < 0
                )
              }
              type="button"
              loading={remote.pending && toolDrafts.length > 0}
              onClick={handleSaveTools}
            >
              {t("pages.tools.saveToolSettings")}
            </Button>
          </ResourceEditorFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={serverPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setServerPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.tools.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.tools.deleteDialogDescription", {
              tool: serverPendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remote.pending}>
              {t("pages.tools.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={remote.pending}
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
