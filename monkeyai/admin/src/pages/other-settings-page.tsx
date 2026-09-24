import { useEffect, useState, type FormEvent } from "react"
import {
  Delete02Icon,
  Edit02Icon,
  Route02Icon,
  MailSend02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  PowerIcon,
  PowerOffIcon,
  TagsIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

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
import { useAppToast } from "@/components/animated-toast-provider"
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { api } from "@/lib/api"

const OAUTH_PROVIDERS = [
  { value: "github", labelKey: "pages.otherSettings.oauth.providers.github" },
  { value: "google", labelKey: "pages.otherSettings.oauth.providers.google" },
  {
    value: "microsoft",
    labelKey: "pages.otherSettings.oauth.providers.microsoft",
  },
  { value: "gitlab", labelKey: "pages.otherSettings.oauth.providers.gitlab" },
  {
    value: "baizhiyun",
    labelKey: "pages.otherSettings.oauth.providers.baizhiyun",
  },
  { value: "oidc", labelKey: "pages.otherSettings.oauth.providers.oidc" },
] as const

const ENCRYPTION_OPTIONS = [
  {
    value: "starttls",
    labelKey: "pages.otherSettings.email.encryptionOptions.starttls",
  },
  {
    value: "tls",
    labelKey: "pages.otherSettings.email.encryptionOptions.tls",
  },
  {
    value: "none",
    labelKey: "pages.otherSettings.email.encryptionOptions.none",
  },
] as const

const KNOWLEDGE_MODEL_OPTIONS = {
  embeddingModel: [{ value: "bge-m3", label: "bge-m3" }],
  rerankerModel: [{ value: "bge-reranker-v2-m3", label: "bge-reranker-v2-m3" }],
} as const

const KNOWLEDGE_MODEL_PROTOCOLS = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
] as const

type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]["value"]
type Encryption = (typeof ENCRYPTION_OPTIONS)[number]["value"]
type KnowledgeModelProtocol =
  (typeof KNOWLEDGE_MODEL_PROTOCOLS)[number]["value"]

type OAuthConnection = {
  id: string
  provider: OAuthProvider
  name: string
  clientId: string
  clientSecret: string
  issuerUrl?: string
  scopes?: string[]
  enabled: boolean
  autoRegistrationEnabled: boolean
}

type OAuthPendingAction = {
  connection: OAuthConnection
  action: "enable" | "disable" | "delete"
}

type AutoRegistrationPendingAction =
  | { type: "email"; enabled: boolean }
  | { type: "oauth"; enabled: boolean; connection: OAuthConnection }

function readOAuthConnections(
  value: Record<string, unknown>
): OAuthConnection[] {
  const connections = Array.isArray(value.oauth_connections)
    ? value.oauth_connections
    : []
  return connections.map((item) => {
    const connection = item as Record<string, unknown>
    return {
      id: String(connection.id),
      provider: String(connection.provider) as OAuthProvider,
      name: String(connection.name),
      clientId: String(connection.client_id),
      clientSecret: String(connection.client_secret ?? ""),
      issuerUrl: connection.issuer_url
        ? String(connection.issuer_url)
        : undefined,
      scopes: Array.isArray(connection.scopes)
        ? connection.scopes.map(String)
        : undefined,
      enabled: Boolean(connection.enabled),
      autoRegistrationEnabled: connection.auto_registration_enabled !== false,
    }
  })
}

type LoginMethodSettings = {
  passwordEnabled: boolean
  emailCodeEnabled: boolean
  emailCodeAutoRegistrationEnabled: boolean
}

type EmailSettings = {
  senderName: string
  senderEmail: string
  smtpHost: string
  smtpPort: string
  smtpUsername: string
  smtpPassword: string
  encryption: Encryption
}

type KnowledgeModelConfig = {
  model: string
  modelId: string
  baseUrl: string
  apiKey: string
}

type DocumentParsingEngineConfig = {
  provider: "baizhi"
  apiKey: string
}

type ContentEnhancementModelConfig = {
  modelId: string
  displayName: string
  contextSizeK: number
  baseUrl: string
  protocol: KnowledgeModelProtocol
  apiKey: string
}

type KnowledgeBaseSettings = {
  embeddingModel: KnowledgeModelConfig | null
  rerankerModel: KnowledgeModelConfig | null
  documentParsingEngine: DocumentParsingEngineConfig | null
  contentEnhancementModel: ContentEnhancementModelConfig | null
}

type KnowledgeModelKind = "embeddingModel" | "rerankerModel"

const INITIAL_OAUTH_CONNECTIONS: OAuthConnection[] = []

const INITIAL_LOGIN_METHOD_SETTINGS: LoginMethodSettings = {
  passwordEnabled: true,
  emailCodeEnabled: false,
  emailCodeAutoRegistrationEnabled: false,
}

const INITIAL_EMAIL_SETTINGS: EmailSettings = {
  senderName: "Monkey AI",
  senderEmail: "no-reply@example.com",
  smtpHost: "smtp.example.com",
  smtpPort: "587",
  smtpUsername: "no-reply@example.com",
  smtpPassword: "",
  encryption: "starttls",
}

const INITIAL_KNOWLEDGE_BASE_SETTINGS: KnowledgeBaseSettings = {
  embeddingModel: null,
  rerankerModel: null,
  documentParsingEngine: null,
  contentEnhancementModel: null,
}

