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
import { getModelUrlDescription, modelProviderList } from "@/utils/common"
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
  const [apiToken, setApiToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [modelList, setModelList] = useState<DomainProviderModelListItem[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modelListFetchFailed, setModelListFetchFailed] = useState(false)
  const [modelListAttempted, setModelListAttempted] = useState(false)
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
      resetModelListState()
      // 初始化已选中的分组
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
        toast.error("获取分组列表失败: " + resp.message);
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
      toast.error("请先输入 API Token")
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
            toast.warning("未获取到可用模型，可手动填写模型名称")
          } else {
            toast.success(`获取到 ${models.length} 个可用模型`)
          }
        } else {
          setModelList([])
          setModelListFetchFailed(true)
          toast.error("获取模型列表失败: " + resp.message + "，可手动填写模型名称")
        }
      })
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!model?.id) {
      toast.error("模型信息不完整")
      return
    }

    if (!apiToken.trim()) {
      toast.error("请输入 API Token")
      return
    }
    if (!selectedModel.trim()) {
      toast.error("请选择模型名称")
      return
    }
    if (!baseUrl.trim()) {
      toast.error("请输入模型 API 地址")
      return
    }

    setSaving(true)

    // 先进行健康检查
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
          // 健康检查通过，继续保存
          const requestData: any = {
            api_key: apiToken.trim(),
            model: selectedModel.trim(),
            base_url: baseUrl.trim(),
            interface_type: interfaceType,
            group_ids: selectedGroupIds
          }

          // 如果 provider 存在，也一起更新
          if (model.provider) {
            requestData.provider = model.provider
          }

          await apiRequest('v1TeamsModelsUpdate', requestData, [model.id!], (resp) => {
            if (resp.code === 0) {
              toast.success("模型修改成功")
              setApiToken("")
              setBaseUrl("")
              setSelectedModel("")
              setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
              resetModelListState()
              setSelectedGroupIds([])
              setSelectOpen(false)
              onOpenChange(false)
              onRefresh?.()
            } else {
              toast.error("修改模型失败: " + resp.message);
            }
          })
        } else {
          toast.error("模型配置检查失败: " + resp.data?.error)
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
    resetModelListState()
    setSelectedGroupIds([])
    setSelectOpen(false)
    onOpenChange(false)
  }

  // 对模型列表进行分组和排序
  const getGroupedModels = () => {
    const groups: Record<string, DomainProviderModelListItem[]> = {}
    
    modelList.forEach((item) => {
      const modelName = item.model || ""
      const parts = modelName.split("-")
      const groupKey = parts.length > 0 ? parts[0] : "其他"
      
      if (!groups[groupKey]) {
        groups[groupKey] = []
      }
      groups[groupKey].push(item)
    })
    
    // 对每个组内的模型按字符串排序
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => {
        const aName = a.model || ""
        const bName = b.model || ""
        return aName.localeCompare(bName)
      })
    })
    
    // 对组名进行排序
    const sortedGroupKeys = Object.keys(groups).sort()
    
    return { groups, sortedGroupKeys }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改 AI 大模型</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>接口格式</FieldLabel>
            <FieldContent>
              <Select
                value={interfaceType}
                onValueChange={(value) => setInterfaceType(value as ConstsInterfaceType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择接口格式类型" />
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
            <FieldLabel>模型 API 地址</FieldLabel>
            <FieldContent>
              <Input
                placeholder="请输入模型 API 地址"
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
                placeholder="请输入 API Token"
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value)
                  resetModelListState()
                }}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>模型名称</FieldLabel>
            <FieldContent>
              {showManualModelInput ? (
                <>
                  <Input
                    placeholder="请输入模型名称（与服务商 API 一致）"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                  />
                  <FieldDescription>
                    {modelListFetchFailed
                      ? "无法拉取模型列表，请按服务商文档填写模型 ID。"
                      : "当前未返回可用模型，请手动填写模型名称。"}
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
                    <SelectValue placeholder={loadingModels ? "加载中..." : selectedModel || "请选择模型"} />
                  </SelectTrigger>
                  <SelectContent>
                    {loadingModels ? (
                      <div className="flex items-center justify-center py-4">
                        <Spinner />
                        <span className="ml-2 text-sm text-muted-foreground">加载模型中...</span>
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
                                  {item.model}
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
                        {apiToken.trim() ? "暂无可用模型" : "请先输入 API Token"}
                      </div>
                    )}
                  </SelectContent>
                </Select>
              )}
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>可使用该配置的分组</FieldLabel>
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
                      ? "请选择分组"
                      : selectedGroupIds.length === 1
                      ? groups.find((g) => g.id === selectedGroupIds[0])?.name || "已选择 1 个分组"
                      : `已选择 ${selectedGroupIds.length} 个分组`}
                  </span>
                  <ChevronDown className={cn("ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform", selectOpen && "rotate-180")} />
                </Button>
                {selectOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                    <div className="max-h-[300px] overflow-auto p-1">
                      {groups.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          暂无分组
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!selectedModel.trim() || saving}>
            {saving && <Spinner className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

