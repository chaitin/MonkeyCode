import { useEffect, useState, type FormEvent } from "react"
import {
  Delete02Icon,
  Edit02Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { GroupSelect } from "@/components/group-select"
import { ImageGenerationTest } from "@/components/image-generation-test"
import { SkillTagSelect } from "@/components/skill-tag-select"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Iconfont } from "@/components/iconfont"
import {
  getAuthorizationNames,
  type AuthorizationGroupNode,
  type AuthorizationMember,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import { api } from "@/lib/api"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { ROOT_GROUP_ID } from "@/lib/member-groups"
import { getModelIconName } from "@/lib/model-utils"
import { cn } from "@/lib/utils"

const PROTOCOLS = [
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
] as const

type ModelProtocol = (typeof PROTOCOLS)[number]["value"] | "image_generation"
type ModelKind = "text" | "image"
type ImageProvider =
  "openai_images" | "openai_responses_image" | "volcengine" | "xai"
type ModelType = "system" | "user"

const IMAGE_PROVIDERS = [
  { value: "openai_images", label: "OpenAI GPT Image API" },
  { value: "openai_responses_image", label: "OpenAI Responses Image" },
  { value: "volcengine", label: "Seedream" },
  { value: "xai", label: "Grok Imagine" },
] as const

type ImageConfig = {
  qualities: string[]
  aspect_ratios: string[]
  default_quality: string
  default_aspect_ratio: string
}

type ImageMultiplier = { name: string; multiplier: string }
type ImagePricing = {
  base_credits_per_image: string
  quality_multipliers?: ImageMultiplier[]
  aspect_ratio_multipliers?: ImageMultiplier[]
  operation_multipliers?: ImageMultiplier[]
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
const positiveMultiplier = /^(?:[1-9]\d*(?:\.\d{1,6})?|0\.(?=\d*[1-9])\d{1,6})$/

type ModelBase = {
  id: string
  modelId: string
  displayName: string
  contextSizeK: number
  maxOutputTokens: number
  supportsVision: boolean
  baseUrl: string
  protocol: ModelProtocol
  kind: ModelKind
  provider: ImageProvider | "passthrough"
  imageConfig?: ImageConfig
  imagePricing?: ImagePricing
  apiKeyConfigured: boolean
  tagIds: string[]
  authorization: AuthorizationSelection
  enabled: boolean
}

type Model = ModelBase & { type: ModelType; multiplier: number }

type ApiModel = {
  id: string
  ownership_type: ModelType
  model_id: string
  display_name: string
  protocol: ModelProtocol
  kind: ModelKind
  provider: ImageProvider | "passthrough"
  image_config?: ImageConfig
  image_pricing?: ImagePricing
  base_url: string
  api_key_configured: boolean
  advanced_config?: {
    context_window_tokens: number
    max_output_tokens: number
    supports_vision: boolean
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
  group_id?: string
}

function fromApiModel(model: ApiModel): Model {
  return {
    id: model.id,
    modelId: model.model_id,
    displayName: model.display_name,
    contextSizeK: (model.advanced_config?.context_window_tokens ?? 0) / 1000,
    maxOutputTokens: model.advanced_config?.max_output_tokens ?? 0,
    supportsVision: model.advanced_config?.supports_vision ?? false,
    baseUrl: model.base_url,
    protocol: model.protocol,
    kind: model.kind ?? "text",
    provider: model.provider ?? "passthrough",
    imageConfig: model.image_config,
    imagePricing: model.image_pricing,
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

function buildGroupTree(groups: AuthorizationSubject[]) {
  const nodes = new Map<string, AuthorizationGroupNode>()
  groups.forEach((group) =>
    nodes.set(group.id, { value: group.id, labelKey: group.name, children: [] })
  )
  const roots: AuthorizationGroupNode[] = []
  groups.forEach((group) => {
    const node = nodes.get(group.id)!
    const parent = group.parent_id ? nodes.get(group.parent_id) : undefined
    if (parent) parent.children!.push(node)
    else roots.push(node)
  })
  return roots
}

function flattenGroupTree(
  groups: AuthorizationGroupNode[],
  parentId: string | null = null
): (AuthorizationGroupNode & { parentId: string | null })[] {
  return groups.flatMap((group) => [
    { ...group, parentId },
    ...flattenGroupTree(group.children ?? [], group.value),
  ])
}

export function ModelsPage() {
  const { i18n, t } = useTranslation()
  const { tags: availableTags } = useSkillTags()
  const { showToast } = useAppToast()
  const [models, setModels] = useState<Model[]>([])
  const [groups, setGroups] = useState<AuthorizationGroupNode[]>([])
  const [members, setMembers] = useState<AuthorizationMember[]>([])
  const [loadRevision, setLoadRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  const [activeModelType, setActiveModelType] = useState<ModelType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelPendingDeletion, setModelPendingDeletion] =
    useState<Model | null>(null)
  const [modelToTest, setModelToTest] = useState<Model | null>(null)
  const [protocol, setProtocol] = useState<ModelProtocol>(
    "openai_chat_completions"
  )
  const [kind, setKind] = useState<ModelKind>("text")
  const [provider, setProvider] = useState<ImageProvider>("openai_images")
  const [imageModelId, setImageModelId] = useState("")
  const [imageCapabilities, setImageCapabilities] =
    useState<ImageCapabilities | null>(null)
  const [qualities, setQualities] = useState<string[]>([])
  const [aspectRatios, setAspectRatios] = useState<string[]>([])
  const [defaultQuality, setDefaultQuality] = useState("")
  const [defaultAspectRatio, setDefaultAspectRatio] = useState("")
  const [baseCredits, setBaseCredits] = useState("10")
  const [qualityMultipliers, setQualityMultipliers] = useState<
    Record<string, string>
  >({})
  const [aspectMultipliers, setAspectMultipliers] = useState<
    Record<string, string>
  >({})
  const [editMultiplier, setEditMultiplier] = useState("1")
  const [supportsVision, setSupportsVision] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const editingModel = models.find((model) => model.id === editingModelId)

  useEffect(() => {
    let active = true
    Promise.all([
      api<{ models: ApiModel[] }>("/api/admin/v1/models"),
      api<{ groups: AuthorizationSubject[]; users: AuthorizationSubject[] }>(
        "/api/admin/v1/models/authorization-subjects"
      ),
    ])
      .then(([modelResult, subjects]) => {
        if (!active) return
        setModels(modelResult.models.map(fromApiModel))
        setGroups(buildGroupTree(subjects.groups))
        setMembers(
          subjects.users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email ?? "",
            groupId: user.group_id ?? "",
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
    if (!dialogOpen || kind !== "image" || !imageModelId.trim()) return
    let active = true
    const timer = window.setTimeout(() => {
      api<ImageCapabilities>(
        `/api/admin/v1/models/image-capabilities?provider=${encodeURIComponent(provider)}&model_id=${encodeURIComponent(imageModelId.trim())}`
      )
        .then((capability) => {
          if (!active) return
          setImageCapabilities(capability)
          setQualities((current) =>
            current.filter((value) => capability.qualities.includes(value))
          )
          setAspectRatios((current) =>
            current.filter((value) => capability.aspect_ratios.includes(value))
          )
        })
        .catch(() => {
          if (active) setImageCapabilities(null)
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [dialogOpen, kind, provider, imageModelId])

  const resetModelOptions = () => {
    setProtocol("openai_chat_completions")
    setKind("text")
    setProvider("openai_images")
    setImageModelId("")
    setImageCapabilities(null)
    setQualities([])
    setAspectRatios([])
    setDefaultQuality("")
    setDefaultAspectRatio("")
    setBaseCredits("10")
    setQualityMultipliers({})
    setAspectMultipliers({})
    setEditMultiplier("1")
    setSupportsVision(false)
    setTagsOpen(false)
    setTagIds([])
    setAuthorization({ groupIds: [], memberIds: [] })
  }

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open)
    if (!open) {
      resetModelOptions()
      setEditingModelId(null)
    }
  }

  const handleEditModel = (model: Model) => {
    if (model.type !== "system") {
      return
    }

    setEditingModelId(model.id)
    setProtocol(model.protocol)
    setKind(model.kind)
    setProvider(
      model.provider === "passthrough" ? "openai_images" : model.provider
    )
    setImageModelId(model.modelId)
    setQualities(model.imageConfig?.qualities ?? [])
    setAspectRatios(model.imageConfig?.aspect_ratios ?? [])
    setDefaultQuality(model.imageConfig?.default_quality ?? "")
    setDefaultAspectRatio(model.imageConfig?.default_aspect_ratio ?? "")
    setBaseCredits(model.imagePricing?.base_credits_per_image ?? "10")
    setQualityMultipliers(
      Object.fromEntries(
        (model.imagePricing?.quality_multipliers ?? []).map((item) => [
          item.name,
          item.multiplier,
        ])
      )
    )
    setAspectMultipliers(
      Object.fromEntries(
        (model.imagePricing?.aspect_ratio_multipliers ?? []).map((item) => [
          item.name,
          item.multiplier,
        ])
      )
    )
    setEditMultiplier(
      model.imagePricing?.operation_multipliers?.find(
        (item) => item.name === "edit"
      )?.multiplier ?? "1"
    )
    setSupportsVision(model.supportsVision)
    setTagIds(model.tagIds)
    setAuthorization(model.authorization)
    setDialogOpen(true)
  }

  const setModelEnabled = async (modelId: string, enabled: boolean) => {
    try {
      const updated = await api<ApiModel>(
        `/api/admin/v1/models/${modelId}/enabled`,
        { method: "PATCH", body: JSON.stringify({ enabled }) }
      )
      setModels((currentModels) =>
        currentModels.map((model) =>
          model.id === modelId ? fromApiModel(updated) : model
        )
      )
      showToast({
        status: "success",
        title: t("resources.operationCompleted"),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    }
  }

  const handleDeleteModel = async () => {
    if (!modelPendingDeletion || modelPendingDeletion.type !== "system") {
      return
    }

    try {
      await api<void>(`/api/admin/v1/models/${modelPendingDeletion.id}`, {
        method: "DELETE",
      })
      setModels((currentModels) =>
        currentModels.filter((model) => model.id !== modelPendingDeletion.id)
      )
      setModelPendingDeletion(null)
      showToast({
        status: "success",
        title: t("resources.operationCompleted"),
      })
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    }
  }

  const handleAddModel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const formData = new FormData(form)
    const modelId = String(formData.get("modelId") ?? "").trim()
    const displayName = String(formData.get("displayName") ?? "").trim()
    const contextSizeK = Number(formData.get("contextSizeK"))
    const maxOutputTokens = Number(formData.get("maxOutputTokens"))
    const baseUrl = String(formData.get("baseUrl") ?? "").trim()
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const multiplier = Number(formData.get("multiplier"))

    if (
      !modelId ||
      !displayName ||
      !baseUrl ||
      (!apiKey && !editingModel?.apiKeyConfigured) ||
      authorization.groupIds.length + authorization.memberIds.length === 0 ||
      editingModel?.type === "user"
    )
      return

    if (kind === "text") {
      if (
        !Number.isFinite(contextSizeK) ||
        contextSizeK <= 0 ||
        !Number.isFinite(maxOutputTokens) ||
        maxOutputTokens <= 0 ||
        !Number.isFinite(multiplier) ||
        multiplier <= 0
      )
        return
    } else {
      if (
        !imageCapabilities ||
        qualities.length === 0 ||
        aspectRatios.length === 0 ||
        !qualities.includes(defaultQuality) ||
        !aspectRatios.includes(defaultAspectRatio) ||
        !decimalCredits.test(baseCredits) ||
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
        ) ||
        [
          ...qualities.map((value) => qualityMultipliers[value] ?? "1"),
          ...aspectRatios.map((value) => aspectMultipliers[value] ?? "1"),
          editMultiplier,
        ].some((value) => !positiveMultiplier.test(value))
      )
        return
    }

    setSaving(true)
    try {
      const common = {
        model_id: modelId,
        display_name: displayName,
        base_url: baseUrl,
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
                max_output_tokens: maxOutputTokens,
                supports_vision: supportsVision,
              },
              credit_multiplier: multiplier,
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
                base_credits_per_image: baseCredits,
                quality_multipliers: qualities
                  .filter(
                    (name) =>
                      qualityMultipliers[name] &&
                      qualityMultipliers[name] !== "1"
                  )
                  .map((name) => ({
                    name,
                    multiplier: qualityMultipliers[name],
                  })),
                aspect_ratio_multipliers: aspectRatios
                  .filter(
                    (name) =>
                      aspectMultipliers[name] && aspectMultipliers[name] !== "1"
                  )
                  .map((name) => ({
                    name,
                    multiplier: aspectMultipliers[name],
                  })),
                operation_multipliers:
                  editMultiplier === "1"
                    ? []
                    : [{ name: "edit", multiplier: editMultiplier }],
              },
            }
      const saved = await api<ApiModel>(
        editingModel
          ? `/api/admin/v1/models/${editingModel.id}`
          : "/api/admin/v1/models",
        {
          method: editingModel ? "PUT" : "POST",
          body: JSON.stringify(payload),
        }
      )
      setModels((currentModels) =>
        editingModel
          ? currentModels.map((model) =>
              model.id === saved.id ? fromApiModel(saved) : model
            )
          : [fromApiModel(saved), ...currentModels]
      )
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
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <Tabs
        className="gap-4"
        value={activeModelType}
        onValueChange={(value) => {
          setActiveModelType(value as ModelType)
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label={t("pages.models.type")}>
            <TabsTrigger value="system">
              {t("pages.models.systemModel")}
            </TabsTrigger>
            <TabsTrigger value="user">
              {t("pages.models.userModel")}
            </TabsTrigger>
          </TabsList>
          {activeModelType === "system" && (
            <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    onClick={() => {
                      setEditingModelId(null)
                      resetModelOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.models.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
              >
                <form
                  key={editingModel?.id ?? "new-model"}
                  className="flex flex-col gap-6"
                  onSubmit={handleAddModel}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {editingModel
                        ? t("pages.models.editDialogTitle")
                        : t("pages.models.dialogTitle")}
                    </DialogTitle>
                  </DialogHeader>
                  <FieldGroup className="gap-5">
                    <FieldGroup className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="model-id">
                          {t("pages.models.modelId")}
                        </FieldLabel>
                        <Input
                          id="model-id"
                          name="modelId"
                          defaultValue={editingModel?.modelId}
                          onChange={(event) => {
                            setImageModelId(event.target.value)
                            setImageCapabilities(null)
                          }}
                          placeholder={t("pages.models.modelIdPlaceholder")}
                          required
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="model-display-name">
                          {t("pages.models.displayName")}
                        </FieldLabel>
                        <Input
                          id="model-display-name"
                          name="displayName"
                          defaultValue={editingModel?.displayName}
                          placeholder={t("pages.models.displayNamePlaceholder")}
                          required
                        />
                      </Field>
                    </FieldGroup>

                    <FieldGroup className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="model-kind">
                          {t("pages.models.kind")}
                        </FieldLabel>
                        <Select
                          items={[
                            {
                              value: "text",
                              label: t("pages.models.textKind"),
                            },
                            {
                              value: "image",
                              label: t("pages.models.imageKind"),
                            },
                          ]}
                          value={kind}
                          onValueChange={(value) => {
                            const next = value as ModelKind
                            setKind(next)
                            setImageCapabilities(null)
                            if (next === "text")
                              setProtocol("openai_chat_completions")
                          }}
                        >
                          <SelectTrigger className="w-full" id="model-kind">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="text">
                                {t("pages.models.textKind")}
                              </SelectItem>
                              <SelectItem value="image">
                                {t("pages.models.imageKind")}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
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
                    </FieldGroup>

                    <Field>
                      <FieldLabel htmlFor="model-base-url">
                        {t("pages.models.baseUrl")}
                      </FieldLabel>
                      <Input
                        id="model-base-url"
                        name="baseUrl"
                        defaultValue={editingModel?.baseUrl}
                        type="url"
                        placeholder={t("pages.models.baseUrlPlaceholder")}
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
                        placeholder={t("pages.models.apiKeyPlaceholder")}
                        type="password"
                        required={!editingModel?.apiKeyConfigured}
                      />
                    </Field>

                    {kind === "text" && (
                      <FieldGroup className="grid gap-4 sm:grid-cols-4">
                        <Field>
                          <FieldLabel htmlFor="model-context-size">
                            {t("pages.models.contextSize")} (K)
                          </FieldLabel>
                          <Input
                            id="model-context-size"
                            min="1"
                            name="contextSizeK"
                            defaultValue={editingModel?.contextSizeK}
                            placeholder="128"
                            step="1"
                            type="number"
                            required
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="model-max-output-tokens">
                            {t("pages.modelStatistics.metrics.outputTokens")}
                          </FieldLabel>
                          <Input
                            id="model-max-output-tokens"
                            min="1"
                            name="maxOutputTokens"
                            defaultValue={editingModel?.maxOutputTokens}
                            placeholder="8192"
                            step="1"
                            type="number"
                            required
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="model-multiplier">
                            {t("pages.models.multiplier")}
                          </FieldLabel>
                          <Input
                            id="model-multiplier"
                            min="0.01"
                            name="multiplier"
                            defaultValue={
                              editingModel?.type === "system"
                                ? editingModel.multiplier
                                : undefined
                            }
                            placeholder="1.0"
                            step="0.1"
                            type="number"
                            required
                          />
                        </Field>
                        <Field className="sm:col-span-2">
                          <FieldLabel htmlFor="model-protocol">
                            {t("pages.models.protocol")}
                          </FieldLabel>
                          <Select
                            items={PROTOCOLS}
                            value={protocol}
                            onValueChange={(value) => {
                              setProtocol(value as ModelProtocol)
                            }}
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
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                      </FieldGroup>
                    )}

                    {kind === "text" && (
                      <Field orientation="horizontal">
                        <FieldLabel htmlFor="model-vision">
                          {t("pages.models.supportsVision")}
                        </FieldLabel>
                        <Switch
                          checked={supportsVision}
                          id="model-vision"
                          onCheckedChange={setSupportsVision}
                        />
                      </Field>
                    )}

                    {kind === "image" && (
                      <FieldGroup className="gap-4">
                        {!imageCapabilities && (
                          <p className="text-sm text-muted-foreground">
                            {t("pages.models.imageCapabilitiesUnavailable")}
                          </p>
                        )}
                        {imageCapabilities && (
                          <>
                            <Field>
                              <FieldLabel>
                                {t("pages.models.imageQuality")}
                              </FieldLabel>
                              <div className="flex flex-wrap gap-3">
                                {imageCapabilities.qualities.map((value) => (
                                  <label
                                    key={value}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={qualities.includes(value)}
                                      onChange={(event) => {
                                        setQualities((current) =>
                                          event.target.checked
                                            ? [...current, value]
                                            : current.filter(
                                                (item) => item !== value
                                              )
                                        )
                                        if (
                                          event.target.checked &&
                                          !defaultQuality
                                        )
                                          setDefaultQuality(value)
                                        if (
                                          !event.target.checked &&
                                          defaultQuality === value
                                        )
                                          setDefaultQuality("")
                                      }}
                                    />
                                    {value}
                                  </label>
                                ))}
                              </div>
                            </Field>
                            <Field>
                              <FieldLabel>
                                {t("pages.models.aspectRatio")}
                              </FieldLabel>
                              <div className="flex flex-wrap gap-3">
                                {imageCapabilities.aspect_ratios.map(
                                  (value) => (
                                    <label
                                      key={value}
                                      className="flex items-center gap-2 text-sm"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={aspectRatios.includes(value)}
                                        onChange={(event) => {
                                          setAspectRatios((current) =>
                                            event.target.checked
                                              ? [...current, value]
                                              : current.filter(
                                                  (item) => item !== value
                                                )
                                          )
                                          if (
                                            event.target.checked &&
                                            !defaultAspectRatio
                                          )
                                            setDefaultAspectRatio(value)
                                          if (
                                            !event.target.checked &&
                                            defaultAspectRatio === value
                                          )
                                            setDefaultAspectRatio("")
                                        }}
                                      />
                                      {value}
                                    </label>
                                  )
                                )}
                              </div>
                            </Field>
                            <FieldGroup className="grid gap-4 sm:grid-cols-2">
                              <Field>
                                <FieldLabel>
                                  {t("pages.models.defaultQuality")}
                                </FieldLabel>
                                <Select
                                  items={qualities.map((value) => ({
                                    value,
                                    label: value,
                                  }))}
                                  value={defaultQuality}
                                  onValueChange={(value) =>
                                    setDefaultQuality(value ?? "")
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {qualities.map((value) => (
                                        <SelectItem key={value} value={value}>
                                          {value}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                              <Field>
                                <FieldLabel>
                                  {t("pages.models.defaultAspectRatio")}
                                </FieldLabel>
                                <Select
                                  items={aspectRatios.map((value) => ({
                                    value,
                                    label: value,
                                  }))}
                                  value={defaultAspectRatio}
                                  onValueChange={(value) =>
                                    setDefaultAspectRatio(value ?? "")
                                  }
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectGroup>
                                      {aspectRatios.map((value) => (
                                        <SelectItem key={value} value={value}>
                                          {value}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  </SelectContent>
                                </Select>
                              </Field>
                            </FieldGroup>
                            <Field>
                              <FieldLabel htmlFor="model-base-credits">
                                {t("pages.models.baseCreditsPerImage")}
                              </FieldLabel>
                              <Input
                                id="model-base-credits"
                                value={baseCredits}
                                onChange={(event) =>
                                  setBaseCredits(event.target.value)
                                }
                                inputMode="decimal"
                                required
                              />
                            </Field>
                            <FieldGroup className="grid gap-4 sm:grid-cols-2">
                              {qualities.map((value) => (
                                <Field key={value}>
                                  <FieldLabel
                                    htmlFor={`quality-price-${value}`}
                                  >
                                    {value}{" "}
                                    {t("pages.models.qualityMultiplier")}
                                  </FieldLabel>
                                  <Input
                                    id={`quality-price-${value}`}
                                    value={qualityMultipliers[value] ?? "1"}
                                    onChange={(event) =>
                                      setQualityMultipliers((current) => ({
                                        ...current,
                                        [value]: event.target.value,
                                      }))
                                    }
                                    inputMode="decimal"
                                  />
                                </Field>
                              ))}
                              {aspectRatios.map((value) => (
                                <Field key={value}>
                                  <FieldLabel htmlFor={`ratio-price-${value}`}>
                                    {value} {t("pages.models.aspectMultiplier")}
                                  </FieldLabel>
                                  <Input
                                    id={`ratio-price-${value}`}
                                    value={aspectMultipliers[value] ?? "1"}
                                    onChange={(event) =>
                                      setAspectMultipliers((current) => ({
                                        ...current,
                                        [value]: event.target.value,
                                      }))
                                    }
                                    inputMode="decimal"
                                  />
                                </Field>
                              ))}
                              {imageCapabilities.operations.includes(
                                "edit"
                              ) && (
                                <Field>
                                  <FieldLabel htmlFor="edit-price">
                                    {t("pages.models.editMultiplier")}
                                  </FieldLabel>
                                  <Input
                                    id="edit-price"
                                    value={editMultiplier}
                                    onChange={(event) =>
                                      setEditMultiplier(event.target.value)
                                    }
                                    inputMode="decimal"
                                  />
                                </Field>
                              )}
                            </FieldGroup>
                          </>
                        )}
                      </FieldGroup>
                    )}

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
                      <FieldLabel htmlFor="model-authorized-groups">
                        {t("pages.models.authorizedGroups")}
                      </FieldLabel>
                      <GroupSelect
                        id="model-authorized-groups"
                        options={flattenGroupTree(groups).map((group) => ({
                          id: group.value,
                          parentId: group.parentId,
                          name: group.labelKey,
                          disabled: group.value === ROOT_GROUP_ID,
                        }))}
                        users={members.map((member) => ({
                          id: member.id,
                          name: member.name,
                          email: member.email,
                          groupIds: member.groupId ? [member.groupId] : [],
                        }))}
                        label={t("pages.models.authorizedGroups")}
                        placeholder={t("pages.models.authorizationPlaceholder")}
                        emptyText={t("pages.membersAndGroups.noMembersFound")}
                        locale={i18n.resolvedLanguage ?? i18n.language}
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
                        disabled={saving}
                        defaultExpanded
                        collapsible
                        multiple
                        selectionMode="both"
                        searchable
                        searchPlaceholder={t(
                          "pages.models.searchAuthorization"
                        )}
                        noResultsText={t(
                          "pages.models.noMatchingAuthorization"
                        )}
                        cascadeGroups
                      />
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.models.cancel")}
                    </DialogClose>
                    <Button disabled={saving} type="submit">
                      {editingModel
                        ? t("pages.models.save")
                        : t("pages.models.create")}
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
              {models
                .filter((model) => model.type === tabType)
                .map((model) => (
                  <Card
                    className={cn(!model.enabled && "bg-muted")}
                    key={model.id}
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
                            {model.kind === "image" && (
                              <Badge variant="outline">
                                {t("pages.models.imageKind")}
                              </Badge>
                            )}
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
                        {model.type === "system" && (
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
                                {model.kind === "image" &&
                                  model.enabled &&
                                  model.imageConfig && (
                                    <DropdownMenuItem
                                      onClick={() => setModelToTest(model)}
                                    >
                                      <HugeiconsIcon
                                        icon={PlayIcon}
                                        strokeWidth={2}
                                      />
                                      {t("pages.models.testGeneration")}
                                    </DropdownMenuItem>
                                  )}
                                <DropdownMenuItem
                                  onClick={() => handleEditModel(model)}
                                >
                                  <HugeiconsIcon
                                    icon={Edit02Icon}
                                    strokeWidth={2}
                                  />
                                  {t("pages.models.edit")}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() => setModelPendingDeletion(model)}
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
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3">
                      <dl className="flex flex-col gap-3">
                        {model.kind === "image" ? (
                          <>
                            <div className="flex min-w-0 items-center gap-4">
                              <dt className="w-2/5 truncate text-muted-foreground">
                                {t("pages.models.imageQuality")}
                              </dt>
                              <dd className="w-3/5 truncate text-end font-medium">
                                {model.imageConfig?.qualities.join(", ") ?? "-"}
                              </dd>
                            </div>
                            <div className="flex min-w-0 items-center gap-4">
                              <dt className="w-2/5 truncate text-muted-foreground">
                                {t("pages.models.aspectRatio")}
                              </dt>
                              <dd className="w-3/5 truncate text-end font-medium">
                                {model.imageConfig?.aspect_ratios.join(", ") ??
                                  "-"}
                              </dd>
                            </div>
                            <div className="flex min-w-0 items-center gap-4">
                              <dt className="w-2/5 truncate text-muted-foreground">
                                {t("pages.models.baseCreditsPerImage")}
                              </dt>
                              <dd className="w-3/5 truncate text-end font-medium">
                                {model.imagePricing?.base_credits_per_image ??
                                  "0"}
                              </dd>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex min-w-0 items-center gap-4">
                              <dt
                                className="w-2/5 truncate text-muted-foreground"
                                title={t("pages.models.contextSize")}
                              >
                                {t("pages.models.contextSize")}
                              </dt>
                              <dd className="w-3/5 truncate text-end font-medium">
                                {model.contextSizeK}K
                              </dd>
                            </div>
                            <div className="flex min-w-0 items-center gap-4">
                              <dt
                                className="w-2/5 truncate text-muted-foreground"
                                title={t("pages.models.imageRecognition")}
                              >
                                {t("pages.models.imageRecognition")}
                              </dt>
                              <dd className="w-3/5 truncate text-end font-medium">
                                {model.supportsVision
                                  ? t("pages.models.supported")
                                  : t("pages.models.unsupported")}
                              </dd>
                            </div>
                            {model.type === "system" && (
                              <div className="flex min-w-0 items-center gap-4">
                                <dt
                                  className="w-2/5 truncate text-muted-foreground"
                                  title={t("pages.models.multiplier")}
                                >
                                  {t("pages.models.multiplier")}
                                </dt>
                                <dd className="w-3/5 truncate text-end font-medium">
                                  {model.multiplier.toFixed(1)}×
                                </dd>
                              </div>
                            )}
                          </>
                        )}
                      </dl>
                      <ResourceTagSummary tagIds={model.tagIds} />
                    </CardContent>
                    <CardFooter className="min-w-0 gap-4 border-t">
                      <span
                        className="w-2/5 truncate text-muted-foreground"
                        title={t("pages.models.authorizedGroups")}
                      >
                        {t("pages.models.authorizedGroups")}
                      </span>
                      <span
                        className="w-3/5 truncate text-end font-medium"
                        title={getAuthorizationNames(
                          model.authorization,
                          t,
                          flattenGroupTree(groups),
                          members
                        )}
                      >
                        {getAuthorizationNames(
                          model.authorization,
                          t,
                          flattenGroupTree(groups),
                          members
                        )}
                      </span>
                    </CardFooter>
                  </Card>
                ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>

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
            <AlertDialogCancel>{t("pages.models.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteModel}
            >
              {t("pages.models.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