export function OtherSettingsPage() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const { tags: skillTags, addTag, deleteTag, renameTag } = useSkillTags()
  const [teamName, setTeamName] = useState("Monkey AI")
  const [savedTeamName, setSavedTeamName] = useState("Monkey AI")
  const [toolName, setToolName] = useState("MonkeyAI")
  const [savedToolName, setSavedToolName] = useState("MonkeyAI")
  const [oauthConnections, setOauthConnections] = useState(
    INITIAL_OAUTH_CONNECTIONS
  )
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthCallbackDialogOpen, setOauthCallbackDialogOpen] = useState(false)
  const [oauthCallbackURL, setOauthCallbackURL] = useState(
    () => `${window.location.origin}/api/auth/v1/oauth/callback`
  )
  const [editingOauthID, setEditingOauthID] = useState<string | null>(null)
  const [oauthProvider, setOauthProvider] = useState<OAuthProvider>("github")
  const [oauthSaving, setOauthSaving] = useState(false)
  const [oauthPendingAction, setOauthPendingAction] =
    useState<OAuthPendingAction | null>(null)
  const [oauthActionSaving, setOauthActionSaving] = useState(false)
  const [loginMethodSettings, setLoginMethodSettings] = useState(
    INITIAL_LOGIN_METHOD_SETTINGS
  )
  const [loginMethodSaving, setLoginMethodSaving] = useState<
    keyof LoginMethodSettings | null
  >(null)
  const [emailSettings, setEmailSettings] = useState(INITIAL_EMAIL_SETTINGS)
  const [savedEmailSettings, setSavedEmailSettings] = useState(
    INITIAL_EMAIL_SETTINGS
  )
  const [emailConfigured, setEmailConfigured] = useState(false)
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [autoRegistrationPending, setAutoRegistrationPending] =
    useState<AutoRegistrationPendingAction | null>(null)
  const [autoRegistrationSaving, setAutoRegistrationSaving] = useState(false)
  const [emailCodePendingValue, setEmailCodePendingValue] = useState<
    boolean | null
  >(null)
  const [passwordPendingValue, setPasswordPendingValue] = useState<
    boolean | null
  >(null)
  const [testSending, setTestSending] = useState(false)
  const [knowledgeBaseSettings, setKnowledgeBaseSettings] = useState(
    INITIAL_KNOWLEDGE_BASE_SETTINGS
  )
  const [knowledgeModelDialog, setKnowledgeModelDialog] =
    useState<KnowledgeModelKind | null>(null)
  const [documentParsingDialogOpen, setDocumentParsingDialogOpen] =
    useState(false)
  const [contentEnhancementDialogOpen, setContentEnhancementDialogOpen] =
    useState(false)
  const [tagDialogOpen, setTagDialogOpen] = useState(false)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [tagName, setTagName] = useState("")
  const [tagError, setTagError] = useState("")
  const [tagPendingDeletionId, setTagPendingDeletionId] = useState<
    string | null
  >(null)
  const brandInfoDirty =
    teamName !== savedTeamName || toolName !== savedToolName
  const emailSettingsDirty =
    JSON.stringify(emailSettings) !== JSON.stringify(savedEmailSettings)
  const emailConfigurationVisible = emailConfigured
  const editingOauthConnection = editingOauthID
    ? oauthConnections.find((connection) => connection.id === editingOauthID)
    : undefined

  useEffect(() => {
    const controller = new AbortController()
    api<{ issuer: string }>("/.well-known/oauth-authorization-server", {
      signal: controller.signal,
    })
      .then(({ issuer }) => {
        const publicURL = issuer.replace(/\/+$/, "")
        if (publicURL) {
          setOauthCallbackURL(`${publicURL}/api/auth/v1/oauth/callback`)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    api<{
      settings: Array<{
        key: string
        value: Record<string, unknown>
      }>
    }>("/api/admin/v1/settings")
      .then(({ settings }) => {
        for (const setting of settings) {
          if (setting.key === "branding") {
            const workspaceName = String(
              setting.value.workspace_name ?? "Monkey AI"
            )
            const productName = String(setting.value.product_name ?? "MonkeyAI")
            setTeamName(workspaceName)
            setSavedTeamName(workspaceName)
            setToolName(productName)
            setSavedToolName(productName)
          }
          if (setting.key === "authentication") {
            setOauthConnections(readOAuthConnections(setting.value))
            setLoginMethodSettings({
              passwordEnabled:
                typeof setting.value.password_enabled === "boolean"
                  ? setting.value.password_enabled
                  : INITIAL_LOGIN_METHOD_SETTINGS.passwordEnabled,
              emailCodeEnabled:
                typeof setting.value.email_code_enabled === "boolean"
                  ? setting.value.email_code_enabled
                  : INITIAL_LOGIN_METHOD_SETTINGS.emailCodeEnabled,
              emailCodeAutoRegistrationEnabled:
                typeof setting.value.email_code_auto_registration_enabled ===
                "boolean"
                  ? setting.value.email_code_auto_registration_enabled
                  : INITIAL_LOGIN_METHOD_SETTINGS.emailCodeAutoRegistrationEnabled,
            })
          }
          if (setting.key === "email") {
            const applyEmail = (): EmailSettings => ({
              senderName: String(setting.value.sender_name ?? ""),
              senderEmail: String(setting.value.sender_email ?? ""),
              smtpHost: String(setting.value.smtp_host ?? ""),
              smtpPort: String(setting.value.smtp_port ?? "587"),
              smtpUsername: String(setting.value.smtp_username ?? ""),
              smtpPassword: String(setting.value.smtp_password ?? ""),
              encryption: String(
                setting.value.smtp_encryption ?? "starttls"
              ) as Encryption,
            })
            setEmailSettings(applyEmail)
            setSavedEmailSettings(applyEmail)
            setEmailConfigured(true)
          }
        }
      })
      .catch((reason: Error) =>
        showToast({ status: "error", title: reason.message })
      )
  }, [showToast])

  const saveSetting = async (key: string, value: Record<string, unknown>) => {
    try {
      return await api<{ value: Record<string, unknown> }>(
        `/api/admin/v1/settings/${key}`,
        {
          method: "PUT",
          body: JSON.stringify({ value, schema_version: 1 }),
        }
      )
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
      return false
    }
  }

  const saveAuthentication = async (
    connections: (Omit<OAuthConnection, "id"> & { id?: string })[],
    loginMethods = loginMethodSettings
  ) => {
    const saved = await saveSetting("authentication", {
      password_enabled: loginMethods.passwordEnabled,
      email_code_enabled: loginMethods.emailCodeEnabled,
      email_code_auto_registration_enabled:
        loginMethods.emailCodeAutoRegistrationEnabled,
      oauth_connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        client_id: connection.clientId,
        client_secret: connection.clientSecret,
        issuer_url: connection.issuerUrl ?? null,
        scopes: connection.scopes,
        enabled: connection.enabled,
        auto_registration_enabled: connection.autoRegistrationEnabled,
      })),
    })
    if (!saved) return false
    setOauthConnections(readOAuthConnections(saved.value))
    showToast({
      status: "success",
      title: t("resources.operationCompleted"),
    })
    return true
  }

  const providerItems = OAUTH_PROVIDERS.map((provider) => ({
    value: provider.value,
    label: t(provider.labelKey),
  }))
  const encryptionItems = ENCRYPTION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }))

  const handleOauthDialogOpenChange = (open: boolean) => {
    setOauthDialogOpen(open)
    if (!open) {
      setEditingOauthID(null)
      setOauthProvider("github")
    }
  }

  const openOauthEditDialog = (connection: OAuthConnection) => {
    setEditingOauthID(connection.id)
    setOauthProvider(connection.provider)
    setOauthDialogOpen(true)
  }

  const copyOauthCallbackURL = async () => {
    try {
      await navigator.clipboard.writeText(oauthCallbackURL)
      showToast({
        status: "success",
        title: t("pages.otherSettings.oauth.callbackCopied"),
      })
    } catch {
      showToast({
        status: "error",
        title: t("pages.otherSettings.oauth.callbackCopyFailed"),
      })
    }
  }

  const handleOauthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (oauthSaving) return

    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const clientId = String(formData.get("clientId") ?? "").trim()
    const clientSecret = String(formData.get("clientSecret") ?? "").trim()
    const issuerUrl = String(formData.get("issuerUrl") ?? "").trim()

    if (
      !name ||
      !clientId ||
      (!clientSecret && !editingOauthConnection) ||
      ((oauthProvider === "oidc" || oauthProvider === "baizhiyun") &&
        !issuerUrl)
    ) {
      return
    }

    const nextConnection = {
      id: editingOauthConnection?.id,
      provider: oauthProvider,
      name,
      clientId,
      clientSecret,
      issuerUrl: issuerUrl || undefined,
      scopes: editingOauthConnection?.scopes,
      enabled: editingOauthConnection?.enabled ?? true,
      autoRegistrationEnabled:
        editingOauthConnection?.autoRegistrationEnabled ?? true,
    }
    const connections = editingOauthConnection
      ? oauthConnections.map((connection) =>
          connection.id === editingOauthConnection.id
            ? nextConnection
            : connection
        )
      : [...oauthConnections, nextConnection]

    setOauthSaving(true)
    try {
      if (await saveAuthentication(connections)) {
        form.reset()
        handleOauthDialogOpenChange(false)
      }
    } finally {
      setOauthSaving(false)
    }
  }

  const setOauthEnabled = async (id: string, enabled: boolean) => {
    const connections = oauthConnections.map((connection) =>
      connection.id === id ? { ...connection, enabled } : connection
    )
    return saveAuthentication(connections)
  }

  const removeOauthConnection = async (id: string) => {
    const connections = oauthConnections.filter(
      (connection) => connection.id !== id
    )
    return saveAuthentication(connections)
  }

  const confirmOauthAction = async () => {
    if (!oauthPendingAction || oauthActionSaving) return

    setOauthActionSaving(true)
    try {
      const { connection, action } = oauthPendingAction
      const saved =
        action === "delete"
          ? await removeOauthConnection(connection.id)
          : await setOauthEnabled(connection.id, action === "enable")
      if (saved) {
        setOauthPendingAction(null)
      }
    } finally {
      setOauthActionSaving(false)
    }
  }

  const setLoginMethodEnabled = async (
    key: keyof LoginMethodSettings,
    enabled: boolean
  ) => {
    const nextSettings = { ...loginMethodSettings, [key]: enabled }
    setLoginMethodSaving(key)
    try {
      const saved = await saveAuthentication(oauthConnections, nextSettings)
      if (saved) {
        setLoginMethodSettings(nextSettings)
      }
      return saved
    } finally {
      setLoginMethodSaving(null)
    }
  }

  const confirmAutoRegistration = async () => {
    if (!autoRegistrationPending || autoRegistrationSaving) return

    setAutoRegistrationSaving(true)
    try {
      if (autoRegistrationPending.type === "email") {
        const nextSettings = {
          ...loginMethodSettings,
          emailCodeAutoRegistrationEnabled: autoRegistrationPending.enabled,
        }
        if (await saveAuthentication(oauthConnections, nextSettings)) {
          setLoginMethodSettings(nextSettings)
          setAutoRegistrationPending(null)
        }
        return
      }

      const connections = oauthConnections.map((connection) =>
        connection.id === autoRegistrationPending.connection.id
          ? {
              ...connection,
              autoRegistrationEnabled: autoRegistrationPending.enabled,
            }
          : connection
      )
      if (await saveAuthentication(connections)) {
        setAutoRegistrationPending(null)
      }
    } finally {
      setAutoRegistrationSaving(false)
    }
  }

  const updateEmailSetting = <Key extends keyof EmailSettings>(
    key: Key,
    value: EmailSettings[Key]
  ) => {
    setEmailSettings((settings) => ({ ...settings, [key]: value }))
  }

  const handleEmailDialogOpenChange = (open: boolean) => {
    setEmailDialogOpen(open)
    setEmailSettings(savedEmailSettings)
  }

  const handleEmailSettingsSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    const saved = await saveSetting("email", {
      sender_name: emailSettings.senderName,
      sender_email: emailSettings.senderEmail,
      smtp_host: emailSettings.smtpHost,
      smtp_port: Number(emailSettings.smtpPort),
      smtp_username: emailSettings.smtpUsername,
      smtp_password: emailSettings.smtpPassword,
      smtp_encryption: emailSettings.encryption,
    })
    if (saved) {
      setSavedEmailSettings(emailSettings)
      setEmailConfigured(true)
      setEmailDialogOpen(false)
      showToast({
        status: "success",
        title: t("pages.otherSettings.email.saved"),
      })
    }
  }

  const handleKnowledgeModelSubmit = (
    event: FormEvent<HTMLFormElement>,
    kind: KnowledgeModelKind
  ) => {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const model = String(formData.get("model") ?? "").trim()
    const modelId = String(formData.get("modelId") ?? "").trim()
    const baseUrl = String(formData.get("baseUrl") ?? "").trim()
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const currentConfig = knowledgeBaseSettings[kind]
    const modelSupported = KNOWLEDGE_MODEL_OPTIONS[kind].some(
      (option) => option.value === model
    )

    if (
      !modelSupported ||
      !modelId ||
      !baseUrl ||
      (!apiKey && !currentConfig)
    ) {
      return
    }

    setKnowledgeBaseSettings((settings) => ({
      ...settings,
      [kind]: {
        model,
        modelId,
        baseUrl,
        apiKey: apiKey || currentConfig?.apiKey || "",
      },
    }))
    setKnowledgeModelDialog(null)
  }

  const handleDocumentParsingSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const currentConfig = knowledgeBaseSettings.documentParsingEngine

    if (!apiKey && !currentConfig) {
      return
    }

    setKnowledgeBaseSettings((settings) => ({
      ...settings,
      documentParsingEngine: {
        provider: "baizhi",
        apiKey: apiKey || currentConfig?.apiKey || "",
      },
    }))
    setDocumentParsingDialogOpen(false)
  }

  const handleContentEnhancementSubmit = (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()

    const formData = new FormData(event.currentTarget)
    const modelId = String(formData.get("modelId") ?? "").trim()
    const displayName = String(formData.get("displayName") ?? "").trim()
    const contextSizeK = Number(formData.get("contextSizeK"))
    const baseUrl = String(formData.get("baseUrl") ?? "").trim()
    const protocol = String(formData.get("protocol") ?? "").trim()
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const currentConfig = knowledgeBaseSettings.contentEnhancementModel
    const protocolSupported = KNOWLEDGE_MODEL_PROTOCOLS.some(
      (option) => option.value === protocol
    )

    if (
      !modelId ||
      !displayName ||
      !Number.isFinite(contextSizeK) ||
      contextSizeK <= 0 ||
      !baseUrl ||
      !protocolSupported ||
      (!apiKey && !currentConfig)
    ) {
      return
    }

    setKnowledgeBaseSettings((settings) => ({
      ...settings,
      contentEnhancementModel: {
        modelId,
        displayName,
        contextSizeK,
        baseUrl,
        protocol: protocol as KnowledgeModelProtocol,
        apiKey: apiKey || currentConfig?.apiKey || "",
      },
    }))
    setContentEnhancementDialogOpen(false)
  }

  const handleTestEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const recipient = String(formData.get("recipient") ?? "").trim()
    if (!recipient) {
      return
    }

    if (testSending) return
    setTestSending(true)
    try {
      await api("/api/admin/v1/settings/email/test", {
        method: "POST",
        body: JSON.stringify({ recipient }),
      })
      showToast({
        status: "success",
        title: t("pages.otherSettings.email.testSent", { email: recipient }),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setTestSending(false)
    }
  }

  const handleTagDialogOpenChange = (open: boolean) => {
    setTagDialogOpen(open)
    if (!open) {
      setEditingTagId(null)
      setTagName("")
      setTagError("")
    }
  }

  const openTagDialog = (tagId?: string) => {
    const tag = skillTags.find((candidate) => candidate.id === tagId)
    setEditingTagId(tag?.id ?? null)
    setTagName(tag?.name ?? "")
    setTagError("")
    setTagDialogOpen(true)
  }

  const handleTagSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = editingTagId
      ? await renameTag(editingTagId, tagName)
      : await addTag(tagName)

    if (result === "conflict") {
      setTagError(t("pages.otherSettings.skillTags.duplicate"))
      return
    }
    if (result === "failed") return

    handleTagDialogOpenChange(false)
    showToast({
      status: "success",
      title: t("pages.otherSettings.skillTags.saved"),
    })
  }

  const tagPendingDeletion = skillTags.find(
    (tag) => tag.id === tagPendingDeletionId
  )

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.brandInfo.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.brandInfo.description")}
          </CardDescription>
          {brandInfoDirty && (
            <CardAction>
              <Button
                type="button"
                disabled={!teamName.trim() || !toolName.trim()}
                onClick={async () => {
                  const saved = await saveSetting("branding", {
                    workspace_name: teamName.trim(),
                    product_name: toolName.trim(),
                  })
                  if (saved) {
                    setSavedTeamName(teamName)
                    setSavedToolName(toolName)
                    showToast({
                      status: "success",
                      title: t("pages.otherSettings.brandInfo.saved"),
                    })
                  }
                }}
              >
                {t("pages.otherSettings.brandInfo.save")}
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="team-name">
                {t("pages.otherSettings.brandInfo.teamName")}
              </FieldLabel>
              <Input
                id="team-name"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-name">
                {t("pages.otherSettings.brandInfo.toolName")}
              </FieldLabel>
              <Input
                id="tool-name"
                value={toolName}
                onChange={(event) => setToolName(event.target.value)}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="order-3">
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.skillTags.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.skillTags.description")}
          </CardDescription>
          <CardAction>
            <Button type="button" onClick={() => openTagDialog()}>
              <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
              {t("pages.otherSettings.skillTags.add")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {skillTags.length > 0 ? (
            <ItemGroup className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
              {skillTags.map((tag) => (
                <Item
                  className="w-full"
                  key={tag.id}
                  size="sm"
                  variant="outline"
                >
                  <ItemMedia variant="icon">
                    <HugeiconsIcon icon={TagsIcon} strokeWidth={2} />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle title={tag.name}>{tag.name}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
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
                            onClick={() => openTagDialog(tag.id)}
                          >
                            <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                            {t("pages.otherSettings.skillTags.edit")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setTagPendingDeletionId(tag.id)}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              strokeWidth={2}
                            />
                            {t("pages.otherSettings.skillTags.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              ))}
            </ItemGroup>
          ) : (
            <p className="py-6 text-center text-muted-foreground">
              {t("pages.otherSettings.skillTags.empty")}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={tagDialogOpen} onOpenChange={handleTagDialogOpenChange}>
        <DialogContent className="sm:max-w-sm" closeLabel={t("common.close")}>
          <form className="flex flex-col gap-6" onSubmit={handleTagSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editingTagId
                  ? t("pages.otherSettings.skillTags.editDialogTitle")
                  : t("pages.otherSettings.skillTags.addDialogTitle")}
              </DialogTitle>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field data-invalid={Boolean(tagError)}>
                <FieldLabel htmlFor="skill-tag-name">
                  {t("pages.otherSettings.skillTags.name")}
                </FieldLabel>
                <Input
                  aria-invalid={Boolean(tagError)}
                  autoFocus
                  id="skill-tag-name"
                  maxLength={32}
                  placeholder={t(
                    "pages.otherSettings.skillTags.namePlaceholder"
                  )}
                  required
                  value={tagName}
                  onChange={(event) => {
                    setTagName(event.target.value)
                    setTagError("")
                  }}
                />
                <FieldError>{tagError}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("pages.otherSettings.skillTags.cancel")}
              </DialogClose>
              <Button disabled={!tagName.trim()} type="submit">
                {editingTagId
                  ? t("pages.otherSettings.skillTags.save")
                  : t("pages.otherSettings.skillTags.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={tagPendingDeletionId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTagPendingDeletionId(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.otherSettings.skillTags.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.otherSettings.skillTags.deleteDialogDescription", {
              tag: tagPendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.otherSettings.skillTags.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async (event) => {
                event.preventDefault()
                if (tagPendingDeletionId) {
                  if (!(await deleteTag(tagPendingDeletionId))) return
                }
                setTagPendingDeletionId(null)
                showToast({
                  status: "success",
                  title: t("pages.otherSettings.skillTags.deleted"),
                })
              }}
            >
              {t("pages.otherSettings.skillTags.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="order-4">
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.knowledgeBase.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.knowledgeBase.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            {(["embeddingModel", "rerankerModel"] as KnowledgeModelKind[]).map(
              (kind) => {
                const config = knowledgeBaseSettings[kind]
                const modelOptions = KNOWLEDGE_MODEL_OPTIONS[kind]
                const modelName = t(`pages.otherSettings.knowledgeBase.${kind}`)

                return (
                  <Item key={kind} variant="outline">
                    <ItemContent>
                      <ItemTitle>{modelName}</ItemTitle>
                      <ItemDescription>
                        {config ? (
                          <>
                            <bdi>{config.model}</bdi>
                            <span aria-hidden="true"> · </span>
                            <bdi>{config.modelId}</bdi>
                            <span aria-hidden="true"> · </span>
                            <bdi>{config.baseUrl}</bdi>
                          </>
                        ) : (
                          t("pages.otherSettings.knowledgeBase.notConfigured")
                        )}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Dialog
                        open={knowledgeModelDialog === kind}
                        onOpenChange={(open) =>
                          setKnowledgeModelDialog(open ? kind : null)
                        }
                      >
                        <DialogTrigger render={<Button variant="secondary" />}>
                          {t(
                            config
                              ? "pages.otherSettings.knowledgeBase.edit"
                              : "pages.otherSettings.knowledgeBase.configure"
                          )}
                        </DialogTrigger>
                        <DialogContent
                          className="sm:max-w-lg"
                          closeLabel={t("common.close")}
                        >
                          <form
                            className="flex flex-col gap-6"
                            onSubmit={(event) =>
                              handleKnowledgeModelSubmit(event, kind)
                            }
                          >
                            <DialogHeader>
                              <DialogTitle>
                                {t(
                                  "pages.otherSettings.knowledgeBase.dialogTitle",
                                  { model: modelName }
                                )}
                              </DialogTitle>
                              <DialogDescription>
                                {t(
                                  "pages.otherSettings.knowledgeBase.dialogDescription"
                                )}
                              </DialogDescription>
                            </DialogHeader>
                            <FieldGroup className="gap-4">
                              <Field>
                                <FieldLabel htmlFor={`${kind}-model`}>
                                  {t("pages.otherSettings.knowledgeBase.model")}
                                </FieldLabel>
                                <Select
                                  name="model"
                                  defaultValue={
                                    config?.model ?? modelOptions[0].value
                                  }
                                  items={modelOptions}
                                >
                                  <SelectTrigger
                                    id={`${kind}-model`}
                                    className="w-full"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent alignItemWithTrigger={false}>
                                    <SelectGroup>
                                      {modelOptions.map((option) => (
                                        <SelectItem
                                          key={option.value}
                                          value={option.value}
                                        >
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                                <FieldDescription>
                                  {t(
                                    kind === "embeddingModel"
                                      ? "pages.otherSettings.knowledgeBase.embeddingSupportDescription"
                                      : "pages.otherSettings.knowledgeBase.rerankerSupportDescription"
                                  )}
                                </FieldDescription>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`${kind}-model-id`}>
                                  {t(
                                    "pages.otherSettings.knowledgeBase.modelId"
                                  )}
                                </FieldLabel>
                                <Input
                                  id={`${kind}-model-id`}
                                  name="modelId"
                                  defaultValue={
                                    config?.modelId ?? modelOptions[0].value
                                  }
                                  placeholder={t(
                                    "pages.otherSettings.knowledgeBase.modelIdPlaceholder"
                                  )}
                                  required
                                />
                                <FieldDescription>
                                  {t(
                                    "pages.otherSettings.knowledgeBase.modelIdDescription"
                                  )}
                                </FieldDescription>
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`${kind}-base-url`}>
                                  {t(
                                    "pages.otherSettings.knowledgeBase.baseUrl"
                                  )}
                                </FieldLabel>
                                <Input
                                  id={`${kind}-base-url`}
                                  name="baseUrl"
                                  type="url"
                                  defaultValue={config?.baseUrl}
                                  placeholder={t(
                                    "pages.otherSettings.knowledgeBase.baseUrlPlaceholder"
                                  )}
                                  required
                                />
                              </Field>
                              <Field>
                                <FieldLabel htmlFor={`${kind}-api-key`}>
                                  {t(
                                    "pages.otherSettings.knowledgeBase.apiKey"
                                  )}
                                </FieldLabel>
                                <Input
                                  id={`${kind}-api-key`}
                                  name="apiKey"
                                  type="password"
                                  autoComplete="new-password"
                                  placeholder={t(
                                    config
                                      ? "pages.otherSettings.knowledgeBase.apiKeyUpdatePlaceholder"
                                      : "pages.otherSettings.knowledgeBase.apiKeyPlaceholder"
                                  )}
                                  required={!config}
                                />
                                <FieldDescription>
                                  {t(
                                    config
                                      ? "pages.otherSettings.knowledgeBase.apiKeyUpdateDescription"
                                      : "pages.otherSettings.knowledgeBase.apiKeyDescription"
                                  )}
                                </FieldDescription>
                              </Field>
                            </FieldGroup>
                            <DialogFooter>
                              <DialogClose
                                render={
                                  <Button type="button" variant="outline" />
                                }
                              >
                                {t("pages.otherSettings.knowledgeBase.cancel")}
                              </DialogClose>
                              <Button type="submit">
                                {t("pages.otherSettings.knowledgeBase.save")}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </ItemActions>
                  </Item>
                )
              }
            )}
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  {t(
                    "pages.otherSettings.knowledgeBase.documentParsingEngine.title"
                  )}
                  {knowledgeBaseSettings.documentParsingEngine && (
                    <Badge variant="outline">
                      {t(
                        "pages.otherSettings.knowledgeBase.documentParsingEngine.provider"
                      )}
                    </Badge>
                  )}
                </ItemTitle>
                <ItemDescription>
                  {t(
                    knowledgeBaseSettings.documentParsingEngine
                      ? "pages.otherSettings.knowledgeBase.documentParsingEngine.configuredDescription"
                      : "pages.otherSettings.knowledgeBase.documentParsingEngine.defaultDescription"
                  )}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Dialog
                  open={documentParsingDialogOpen}
                  onOpenChange={setDocumentParsingDialogOpen}
                >
                  <DialogTrigger render={<Button variant="secondary" />}>
                    {t(
                      knowledgeBaseSettings.documentParsingEngine
                        ? "pages.otherSettings.knowledgeBase.edit"
                        : "pages.otherSettings.knowledgeBase.configure"
                    )}
                  </DialogTrigger>
                  <DialogContent
                    className="sm:max-w-lg"
                    closeLabel={t("common.close")}
                  >
                    <form
                      className="flex flex-col gap-6"
                      onSubmit={handleDocumentParsingSubmit}
                    >
                      <DialogHeader>
                        <DialogTitle>
                          {t(
                            "pages.otherSettings.knowledgeBase.documentParsingEngine.dialogTitle"
                          )}
                        </DialogTitle>
                        <DialogDescription>
                          {t(
                            "pages.otherSettings.knowledgeBase.documentParsingEngine.dialogDescription"
                          )}
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup className="gap-4">
                        <Field>
                          <FieldLabel>
                            {t(
                              "pages.otherSettings.knowledgeBase.documentParsingEngine.providerLabel"
                            )}
                          </FieldLabel>
                          <FieldDescription>
                            {t(
                              "pages.otherSettings.knowledgeBase.documentParsingEngine.providerDescription"
                            )}
                          </FieldDescription>
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="document-parsing-api-key">
                            {t(
                              "pages.otherSettings.knowledgeBase.documentParsingEngine.apiKey"
                            )}
                          </FieldLabel>
                          <Input
                            id="document-parsing-api-key"
                            name="apiKey"
                            type="password"
                            autoComplete="new-password"
                            placeholder={t(
                              knowledgeBaseSettings.documentParsingEngine
                                ? "pages.otherSettings.knowledgeBase.documentParsingEngine.apiKeyUpdatePlaceholder"
                                : "pages.otherSettings.knowledgeBase.documentParsingEngine.apiKeyPlaceholder"
                            )}
                            required={
                              !knowledgeBaseSettings.documentParsingEngine
                            }
                          />
                          <FieldDescription>
                            {t(
                              knowledgeBaseSettings.documentParsingEngine
                                ? "pages.otherSettings.knowledgeBase.documentParsingEngine.apiKeyUpdateDescription"
                                : "pages.otherSettings.knowledgeBase.documentParsingEngine.apiKeyDescription"
                            )}
                          </FieldDescription>
                        </Field>
                      </FieldGroup>
                      <DialogFooter>
                        <DialogClose
                          render={<Button type="button" variant="outline" />}
                        >
                          {t("pages.otherSettings.knowledgeBase.cancel")}
                        </DialogClose>
                        <Button type="submit">
                          {t("pages.otherSettings.knowledgeBase.save")}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  {t(
                    "pages.otherSettings.knowledgeBase.contentEnhancementModel.title"
                  )}
                </ItemTitle>
                <ItemDescription>
                  {knowledgeBaseSettings.contentEnhancementModel ? (
                    <>
                      <bdi>
                        {
                          knowledgeBaseSettings.contentEnhancementModel
                            .displayName
                        }
                      </bdi>
                      <span aria-hidden="true"> · </span>
                      <bdi>
                        {knowledgeBaseSettings.contentEnhancementModel.modelId}
                      </bdi>
                      <span aria-hidden="true"> · </span>
                      <bdi>
                        {
                          KNOWLEDGE_MODEL_PROTOCOLS.find(
                            (option) =>
                              option.value ===
                              knowledgeBaseSettings.contentEnhancementModel
                                ?.protocol
                          )?.label
                        }
                      </bdi>
                      <span aria-hidden="true"> · </span>
                      <bdi>
                        {knowledgeBaseSettings.contentEnhancementModel.baseUrl}
                      </bdi>
                    </>
                  ) : (
                    t(
                      "pages.otherSettings.knowledgeBase.contentEnhancementModel.notConfiguredDescription"
                    )
                  )}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Dialog
                  open={contentEnhancementDialogOpen}
                  onOpenChange={setContentEnhancementDialogOpen}
                >
                  <DialogTrigger render={<Button variant="secondary" />}>
                    {t(
                      knowledgeBaseSettings.contentEnhancementModel
                        ? "pages.otherSettings.knowledgeBase.edit"
                        : "pages.otherSettings.knowledgeBase.configure"
                    )}
                  </DialogTrigger>
                  <DialogContent
                    className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                    closeLabel={t("common.close")}
                  >
                    <form
                      className="flex flex-col gap-6"
                      onSubmit={handleContentEnhancementSubmit}
                    >
                      <DialogHeader>
                        <DialogTitle>
                          {t(
                            "pages.otherSettings.knowledgeBase.contentEnhancementModel.dialogTitle"
                          )}
                        </DialogTitle>
                        <DialogDescription>
                          {t(
                            "pages.otherSettings.knowledgeBase.contentEnhancementModel.dialogDescription"
                          )}
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup className="gap-4">
                        <FieldGroup className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="enhancement-model-id">
                              {t("pages.models.modelId")}
                            </FieldLabel>
                            <Input
                              id="enhancement-model-id"
                              name="modelId"
                              defaultValue={
                                knowledgeBaseSettings.contentEnhancementModel
                                  ?.modelId
                              }
                              placeholder={t("pages.models.modelIdPlaceholder")}
                              required
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="enhancement-model-display-name">
                              {t("pages.models.displayName")}
                            </FieldLabel>
                            <Input
                              id="enhancement-model-display-name"
                              name="displayName"
                              defaultValue={
                                knowledgeBaseSettings.contentEnhancementModel
                                  ?.displayName
                              }
                              placeholder={t(
                                "pages.models.displayNamePlaceholder"
                              )}
                              required
                            />
                          </Field>
                        </FieldGroup>
                        <Field>
                          <FieldLabel htmlFor="enhancement-model-base-url">
                            {t("pages.models.baseUrl")}
                          </FieldLabel>
                          <Input
                            id="enhancement-model-base-url"
                            name="baseUrl"
                            type="url"
                            defaultValue={
                              knowledgeBaseSettings.contentEnhancementModel
                                ?.baseUrl
                            }
                            placeholder={t("pages.models.baseUrlPlaceholder")}
                            required
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="enhancement-model-api-key">
                            {t("pages.models.apiKey")}
                          </FieldLabel>
                          <Input
                            id="enhancement-model-api-key"
                            name="apiKey"
                            type="password"
                            autoComplete="new-password"
                            placeholder={t(
                              knowledgeBaseSettings.contentEnhancementModel
                                ? "pages.otherSettings.knowledgeBase.apiKeyUpdatePlaceholder"
                                : "pages.models.apiKeyPlaceholder"
                            )}
                            required={
                              !knowledgeBaseSettings.contentEnhancementModel
                            }
                          />
                          <FieldDescription>
                            {t(
                              knowledgeBaseSettings.contentEnhancementModel
                                ? "pages.otherSettings.knowledgeBase.apiKeyUpdateDescription"
                                : "pages.otherSettings.knowledgeBase.apiKeyDescription"
                            )}
                          </FieldDescription>
                        </Field>
                        <FieldGroup className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="enhancement-model-context-size">
                              {t("pages.models.contextSize")} (K)
                            </FieldLabel>
                            <Input
                              id="enhancement-model-context-size"
                              name="contextSizeK"
                              type="number"
                              min="1"
                              step="1"
                              defaultValue={
                                knowledgeBaseSettings.contentEnhancementModel
                                  ?.contextSizeK ?? 128
                              }
                              required
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="enhancement-model-protocol">
                              {t("pages.models.protocol")}
                            </FieldLabel>
                            <Select
                              name="protocol"
                              items={KNOWLEDGE_MODEL_PROTOCOLS}
                              defaultValue={
                                knowledgeBaseSettings.contentEnhancementModel
                                  ?.protocol ??
                                KNOWLEDGE_MODEL_PROTOCOLS[0].value
                              }
                            >
                              <SelectTrigger
                                id="enhancement-model-protocol"
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  {KNOWLEDGE_MODEL_PROTOCOLS.map((option) => (
                                    <SelectItem
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </Field>
                        </FieldGroup>
                      </FieldGroup>
                      <DialogFooter>
                        <DialogClose
                          render={<Button type="button" variant="outline" />}
                        >
                          {t("pages.otherSettings.knowledgeBase.cancel")}
                        </DialogClose>
                        <Button type="submit">
                          {t("pages.otherSettings.knowledgeBase.save")}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <Card className="order-1">
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.loginMethods.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.loginMethods.description")}
          </CardDescription>
          <CardAction>
            <Dialog
              open={oauthDialogOpen}
              onOpenChange={handleOauthDialogOpenChange}
            >
              <DialogTrigger render={<Button />}>
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.otherSettings.oauth.add")}
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-lg"
                closeLabel={t("common.close")}
              >
                <form
                  key={editingOauthID ?? "new"}
                  className="flex flex-col gap-6"
                  onSubmit={handleOauthSubmit}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {t(
                        editingOauthConnection
                          ? "pages.otherSettings.oauth.editDialogTitle"
                          : "pages.otherSettings.oauth.dialogTitle"
                      )}
                    </DialogTitle>
                  </DialogHeader>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="oauth-provider">
                        {t("pages.otherSettings.oauth.provider")}
                      </FieldLabel>
                      <Select
                        items={providerItems}
                        value={oauthProvider}
                        onValueChange={(value) => {
                          if (value !== null) {
                            setOauthProvider(value as OAuthProvider)
                          }
                        }}
                      >
                        <SelectTrigger id="oauth-provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {providerItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="oauth-name">
                        {t("pages.otherSettings.oauth.name")}
                      </FieldLabel>
                      <Input
                        id="oauth-name"
                        name="name"
                        defaultValue={editingOauthConnection?.name}
                        placeholder={t(
                          "pages.otherSettings.oauth.namePlaceholder"
                        )}
                        required
                      />
                    </Field>
                    {(oauthProvider === "oidc" ||
                      oauthProvider === "baizhiyun") && (
                      <Field>
                        <FieldLabel htmlFor="oauth-issuer-url">
                          {t("pages.otherSettings.oauth.issuerUrl")}
                        </FieldLabel>
                        <Input
                          id="oauth-issuer-url"
                          name="issuerUrl"
                          type="url"
                          defaultValue={editingOauthConnection?.issuerUrl}
                          placeholder="https://id.example.com"
                          required
                        />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor="oauth-client-id">
                        {t("pages.otherSettings.oauth.clientId")}
                      </FieldLabel>
                      <Input
                        id="oauth-client-id"
                        name="clientId"
                        defaultValue={editingOauthConnection?.clientId}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="oauth-client-secret">
                        {t("pages.otherSettings.oauth.clientSecret")}
                      </FieldLabel>
                      <Input
                        id="oauth-client-secret"
                        name="clientSecret"
                        type="password"
                        placeholder={
                          editingOauthConnection
                            ? t(
                                "pages.otherSettings.oauth.secretUpdatePlaceholder"
                              )
                            : undefined
                        }
                        required={!editingOauthConnection}
                      />
                    </Field>
                    {oauthProvider === "baizhiyun" && (
                      <FieldDescription>
                        {t("pages.otherSettings.oauth.baizhiyunScopes")}
                      </FieldDescription>
                    )}
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={oauthSaving}
                        />
                      }
                    >
                      {t("pages.otherSettings.oauth.cancel")}
                    </DialogClose>
                    <Button
                      type="submit"
                      disabled={oauthSaving}
                      aria-busy={oauthSaving}
                    >
                      {oauthSaving
                        ? `${t(
                            editingOauthConnection
                              ? "pages.otherSettings.oauth.updateConnection"
                              : "pages.otherSettings.oauth.addConnection"
                          )}…`
                        : t(
                            editingOauthConnection
                              ? "pages.otherSettings.oauth.updateConnection"
                              : "pages.otherSettings.oauth.addConnection"
                          )}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  {t("pages.otherSettings.loginMethods.password")}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={loginMethodSettings.passwordEnabled}
                  disabled={loginMethodSaving !== null}
                  onCheckedChange={setPasswordPendingValue}
                  aria-label={t("pages.otherSettings.loginMethods.password")}
                  aria-busy={loginMethodSaving === "passwordEnabled"}
                />
              </ItemActions>
            </Item>
            {oauthConnections.map((connection) => (
              <Item key={connection.id} variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {connection.name}
                    <Badge
                      variant="outline"
                      className={
                        connection.enabled
                          ? "border-green-500/40 text-green-700 dark:border-green-400/40 dark:text-green-400"
                          : "border-red-500/40 text-red-700 dark:border-red-400/40 dark:text-red-400"
                      }
                    >
                      {t(
                        connection.enabled
                          ? "pages.otherSettings.oauth.enabled"
                          : "pages.otherSettings.oauth.disabled"
                      )}
                    </Badge>
                  </ItemTitle>
                </ItemContent>
                <ItemActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="cursor-pointer"
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
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            setOauthPendingAction({
                              connection,
                              action: connection.enabled ? "disable" : "enable",
                            })
                          }
                        >
                          <HugeiconsIcon
                            icon={connection.enabled ? PowerOffIcon : PowerIcon}
                            strokeWidth={2}
                          />
                          {t(
                            connection.enabled
                              ? "pages.otherSettings.oauth.disable"
                              : "pages.otherSettings.oauth.enable"
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openOauthEditDialog(connection)}
                        >
                          <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                          {t("pages.otherSettings.oauth.edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setOauthCallbackDialogOpen(true)}
                        >
                          <HugeiconsIcon icon={Route02Icon} strokeWidth={2} />
                          {t("pages.otherSettings.oauth.viewCallback")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setOauthPendingAction({
                              connection,
                              action: "delete",
                            })
                          }
                        >
                          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          {t("pages.otherSettings.oauth.delete")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
                <ItemFooter>
                  <Item size="sm" variant="outline">
                    <ItemContent>
                      <ItemTitle>
                        {t(
                          "pages.otherSettings.loginMethods.autoRegisterMissingUsers"
                        )}
                      </ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Switch
                        checked={connection.autoRegistrationEnabled}
                        disabled={autoRegistrationSaving}
                        onCheckedChange={(enabled) =>
                          setAutoRegistrationPending({
                            type: "oauth",
                            connection,
                            enabled,
                          })
                        }
                        aria-label={t(
                          "pages.otherSettings.loginMethods.autoRegisterMissingUsers"
                        )}
                        aria-busy={
                          autoRegistrationSaving &&
                          autoRegistrationPending?.type === "oauth" &&
                          autoRegistrationPending.connection.id ===
                            connection.id
                        }
                      />
                    </ItemActions>
                  </Item>
                </ItemFooter>
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <AlertDialog
        open={oauthPendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !oauthActionSaving) {
            setOauthPendingAction(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {oauthPendingAction &&
                t(
                  `pages.otherSettings.oauth.${oauthPendingAction.action}DialogTitle`,
                  { name: oauthPendingAction.connection.name }
                )}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {oauthPendingAction &&
              t(
                `pages.otherSettings.oauth.${oauthPendingAction.action}DialogDescription`,
                { name: oauthPendingAction.connection.name }
              )}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={oauthActionSaving}>
              {t("pages.otherSettings.oauth.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={
                oauthPendingAction?.action === "delete"
                  ? "destructive"
                  : "default"
              }
              disabled={oauthActionSaving}
              aria-busy={oauthActionSaving}
              onClick={confirmOauthAction}
            >
              {oauthPendingAction &&
                t(
                  `pages.otherSettings.oauth.confirm${oauthPendingAction.action[0].toUpperCase()}${oauthPendingAction.action.slice(1)}`
                )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={oauthCallbackDialogOpen}
        onOpenChange={setOauthCallbackDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("pages.otherSettings.oauth.callbackDialogTitle")}
            </DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="oauth-callback-url">
              {t("pages.otherSettings.oauth.callbackURL")}
            </FieldLabel>
            <Input
              id="oauth-callback-url"
              className="font-mono"
              value={oauthCallbackURL}
              readOnly
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyOauthCallbackURL()}
            >
              {t("pages.otherSettings.oauth.copyCallback")}
            </Button>
            <DialogClose render={<Button type="button" />}>
              {t("common.close")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="order-2">
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.email.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.email.description")}
          </CardDescription>
          <Dialog
            open={emailDialogOpen}
            onOpenChange={handleEmailDialogOpenChange}
          >
            <DialogContent
              className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
              closeLabel={t("common.close")}
            >
              <form
                className="flex flex-col gap-6"
                onSubmit={handleEmailSettingsSubmit}
              >
                <DialogHeader>
                  <DialogTitle>
                    {t("pages.otherSettings.email.dialogTitle")}
                  </DialogTitle>
                </DialogHeader>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="smtp-host">
                      {t("pages.otherSettings.email.smtpHost")}
                    </FieldLabel>
                    <Input
                      id="smtp-host"
                      value={emailSettings.smtpHost}
                      onChange={(event) =>
                        updateEmailSetting("smtpHost", event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="smtp-port">
                      {t("pages.otherSettings.email.smtpPort")}
                    </FieldLabel>
                    <Input
                      id="smtp-port"
                      type="number"
                      min="1"
                      max="65535"
                      value={emailSettings.smtpPort}
                      onChange={(event) =>
                        updateEmailSetting("smtpPort", event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="smtp-username">
                      {t("pages.otherSettings.email.smtpUsername")}
                    </FieldLabel>
                    <Input
                      id="smtp-username"
                      autoComplete="off"
                      value={emailSettings.smtpUsername}
                      onChange={(event) =>
                        updateEmailSetting("smtpUsername", event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="smtp-password">
                      {t("pages.otherSettings.email.smtpPassword")}
                    </FieldLabel>
                    <Input
                      id="smtp-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="••••••••••••"
                      value={emailSettings.smtpPassword}
                      onChange={(event) =>
                        updateEmailSetting("smtpPassword", event.target.value)
                      }
                    />
                  </Field>
                  <FieldSet className="md:col-span-2">
                    <FieldLegend variant="label">
                      {t("pages.otherSettings.email.encryption")}
                    </FieldLegend>
                    <RadioGroup
                      className="grid grid-cols-3 gap-3"
                      value={emailSettings.encryption}
                      onValueChange={(value) =>
                        updateEmailSetting("encryption", value as Encryption)
                      }
                      aria-label={t("pages.otherSettings.email.encryption")}
                    >
                      {encryptionItems.map((item) => (
                        <FieldLabel
                          key={item.value}
                          htmlFor={`smtp-encryption-${item.value}`}
                          className="h-9 w-full cursor-pointer rounded-md border border-input px-2.5 font-normal shadow-xs transition-[color,box-shadow] hover:bg-muted/50 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 dark:bg-input/30"
                        >
                          <RadioGroupItem
                            id={`smtp-encryption-${item.value}`}
                            value={item.value}
                          />
                          <span className="truncate">{item.label}</span>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                  </FieldSet>
                  <Field>
                    <FieldLabel htmlFor="sender-name">
                      {t("pages.otherSettings.email.senderName")}
                    </FieldLabel>
                    <Input
                      id="sender-name"
                      value={emailSettings.senderName}
                      onChange={(event) =>
                        updateEmailSetting("senderName", event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sender-email">
                      {t("pages.otherSettings.email.senderEmail")}
                    </FieldLabel>
                    <Input
                      id="sender-email"
                      type="email"
                      value={emailSettings.senderEmail}
                      onChange={(event) =>
                        updateEmailSetting("senderEmail", event.target.value)
                      }
                      required
                    />
                  </Field>
                </FieldGroup>

                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" />}
                  >
                    {t("pages.otherSettings.email.cancel")}
                  </DialogClose>
                  <Button disabled={!emailSettingsDirty} type="submit">
                    {t("pages.otherSettings.email.save")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  {t("pages.otherSettings.email.sendingConfiguration")}
                </ItemTitle>
                <ItemDescription>
                  {emailConfigurationVisible ? (
                    <bdi>{savedEmailSettings.senderEmail}</bdi>
                  ) : (
                    t("pages.otherSettings.email.notConfigured")
                  )}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleEmailDialogOpenChange(true)}
                >
                  {t("pages.otherSettings.email.configure")}
                </Button>
              </ItemActions>
            </Item>
            {emailConfigurationVisible && (
              <>
                <Item variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {t("pages.otherSettings.loginMethods.emailCode")}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={loginMethodSettings.emailCodeEnabled}
                      disabled={loginMethodSaving !== null}
                      onCheckedChange={setEmailCodePendingValue}
                      aria-label={t(
                        "pages.otherSettings.loginMethods.emailCode"
                      )}
                      aria-busy={loginMethodSaving === "emailCodeEnabled"}
                    />
                  </ItemActions>
                </Item>
                <Item variant="outline">
                  <ItemContent>
                    <ItemTitle>
                      {t(
                        "pages.otherSettings.loginMethods.autoRegisterMissingUsers"
                      )}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={
                        loginMethodSettings.emailCodeAutoRegistrationEnabled
                      }
                      disabled={autoRegistrationSaving}
                      onCheckedChange={(enabled) =>
                        setAutoRegistrationPending({
                          type: "email",
                          enabled,
                        })
                      }
                      aria-label={t(
                        "pages.otherSettings.loginMethods.autoRegisterMissingUsers"
                      )}
                      aria-busy={
                        autoRegistrationSaving &&
                        autoRegistrationPending?.type === "email"
                      }
                    />
                  </ItemActions>
                </Item>
                <Item
                  render={<form onSubmit={handleTestEmail} />}
                  variant="outline"
                >
                  <ItemContent>
                    <Field>
                      <FieldLabel className="sr-only" htmlFor="test-recipient">
                        {t("pages.otherSettings.email.testRecipient")}
                      </FieldLabel>
                      <Input
                        id="test-recipient"
                        name="recipient"
                        type="email"
                        placeholder="admin@example.com"
                        required
                      />
                    </Field>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={testSending}
                      aria-busy={testSending}
                    >
                      <HugeiconsIcon
                        icon={MailSend02Icon}
                        data-icon="inline-start"
                      />
                      {testSending
                        ? t("login.sendingCode", "发送中…")
                        : t("pages.otherSettings.email.sendTest")}
                    </Button>
                  </ItemActions>
                </Item>
              </>
            )}
          </ItemGroup>
        </CardContent>
      </Card>

      <AlertDialog
        open={passwordPendingValue !== null}
        onOpenChange={(open) => {
          if (!open && loginMethodSaving === null) {
            setPasswordPendingValue(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                passwordPendingValue
                  ? "pages.otherSettings.loginMethods.enablePasswordDialogTitle"
                  : "pages.otherSettings.loginMethods.disablePasswordDialogTitle"
              )}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t(
              passwordPendingValue
                ? "pages.otherSettings.loginMethods.enablePasswordDialogDescription"
                : "pages.otherSettings.loginMethods.disablePasswordDialogDescription"
            )}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loginMethodSaving !== null}>
              {t("pages.otherSettings.email.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={loginMethodSaving !== null}
              aria-busy={loginMethodSaving === "passwordEnabled"}
              onClick={async () => {
                if (passwordPendingValue === null) {
                  return
                }

                if (
                  await setLoginMethodEnabled(
                    "passwordEnabled",
                    passwordPendingValue
                  )
                ) {
                  setPasswordPendingValue(null)
                }
              }}
            >
              {t(
                passwordPendingValue
                  ? "pages.otherSettings.loginMethods.confirmEnablePassword"
                  : "pages.otherSettings.loginMethods.confirmDisablePassword"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={emailCodePendingValue !== null}
        onOpenChange={(open) => {
          if (!open && loginMethodSaving === null) {
            setEmailCodePendingValue(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                emailCodePendingValue
                  ? "pages.otherSettings.loginMethods.enableEmailCodeDialogTitle"
                  : "pages.otherSettings.loginMethods.disableEmailCodeDialogTitle"
              )}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t(
              emailCodePendingValue
                ? "pages.otherSettings.loginMethods.enableEmailCodeDialogDescription"
                : "pages.otherSettings.loginMethods.disableEmailCodeDialogDescription"
            )}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loginMethodSaving !== null}>
              {t("pages.otherSettings.email.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={loginMethodSaving !== null}
              aria-busy={loginMethodSaving === "emailCodeEnabled"}
              onClick={async () => {
                if (emailCodePendingValue === null) {
                  return
                }

                if (
                  await setLoginMethodEnabled(
                    "emailCodeEnabled",
                    emailCodePendingValue
                  )
                ) {
                  setEmailCodePendingValue(null)
                }
              }}
            >
              {t(
                emailCodePendingValue
                  ? "pages.otherSettings.loginMethods.confirmEnableEmailCode"
                  : "pages.otherSettings.loginMethods.confirmDisableEmailCode"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={autoRegistrationPending !== null}
        onOpenChange={(open) => {
          if (!open && !autoRegistrationSaving) {
            setAutoRegistrationPending(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {autoRegistrationPending &&
                t(
                  autoRegistrationPending.type === "email"
                    ? autoRegistrationPending.enabled
                      ? "pages.otherSettings.loginMethods.enableEmailAutoRegistrationDialogTitle"
                      : "pages.otherSettings.loginMethods.disableEmailAutoRegistrationDialogTitle"
                    : autoRegistrationPending.enabled
                      ? "pages.otherSettings.loginMethods.enableOauthAutoRegistrationDialogTitle"
                      : "pages.otherSettings.loginMethods.disableOauthAutoRegistrationDialogTitle",
                  autoRegistrationPending.type === "oauth"
                    ? { name: autoRegistrationPending.connection.name }
                    : undefined
                )}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {autoRegistrationPending &&
              t(
                autoRegistrationPending.type === "email"
                  ? autoRegistrationPending.enabled
                    ? "pages.otherSettings.loginMethods.enableEmailAutoRegistrationDialogDescription"
                    : "pages.otherSettings.loginMethods.disableEmailAutoRegistrationDialogDescription"
                  : autoRegistrationPending.enabled
                    ? "pages.otherSettings.loginMethods.enableOauthAutoRegistrationDialogDescription"
                    : "pages.otherSettings.loginMethods.disableOauthAutoRegistrationDialogDescription",
                autoRegistrationPending.type === "oauth"
                  ? { name: autoRegistrationPending.connection.name }
                  : undefined
              )}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={autoRegistrationSaving}>
              {t("pages.otherSettings.email.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={autoRegistrationSaving}
              aria-busy={autoRegistrationSaving}
              onClick={confirmAutoRegistration}
            >
              {t(
                autoRegistrationPending?.enabled
                  ? "pages.otherSettings.loginMethods.confirmEnableAutoRegistration"
                  : "pages.otherSettings.loginMethods.confirmDisableAutoRegistration"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
