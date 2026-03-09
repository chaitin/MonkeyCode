import { useState } from "react"
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
import type { DomainProviderModelListItem } from "@/api/Api"
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
import { Spinner } from "@/components/ui/spinner"
import { CircleQuestionMark } from 'lucide-react'
import { getModelUrlDescription, modelProviderList } from "@/utils/common"

interface AddModelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddModel({
  open,
  onOpenChange,
  onRefresh,
}: AddModelProps) {
  const [model, setModel] = useState("")
  const [apiToken, setApiToken] = useState("")
  const [baseUrl, setBaseUrl] = useState("https://model-square.app.baizhi.cloud/v1")
  const [interfaceType, setInterfaceType] = useState<ConstsInterfaceType>(ConstsInterfaceType.InterfaceTypeOpenAIChat)
  const [modelList, setModelList] = useState<DomainProviderModelListItem[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [saving, setSaving] = useState(false)

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
    await apiRequest('getProviderModelList', {
        api_key: apiToken.trim(),
        base_url: baseUrl.trim() || "https://model-square.app.baizhi.cloud/v1",
        provider: "BaiZhiCloud",
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
        }
      })
    setLoadingModels(false)
  }

  const handleSave = async () => {
    if (!apiToken.trim()) {
      toast.error("请输入 API Token")
      return
    }
    if (!model.trim()) {
      toast.error("请选择模型名称")
      return
    }
    if (!baseUrl.trim()) {
      toast.error("请输入模型 API 地址")
      return
    }

    setSaving(true)

    // 先进行健康检查
    const healthCheckData = {
      api_key: apiToken.trim(),
      model: model.trim(),
      base_url: baseUrl.trim(),
      interface_type: interfaceType,
      provider: "BaiZhiCloud",
    }

    await apiRequest('v1UsersModelsHealthCheckCreate', healthCheckData, [], async (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          // 健康检查通过，继续保存
          const requestData: any = {
            provider: "BaiZhiCloud",
            model: model.trim(),
            base_url: baseUrl.trim(),
            api_key: apiToken.trim(),
            interface_type: interfaceType,
          }

          await apiRequest('v1UsersModelsCreate', requestData, [], (resp) => {
            if (resp.code === 0) {
              toast.success("模型绑定成功")
              setModel("")
              setApiToken("")
              setBaseUrl("https://model-square.app.baizhi.cloud/v1")
              setInterfaceType(ConstsInterfaceType.InterfaceTypeOpenAIChat)
              setModelList([])
              onOpenChange(false)
              onRefresh?.()
            } else {
              toast.error("绑定模型失败: " + resp.message)
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
    setModel("")
    setApiToken("")
    setBaseUrl("https://model-square.app.baizhi.cloud/v1")
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
      <DialogTrigger asChild>
        <Button variant={"outline"} size="sm">绑定</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定 AI 大模型</DialogTitle>
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
            <FieldDescription>{getModelUrlDescription(baseUrl, interfaceType)}</FieldDescription>
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
                  <CircleQuestionMark />如何获得
                </a>
              </Button>
            </div>
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
                  <SelectValue placeholder={loadingModels ? "加载中..." : "请选择模型"} />
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
                  })() : (
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
          <Button onClick={handleSave} disabled={!model.trim() || saving}>
            {saving && <Spinner className="size-4" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

