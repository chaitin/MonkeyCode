import { useState, useEffect, useRef } from "react"
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
import { Checkbox } from "@/components/ui/checkbox"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainTeamModel, DomainProviderModelListItem, DomainTeamGroup } from "@/api/Api"
import { ConstsInterfaceType } from "@/api/Api"
import { getModelDisplayName, getModelUrlDescription, modelProviderList } from "@/utils/common"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "react-i18next"

interface EditModelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: DomainTeamModel | null
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
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [modelList, setModelList] = useState<DomainProviderModelListItem[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelListFetchFailed, setModelListFetchFailed] = useState(false)
  const [modelListAttempted, setModelListAttempted] = useState(false)
  const [supportImage, setSupportImage] = useState(false)
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const [groups, setGroups] = useState<DomainTeamGroup[]>([])
  const [selectOpen, setSelectOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      fetchGroups()
    }
  }, [open])

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
      setInterfaceType(model.interface_type || ConstsInterfaceType.InterfaceTypeOpenAIChat)
      setSupportImage(model.support_image === true)
      resetModelListState()
      setSelectedGroupIds(model.groups?.map(g => g.id || "").filter(id => id) || [])
    }
  }, [model, open])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setSelectOpen(false)
      }
    }

    if (selectOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [selectOpen])

  const fetchGroups = async () => {
    await apiRequest('v1TeamsGroupsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setGroups(resp.data?.groups || [])
      } else {
        toast.error(t("managerModels.toast.groupFetchFailedWithMessage", { message: resp.message }));
      }
    })
  }

  const handleGroupCheckboxChange = (groupId: string, checked: boolean) => {
    if (checked) {
      setSelectedGroupIds([...selectedGroupIds, groupId])
    } else {
      setSelectedGroupIds(selectedGroupIds.filter(id => id !== groupId))
    }
  }

  const fetchModelList = async () => {
    if (!apiToken.trim()) {
      toast.error(t("managerModels.toast.apiTokenFirst"))
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
            toast.warning(t("managerModels.toast.noModelsManual"))
          } else {
            toast.success(t("managerModels.toast.fetchedModels", { count: models.length }))
          }
        } else {
          setModelList([])
          setModelListFetchFailed(true)
          toast.error(t("managerModels.toast.fetchModelsFailedManual", { message: resp.message }))
        }
      })
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!model?.id) {
      toast.error(t("managerModels.toast.incomplete"))
      return
    }

    if (!apiToken.trim()) {
      toast.error(t("managerModels.toast.apiTokenRequired"))
      return
    }
    if (!selectedModel.trim()) {
      toast.error(t("managerModels.toast.modelRequired"))
      return
    }
    if (!baseUrl.trim()) {
      toast.error(t("managerModels.toast.baseUrlRequired"))
      return
    }

    setSaving(true)

    const provider = model.provider || "BaiZhiCloud"
    const healthCheckData = {
      api_key: apiToken.trim(),
      model: selectedModel.trim(),
      base_url: baseUrl.trim(),
      interface_type: interfaceType,
      provider: provider,
    }

    await apiRequest('v1TeamsModelsHealthCheckCreate', healthCheckData, [], async (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          const requestData: any = {
            api_key: apiToken.trim(),
            model: selectedModel.trim(),
            base_url: baseUrl.trim(),
            interface_type: interfaceType,
            support_image: supportImage,
            group_ids: selectedGroupIds
          }

          if (model.provider) {
            requestData.provider = model.provider
          }

          await apiRequest('v1TeamsModelsUpdate', requestData, [model.id!], (resp) => {
            if (resp.code === 0) {
              toast.success(t("managerModels.toast.updateSuccess"))
              setApiToken("")
              setBaseUrl("")
              setSelectedModel("")
              setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
              setSupportImage(false)
              resetModelListState()
              setSelectedGroupIds([])
              setSelectOpen(false)
              onOpenChange(false)
              onRefresh?.()
            } else {
              toast.error(t("managerModels.toast.updateFailedWithMessage", { message: resp.message }));
            }
          })
        } else {
          toast.error(t("managerModels.toast.configCheckFailedWithMessage", { message: resp.data?.error }))
        }
      }
    })
    
    setSaving(false)
  }

  const handleCancel = () => {
    setApiToken("")
    setBaseUrl("")
    setSelectedModel("")
    setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
    setSupportImage(false)
    resetModelListState()
    setSelectedGroupIds([])
    setSelectOpen(false)
    onOpenChange(false)
  }

  // Group and sort provider model options.
  const getGroupedModels = () => {
    const groups: Record<string, DomainProviderModelListItem[]> = {}
    
    modelList.forEach((item) => {
      const modelName = item.model || ""
      const parts = modelName.split("-")
      const groupKey = parts.length > 0 ? parts[0] : t("managerModels.fallback.otherGroup")
      
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(item)
    })
    
    // Sort models inside each group by name.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("managerModels.form.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto overscroll-contain pr-1">
          <Field>
            <FieldLabel>{t("managerModels.form.interfaceFormat")}</FieldLabel>
            <FieldContent>
              <Select
                value={interfaceType}
                onValueChange={(value) => setInterfaceType(value as ConstsInterfaceType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("managerModels.form.interfacePlaceholder")} />
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
            <FieldLabel>{t("managerModels.form.modelApiUrl")}</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("managerModels.form.modelApiUrlPlaceholder")}
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  resetModelListState()
                }}
              />
            </FieldContent>
            <FieldDescription>
              {getModelUrlDescription(baseUrl, interfaceType)}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>API Token</FieldLabel>
            <FieldContent>
              <Input
                placeholder={t("managerModels.form.apiTokenPlaceholder")}
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value)
                  resetModelListState()
                }}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("managerModels.form.modelName")}</FieldLabel>
            <FieldContent>
              {showManualModelInput ? (
                <>
                  <Input
                    placeholder={t("managerModels.form.modelNamePlaceholder")}
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  />
                  <FieldDescription>
                    {modelListFetchFailed
                      ? t("managerModels.form.fetchFailedDescription")
                      : t("managerModels.form.emptyModelsDescription")}
                  </FieldDescription>
                </>
              ) : (
                <Select
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  onOpenChange={(open) => {
                    if (open && apiToken.trim() && !loadingModels) {
                      fetchModelList()
                    }
                  }}
                  disabled={loadingModels || !apiToken.trim()}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={loadingModels ? t("managerModels.form.loading") : selectedModel || t("managerModels.form.selectModel")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingModels ? (
                      <div className="flex items-center justify-center py-4">
                        <Spinner />
                        <span className="ml-2 text-sm text-muted-foreground">
                          {t("managerModels.form.loadingModels")}
                        </span>
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
                    })() : selectedModel ? (
                      <SelectItem value={selectedModel}>
                        {selectedModel}
                      </SelectItem>
                    ) : (
                      <div className="py-4 text-center text-sm text-muted-foreground">
                        {apiToken.trim()
                          ? t("managerModels.form.noModels")
                          : t("managerModels.toast.apiTokenFirst")}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("managerModels.form.groupsLabel")}</FieldLabel>
            <FieldContent>
              <div className="relative" ref={selectRef}>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={selectOpen}
                  className="w-full justify-between"
                  onClick={() => setSelectOpen(!selectOpen)}
                >
                  <span className="truncate">
                    {selectedGroupIds.length === 0
                      ? t("managerModels.form.selectGroups")
                      : selectedGroupIds.length === 1
                      ? groups.find((g) => g.id === selectedGroupIds[0])?.name || t("managerModels.form.selectedOne")
                      : t("managerModels.form.selectedMany", { count: selectedGroupIds.length })}
                  </span>
                  <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                </Button>
                {selectOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[300px] overflow-auto p-1">
                      {groups.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          {t("managerModels.fallback.noGroups")}
                        </div>
                      ) : (
                        groups.map((group) => {
                          const isChecked = selectedGroupIds.includes(group.id || "")
                          return (
                            <div
                              key={group.id}
                              className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent cursor-pointer"
                              onClick={() => handleGroupCheckboxChange(group.id || "", !isChecked)}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => handleGroupCheckboxChange(group.id || "", checked as boolean)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-sm">{group.name}</span>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>{t("managerModels.form.imageSupport")}</FieldLabel>
            <FieldContent>
              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {supportImage ? t("managerModels.form.supported") : t("managerModels.form.unsupported")}
                </span>
                <Switch
                  checked={supportImage}
                  onCheckedChange={setSupportImage}
                  disabled={saving}
                />
              </div>
            </FieldContent>
            <FieldDescription>{t("managerModels.form.imageSupportDescription")}</FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            {t("managerModels.actions.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!selectedModel.trim() || saving}>
            {saving && <Spinner className="size-4" />}
            {t("managerModels.actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
