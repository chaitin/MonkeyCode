import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainModel, DomainProviderModelListItem } from "@/api/Api"
import { ConstsInterfaceType } from "@/api/Api"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { CircleQuestionMark } from 'lucide-react'
import { getModelDisplayName, modelProviderList } from "@/utils/common"
import { useTranslation } from "react-i18next"

interface AddModelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialModel?: DomainModel | null
  onRefresh?: () => void
}

const DEFAULT_BASE_URL = "https://model-square.app.baizhi.cloud/v1"
const DEFAULT_PROVIDER = "BaiZhiCloud"
const DEFAULT_CONTEXT_LIMIT = "200000"
const DEFAULT_OUTPUT_LIMIT = "32000"

export default function AddModel({
  open,
  onOpenChange,
  initialModel,
  onRefresh,
}: AddModelProps) {
  const { t } = useTranslation()
  const [model, setModel] = useState("")
  const [remark, setRemark] = useState("")
  const [apiToken, setApiToken] = useState("")
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL)
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [contextLimit, setContextLimit] = useState(DEFAULT_CONTEXT_LIMIT)
  const [outputLimit, setOutputLimit] = useState(DEFAULT_OUTPUT_LIMIT)
  const [temperature, setTemperature] = useState<number | undefined>(undefined)
  const [thinkingEnabled, setThinkingEnabled] = useState(true)
  const [supportImage, setSupportImage] = useState(false)
  const [modelList, setModelList] = useState<DomainProviderModelListItem[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelListFetchFailed, setModelListFetchFailed] = useState(false)
  const [modelListAttempted, setModelListAttempted] = useState(false)

  const resetModelListState = () => {
    setModelList([])
    setModelListAttempted(false)
    setModelListFetchFailed(false)
  }

  const resetForm = (source?: DomainModel | null) => {
    setModel(source?.model || "")
    setRemark(source?.remark || "")
    setApiToken(source?.api_key || "")
    setBaseUrl(source?.base_url || DEFAULT_BASE_URL)
    setProvider(source?.provider || DEFAULT_PROVIDER)
    setInterfaceType(source?.interface_type || ConstsInterfaceType.InterfaceTypeOpenAIChat)
    setContextLimit(source?.context_limit ? String(source.context_limit) : DEFAULT_CONTEXT_LIMIT)
    setOutputLimit(source?.output_limit ? String(source.output_limit) : DEFAULT_OUTPUT_LIMIT)
    setTemperature(source?.temperature)
    setThinkingEnabled(source ? source.thinking_enabled === true : true)
    setSupportImage(source?.support_image === true)
    resetModelListState()
  }

  useEffect(() => {
    if (open) {
      resetForm(initialModel)
    }
  }, [open, initialModel])

  const showManualModelInput =
    apiToken.trim() &&
    !loadingModels &&
    modelListAttempted &&
    (modelListFetchFailed || modelList.length === 0)

  const parsePositiveInteger = (value: string, label: string) => {
    const parsedValue = Number(value.trim())
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      toast.error(t("consoleSettings.models.toast.positiveInteger", { label }))
      return null
    }

    return parsedValue
  }

  const fetchModelList = async () => {
    if (!apiToken.trim()) {
      toast.error(t("consoleSettings.models.toast.apiTokenFirst"))
      return
    }

    setModelListAttempted(true)
    setModelListFetchFailed(false)

    if (modelProviderList[baseUrl.trim()]) {
      setModelList(modelProviderList[baseUrl.trim()])
      return
    }

    setLoadingModels(true)
    await apiRequest('getProviderModelList', {
        api_key: apiToken.trim(),
        base_url: baseUrl.trim() || DEFAULT_BASE_URL,
        provider,
      }, [], (resp) => {
        if (resp.code === 0) {
          const models = resp.data?.models || []
          setModelList(models)
          setModelListFetchFailed(false)
          if (models.length === 0) {
            toast.warning(t("consoleSettings.models.toast.noProviderModels"))
          } else {
            toast.success(t("consoleSettings.models.toast.providerModelsLoaded", { count: models.length }))
          }
        } else {
          setModelList([])
          setModelListFetchFailed(true)
          toast.error(t("consoleSettings.models.toast.providerModelsFailed", { message: resp.message }))
        }
      })
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!apiToken.trim()) {
      toast.error(t("consoleSettings.models.toast.apiTokenRequired"))
      return
    }
    if (!model.trim()) {
      toast.error(t("consoleSettings.models.toast.modelRequired"))
      return
    }
    if (!baseUrl.trim()) {
      toast.error(t("consoleSettings.models.toast.baseUrlRequired"))
      return
    }
    const parsedContextLimit = parsePositiveInteger(contextLimit, t("consoleSettings.models.labels.contextLimit"))
    if (parsedContextLimit === null) {
      return
    }
    const parsedOutputLimit = parsePositiveInteger(outputLimit, t("consoleSettings.models.labels.outputLimit"))
    if (parsedOutputLimit === null) {
      return
    }

    setSaving(true)

    // Run a health check before saving.
    const healthCheckData = {
      api_key: apiToken.trim(),
      model: model.trim(),
      base_url: baseUrl.trim(),
      interface_type: interfaceType,
      provider,
    }

    await apiRequest('v1UsersModelsHealthCheckCreate', healthCheckData, [], async (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          const requestData: any = {
            provider,
            model: model.trim(),
            remark: remark.trim(),
            base_url: baseUrl.trim(),
            api_key: apiToken.trim(),
            interface_type: interfaceType,
            context_limit: parsedContextLimit,
            output_limit: parsedOutputLimit,
            thinking_enabled: thinkingEnabled,
            support_image: supportImage,
          }

          if (temperature !== undefined) {
            requestData.temperature = temperature
          }

          await apiRequest('v1UsersModelsCreate', requestData, [], (resp) => {
            if (resp.code === 0) {
              toast.success(t("consoleSettings.models.toast.addSuccess"))
              resetForm()
              onOpenChange(false)
              onRefresh?.()
            } else {
              toast.error(t("consoleSettings.models.toast.addFailed", { message: resp.message }))
            }
          })
        } else {
          toast.error(t("consoleSettings.models.toast.healthCheckFailed", { message: resp.data?.error }))
        }
      }
    })
    
    setSaving(false)
  }

  const handleCancel = () => {
    resetForm()
    onOpenChange(false)
  }

  const modelApiDescription = () => {
    let url = baseUrl.trim()

    if (!url) {
      return t("consoleSettings.models.descriptionText.apiUrlUnset")
    }

    if (!url.endsWith('/')) {
      url += '/'
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return t("consoleSettings.models.descriptionText.apiUrlInvalid")
    }

    switch (interfaceType) {
      case ConstsInterfaceType.InterfaceTypeOpenAIResponse:
        return url + "responses"
      case ConstsInterfaceType.InterfaceTypeOpenAIChat:
        return url + "chat/completions"
      case ConstsInterfaceType.InterfaceTypeAnthropic:
        return url + "v1/messages"
      default:
        return t("consoleSettings.models.descriptionText.apiUrlInvalid")
    }
  }

  // Group and sort provider model options.
  const getGroupedModels = () => {
    const groups: Record<string, DomainProviderModelListItem[]> = {}
    
    modelList.forEach((item) => {
      const modelName = item.model || ""
      const parts = modelName.split("-")
      const groupKey = parts.length > 0 ? parts[0] : t("consoleSettings.models.fallback.other")
      
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(item)
    })
    
    // Sort each group by model id.
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const aName = a.model || ""
        const bName = b.model || ""
        return aName.localeCompare(bName)
      })
    })
    
    // Sort group names.
    const sortedGroupKeys = Object.keys(groups).sort()
    
    return { groups, sortedGroupKeys }
  }


  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetForm()
        }
        onOpenChange(nextOpen)
      }}
    >
      <DialogTrigger asChild>
        <Button variant={"outline"} size="sm">{t("consoleSettings.models.actions.bind")}</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.models.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain pr-1">
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.interfaceType")}</FieldLabel>
            <FieldContent>
              <Select
                value={interfaceType}
                onValueChange={(value) => setInterfaceType(value as ConstsInterfaceType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("consoleSettings.models.placeholders.interfaceType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsInterfaceType.InterfaceTypeOpenAIResponse}>
                    OpenAI Responses
                  </SelectItem>
                  <SelectItem value={ConstsInterfaceType.InterfaceTypeOpenAIChat}>
                    OpenAI Chat
                  </SelectItem>
                  <SelectItem value={ConstsInterfaceType.InterfaceTypeAnthropic}>
                    Anthropic
                  </SelectItem>
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.baseUrl")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.models.placeholders.baseUrl")}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  resetModelListState()
                }}
              />
            </FieldContent>
            <FieldDescription>{modelApiDescription()}</FieldDescription>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel>API Token</FieldLabel>
              <Button
                type="button"
                variant="link"
                size="sm"
                asChild
                className="h-auto p-0 text-foreground"
              >
                <a href="https://monkeycode.docs.baizhi.cloud/" target="_blank">
                  <CircleQuestionMark />{t("consoleSettings.models.help.howToGet")}
                </a>
              </Button>
            </div>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.models.placeholders.apiToken")}
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value)
                  resetModelListState()
                }}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.modelName")}</FieldLabel>
            <FieldContent>
              {showManualModelInput ? (
                <>
                  <Input
                    placeholder={t("consoleSettings.models.placeholders.modelName")}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                  <FieldDescription>
                    {modelListFetchFailed
                      ? t("consoleSettings.models.descriptionText.fetchFailedManual")
                      : t("consoleSettings.models.descriptionText.emptyManual")}
                  </FieldDescription>
                </>
              ) : (
                <Select
                  value={model}
                  onValueChange={setModel}
                  onOpenChange={(open) => {
                    if (open && apiToken.trim() && !loadingModels) {
                      fetchModelList()
                    }
                  }}
                  disabled={loadingModels || !apiToken.trim()}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingModels ? t("consoleSettings.models.loadingShort") : model || t("consoleSettings.models.placeholders.selectModel")} />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingModels ? (
                      <div className="flex items-center justify-center py-4">
                        <Spinner />
                        <span className="ml-2 text-sm text-muted-foreground">{t("consoleSettings.models.loadingModels")}</span>
                      </div>
                    ) : modelList.length > 0 ? (() => {
                      const { groups, sortedGroupKeys } = getGroupedModels()
                      return (
                        <>
                          {sortedGroupKeys.map((groupKey) => (
                            <SelectGroup key={groupKey}>
                              <SelectLabel>{groupKey}</SelectLabel>
                              {groups[groupKey].map((item, index) => (
                                <SelectItem key={`${groupKey}-${index}`} value={item.model || ""}>
                                  {getModelDisplayName(item.model)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </>
                      )
                    })() : model ? (
                      <SelectItem value={model}>
                        {model}
                      </SelectItem>
                    ) : (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        {apiToken.trim() ? t("consoleSettings.models.emptyProviderModels") : t("consoleSettings.models.apiTokenFirst")}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.remark")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("consoleSettings.models.placeholders.remark")}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>{t("consoleSettings.models.labels.contextLimit")}</FieldLabel>
              <FieldContent>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder={t("consoleSettings.models.placeholders.contextLimit")}
                  value={contextLimit}
                  onChange={(e) => setContextLimit(e.target.value)}
                />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("consoleSettings.models.labels.outputLimit")}</FieldLabel>
              <FieldContent>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  placeholder={t("consoleSettings.models.placeholders.outputLimit")}
                  value={outputLimit}
                  onChange={(e) => setOutputLimit(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.thinking")}</FieldLabel>
            <FieldContent>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {thinkingEnabled ? t("consoleSettings.models.status.enabled") : t("consoleSettings.models.status.disabled")}
                </span>
                <Switch
                  checked={thinkingEnabled}
                  onCheckedChange={setThinkingEnabled}
                  disabled={saving}
                />
              </div>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("consoleSettings.models.labels.imageRecognition")}</FieldLabel>
            <FieldContent>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {supportImage ? t("consoleSettings.models.status.supported") : t("consoleSettings.models.status.unsupported")}
                </span>
                <Switch
                  checked={supportImage}
                  onCheckedChange={setSupportImage}
                  disabled={saving}
                />
              </div>
            </FieldContent>
            <FieldDescription>{t("consoleSettings.models.descriptionText.imageRecognition")}</FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            {t("consoleSettings.models.actions.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!model.trim() || saving}>
            {saving && <Spinner className="size-4" />}
            {t("consoleSettings.models.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
