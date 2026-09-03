import { useState, type FormEvent } from "react"
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
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import { getModelIconName } from "@/lib/model-utils"
import { cn } from "@/lib/utils"

const PROTOCOLS = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic", label: "Anthropic" },
] as const

type ModelProtocol = (typeof PROTOCOLS)[number]["value"]
type ModelType = "system" | "user"

type ModelBase = {
  id: string
  modelId: string
  displayName: string
  contextSizeK: number
  supportsVision: boolean
  baseUrl: string
  protocol: ModelProtocol
  apiKey: string
  authorization: AuthorizationSelection
  enabled: boolean
}

type Model = ModelBase &
  ({ type: "system"; multiplier: number } | { type: "user" })

const INITIAL_MODELS: Model[] = [
  {
    id: "openai-gpt-4o",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    contextSizeK: 128,
    supportsVision: true,
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    multiplier: 1,
    authorization: {
      groupIds: ["administrators", "product", "engineering"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "openai-o3",
    modelId: "o3",
    displayName: "OpenAI o3",
    contextSizeK: 200,
    supportsVision: true,
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai-responses",
    apiKey: "configured",
    multiplier: 2,
    authorization: {
      groupIds: ["administrators", "engineering"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "anthropic-claude-sonnet",
    modelId: "claude-3-5-sonnet-latest",
    displayName: "Claude 3.5 Sonnet",
    contextSizeK: 200,
    supportsVision: true,
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    apiKey: "configured",
    multiplier: 1.5,
    authorization: {
      groupIds: ["administrators", "product", "engineering"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "deepseek-chat",
    modelId: "deepseek-chat",
    displayName: "DeepSeek V3",
    contextSizeK: 64,
    supportsVision: false,
    baseUrl: "https://api.deepseek.com",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    multiplier: 0.5,
    authorization: {
      groupIds: ["administrators", "engineering", "operations"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "alibaba-qwen-max",
    modelId: "qwen-max",
    displayName: "Qwen Max",
    contextSizeK: 32,
    supportsVision: false,
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    multiplier: 0.8,
    authorization: {
      groupIds: ["administrators", "product"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "volcengine-doubao-pro",
    modelId: "doubao-pro-32k",
    displayName: "Doubao Pro",
    contextSizeK: 32,
    supportsVision: false,
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    multiplier: 0.6,
    authorization: {
      groupIds: ["administrators", "operations"],
      memberIds: [],
    },
    enabled: true,
    type: "system",
  },
  {
    id: "user-gemini-2-5-pro",
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    contextSizeK: 1024,
    supportsVision: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    authorization: {
      groupIds: [],
      memberIds: ["member-04"],
    },
    enabled: true,
    type: "user",
  },
  {
    id: "user-moonshot-v1",
    modelId: "moonshot-v1-32k",
    displayName: "Moonshot 32K",
    contextSizeK: 32,
    supportsVision: false,
    baseUrl: "https://api.moonshot.cn/v1",
    protocol: "openai-chat-completions",
    apiKey: "configured",
    authorization: {
      groupIds: [],
      memberIds: ["member-01"],
    },
    enabled: true,
    type: "user",
  },
]

export function ModelsPage() {
  const { t } = useTranslation()
  const [models, setModels] = useState(INITIAL_MODELS)
  const [activeModelType, setActiveModelType] = useState<ModelType>("system")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [modelPendingDeletion, setModelPendingDeletion] =
    useState<Model | null>(null)
  const [protocol, setProtocol] = useState<ModelProtocol>(
    "openai-chat-completions"
  )
  const [supportsVision, setSupportsVision] = useState(false)
  const [authorizationOpen, setAuthorizationOpen] = useState(false)
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: ["administrators"],
    memberIds: [],
  })
  const editingModel = models.find((model) => model.id === editingModelId)

  const resetModelOptions = () => {
    setProtocol("openai-chat-completions")
    setSupportsVision(false)
    setAuthorizationOpen(false)
    setAuthorization({ groupIds: ["administrators"], memberIds: [] })
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

  const setModelEnabled = (modelId: string, enabled: boolean) => {
    setModels((currentModels) =>
      currentModels.map((model) =>
        model.id === modelId && model.type === "system"
          ? { ...model, enabled }
          : model
      )
    )
  }

  const handleDeleteModel = () => {
    if (!modelPendingDeletion || modelPendingDeletion.type !== "system") {
      return
    }

    setModels((currentModels) =>
      currentModels.filter((model) => model.id !== modelPendingDeletion.id)
    )
    setModelPendingDeletion(null)
  }

  const handleAddModel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const form = event.currentTarget
    const formData = new FormData(form)
    const modelId = String(formData.get("modelId") ?? "").trim()
    const displayName = String(formData.get("displayName") ?? "").trim()
    const contextSizeK = Number(formData.get("contextSizeK"))
    const baseUrl = String(formData.get("baseUrl") ?? "").trim()
    const apiKey = String(formData.get("apiKey") ?? "").trim()
    const multiplier = Number(formData.get("multiplier"))

    if (
      !modelId ||
      !displayName ||
      !Number.isFinite(contextSizeK) ||
      contextSizeK <= 0 ||
      !baseUrl ||
      !apiKey ||
      !Number.isFinite(multiplier) ||
      multiplier < 0 ||
      authorization.groupIds.length + authorization.memberIds.length === 0 ||
      editingModel?.type === "user"
    ) {
      return
    }

    if (editingModel) {
      setModels((currentModels) =>
        currentModels.map((model) =>
          model.id === editingModel.id
            ? {
                ...model,
                modelId,
                displayName,
                contextSizeK,
                supportsVision,
                baseUrl,
                protocol,
                apiKey,
                multiplier,
                authorization,
              }
            : model
        )
      )
    } else {
      setModels((currentModels) => [
        ...currentModels,
        {
          id: `${modelId}-${Date.now()}`,
          modelId,
          displayName,
          contextSizeK,
          supportsVision,
          baseUrl,
          protocol,
          apiKey,
          multiplier,
          authorization,
          enabled: true,
          type: "system",
        },
      ])
    }
    form.reset()
    handleDialogOpenChange(false)
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
                        defaultValue={editingModel?.apiKey}
                        placeholder={t("pages.models.apiKeyPlaceholder")}
                        type="password"
                        required
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
                        <FieldLabel htmlFor="model-multiplier">
                          {t("pages.models.multiplier")}
                        </FieldLabel>
                        <Input
                          id="model-multiplier"
                          min="0"
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
                      />
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.models.cancel")}
                    </DialogClose>
                    <Button type="submit">
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
                        title={getAuthorizationNames(model.authorization, t)}
                      >
                        {getAuthorizationNames(model.authorization, t)}
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
