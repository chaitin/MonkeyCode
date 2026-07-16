import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Spinner } from "@/components/ui/spinner"
import { modelProviderList } from "@/utils/common"
import { useTranslation } from "react-i18next"
import { ProviderModelCombobox } from "./provider-model-combobox"

interface EditModelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  model?: DomainModel
  onRefresh?: () => void
}


export default function EditModel({
  open,
  onOpenChange,
  model,
  onRefresh,
}: EditModelProps) {
  const { t } = useTranslation()
  const [apiToken, setApiToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [remark, setRemark] = useState("")
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [contextLimit, setContextLimit] = useState("")
  const [outputLimit, setOutputLimit] = useState("")
  const [thinkingEnabled, setThinkingEnabled] = useState(false)
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

  const showManualModelInput =
    apiToken.trim() &&
    !loadingModels &&
    modelListAttempted &&
    (modelListFetchFailed || modelList.length === 0)

  useEffect(() => {
    if (model && open) {
      setApiToken(model.api_key || "")
      setBaseUrl(model.base_url || "https://model-square.app.baizhi.cloud/v1")
      setSelectedModel(model.model || "")
      setRemark(model.remark || "")
      setInterfaceType(model.interface_type || ConstsInterfaceType.InterfaceTypeOpenAIChat)
      setContextLimit(model.context_limit ? String(model.context_limit) : "")
      setOutputLimit(model.output_limit ? String(model.output_limit) : "")
      setThinkingEnabled(model.thinking_enabled === true)
      setSupportImage(model.support_image === true)
      resetModelListState()
    }
  }, [model, open])

  const parseOptionalPositiveInteger = (value: string, label: string) => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      return undefined
    }

    const parsedValue = Number(trimmedValue)
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
      base_url: baseUrl.trim() || model?.base_url || "https://model-square.app.baizhi.cloud/v1",
      provider: model?.provider || "BaiZhiCloud",
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
        toast.error(t("consoleSettings.models.toast.providerModelsFailed", { message: resp.message }))
        setModelList([])
        setModelListFetchFailed(true)
      }
    })
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!model?.id) {
      toast.error(t("consoleSettings.models.toast.incomplete"))
      return
    }

    if (!apiToken.trim()) {
      toast.error(t("consoleSettings.models.toast.apiTokenRequired"))
      return
    }
    if (!selectedModel.trim()) {
      toast.error(t("consoleSettings.models.toast.modelRequired"))
      return
    }
    if (!baseUrl.trim()) {
      toast.error(t("consoleSettings.models.toast.baseUrlRequired"))
      return
    }
    const parsedContextLimit = parseOptionalPositiveInteger(contextLimit, t("consoleSettings.models.labels.contextLimit"))
    if (parsedContextLimit === null) {
      return
    }
    const parsedOutputLimit = parseOptionalPositiveInteger(outputLimit, t("consoleSettings.models.labels.outputLimit"))
    if (parsedOutputLimit === null) {
      return
    }

    setSaving(true)

    // Run a health check before saving.
    const provider = model.provider || "BaiZhiCloud"
    const healthCheckData = {
      api_key: apiToken.trim(),
      model: selectedModel.trim(),
      base_url: baseUrl.trim(),
      interface_type: interfaceType,
      provider: provider,
    }

    await apiRequest('v1UsersModelsHealthCheckCreate', healthCheckData, [], async (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          const requestData: any = {
            api_key: apiToken.trim(),
            model: selectedModel.trim(),
            remark: remark.trim(),
            base_url: baseUrl.trim(),
            interface_type: interfaceType,
            thinking_enabled: thinkingEnabled,
            support_image: supportImage,
          }

          if (parsedContextLimit !== undefined) {
            requestData.context_limit = parsedContextLimit
          }

          if (parsedOutputLimit !== undefined) {
            requestData.output_limit = parsedOutputLimit
          }

          // Preserve the provider when the existing model has one.
          if (model.provider) {
            requestData.provider = model.provider
          }

          await apiRequest('v1UsersModelsUpdate', requestData, [model.id!], (resp) => {
            if (resp.code === 0) {
              toast.success(t("consoleSettings.models.toast.updateSuccess"))
              setApiToken("")
              setBaseUrl("")
              setSelectedModel("")
              setRemark("")
              setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
              setContextLimit("")
              setOutputLimit("")
              setThinkingEnabled(false)
              setSupportImage(false)
              resetModelListState()
              onOpenChange(false)
              onRefresh?.()
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
    setApiToken("")
    setBaseUrl("")
    setSelectedModel("")
    setRemark("")
    setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
    setContextLimit("")
    setOutputLimit("")
    setThinkingEnabled(false)
    setSupportImage(false)
    resetModelListState()
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("consoleSettings.models.edit.title")}</DialogTitle>
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
            <FieldDescription>
              {modelApiDescription()}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>API Token</FieldLabel>
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
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  />
                  <FieldDescription>
                    {modelListFetchFailed
                      ? t("consoleSettings.models.descriptionText.fetchFailedManual")
                      : t("consoleSettings.models.descriptionText.emptyManual")}
                  </FieldDescription>
                </>
              ) : (
                <ProviderModelCombobox
                  value={selectedModel}
                  models={modelList}
                  loading={loadingModels}
                  disabled={!apiToken.trim()}
                  onOpen={() => {
                    if (apiToken.trim() && !loadingModels) {
                      void fetchModelList()
                    }
                  }}
                  onValueChange={setSelectedModel}
                />
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
          <Button onClick={handleSave} disabled={!selectedModel.trim() || saving}>
            {saving && <Spinner className="size-4" />}
            {t("consoleSettings.models.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
