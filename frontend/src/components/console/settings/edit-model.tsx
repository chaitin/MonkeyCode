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
import type { DomainModel, DomainProviderModelListItem, DomainUpdateModelReq } from "@/api/Api"
import { ConstsInterfaceType, ConstsModelProvider } from "@/api/Api"
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
import { getModelUrlDescription, modelProviderList } from "@/utils/common"

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
  const [apiToken, setApiToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [modelList, setModelList] = useState<DomainProviderModelListItem[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (model && open) {
      setApiToken(model.api_key || "")
      setBaseUrl(model.base_url || "https://model-square.app.baizhi.cloud/v1")
      setSelectedModel(model.model || "")
      setInterfaceType(model.interface_type || ConstsInterfaceType.InterfaceTypeOpenAIChat)
      setModelList([])
    }
  }, [model, open])

  const fetchModelList = async () => {
    if (!apiToken.trim()) {
      toast.error("请先输入 API Token")
      return
    }

    if (modelProviderList[baseUrl.trim()]) {
      setModelList(modelProviderList[baseUrl.trim()])
      return
    }

    setLoadingModels(true)
    const provider = (model?.provider as ConstsModelProvider | undefined) ?? ConstsModelProvider.ModelProviderBaiZhiCloud
    await apiRequest('getProviderModelList',  {
      api_key: apiToken.trim(),
      base_url: baseUrl.trim() || model?.base_url || "https://model-square.app.baizhi.cloud/v1",
      provider,
    }, [], (resp) => {
      if (resp.code === 0) {
        const models = resp.data?.models || []
        setModelList(models)
        if (models.length === 0) {
          toast.warning("未获取到可用模型")
        } else {
          toast.success(`获取到 ${models.length} 个可用模型`)
        }
      } else {
        toast.error("获取模型列表失败: " + resp.message)
        setModelList([])
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
    const provider = (model.provider as ConstsModelProvider | undefined) ?? ConstsModelProvider.ModelProviderBaiZhiCloud
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
          // 健康检查通过，继续保存
          const requestData: DomainUpdateModelReq = {
            api_key: apiToken.trim(),
            model: selectedModel.trim(),
            base_url: baseUrl.trim(),
            interface_type: interfaceType,
          }

          // 如果 provider 存在，也一起更新
          if (model.provider) {
            requestData.provider = model.provider
          }

          await apiRequest('v1UsersModelsUpdate', requestData, [model.id!], (resp) => {
            if (resp.code === 0) {
              toast.success("模型修改成功")
              setApiToken("")
              setBaseUrl("")
              setSelectedModel("")
              setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
              setModelList([])
              onOpenChange(false)
              onRefresh?.()
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
    setModelList([])
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
                onChange={(e) => setBaseUrl(e.target.value)}
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
                onChange={(e) => setApiToken(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>模型名称</FieldLabel>
            <FieldContent>
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

