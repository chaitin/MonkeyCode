import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  AiChat02Icon,
  AiImageIcon,
  ArrowRight01Icon,
  CheckmarkSquare02Icon,
  Copy01Icon,
  Delete02Icon,
  Edit02Icon,
  Logout05Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  Radar03Icon,
  SquareIcon,
  Tag01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import {
  GroupSelect,
  type GroupSelectOption,
  type GroupSelectUser,
} from "@/components/group-select"
import { ImageGenerationTest } from "@/components/image-generation-test"
import { ModelDiscovery } from "@/components/model-discovery"
import { SkillTagSelect } from "@/components/skill-tag-select"
import { ResourceAuthorizationBadge } from "@/components/resource-authorization-badge"
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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Item, ItemActions, ItemContent, ItemGroup } from "@/components/ui/item"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResourceList } from "@/components/resource-list"
import { useResourceList } from "@/hooks/use-resource-list"
import { Iconfont } from "@/components/iconfont"
import type { AuthorizationSelection } from "@/lib/authorization-groups"
import { api } from "@/lib/api"
import { deleteModelBatch } from "@/lib/model-batch-delete"
import { SystemProxySelect } from "@/components/proxy-settings"
import { loadProxies, type SystemProxy } from "@/lib/proxy-settings"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { getModelIconName } from "@/lib/model-utils"
import type { SkillTag } from "@/lib/skill-tags"
import { cn } from "@/lib/utils"
import {
  VIDEO_MODELS,
  videoDefaults,
  videoResolutions,
  type VideoCapabilities,
  type VideoConfig,
  type VideoMode,
  type VideoProvider,
} from "@/lib/video-models"

const PROTOCOLS = [
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
] as const

type ModelProtocol =
  (typeof PROTOCOLS)[number]["value"] | "image_generation" | "video_generation"
type ModelKind = "text" | "image" | "video"
type ImageProvider =
  "openai_images" | "openai_responses_image" | "volcengine" | "xai" | "agnes"
type ModelProvider = ImageProvider | VideoProvider | "passthrough"
type ModelType = "system" | "user"
type VideoPricing = {
  rates: Array<{ resolution: string; credits_per_second: string }>
}

const IMAGE_PROVIDERS: Array<{
  value: ImageProvider
  label: string
  model?: string
}> = [
  { value: "openai_images", label: "OpenAI GPT Image API" },
  { value: "openai_responses_image", label: "OpenAI Responses Image" },
  { value: "volcengine", label: "Seedream" },
  { value: "xai", label: "Grok Imagine" },
  {
    value: "agnes",
    label: "Agnes Image 2.5 Flash",
    model: "agnes-image-2.5-flash",
  },
]

type ImageConfig = {
  qualities: string[]
  aspect_ratios: string[]
  default_quality: string
  default_aspect_ratio: string
}

type ImagePricing = {
  rates: Array<{ quality: string; credits_per_image: string }>
}

type ImageCapabilities = {
  qualities: string[]
  aspect_ratios: string[]
  allowed_aspect_ratios?: Record<string, string[]>
  operations: Array<"generate" | "edit">
  max_images: number
  max_reference_images: number
  supports_reference_image: boolean
  supports_mask: boolean
}

const decimalCredits = /^(0|[1-9]\d*)(\.\d{1,6})?$/
const DEFAULT_IMAGE_RATES = { "1K": "20", "2K": "40", "4K": "80" }
const DEFAULT_VIDEO_RATES = {
  "480": "20",
  "480p": "20",
  "480P": "20",
  "720": "40",
  "720p": "40",
  "720P": "40",
  "768": "40",
  "768p": "40",
  "768P": "40",
  "1080": "80",
  "1080p": "80",
  "1080P": "80",
  "1K": "80",
  "1k": "80",
  "2K": "160",
  "2k": "160",
  "4K": "320",
  "4k": "320",
}

type ModelBase = {
  id: string
  modelId: string
  displayName: string
  owner: string
  contextSizeK: number
  maxOutputTokensK: number
  supportsVision: boolean
  supportsReasoning: boolean
  baseUrl: string
  proxyId: string
  protocol: ModelProtocol
  kind: ModelKind
  provider: ModelProvider
  imageConfig?: ImageConfig
  imagePricing?: ImagePricing
  videoConfig?: VideoConfig
  videoPricing?: VideoPricing
  apiKeyConfigured: boolean
  tagIds: string[]
  authorization: AuthorizationSelection
  enabled: boolean
}

type Model = ModelBase & { type: ModelType; multiplier: number }

type ApiModel = {
  id: string
  ownership_type: ModelType
  user: { id: string; name: string; email: string }
  model_id: string
  display_name: string
  protocol: ModelProtocol
  kind: ModelKind
  provider: ModelProvider
  image_config?: ImageConfig
  image_pricing?: ImagePricing
  video_config?: VideoConfig
  video_pricing?: VideoPricing
  base_url: string
  proxy_id: string
  api_key_configured: boolean
  advanced_config?: {
    context_window_tokens: number
    max_output_tokens: number
    supports_vision: boolean
    supports_reasoning?: boolean
  }
  credit_multiplier: number
  tags?: { id: string; name: string }[]
  authorization: {
    user_ids: string[] | null
    group_ids: string[] | null
  }
  enabled: boolean
}

type AuthorizationSubject = {
  id: string
  parent_id?: string
  name: string
  email?: string
  avatar_url?: string | null
  group_id?: string
}

function fromApiModel(model: ApiModel): Model {
  return {
    id: model.id,
    modelId: model.model_id,
    displayName: model.display_name,
    owner: model.user.name || model.user.email || model.user.id,
    contextSizeK: (model.advanced_config?.context_window_tokens ?? 0) / 1000,
    maxOutputTokensK: (model.advanced_config?.max_output_tokens ?? 0) / 1000,
    supportsVision: model.advanced_config?.supports_vision ?? false,
    supportsReasoning: model.advanced_config?.supports_reasoning ?? false,
    baseUrl: model.base_url,
    proxyId: model.proxy_id ?? "",
    protocol: model.protocol,
    kind: model.kind ?? "text",
    provider: model.provider ?? "passthrough",
    imageConfig: model.image_config,
    imagePricing: model.image_pricing,
    videoConfig: model.video_config,
    videoPricing: model.video_pricing,
    apiKeyConfigured: model.api_key_configured,
    multiplier: model.credit_multiplier,
    tagIds: (model.tags ?? []).map((tag) => tag.id),
    authorization: {
      groupIds: model.authorization.group_ids ?? [],
      memberIds: model.authorization.user_ids ?? [],
    },
    enabled: model.enabled,
    type: model.ownership_type,
  }
}

function ModelTagBadges({
  tagIds,
  tags,
  leading,
}: {
  tagIds: string[]
  tags: SkillTag[]
  leading?: ReactNode
}) {
  const { t } = useTranslation()
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id))

  if (!selectedTags.length && !leading) {
    return (
      <span className="text-muted-foreground">{t("pages.models.noTags")}</span>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {leading}
      {selectedTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="max-w-full truncate"
          title={tag.name}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  )
}

function ModelPricingSkeleton() {
  const { t } = useTranslation()
  return (
    <FieldGroup
      className="grid gap-3 sm:grid-cols-2"
      role="status"
      aria-busy="true"
      aria-label={t("resources.tableLoading")}
      data-model-pricing-loading=""
    >
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-5 w-40 max-w-full motion-reduce:animate-none" />
          <Skeleton className="h-9 w-full motion-reduce:animate-none" />
        </div>
      ))}
    </FieldGroup>
  )
}

