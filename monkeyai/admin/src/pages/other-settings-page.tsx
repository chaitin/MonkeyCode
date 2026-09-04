import { useEffect, useState, type FormEvent } from "react"
import {
  Delete02Icon,
  Edit02Icon,
  MailSend02Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
  enabled: boolean
}

type EmailSettings = {
  registrationEnabled: boolean
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

const INITIAL_EMAIL_SETTINGS: EmailSettings = {
  registrationEnabled: false,
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
  const { tags: skillTags, addTag, deleteTag, renameTag } = useSkillTags()
  const [teamName, setTeamName] = useState("Monkey AI")
  const [savedTeamName, setSavedTeamName] = useState("Monkey AI")
  const [toolName, setToolName] = useState("MonkeyAI")
  const [savedToolName, setSavedToolName] = useState("MonkeyAI")
  const [brandInfoSaved, setBrandInfoSaved] = useState(false)
  const [settingsError, setSettingsError] = useState("")
  const [oauthConnections, setOauthConnections] = useState(
    INITIAL_OAUTH_CONNECTIONS
  )
  const [oauthDialogOpen, setOauthDialogOpen] = useState(false)
  const [oauthProvider, setOauthProvider] = useState<OAuthProvider>("github")
  const [emailSettings, setEmailSettings] = useState(INITIAL_EMAIL_SETTINGS)
  const [savedEmailSettings, setSavedEmailSettings] = useState(
    INITIAL_EMAIL_SETTINGS
  )
  const [emailDialogOpen, setEmailDialogOpen] = useState(false)
  const [registrationPendingValue, setRegistrationPendingValue] = useState<
    boolean | null
  >(null)
  const [testSentTo, setTestSentTo] = useState<string | null>(null)
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
            const connections = Array.isArray(setting.value.oauth_connections)
              ? setting.value.oauth_connections
              : []
            setOauthConnections(
              connections.map((item) => {
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
                  enabled: Boolean(connection.enabled),
                }
              })
            )
            const registrationEnabled = Boolean(
              setting.value.registration_enabled
            )
            setEmailSettings((current) => ({
              ...current,
              registrationEnabled,
            }))
            setSavedEmailSettings((current) => ({
              ...current,
              registrationEnabled,
            }))
          }
          if (setting.key === "email") {
            const applyEmail = (current: EmailSettings): EmailSettings => ({
              registrationEnabled: current.registrationEnabled,
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
          }
        }
      })
      .catch((reason: Error) => setSettingsError(reason.message))
  }, [])

  const saveSetting = async (key: string, value: Record<string, unknown>) => {
    setSettingsError("")
    try {
      await api(`/api/admin/v1/settings/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value, schema_version: 1 }),
      })
      return true
    } catch (reason) {
      setSettingsError((reason as Error).message)
      return false
    }
  }

  const saveAuthentication = async (
    connections: OAuthConnection[],
    registrationEnabled = savedEmailSettings.registrationEnabled
  ) =>
    saveSetting("authentication", {
      registration_enabled: registrationEnabled,
      oauth_connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        client_id: connection.clientId,
        client_secret: connection.clientSecret,
        issuer_url: connection.issuerUrl ?? null,
        enabled: connection.enabled,
      })),
    })

  const providerItems = OAUTH_PROVIDERS.map((provider) => ({
    value: provider.value,
    label: t(provider.labelKey),
  }))
  const encryptionItems = ENCRYPTION_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }))

  const getProviderName = (provider: OAuthProvider) => {
    const item = OAUTH_PROVIDERS.find(
      (candidate) => candidate.value === provider
    )
    return item ? t(item.labelKey) : provider
  }

  const handleOauthDialogOpenChange = (open: boolean) => {
    setOauthDialogOpen(open)
    if (!open) {
      setOauthProvider("github")
    }
  }

  const handleAddOauth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const clientId = String(formData.get("clientId") ?? "").trim()
    const clientSecret = String(formData.get("clientSecret") ?? "").trim()
    const issuerUrl = String(formData.get("issuerUrl") ?? "").trim()

    if (
      !name ||
      !clientId ||
      !clientSecret ||
      (oauthProvider === "oidc" && !issuerUrl)
    ) {
      return
    }

    const connections = [
      ...oauthConnections,
      {
        id: crypto.randomUUID(),
        provider: oauthProvider,
        name,
        clientId,
        clientSecret,
        issuerUrl: issuerUrl || undefined,
        enabled: true,
      },
    ]
    if (await saveAuthentication(connections)) {
      setOauthConnections(connections)
      form.reset()
      handleOauthDialogOpenChange(false)
    }
  }

  const setOauthEnabled = async (id: string, enabled: boolean) => {
    const connections = oauthConnections.map((connection) =>
      connection.id === id ? { ...connection, enabled } : connection
    )
    if (await saveAuthentication(connections)) {
      setOauthConnections(connections)
    }
  }

  const removeOauthConnection = async (id: string) => {
    const connections = oauthConnections.filter(
      (connection) => connection.id !== id
    )
    if (await saveAuthentication(connections)) {
      setOauthConnections(connections)
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

    if (open) {
      setTestSentTo(null)
    }
  }

  const handleEmailSettingsSubmit = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault()
    const saved = await saveSetting("email", {
      registration_enabled: emailSettings.registrationEnabled,
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
      setEmailDialogOpen(false)
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

  const handleTestEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const recipient = String(formData.get("recipient") ?? "").trim()
    if (!recipient) {
      return
    }

    setTestSentTo(recipient)
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

  const handleTagSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const saved = editingTagId
      ? renameTag(editingTagId, tagName)
      : addTag(tagName)

    if (!saved) {
      setTagError(t("pages.otherSettings.skillTags.duplicate"))
      return
    }

    handleTagDialogOpenChange(false)
  }

  const tagPendingDeletion = skillTags.find(
    (tag) => tag.id === tagPendingDeletionId
  )

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {settingsError && (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {settingsError}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("pages.otherSettings.brandInfo.title")}</CardTitle>
          <CardDescription>
            {t("pages.otherSettings.brandInfo.description")}
          </CardDescription>
          {(brandInfoDirty || brandInfoSaved) && (
            <CardAction className="flex items-center gap-2" aria-live="polite">
              {brandInfoSaved && (
                <Badge variant="secondary">
                  {t("pages.otherSettings.brandInfo.saved")}
                </Badge>
              )}
              {brandInfoDirty && (
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
                      setBrandInfoSaved(true)
                    }
                  }}
                >
                  {t("pages.otherSettings.brandInfo.save")}
                </Button>
              )}
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
                onChange={(event) => {
                  setTeamName(event.target.value)
                  setBrandInfoSaved(false)
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tool-name">
                {t("pages.otherSettings.brandInfo.toolName")}
              </FieldLabel>
              <Input
                id="tool-name"
                value={toolName}
                onChange={(event) => {
                  setToolName(event.target.value)
                  setBrandInfoSaved(false)
                }}
              />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
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
            <ItemGroup className="flex flex-row flex-wrap gap-2">
              {skillTags.map((tag) => (
                <Item
                  className="w-full sm:w-52"
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
            <FieldGroup>
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
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.otherSettings.skillTags.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.otherSettings.skillTags.deleteDialogDescription", {
                tag: tagPendingDeletion?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.otherSettings.skillTags.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (tagPendingDeletionId) {
                  deleteTag(tagPendingDeletionId)
                }
                setTagPendingDeletionId(null)
              }}
            >
              {t("pages.otherSettings.skillTags.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
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
                        <DialogTrigger render={<Button variant="outline" />}>
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
                            <FieldGroup>
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
                  <DialogTrigger render={<Button variant="outline" />}>
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
                      <FieldGroup>
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
                  <DialogTrigger render={<Button variant="outline" />}>
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
                      <FieldGroup className="gap-5">
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

      <Card>
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
                <form className="flex flex-col gap-6" onSubmit={handleAddOauth}>
                  <DialogHeader>
                    <DialogTitle>
                      {t("pages.otherSettings.oauth.dialogTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("pages.otherSettings.oauth.dialogDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <FieldGroup>
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
                        placeholder={t(
                          "pages.otherSettings.oauth.namePlaceholder"
                        )}
                        required
                      />
                    </Field>
                    {oauthProvider === "oidc" && (
                      <Field>
                        <FieldLabel htmlFor="oauth-issuer-url">
                          {t("pages.otherSettings.oauth.issuerUrl")}
                        </FieldLabel>
                        <Input
                          id="oauth-issuer-url"
                          name="issuerUrl"
                          type="url"
                          placeholder="https://id.example.com"
                          required
                        />
                      </Field>
                    )}
                    <Field>
                      <FieldLabel htmlFor="oauth-client-id">
                        {t("pages.otherSettings.oauth.clientId")}
                      </FieldLabel>
                      <Input id="oauth-client-id" name="clientId" required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="oauth-client-secret">
                        {t("pages.otherSettings.oauth.clientSecret")}
                      </FieldLabel>
                      <Input
                        id="oauth-client-secret"
                        name="clientSecret"
                        type="password"
                        required
                      />
                      <FieldDescription>
                        {t("pages.otherSettings.oauth.secretDescription")}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.otherSettings.oauth.cancel")}
                    </DialogClose>
                    <Button type="submit">
                      {t("pages.otherSettings.oauth.addConnection")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardAction>
        </CardHeader>
        <CardContent className="gap-6">
          <div className="flex flex-col gap-3">
            {oauthConnections.map((connection) => (
              <div
                key={connection.id}
                className="flex flex-wrap items-center gap-4 rounded-lg border p-4"
              >
                <Badge variant="outline">
                  {getProviderName(connection.provider)}
                </Badge>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{connection.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {t("pages.otherSettings.oauth.clientIdValue", {
                      clientId: connection.clientId,
                    })}
                  </p>
                  {connection.issuerUrl && (
                    <p className="truncate text-sm text-muted-foreground">
                      {connection.issuerUrl}
                    </p>
                  )}
                </div>
                <Switch
                  checked={connection.enabled}
                  onCheckedChange={(enabled) =>
                    void setOauthEnabled(connection.id, enabled)
                  }
                  aria-label={t("pages.otherSettings.oauth.toggle", {
                    name: connection.name,
                  })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer text-destructive"
                  aria-label={`删除 ${connection.name}`}
                  onClick={() => void removeOauthConnection(connection.id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="border-t">
          <p className="text-sm text-muted-foreground">
            {t("pages.otherSettings.oauth.connectionCount", {
              count: oauthConnections.length,
            })}
          </p>
        </CardFooter>
      </Card>

      <Card>
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
                  <DialogDescription>
                    {t("pages.otherSettings.email.dialogDescription")}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup className="grid gap-4 md:grid-cols-2">
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
                  <Field>
                    <FieldLabel htmlFor="smtp-encryption">
                      {t("pages.otherSettings.email.encryption")}
                    </FieldLabel>
                    <Select
                      items={encryptionItems}
                      value={emailSettings.encryption}
                      onValueChange={(value) => {
                        if (value !== null) {
                          updateEmailSetting("encryption", value as Encryption)
                        }
                      }}
                    >
                      <SelectTrigger id="smtp-encryption" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {encryptionItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
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
                  {t("pages.otherSettings.email.allowRegistration")}
                </ItemTitle>
                <ItemDescription>
                  {t("pages.otherSettings.email.allowRegistrationDescription")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  checked={savedEmailSettings.registrationEnabled}
                  onCheckedChange={setRegistrationPendingValue}
                  aria-label={t("pages.otherSettings.email.allowRegistration")}
                />
              </ItemActions>
            </Item>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  {t("pages.otherSettings.email.sendingConfiguration")}
                </ItemTitle>
                <ItemDescription>
                  <bdi>{savedEmailSettings.senderName}</bdi>
                  <span aria-hidden="true"> · </span>
                  <bdi>{savedEmailSettings.senderEmail}</bdi>
                  <span aria-hidden="true"> · </span>
                  <bdi>
                    {savedEmailSettings.smtpHost}:{savedEmailSettings.smtpPort}
                  </bdi>
                  <span aria-hidden="true"> · </span>
                  <bdi>
                    {
                      encryptionItems.find(
                        (item) => item.value === savedEmailSettings.encryption
                      )?.label
                    }
                  </bdi>
                  <span aria-hidden="true"> · </span>
                  <bdi>{savedEmailSettings.smtpUsername}</bdi>
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleEmailDialogOpenChange(true)}
                >
                  {t("pages.otherSettings.email.configure")}
                </Button>
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
                  {testSentTo && (
                    <FieldDescription aria-live="polite">
                      {t("pages.otherSettings.email.testSent", {
                        email: testSentTo,
                      })}
                    </FieldDescription>
                  )}
                </Field>
              </ItemContent>
              <ItemActions>
                <Button type="submit">
                  <HugeiconsIcon
                    icon={MailSend02Icon}
                    data-icon="inline-start"
                  />
                  {t("pages.otherSettings.email.sendTest")}
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <AlertDialog
        open={registrationPendingValue !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRegistrationPendingValue(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                registrationPendingValue
                  ? "pages.otherSettings.email.enableRegistrationDialogTitle"
                  : "pages.otherSettings.email.disableRegistrationDialogTitle"
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                registrationPendingValue
                  ? "pages.otherSettings.email.enableRegistrationDialogDescription"
                  : "pages.otherSettings.email.disableRegistrationDialogDescription"
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.otherSettings.email.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (registrationPendingValue === null) {
                  return
                }

                const registrationEnabled = registrationPendingValue
                if (
                  await saveAuthentication(
                    oauthConnections,
                    registrationEnabled
                  )
                ) {
                  setSavedEmailSettings((settings) => ({
                    ...settings,
                    registrationEnabled,
                  }))
                  setEmailSettings((settings) => ({
                    ...settings,
                    registrationEnabled,
                  }))
                  setRegistrationPendingValue(null)
                }
              }}
            >
              {t(
                registrationPendingValue
                  ? "pages.otherSettings.email.confirmEnableRegistration"
                  : "pages.otherSettings.email.confirmDisableRegistration"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
