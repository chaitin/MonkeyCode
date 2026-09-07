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
import { getModelIconName } from "@/lib/model-utils"
import { cn } from "@/lib/utils"

const PROTOCOLS = [
  { value: "openai_chat_completions", label: "OpenAI Chat Completions" },
  { value: "openai_responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
] as const

type ModelProtocol = (typeof PROTOCOLS)[number]["value"]
type ModelType = "system" | "user"

type ModelBase = {
  id: string
  modelId: string
  displayName: string
  contextSizeK: number
  maxOutputTokens: number
  supportsVision: boolean
  baseUrl: string
  protocol: ModelProtocol
  apiKeyConfigured: boolean
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
  base_url: string
  api_key_configured: boolean
  advanced_config: {
    context_window_tokens: number
    max_output_tokens: number
    supports_vision: boolean
  }
  credit_multiplier: number
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
}

function fromApiModel(model: ApiModel): Model {
  return {
    id: model.id,
    modelId: model.model_id,
    displayName: model.display_name,
    contextSizeK: model.advanced_config.context_window_tokens / 1000,
    maxOutputTokens: model.advanced_config.max_output_tokens,
    supportsVision: model.advanced_config.supports_vision,
    baseUrl: model.base_url,
    protocol: model.protocol,
    apiKeyConfigured: model.api_key_configured,
    multiplier: model.credit_multiplier,
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
  groups: AuthorizationGroupNode[]
): AuthorizationGroupNode[] {
  return groups.flatMap((group) => [
    group,
    ...flattenGroupTree(group.children ?? []),
  ])
}

export function ModelsPage() {
  const { t } = useTranslation()
  const [models, setModels] = useState<Model[]>([])
  const [groups, setGroups] = useState<AuthorizationGroupNode[]>([])
  const [members, setMembers] = useState<AuthorizationMember[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [activeModelType, setActiveModelType] = useState<ModelType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelPendingDeletion, setModelPendingDeletion] =
    useState<Model | null>(null)
  const [protocol, setProtocol] = useState<ModelProtocol>(
    "openai_chat_completions"
  )
  const [supportsVision, setSupportsVision] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
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
            groupId: "",
          }))
        )
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message)
      })
    return () => {
      active = false
    }
  }, [])

  const resetModelOptions = () => {
    setProtocol("openai_chat_completions")
    setSupportsVision(false)
    setAuthorizationOpen(false)
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
    setSupportsVision(model.supportsVision)
    setAuthorization(model.authorization)
    setDialogOpen(true)
  }

  const setModelEnabled = async (modelId: string, enabled: boolean) => {
    setError("")
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
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const handleDeleteModel = async () => {
    if (!modelPendingDeletion || modelPendingDeletion.type !== "system") {
      return
    }

    setError("")
    try {
      await api<void>(`/api/admin/v1/models/${modelPendingDeletion.id}`, {
        method: "DELETE",
      })
      setModels((currentModels) =>
        currentModels.filter((model) => model.id !== modelPendingDeletion.id)
      )
      setModelPendingDeletion(null)
    } catch (reason) {
      setError((reason as Error).message)
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
      !Number.isFinite(contextSizeK) ||
      contextSizeK <= 0 ||
      !Number.isFinite(maxOutputTokens) ||
      maxOutputTokens <= 0 ||
      !baseUrl ||
      (!apiKey && !editingModel?.apiKeyConfigured) ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0 ||
      authorization.groupIds.length + authorization.memberIds.length === 0 ||
      editingModel?.type === "user"
    ) {
      return
    }

    setSaving(true)
    setError("")
    try {
      const payload = {
        model_id: modelId,
        display_name: displayName,
        protocol,
        base_url: baseUrl,
        api_key: apiKey,
        advanced_config: {
          context_window_tokens: contextSizeK * 1000,
          max_output_tokens: maxOutputTokens,
          supports_vision: supportsVision,
        },
        credit_multiplier: multiplier,
        authorization: {
          group_ids: authorization.groupIds,
          user_ids: authorization.memberIds,
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
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {error && (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
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
                          <SelectTrigger className="w-full" id="model-protocol">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {PROTOCOLS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    </FieldGroup>

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

                    <Field>
                      <FieldLabel htmlFor="model-authorized-groups">
                        {t("pages.models.authorizedGroups")}
                      </FieldLabel>
                      <AuthorizationSelect
                        id="model-authorized-groups"
                        open={authorizationOpen}
                        placeholder={t("pages.models.authorizationPlaceholder")}
                        title={t("pages.models.authorizedGroups")}
                        value={authorization}
                        onOpenChange={setAuthorizationOpen}
                        onValueChange={setAuthorization}
                        groups={groups}
                        members={members}
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
                    <CardContent>
                      <dl className="flex flex-col gap-3">
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
                      </dl>
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

      <AlertDialog
        open={modelPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) {
            setModelPendingDeletion(null)
          }
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.models.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.models.deleteDialogDescription", {
                model: modelPendingDeletion?.displayName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
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