export function ModelsPage() {
  const { t, i18n } = useTranslation()
  const { tags: availableTags } = useSkillTags()
  const { showToast } = useAppToast()
  const remote = useResourceList<ApiModel>("/models", "models")
  const models = remote.items.map(fromApiModel)
  const [proxies, setProxies] = useState<SystemProxy[]>([])
  const [proxyError, setProxyError] = useState("")
  useEffect(() => {
    loadProxies()
      .then(setProxies)
      .catch((reason: Error) => setProxyError(reason.message))
  }, [])
  const [groups, setGroups] = useState<GroupSelectOption[]>([])
  const [members, setMembers] = useState<GroupSelectUser[]>([])
  const authorizationGroupNames = new Map(
    groups.map((group) => [group.id, group.name])
  )
  const authorizationMemberNames = new Map(
    members.map((member) => [member.id, member.name || member.email || member.id])
  )
  const [loadRevision, setLoadRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const activeModelType = remote.type
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedModels = models.filter(
    (model) => model.type === "system" && selectedIds.includes(model.id)
  )
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchDeleteProgress, setBatchDeleteProgress] = useState({ completed: 0, total: 0 })
  const [batchEnabled, setBatchEnabled] = useState<boolean | null>(null)
  const [batchTagsOpen, setBatchTagsOpen] = useState(false)
  const [batchTagsConfirm, setBatchTagsConfirm] = useState(false)
  const [batchTagIds, setBatchTagIds] = useState<string[]>([])
  const [batchTagsMenuOpen, setBatchTagsMenuOpen] = useState(false)
  const [batchAuthorizationOpen, setBatchAuthorizationOpen] = useState(false)
  const [batchAuthorizationConfirm, setBatchAuthorizationConfirm] =
    useState(false)
  const [batchAuthorization, setBatchAuthorization] =
    useState<AuthorizationSelection>({ groupIds: [], memberIds: [] })
  const [batchPending, setBatchPending] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<Model | null>(null)
  const [formModel, setFormModel] = useState<Model | null>(null)
  const [modelPendingDeletion, setModelPendingDeletion] =
    useState<Model | null>(null)
  const [modelToTest, setModelToTest] = useState<Model | null>(null)
  const [textModelToTest, setTextModelToTest] = useState<Model | null>(null)
  const [testMessage, setTestMessage] = useState("ping")
  const [testResponse, setTestResponse] = useState("")
  const [testSending, setTestSending] = useState(false)
  const [protocol, setProtocol] = useState<ModelProtocol>("openai_responses")
  const [kind, setKind] = useState<ModelKind>("text")
  const [modelId, setModelId] = useState("")
  const modelNameAnchor = useRef<HTMLDivElement>(null)
  const [displayNameOverride, setDisplayNameOverride] = useState<string | null>(
    null
  )
  const changeModelId = (next: string) => {
    setModelId(next)
    setDisplayNameOverride((current) => (current?.trim() ? current : null))
  }
  const [provider, setProvider] = useState<ModelProvider>("openai_images")
  const [videoCapabilities, setVideoCapabilities] =
    useState<VideoCapabilities | null>(null)
  const [videoCapabilitiesFailed, setVideoCapabilitiesFailed] = useState(false)
  const [videoModes, setVideoModes] = useState<VideoMode[]>([])
  const [videoRates, setVideoRates] = useState<Record<string, string>>(() => ({
    ...DEFAULT_VIDEO_RATES,
  }))
  const [imageCapabilities, setImageCapabilities] =
    useState<ImageCapabilities | null>(null)
  const [imageCapabilitiesFailed, setImageCapabilitiesFailed] = useState(false)
  const [qualities, setQualities] = useState<string[]>([])
  const [aspectRatios, setAspectRatios] = useState<string[]>([])
  const [defaultQuality, setDefaultQuality] = useState("")
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("")
  const [imageRates, setImageRates] = useState<Record<string, string>>(() => ({
    ...DEFAULT_IMAGE_RATES,
  }))
  const [supportsVision, setSupportsVision] = useState(true)
  const [supportsReasoning, setSupportsReasoning] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [authorizationOverride, setAuthorization] =
    useState<AuthorizationSelection | null>(null)
  const authorization = useMemo(() => {
    if (authorizationOverride) return authorizationOverride
    const root = groups.find((group) => !group.parentId)
    return { groupIds: root ? [root.id] : [], memberIds: [] }
  }, [authorizationOverride, groups])
  const videoModelSupported = VIDEO_MODELS.some(
    (entry) => entry.provider === provider && entry.model === modelId
  )
  const capabilitiesLoading =
    (kind === "image" && !imageCapabilities && !imageCapabilitiesFailed) ||
    (kind === "video" &&
      videoModelSupported &&
      !videoCapabilities &&
      !videoCapabilitiesFailed)

  useEffect(() => {
    let active = true
    api<{ groups: AuthorizationSubject[]; users: AuthorizationSubject[] }>(
      "/api/admin/v1/models/authorization-subjects"
    )
      .then((subjects) => {
        if (!active) return
        setGroups(
          subjects.groups.map((group) => ({
            id: group.id,
            name: group.name,
            parentId: group.parent_id ?? null,
          }))
        )
        setMembers(
          subjects.users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email ?? "",
            avatarUrl: user.avatar_url,
            groupIds: user.group_id ? [user.group_id] : [],
          }))
        )
      })
      .catch((reason: Error) => {
        if (active) {
          showToast({
            status: "error",
            title: reason.message,
            action: {
              label: t("statistics.retry"),
              onClick: () => setLoadRevision((value) => value + 1),
            },
          })
        }
      })
    return () => {
      active = false
    }
  }, [loadRevision, showToast, t])

  useEffect(() => {
    if (!dialogOpen || kind !== "image") return
    let active = true
    const timer = window.setTimeout(() => {
      const providerPath = `/api/admin/v1/models/image-capabilities?provider=${encodeURIComponent(provider)}`
      api<ImageCapabilities>(providerPath)
        .then((capability) => {
          if (!active) return

          const savedConfig =
            formModel?.kind === "image" && formModel.provider === provider
              ? formModel.imageConfig
              : undefined
          const nextQualities = [...capability.qualities]
          const nextAspectRatios = [...capability.aspect_ratios]

          setImageCapabilities(capability)
          setImageCapabilitiesFailed(false)
          setQualities(nextQualities)
          setAspectRatios(nextAspectRatios)
          setDefaultQuality(
            savedConfig && nextQualities.includes(savedConfig.default_quality)
              ? savedConfig.default_quality
              : (nextQualities[0] ?? "")
          )
          setDefaultAspectRatio(
            savedConfig &&
              nextAspectRatios.includes(savedConfig.default_aspect_ratio)
              ? savedConfig.default_aspect_ratio
              : (nextAspectRatios[0] ?? "")
          )
        })
        .catch(() => {
          if (active) {
            setImageCapabilities(null)
            setImageCapabilitiesFailed(true)
          }
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [dialogOpen, formModel, kind, provider])

  useEffect(() => {
    if (!dialogOpen || kind !== "video") return
    const entry = VIDEO_MODELS.find(
      (candidate) =>
        candidate.provider === provider && candidate.model === modelId
    )
    if (!entry) return
    let active = true
    api<VideoCapabilities>(
      `/api/admin/v1/models/video-capabilities?provider=${entry.provider}&model_id=${encodeURIComponent(entry.model)}`
    )
      .then((cap) => {
        if (!active) return
        setVideoCapabilities(cap)
        setVideoCapabilitiesFailed(false)
        setVideoModes([...cap.modes])
      })
      .catch(() => {
        if (active) {
          setVideoCapabilities(null)
          setVideoCapabilitiesFailed(true)
        }
      })
    return () => {
      active = false
    }
  }, [dialogOpen, kind, provider, modelId, formModel])

  const sendTextTest = async () => {
    if (!textModelToTest || !testMessage.trim() || testSending) return
    setTestSending(true)
    setTestResponse("")
    try {
      const response = await fetch(
        `/api/admin/v1/models/${textModelToTest.id}/probe`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: testMessage.trim() }),
        }
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "模型测试失败")
      }
      setTestResponse(payload?.content || "模型返回了空响应")
    } catch (reason) {
      setTestResponse(
        reason instanceof Error ? reason.message : "模型测试失败"
      )
    } finally {
      setTestSending(false)
    }
  }

  const exitSelection = () => {
    setSelecting(false)
    setSelectionMenuOpen(false)
    setSelectedIds([])
    setBatchDeleteOpen(false)
    setBatchEnabled(null)
    setBatchTagsOpen(false)
    setBatchTagsConfirm(false)
    setBatchTagIds([])
    setBatchAuthorizationOpen(false)
    setBatchAuthorizationConfirm(false)
    setBatchAuthorization({ groupIds: [], memberIds: [] })
  }

  const openBatchEnabled = (enabled: boolean) => {
    if (selectedIds.length === 0) {
      showToast({ status: "error", title: "请先选择模型" })
      return
    }
    setSelectionMenuOpen(false)
    setBatchEnabled(enabled)
  }

  const openBatchDelete = () => {
    if (selectedModels.length === 0) return
    setSelectionMenuOpen(false)
    setBatchDeleteOpen(true)
  }

  const applyBatchDelete = async () => {
    if (batchPending || remote.loading || selectedModels.length === 0) return
    await remote.run(async () => {
      setBatchPending(true)
      setBatchDeleteProgress({ completed: 0, total: selectedModels.length })
      try {
        const result = await deleteModelBatch(selectedModels, api, setBatchDeleteProgress)
        if (result.succeeded.length === models.length && remote.page > 1) {
          remote.previousPage(activeModelType)
        }
        setBatchDeleteOpen(false)
        if (result.failed.length) {
          setSelectedIds(result.failed.map((failure) => failure.id))
          setSelecting(true)
        } else {
          exitSelection()
        }
        showToast({
          status: result.failed.length ? "error" : "success",
          title: t("resources.modelBatchDelete.result", {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          }),
          description: result.failed.length
            ? `${t("resources.modelBatchDelete.retryFailed")} ${result.failed
                .slice(0, 3)
                .map((failure) => `${failure.name}: ${failure.message}`)
                .join("；")}`
            : undefined,
        })
      } finally {
        setBatchPending(false)
      }
    })
  }

  const applyBatchEnabled = async () => {
    if (batchEnabled === null || batchPending) return
    const ids = [...selectedIds]
    setBatchPending(true)
    let succeeded = 0
    let failed = 0
    for (const id of ids) {
      try {
        await api<ApiModel>(`/api/admin/v1/models/${id}/enabled`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: batchEnabled }),
        })
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    await remote.reload()
    setBatchPending(false)
    setBatchEnabled(null)
    exitSelection()
    showToast({
      status: failed ? "error" : "success",
      title: `成功 ${succeeded} 个，失败 ${failed} 个`,
    })
  }

  const applyBatchUpdate = async (
    change: (model: Model) => Record<string, unknown>
  ) => {
    if (batchPending) return
    const selected = models.filter(
      (model) => model.type === "system" && selectedIds.includes(model.id)
    )
    setBatchPending(true)
    let succeeded = 0
    let failed = 0
    for (const model of selected) {
      const common = {
        model_id: model.modelId,
        display_name: model.displayName,
        base_url: model.baseUrl,
        proxy_id: model.proxyId,
        api_key: "",
        tag_ids: model.tagIds,
        authorization: {
          group_ids: model.authorization.groupIds,
          user_ids: model.authorization.memberIds,
        },
        ...change(model),
      }
      const payload =
        model.kind === "text"
          ? {
              ...common,
              kind: "text",
              protocol: model.protocol,
              advanced_config: {
                context_window_tokens: model.contextSizeK * 1000,
                max_output_tokens: model.maxOutputTokensK * 1000,
                supports_vision: model.supportsVision,
                supports_reasoning: model.supportsReasoning,
              },
              credit_multiplier: model.multiplier,
            }
          : model.kind === "video"
            ? {
                ...common,
                kind: "video",
                provider: model.provider,
                protocol: "video_generation",
                video_config: model.videoConfig,
                video_pricing: model.videoPricing,
              }
            : {
                ...common,
                kind: "image",
                provider: model.provider,
                protocol: "image_generation",
                image_config: model.imageConfig,
                image_pricing: model.imagePricing,
              }
      try {
        await api<ApiModel>(`/api/admin/v1/models/${model.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        })
        succeeded += 1
      } catch {
        failed += 1
      }
    }
    await remote.reload()
    setBatchPending(false)
    exitSelection()
    showToast({
      status: failed ? "error" : "success",
      title: `成功 ${succeeded} 个，失败 ${failed} 个`,
    })
  }

  const openBatchTags = () => {
    if (selectedIds.length === 0) {
      showToast({ status: "error", title: "请先选择模型" })
      return
    }
    setSelectionMenuOpen(false)
    setBatchTagIds([])
    setBatchTagsMenuOpen(false)
    setBatchTagsOpen(true)
  }

  const openBatchAuthorization = () => {
    if (selectedIds.length === 0) {
      showToast({ status: "error", title: "请先选择模型" })
      return
    }
    setSelectionMenuOpen(false)
    setBatchAuthorization({ groupIds: [], memberIds: [] })
    setBatchAuthorizationOpen(true)
  }

  const applyBatchTags = () =>
    applyBatchUpdate(() => ({ tag_ids: batchTagIds }))

  const applyBatchAuthorization = () => {
    if (
      batchAuthorization.groupIds.length +
        batchAuthorization.memberIds.length ===
      0
    ) {
      showToast({
        status: "error",
        title: t("pages.models.validation.authorizationRequired"),
      })
      return
    }
    return applyBatchUpdate(() => ({
      authorization: {
        group_ids: batchAuthorization.groupIds,
        user_ids: batchAuthorization.memberIds,
      },
    }))
  }

  const toggleSelected = (id: string) => {
    if (batchPending || remote.pending) return
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }

  const resetModelOptions = () => {
    setAdvancedOpen(false)
    setProtocol("openai_responses")
    setKind("text")
    setModelId("")
    setDisplayNameOverride(null)
    setProvider("openai_images")
    setImageCapabilities(null)
    setImageCapabilitiesFailed(false)
    setVideoCapabilities(null)
    setVideoCapabilitiesFailed(false)
    setVideoModes([])
    setVideoRates({ ...DEFAULT_VIDEO_RATES })
    setQualities([])
    setAspectRatios([])
    setDefaultQuality("")
    setDefaultAspectRatio("")
    setImageRates({ ...DEFAULT_IMAGE_RATES })
    setSupportsVision(true)
    setSupportsReasoning(true)
    setTagsOpen(false)
    setTagIds([])
    setAuthorization(null)
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      resetModelOptions()
      setEditingModel(null)
      setFormModel(null)
    }
  }

  const openModelForm = (model: Model | null, editing: boolean) => {
    if (model && model.type !== "system") return
    setEditingModel(editing ? model : null)
    setFormModel(model)
    if (!model) {
      resetModelOptions()
      setDialogOpen(true)
      return
    }

    setAdvancedOpen(false)
    setProtocol(model.protocol)
    setKind(model.kind)
    setModelId(model.modelId)
    setDisplayNameOverride(model.displayName?.trim() ? model.displayName : null)
    setProvider(
      model.provider === "passthrough" ? "openai_images" : model.provider
    )
    setQualities(model.imageConfig?.qualities ?? [])
    setAspectRatios(model.imageConfig?.aspect_ratios ?? [])
    setDefaultQuality(model.imageConfig?.default_quality ?? "")
    setDefaultAspectRatio(model.imageConfig?.default_aspect_ratio ?? "")
    setImageRates({
      ...DEFAULT_IMAGE_RATES,
      ...Object.fromEntries(
        (model.imagePricing?.rates ?? []).map((rate) => [
          rate.quality,
          rate.credits_per_image,
        ])
      ),
    })
    setVideoModes(model.videoConfig?.modes ?? [])
    setVideoRates({
      ...DEFAULT_VIDEO_RATES,
      ...Object.fromEntries(
        (model.videoPricing?.rates ?? []).map((rate) => [
          rate.resolution,
          rate.credits_per_second,
        ])
      ),
    })
    setSupportsVision(model.supportsVision)
    setSupportsReasoning(model.supportsReasoning)
    setTagIds(model.tagIds)
    setAuthorization(model.authorization)
    setDialogOpen(true)
  }

  const setModelEnabled = async (modelId: string, enabled: boolean) => {
    await remote.run(async () => {
      await api<ApiModel>(`/api/admin/v1/models/${modelId}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
    }, t("resources.operationCompleted"))
  }

  const handleDeleteModel = async () => {
    if (!modelPendingDeletion || modelPendingDeletion.type !== "system") {
      return
    }

    await remote.run(async () => {
      await api<void>(`/api/admin/v1/models/${modelPendingDeletion.id}`, {
        method: "DELETE",
      })
      if (models.length === 1) remote.previousPage(modelPendingDeletion.type)
      setModelPendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  const handleAddModel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const formData = new FormData(form)
    const modelId = String(formData.get("modelId") ?? "").trim()
    const displayName =
      String(formData.get("displayName") ?? "").trim() || modelId
    const contextSizeK = Number(formData.get("contextSizeK"))
    const maxOutputTokensK = Number(formData.get("maxOutputTokensK"))
    const baseUrl = String(formData.get("baseUrl") ?? "").trim()
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const multiplier = Number(formData.get("multiplier"))

    const reject = (title: string) => {
      showToast({ status: "error", title })
    }
    const missingField = !modelId
      ? t("pages.models.modelId")
      : !displayName
        ? t("pages.models.displayName")
        : !baseUrl
          ? t("pages.models.baseUrl")
          : !apiKey && !editingModel?.apiKeyConfigured
            ? t("pages.models.apiKey")
            : ""
    if (missingField)
      return reject(
        t("pages.models.validation.requiredField", { field: missingField })
      )
    if (authorization.groupIds.length + authorization.memberIds.length === 0)
      return reject(t("pages.models.validation.authorizationRequired"))
    if (editingModel?.type === "user")
      return reject(t("pages.models.validation.userModelReadOnly"))

    if (kind === "text") {
      const invalidField =
        !Number.isFinite(contextSizeK) || contextSizeK <= 0
          ? t("pages.models.contextSize")
          : !Number.isFinite(maxOutputTokensK) || maxOutputTokensK <= 0
            ? t("pages.models.maxOutputTokens")
            : !Number.isFinite(multiplier) || multiplier <= 0
              ? t("pages.models.billingMultiplier")
              : ""
      if (invalidField) {
        setAdvancedOpen(true)
        return reject(
          t("pages.models.validation.positiveNumber", { field: invalidField })
        )
      }
    } else if (kind === "video") {
      const entry = VIDEO_MODELS.find(
        (candidate) =>
          candidate.provider === provider && candidate.model === modelId
      )
      const resolutions = videoResolutions(videoCapabilities)
      if (
        !entry ||
        !videoCapabilities ||
        videoModes.length === 0 ||
        resolutions.length === 0
      )
        return reject(t("pages.models.validation.videoConfigInvalid"))
      if (
        resolutions.some(
          (value) => !decimalCredits.test(videoRates[value] ?? "")
        )
      )
        return reject(t("pages.models.validation.videoPriceInvalid"))
    } else {
      if (!imageCapabilities)
        return reject(t("pages.models.imageCapabilitiesUnavailable"))
      if (
        qualities.length === 0 ||
        aspectRatios.length === 0 ||
        !qualities.includes(defaultQuality) ||
        !aspectRatios.includes(defaultAspectRatio) ||
        qualities.some(
          (quality) =>
            !imageCapabilities.qualities.includes(quality) ||
            aspectRatios.some(
              (ratio) =>
                !imageCapabilities.aspect_ratios.includes(ratio) ||
                (imageCapabilities.allowed_aspect_ratios?.[quality] &&
                  !imageCapabilities.allowed_aspect_ratios[quality].includes(
                    ratio
                  ))
            )
        )
      )
        return reject(t("pages.models.validation.imageOptionsInvalid"))
      if (
        qualities.some(
          (quality) => !decimalCredits.test(imageRates[quality] ?? "")
        )
      )
        return reject(t("pages.models.validation.imagePriceInvalid"))
    }

    setSaving(true)
    try {
      const common = {
        model_id: modelId,
        display_name: displayName,
        base_url: baseUrl,
        proxy_id: String(formData.get("proxyId") ?? "").replace(
          /^__direct__$/,
          ""
        ),
        api_key: apiKey,
        tag_ids: tagIds,
        authorization: {
          group_ids: authorization.groupIds,
          user_ids: authorization.memberIds,
        },
      }
      const payload =
        kind === "text"
          ? {
              ...common,
              kind: "text",
              protocol,
              advanced_config: {
                context_window_tokens: contextSizeK * 1000,
                max_output_tokens: maxOutputTokensK * 1000,
                supports_vision: supportsVision,
                supports_reasoning: supportsReasoning,
              },
              credit_multiplier: multiplier,
            }
          : kind === "video" && videoCapabilities
            ? {
                ...common,
                kind: "video",
                provider,
                protocol: "video_generation",
                video_config: {
                  modes: videoModes,
                  defaults: videoDefaults(
                    videoCapabilities,
                    videoModes,
                    formModel?.modelId === modelId
                      ? formModel.videoConfig
                      : undefined
                  ),
                },
                video_pricing: {
                  rates: videoResolutions(videoCapabilities).map(
                    (resolution) => ({
                      resolution,
                      credits_per_second: videoRates[resolution],
                    })
                  ),
                },
              }
            : {
                ...common,
                kind: "image",
                provider,
                protocol: "image_generation",
                image_config: {
                  qualities,
                  aspect_ratios: aspectRatios,
                  default_quality: defaultQuality,
                  default_aspect_ratio: defaultAspectRatio,
                },
                image_pricing: {
                  rates: qualities.map((quality) => ({
                    quality,
                    credits_per_image: imageRates[quality],
                  })),
                },
              }
      await api<ApiModel>(
        editingModel
          ? `/api/admin/v1/models/${editingModel.id}`
          : "/api/admin/v1/models",
        {
          method: editingModel ? "PUT" : "POST",
          body: JSON.stringify(payload),
        }
      )
      remote.reload()
      form.reset()
      handleDialogOpenChange(false)
      showToast({
        status: "success",
        title: t("resources.operationCompleted"),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={remote}
        pending={saving || batchPending}
        typeLabel={t("pages.models.type")}
        systemLabel={t("pages.models.systemModel")}
        userLabel={t("pages.models.userModel")}
        searchPlaceholder="搜索模型"
        searchClassName="sm:max-w-44 sm:flex-none"
        actions={
          <>
            {activeModelType === "system" && (
              <div className="ms-auto flex shrink-0 items-center gap-2">
                {selecting && (
                  <DropdownMenu
                    open={selectionMenuOpen}
                    onOpenChange={setSelectionMenuOpen}
                  >
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={batchPending || remote.pending}
                        >
                          批量操作
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            data-icon="inline-end"
                            className="rotate-90"
                          />
                        </Button>
                      }
                    />
                    <DropdownMenuContent
                      align="end"
                      className="w-40 whitespace-nowrap"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            setSelectedIds(
                              models
                                .filter((model) => model.type === "system")
                                .map((model) => model.id)
                            )
                          }
                        >
                          <HugeiconsIcon
                            icon={CheckmarkSquare02Icon}
                            strokeWidth={2}
                          />
                          选择全部
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setSelectedIds([])}>
                          <HugeiconsIcon icon={SquareIcon} strokeWidth={2} />
                          取消选择
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        {(
                          [
                            [
                              "启用模型",
                              PlayIcon,
                              () => openBatchEnabled(true),
                            ],
                            [
                              "禁用模型",
                              PauseIcon,
                              () => openBatchEnabled(false),
                            ],
                            ["设置标签", Tag01Icon, openBatchTags],
                            [
                              "设置授权范围",
                              UserGroupIcon,
                              openBatchAuthorization,
                            ],
                          ] as const
                        ).map(([label, icon, action]) => (
                          <DropdownMenuItem
                            key={label}
                            disabled={selectedIds.length === 0}
                            onClick={action}
                          >
                            <HugeiconsIcon icon={icon} strokeWidth={2} />
                            {label}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={selectedModels.length === 0 || remote.loading}
                          onClick={openBatchDelete}
                        >
                          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                          {t("resources.modelBatchDelete.action")}
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem onClick={exitSelection}>
                          <HugeiconsIcon icon={Logout05Icon} strokeWidth={2} />
                          退出批量操作
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {!selecting && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={batchPending || remote.pending}
                    onClick={() => {
                      setSelecting(true)
                      setSelectionMenuOpen(true)
                    }}
                  >
                    批量操作
                  </Button>
                )}
                <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
                  <DialogTrigger
                    render={
                      <Button
                        className="shrink-0"
                        disabled={batchPending || remote.pending}
                        onClick={() => openModelForm(null, false)}
                      />
                    }
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      data-icon="inline-start"
                    />
                    {t("pages.models.add")}
                  </DialogTrigger>
                  <DialogContent
                    className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-xl"
                    closeLabel={t("common.close")}
                  >
                    <form
                      key={formModel?.id ?? "new-model"}
                      className="flex min-h-0 flex-col gap-6"
                      onSubmit={handleAddModel}
                      onInvalidCapture={(event) => {
                        const input = event.target as HTMLInputElement
                        if (
                          advancedOpen ||
                          !input.closest("#model-advanced-options")
                        )
                          return
                        event.preventDefault()
                        if (
                          event.currentTarget.querySelector(":invalid") !==
                          input
                        )
                          return
                        setAdvancedOpen(true)
                        requestAnimationFrame(() => {
                          input.focus()
                          input.reportValidity()
                        })
                      }}
                    >
                      <DialogHeader>
                        <DialogTitle>
                          {editingModel
                            ? t("pages.models.editDialogTitle")
                            : t("pages.models.dialogTitle")}
                        </DialogTitle>
                      </DialogHeader>
                      <ScrollArea className="-m-1 flex min-h-0 min-w-0 flex-1 flex-col [&_[data-slot=scroll-area-scrollbar]]:translate-x-2.5 rtl:[&_[data-slot=scroll-area-scrollbar]]:-translate-x-2.5 [&_[data-slot=scroll-area-viewport]]:flex-1 [&_[data-slot=scroll-area-viewport]]:space-y-6 [&_[data-slot=scroll-area-viewport]]:p-1">
                        <Tabs
                          value={kind}
                          onValueChange={(value) => {
                            const next = value as ModelKind
                            setKind(next)
                            setImageCapabilities(null)
                            setImageCapabilitiesFailed(false)
                            setVideoCapabilities(null)
                            setVideoCapabilitiesFailed(false)
                            if (next === "text") setProtocol("openai_responses")
                            if (next === "video") {
                              setProvider(VIDEO_MODELS[0].provider)
                              changeModelId(VIDEO_MODELS[0].model)
                            }
                          }}
                        >
                          <TabsList
                            className="w-full"
                            aria-label={t("pages.models.kind")}
                          >
                            <TabsTrigger type="button" value="text">
                              {t("pages.models.textKind")}
                            </TabsTrigger>
                            <TabsTrigger type="button" value="image">
                              {t("pages.models.imageKind")}
                            </TabsTrigger>
                            <TabsTrigger type="button" value="video">
                              {t("pages.models.videoKind")}
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <FieldGroup className="gap-4">
                          <FieldGroup className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="model-id">
                                {t("pages.models.modelId")}
                              </FieldLabel>
                              <div className="relative" ref={modelNameAnchor}>
                                <Input
                                  id="model-id"
                                  name="modelId"
                                  value={modelId}
                                  className={
                                    kind === "text"
                                      ? "pr-10 rtl:pl-10 rtl:pr-2.5"
                                      : undefined
                                  }
                                  onChange={(event) => {
                                    changeModelId(event.target.value)
                                    setVideoCapabilities(null)
                                    setVideoCapabilitiesFailed(false)
                                  }}
                                  placeholder={t(
                                    "pages.models.modelIdPlaceholder"
                                  )}
                                  required
                                />
                                {kind === "text" && (
                                  <ModelDiscovery
                                    key={`${protocol}:${editingModel?.id ?? ""}`}
                                    anchor={modelNameAnchor}
                                    protocol={protocol}
                                    modelResourceId={editingModel?.id}
                                    onSelect={changeModelId}
                                  />
                                )}
                              </div>
                            </Field>
                            {kind === "text" && (
                              <Field>
                                <FieldLabel htmlFor="model-protocol">
                                  {t("pages.models.protocol")}
                                </FieldLabel>
                                <Select
                                  items={PROTOCOLS}
                                  value={protocol}
                                  onValueChange={(value) =>
                                    setProtocol(value as ModelProtocol)
                                  }
                                >
                                  <SelectTrigger
                                    className="w-full"
                                    id="model-protocol"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {PROTOCOLS.map((item) => (
                                        <SelectItem
                                          key={item.value}
                                          value={item.value}
                                          label={item.label}
                                        >
                                          {item.label}
                                          {item.value ===
                                            "openai_chat_completions" && (
                                            <Badge variant="secondary">
                                              {t("pages.models.notRecommended")}
                                            </Badge>
                                          )}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                            )}

                            {kind === "image" && (
                              <Field>
                                <FieldLabel htmlFor="model-provider">
                                  {t("pages.models.imageProvider")}
                                </FieldLabel>
                                <Select
                                  items={IMAGE_PROVIDERS}
                                  value={provider}
                                  onValueChange={(value) => {
                                    setProvider(value as ImageProvider)
                                    setImageCapabilities(null)
                                    setImageCapabilitiesFailed(false)
                                    const next = IMAGE_PROVIDERS.find(
                                      (item) => item.value === value
                                    )
                                    if (next?.model && !editingModel)
                                      changeModelId(next.model)
                                  }}
                                >
                                  <SelectTrigger
                                    className="w-full"
                                    id="model-provider"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {IMAGE_PROVIDERS.map((item) => (
                                        <SelectItem
                                          key={item.value}
                                          value={item.value}
                                        >
                                          {item.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                            )}

                            {kind === "video" && (
                              <Field>
                                <FieldLabel htmlFor="video-model">
                                  {t("pages.models.videoProtocol")}
                                </FieldLabel>
                                <Select
                                  items={VIDEO_MODELS.map((item) => ({
                                    value: item.model,
                                    label: item.label,
                                  }))}
                                  value={
                                    VIDEO_MODELS.find(
                                      (item) =>
                                        item.provider === provider &&
                                        item.model === modelId
                                    )?.model ?? null
                                  }
                                  onValueChange={(value) => {
                                    const next = VIDEO_MODELS.find(
                                      (entry) => entry.model === value
                                    )
                                    if (next) {
                                      setProvider(next.provider)
                                      changeModelId(next.model)
                                      setVideoCapabilities(null)
                                      setVideoCapabilitiesFailed(false)
                                      setVideoModes([])
                                      setVideoRates({ ...DEFAULT_VIDEO_RATES })
                                    }
                                  }}
                                >
                                  <SelectTrigger
                                    className="w-full"
                                    id="video-model"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {VIDEO_MODELS.map((item) => (
                                        <SelectItem
                                          key={item.model}
                                          value={item.model}
                                        >
                                          {item.label}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                            )}
                          </FieldGroup>
                          <FieldGroup className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="model-base-url">
                                {t("pages.models.baseUrl")}
                              </FieldLabel>
                              <Input
                                id="model-base-url"
                                name="baseUrl"
                                defaultValue={formModel?.baseUrl}
                                type="url"
                                placeholder={t(
                                  "pages.models.baseUrlPlaceholder"
                                )}
                                required
                              />
                            </Field>

                            <Field>
                              <FieldLabel htmlFor="model-api-key">
                                {t("pages.models.apiKey")}
                              </FieldLabel>
                              <Input
                                autoComplete="new-password"
                                id="model-api-key"
                                name="apiKey"
                                defaultValue=""
                                placeholder={t(
                                  "pages.models.apiKeyPlaceholder"
                                )}
                                type="password"
                                required={!editingModel?.apiKeyConfigured}
                              />
                            </Field>
                          </FieldGroup>

                          {kind === "text" && (
                            <ItemGroup className="grid grid-cols-2 gap-4 has-[[data-size=sm]]:gap-4">
                              <Item
                                variant="outline"
                                size="sm"
                                className="min-w-0 flex-nowrap px-2"
                              >
                                <ItemContent className="min-w-0">
                                  <FieldLabel
                                    htmlFor="model-vision"
                                    className="min-w-0 break-words"
                                  >
                                    {t("pages.models.supportsVision")}
                                  </FieldLabel>
                                </ItemContent>
                                <ItemActions>
                                  <Switch
                                    checked={supportsVision}
                                    id="model-vision"
                                    onCheckedChange={setSupportsVision}
                                  />
                                </ItemActions>
                              </Item>
                              <Item
                                variant="outline"
                                size="sm"
                                className="min-w-0 flex-nowrap px-2"
                              >
                                <ItemContent className="min-w-0">
                                  <FieldLabel
                                    htmlFor="model-reasoning"
                                    className="min-w-0 break-words"
                                  >
                                    {t("pages.models.supportsReasoning")}
                                  </FieldLabel>
                                </ItemContent>
                                <ItemActions>
                                  <Switch
                                    checked={supportsReasoning}
                                    id="model-reasoning"
                                    onCheckedChange={setSupportsReasoning}
                                  />
                                </ItemActions>
                              </Item>
                            </ItemGroup>
                          )}

                          {kind === "image" && (
                            <FieldGroup className="gap-3">
                              {!imageCapabilities ? (
                                imageCapabilitiesFailed ? (
                                  <p
                                    role="alert"
                                    className="text-sm text-muted-foreground"
                                  >
                                    {t(
                                      "pages.models.imageCapabilitiesUnavailable"
                                    )}
                                  </p>
                                ) : (
                                  <ModelPricingSkeleton />
                                )
                              ) : (
                                <FieldGroup className="grid gap-3 sm:grid-cols-2">
                                  {qualities.map((quality) => (
                                    <Field key={quality}>
                                      <FieldLabel
                                        htmlFor={`image-rate-${quality}`}
                                      >
                                        {t(
                                          "pages.models.imageCreditsPerImage",
                                          {
                                            quality,
                                          }
                                        )}
                                      </FieldLabel>
                                      <Input
                                        id={`image-rate-${quality}`}
                                        inputMode="decimal"
                                        required
                                        value={imageRates[quality] ?? ""}
                                        onChange={(event) =>
                                          setImageRates((current) => ({
                                            ...current,
                                            [quality]: event.target.value,
                                          }))
                                        }
                                      />
                                    </Field>
                                  ))}
                                </FieldGroup>
                              )}
                            </FieldGroup>
                          )}

                          {kind === "video" && (
                            <FieldGroup className="gap-3">
                              {!videoCapabilities ? (
                                videoCapabilitiesFailed ||
                                !videoModelSupported ? (
                                  <p
                                    role="alert"
                                    className="text-sm text-muted-foreground"
                                  >
                                    当前型号的视频能力不可用，请检查供应商和型号
                                  </p>
                                ) : (
                                  <ModelPricingSkeleton />
                                )
                              ) : (
                                <>
                                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                                    {videoResolutions(videoCapabilities).map(
                                      (resolution) => (
                                        <Field key={resolution}>
                                          <FieldLabel
                                            htmlFor={`video-rate-${resolution}`}
                                          >
                                            {t(
                                              "pages.models.videoCreditsPerSecond",
                                              { resolution }
                                            )}
                                          </FieldLabel>
                                          <Input
                                            id={`video-rate-${resolution}`}
                                            inputMode="decimal"
                                            required
                                            value={videoRates[resolution] ?? ""}
                                            onChange={(event) =>
                                              setVideoRates((current) => ({
                                                ...current,
                                                [resolution]:
                                                  event.target.value,
                                              }))
                                            }
                                          />
                                        </Field>
                                      )
                                    )}
                                  </FieldGroup>
                                </>
                              )}
                            </FieldGroup>
                          )}
                          <FieldGroup className="grid gap-4 sm:grid-cols-2">
                            <Field>
                              <FieldLabel htmlFor="model-tags">
                                {t("pages.skills.tags")}
                              </FieldLabel>
                              <SkillTagSelect
                                id="model-tags"
                                open={tagsOpen}
                                options={availableTags}
                                placeholder={t("pages.skills.tagsPlaceholder")}
                                value={tagIds}
                                onOpenChange={setTagsOpen}
                                onValueChange={setTagIds}
                              />
                            </Field>

                            <Field>
                              <FieldLabel htmlFor="model-authorization">
                                {t("pages.models.authorizedScope")}
                              </FieldLabel>
                              <GroupSelect
                                id="model-authorization"
                                options={groups}
                                users={members}
                                value={{
                                  groupIds: authorization.groupIds,
                                  userIds: authorization.memberIds,
                                }}
                                onValueChange={(next) =>
                                  setAuthorization({
                                    groupIds: [...next.groupIds],
                                    memberIds: [...next.userIds],
                                  })
                                }
                                label={t("pages.models.authorizedScope")}
                                placeholder={t(
                                  "pages.models.authorizationPlaceholder"
                                )}
                                emptyText={t(
                                  "pages.models.noMatchingAuthorization"
                                )}
                                locale={i18n.resolvedLanguage ?? i18n.language}
                                multiple
                                selectionMode="both"
                                cascadeGroups
                                searchable
                                searchPlaceholder={t(
                                  "pages.models.searchAuthorization"
                                )}
                                noResultsText={t(
                                  "pages.models.noMatchingAuthorization"
                                )}
                              />
                            </Field>
                          </FieldGroup>
                          <Collapsible
                            open={advancedOpen}
                            onOpenChange={setAdvancedOpen}
                            className="rounded-lg border"
                          >
                            <CollapsibleTrigger
                              id="model-advanced-trigger"
                              type="button"
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
                              id="model-advanced-options"
                              keepMounted
                              className="border-t p-4"
                            >
                              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                                <Field>
                                  <FieldLabel htmlFor="model-display-name">
                                    {t("pages.models.displayName")}
                                  </FieldLabel>
                                  <Input
                                    id="model-display-name"
                                    name="displayName"
                                    value={displayNameOverride ?? modelId}
                                    onChange={(event) =>
                                      setDisplayNameOverride(event.target.value)
                                    }
                                    placeholder={t(
                                      "pages.models.displayNamePlaceholder"
                                    )}
                                  />
                                </Field>
                                <Field>
                                  <FieldLabel htmlFor="model-proxy">
                                    {t("pages.models.networkProxy")}
                                  </FieldLabel>
                                  <SystemProxySelect
                                    id="model-proxy"
                                    selected={formModel?.proxyId ?? ""}
                                    proxies={proxies}
                                  />
                                  {proxyError && (
                                    <p
                                      role="alert"
                                      className="text-destructive"
                                    >
                                      {proxyError}
                                    </p>
                                  )}
                                </Field>
                                {kind === "text" && (
                                  <>
                                    <Field>
                                      <FieldLabel htmlFor="model-context-size">
                                        {t("pages.models.contextSize")} (K)
                                      </FieldLabel>
                                      <Input
                                        id="model-context-size"
                                        min="1"
                                        name="contextSizeK"
                                        defaultValue={
                                          formModel?.contextSizeK ?? 256
                                        }
                                        placeholder="256"
                                        step="1"
                                        type="number"
                                        required
                                      />
                                    </Field>
                                    <Field>
                                      <FieldLabel htmlFor="model-max-output-tokens">
                                        {t("pages.models.maxOutputTokens")} (K)
                                      </FieldLabel>
                                      <Input
                                        id="model-max-output-tokens"
                                        min="1"
                                        name="maxOutputTokensK"
                                        defaultValue={
                                          formModel?.maxOutputTokensK ?? 16
                                        }
                                        placeholder="16384"
                                        step="1"
                                        type="number"
                                        required
                                      />
                                    </Field>
                                    <Field>
                                      <FieldLabel htmlFor="model-multiplier">
                                        {t("pages.models.billingMultiplier")}
                                      </FieldLabel>
                                      <Input
                                        id="model-multiplier"
                                        min="0.01"
                                        step="0.01"
                                        name="multiplier"
                                        defaultValue={
                                          formModel?.type === "system"
                                            ? formModel.multiplier
                                            : 1
                                        }
                                        placeholder="1.0"
                                        type="number"
                                        required
                                      />
                                    </Field>
                                  </>
                                )}
                              </FieldGroup>
                            </CollapsibleContent>
                          </Collapsible>
                        </FieldGroup>
                      </ScrollArea>
                      <DialogFooter>
                        <DialogClose
                          render={<Button type="button" variant="outline" />}
                        >
                          {t("pages.models.cancel")}
                        </DialogClose>
                        <Button
                          loading={saving}
                          disabled={saving || capabilitiesLoading}
                          type="submit"
                        >
                          {editingModel
                            ? t("pages.models.save")
                            : t("pages.models.create")}
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {(["text", "image", "video"] as const).map((kind) => {
            const kindModels = models.filter((model) => model.kind === kind)
            if (kindModels.length === 0) return null

            return (
              <Collapsible
                key={kind}
                className="overflow-hidden rounded-lg border bg-card"
                defaultOpen
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
                  <HugeiconsIcon
                    icon={kind === "text" ? AiChat02Icon : AiImageIcon}
                    strokeWidth={2}
                  />
                  <span className="font-medium">
                    {kind === "video"
                      ? t("pages.models.videoKind")
                      : t(
                          kind === "text"
                            ? "pages.models.textKind"
                            : "pages.models.imageKind"
                        )}
                  </span>
                  <Badge className="ms-auto" variant="secondary">
                    {kindModels.length}
                  </Badge>
                  <HugeiconsIcon
                    className="size-4 transition-transform group-aria-expanded:rotate-90 [[dir=rtl]_&]:rotate-180 [[dir=rtl]_&]:group-aria-expanded:-rotate-90"
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t p-4">
                  {kindModels.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {kindModels.map((model) => {
                        const generationProtocol =
                          model.kind === "image"
                            ? (IMAGE_PROVIDERS.find(
                                (entry) => entry.value === model.provider
                              )?.label ?? model.provider)
                            : model.kind === "video"
                              ? (VIDEO_MODELS.find(
                                  (entry) =>
                                    entry.provider === model.provider &&
                                    entry.model === model.modelId
                                )?.label ?? model.modelId)
                              : null
                        const selected = selectedIds.includes(model.id)
                        const selectable = selecting && model.type === "system"
                        return (
                          <Card
                            size="sm"
                            className={cn(
                              !model.enabled &&
                                "bg-muted ring-gray-300 dark:bg-muted dark:ring-gray-700",
                              selectable && "cursor-pointer",
                              selected &&
                                "relative ring-0 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border-2",
                              selected && "after:border-primary"
                            )}
                            key={model.id}
                            onClick={
                              selectable
                                ? () => toggleSelected(model.id)
                                : undefined
                            }
                            onKeyDown={
                              selectable
                                ? (event) => {
                                    if (event.target !== event.currentTarget) return
                                    if (
                                      event.key !== "Enter" &&
                                      event.key !== " "
                                    )
                                      return
                                    event.preventDefault()
                                    toggleSelected(model.id)
                                  }
                                : undefined
                            }
                            role={selectable ? "checkbox" : undefined}
                            aria-checked={selectable ? selected : undefined}
                            tabIndex={selectable ? 0 : undefined}
                          >
                            <CardHeader>
                              <div className="flex min-w-0 items-start gap-3">
                                <Avatar size="lg">
                                  <AvatarFallback>
                                    <Iconfont
                                      className="size-7"
                                      name={getModelIconName(model.modelId)}
                                    />
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <CardTitle className="flex min-w-0 items-center gap-2">
                                    <span
                                      className="truncate"
                                      title={model.displayName}
                                    >
                                      {model.displayName}
                                    </span>
                                    {!model.enabled && (
                                      <Badge variant="outline">
                                        {t("pages.models.disable")}
                                      </Badge>
                                    )}
                                  </CardTitle>
                                  <CardDescription
                                    className="truncate"
                                    title={model.baseUrl}
                                  >
                                    {model.baseUrl}
                                  </CardDescription>
                                </div>
                                {selectable ? (
                                  <Checkbox
                                    checked={selected}
                                    aria-label={`选择${model.displayName}`}
                                    className="pointer-events-none mt-1 bg-background"
                                    tabIndex={-1}
                                  />
                                ) : (
                                  model.type === "system" && (
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
                                            disabled={model.enabled}
                                            onClick={() =>
                                              setModelEnabled(model.id, true)
                                            }
                                          >
                                            <HugeiconsIcon
                                              icon={PlayIcon}
                                              strokeWidth={2}
                                            />
                                            {t("pages.models.enable")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            disabled={!model.enabled}
                                            onClick={() =>
                                              setModelEnabled(model.id, false)
                                            }
                                          >
                                            <HugeiconsIcon
                                              icon={PauseIcon}
                                              strokeWidth={2}
                                            />
                                            {t("pages.models.disable")}
                                          </DropdownMenuItem>
                                          {model.kind === "text" && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                setTextModelToTest(model)
                                              }
                                            >
                                              <HugeiconsIcon
                                                icon={Radar03Icon}
                                                strokeWidth={2}
                                              />
                                              测试
                                            </DropdownMenuItem>
                                          )}
                                          {model.kind === "image" &&
                                            model.enabled &&
                                            model.imageConfig && (
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  setModelToTest(model)
                                                }
                                              >
                                                <HugeiconsIcon
                                                  icon={PlayIcon}
                                                  strokeWidth={2}
                                                />
                                                {t(
                                                  "pages.models.testGeneration"
                                                )}
                                              </DropdownMenuItem>
                                            )}
                                          <DropdownMenuItem
                                            onClick={() =>
                                              openModelForm(model, true)
                                            }
                                          >
                                            <HugeiconsIcon
                                              icon={Edit02Icon}
                                              strokeWidth={2}
                                            />
                                            {t("pages.models.edit")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() =>
                                              openModelForm(model, false)
                                            }
                                          >
                                            <HugeiconsIcon
                                              icon={Copy01Icon}
                                              strokeWidth={2}
                                            />
                                            {t("pages.models.copy")}
                                          </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuGroup>
                                          <DropdownMenuItem
                                            variant="destructive"
                                            onClick={() =>
                                              setModelPendingDeletion(model)
                                            }
                                          >
                                            <HugeiconsIcon
                                              icon={Delete02Icon}
                                              strokeWidth={2}
                                            />
                                            {t("pages.models.delete")}
                                          </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-3">
                              <dl className="flex flex-col gap-3">
                                {model.kind === "text" &&
                                  model.type === "system" && (
                                    <div className="flex min-w-0 items-center gap-4">
                                      <dt
                                        className="w-2/5 truncate text-muted-foreground"
                                        title={t("pages.models.multiplier")}
                                      >
                                        {t("pages.models.multiplier")}
                                      </dt>
                                      <dd className="w-3/5 truncate text-end font-medium">
                                        {model.multiplier.toFixed(2)}×
                                      </dd>
                                    </div>
                                  )}
                                {model.type === "user" && (
                                  <div className="flex min-w-0 items-center gap-4">
                                    <dt
                                      className="w-2/5 truncate text-muted-foreground"
                                      title={t("pages.models.creator")}
                                    >
                                      {t("pages.models.creator")}
                                    </dt>
                                    <dd
                                      className="w-3/5 truncate text-end font-medium"
                                      title={model.owner}
                                    >
                                      {model.owner}
                                    </dd>
                                  </div>
                                )}
                              </dl>
                            </CardContent>
                            <CardFooter
                              className={cn(
                                "min-w-0 border-t",
                                !model.enabled && "border-gray-300 dark:border-gray-700"
                              )}
                            >
                              <ModelTagBadges
                                tagIds={model.tagIds}
                                tags={availableTags}
                                leading={
                                  <>
                                    <ResourceAuthorizationBadge
                                      authorization={model.authorization}
                                      groupNames={authorizationGroupNames}
                                      memberNames={authorizationMemberNames}
                                      fallback={
                                        model.type === "user" ? model.owner : undefined
                                      }
                                    />
                                    {model.kind === "text" &&
                                      model.supportsVision && (
                                        <Badge
                                          variant="outline"
                                          className="border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200"
                                        >
                                          {t("pages.models.supportsVision")}
                                        </Badge>
                                      )}
                                    {model.kind === "text" &&
                                      model.supportsReasoning && (
                                        <Badge
                                          variant="outline"
                                          className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
                                        >
                                          {t("pages.models.supportsReasoning")}
                                        </Badge>
                                      )}
                                    {generationProtocol && (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "max-w-full",
                                          model.kind === "image"
                                            ? "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200"
                                            : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-200"
                                        )}
                                        title={generationProtocol}
                                      >
                                        <span className="min-w-0 truncate">
                                          {generationProtocol}
                                        </span>
                                      </Badge>
                                    )}
                                  </>
                                }
                              />
                            </CardFooter>
                          </Card>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="py-6 text-center text-muted-foreground">
                      {t("pages.models.count", { count: 0 })}
                    </p>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </div>
      </ResourceList>

      <Dialog
        open={textModelToTest !== null}
        onOpenChange={(open) => {
          if (!open && !testSending) {
            setTextModelToTest(null)
            setTestMessage("ping")
            setTestResponse("")
          }
        }}
      >
        <DialogContent className="sm:max-w-xl" showCloseButton={!testSending}>
          <DialogHeader>
            <DialogTitle>测试模型</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="text-model-test-message">消息</FieldLabel>
            <Input
              id="text-model-test-message"
              value={testMessage}
              onChange={(event) => setTestMessage(event.target.value)}
              disabled={testSending}
            />
          </Field>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-sm font-medium">响应内容</p>
            <div
              className="max-h-[min(20rem,40vh)] min-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 text-sm"
              aria-live="polite"
            >
              {testResponse || (
                <span className="text-muted-foreground">等待响应</span>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={testSending}
              onClick={() => {
                setTextModelToTest(null)
                setTestMessage("ping")
                setTestResponse("")
              }}
            >
              关闭
            </Button>
            <Button
              type="button"
              loading={testSending}
              disabled={!testMessage.trim() || testSending}
              onClick={() => void sendTextTest()}
            >
              发送
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {modelToTest?.imageConfig && (
        <ImageGenerationTest
          key={modelToTest.id}
          open={Boolean(modelToTest)}
          onOpenChange={(open) => {
            if (!open) setModelToTest(null)
          }}
          model={`${modelToTest.modelId}@${modelToTest.id}`}
          upstreamModel={modelToTest.modelId}
          provider={modelToTest.provider}
          options={modelToTest.imageConfig}
        />
      )}
      <AlertDialog
        open={modelPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setModelPendingDeletion(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.models.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.models.deleteDialogDescription", {
              model: modelPendingDeletion?.displayName ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remote.pending}>
              {t("pages.models.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={remote.pending}
              onClick={handleDeleteModel}
            >
              {t("pages.models.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={batchDeleteOpen}
        onOpenChange={(open) => {
          if (!batchPending && !remote.pending) setBatchDeleteOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("resources.modelBatchDelete.title")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("resources.modelBatchDelete.description", { count: selectedModels.length })}
          </AlertDialogDescription>
          {batchPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("resources.modelBatchDelete.progress", batchDeleteProgress)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>
              {t("resources.skillBatch.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              loading={batchPending}
              disabled={selectedModels.length === 0}
              onClick={applyBatchDelete}
            >
              {t("resources.skillBatch.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={batchEnabled !== null}
        onOpenChange={(open) => {
          if (!open && !batchPending) setBatchEnabled(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchEnabled ? "启用所选模型？" : "禁用所选模型？"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {batchEnabled
              ? `确定启用已选择的 ${selectedIds.length} 个模型吗？`
              : `确定禁用已选择的 ${selectedIds.length} 个模型吗？`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              loading={batchPending}
              onClick={applyBatchEnabled}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={batchTagsOpen}
        onOpenChange={(open) => {
          if (!open && !batchPending) setBatchTagsOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!batchPending}>
          <DialogHeader>
            <DialogTitle>设置标签</DialogTitle>
          </DialogHeader>
          <SkillTagSelect
            id="batch-model-tags"
            open={batchTagsMenuOpen}
            options={availableTags}
            placeholder={t("pages.skills.tagsPlaceholder")}
            value={batchTagIds}
            onOpenChange={setBatchTagsMenuOpen}
            onValueChange={setBatchTagIds}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={batchPending}
              onClick={() => setBatchTagsOpen(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={() => setBatchTagsConfirm(true)}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={batchTagsConfirm}
        onOpenChange={(open) => {
          if (!open && !batchPending) setBatchTagsConfirm(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>设置所选模型的标签？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {`确定将已选择的 ${selectedIds.length} 个模型设置为所选标签吗？`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>取消</AlertDialogCancel>
            <AlertDialogAction loading={batchPending} onClick={applyBatchTags}>
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={batchAuthorizationOpen}
        onOpenChange={(open) => {
          if (!open && !batchPending) setBatchAuthorizationOpen(false)
        }}
      >
        <DialogContent className="sm:max-w-sm" showCloseButton={!batchPending}>
          <DialogHeader>
            <DialogTitle>设置授权范围</DialogTitle>
          </DialogHeader>
          <GroupSelect
            id="batch-model-authorization"
            options={groups}
            users={members}
            value={{
              groupIds: batchAuthorization.groupIds,
              userIds: batchAuthorization.memberIds,
            }}
            onValueChange={(next) =>
              setBatchAuthorization({
                groupIds: [...next.groupIds],
                memberIds: [...next.userIds],
              })
            }
            label={t("pages.models.authorizedScope")}
            placeholder={t("pages.models.authorizationPlaceholder")}
            emptyText={t("pages.models.noMatchingAuthorization")}
            locale={i18n.resolvedLanguage ?? i18n.language}
            multiple
            selectionMode="both"
            cascadeGroups
            searchable
            searchPlaceholder={t("pages.models.searchAuthorization")}
            noResultsText={t("pages.models.noMatchingAuthorization")}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={batchPending}
              onClick={() => setBatchAuthorizationOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => setBatchAuthorizationConfirm(true)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={batchAuthorizationConfirm}
        onOpenChange={(open) => {
          if (!open && !batchPending) setBatchAuthorizationConfirm(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>设置所选模型的授权范围？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {`确定将已选择的 ${selectedIds.length} 个模型设置为所选授权范围吗？`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              loading={batchPending}
              onClick={applyBatchAuthorization}
            >
              确定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
