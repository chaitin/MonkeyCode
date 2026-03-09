import { useState, useEffect, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import Icon from "@/components/common/Icon"
import { ConstsHostStatus } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { getOSFromImageName, getImageShortName, getBrandFromModelName, getGitPlatformIcon, getOwnerTypeBadge, getHostBadges, selectModel, selectImage, selectHost, getModelHealthBadge, getInterfaceTypeBadge } from "@/utils/common"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { IconCoinYen } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"

interface VmAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export default function VmAddDialog({
  open,
  onOpenChange,
  onSuccess,
}: VmAddDialogProps) {
  const [vmName, setVmName] = useState("")
  const [selectedHostId, setSelectedHostId] = useState<string>("")
  const [selectedImageId, setSelectedImageId] = useState<string>("")
  const [selectedModelId, setSelectedModelId] = useState<string>("")
  const [life, setLife] = useState<string>("")
  const [cpu, setCpu] = useState<string>("")
  const [memory, setMemory] = useState<string>("")
  const [repoBranch, setRepoBranch] = useState<string>("")
  const [repoUrl, setRepoUrl] = useState<string>("")
  const [selectedIdentityId, setSelectedIdentityId] = useState<string>("")

  // 数据列表
  const [loading, setLoading] = useState(false)

  // 过期时间选项
  const baseLifeOptions = [
    { label: "1 小时后回收", value: "1h", seconds: 60 * 60 },
    { label: "2 小时后回收", value: "2h", seconds: 2 * 60 * 60 },
    { label: "3 小时后回收", value: "3h", seconds: 3 * 60 * 60 },
    { label: "6 小时后回收", value: "6h", seconds: 6 * 60 * 60 },
    { label: "12 小时后回收", value: "12h", seconds: 12 * 60 * 60 },
    { label: "1 天后回收", value: "1d", seconds: 24 * 60 * 60 },
    { label: "3 天后回收", value: "3d", seconds: 3 * 24 * 60 * 60 },
    { label: "7 天后回收", value: "7d", seconds: 7 * 24 * 60 * 60 },
  ];

  // 公共宿主机不让选择超过 3 小时的时间
  const lifeOptions = useMemo(() => {
    if (selectedHostId === "public_host") {
      return baseLifeOptions.filter(option => option.seconds <= 3 * 60 * 60);
    }
    return baseLifeOptions;
  }, [selectedHostId]);
  const { models, images, identities, hosts } = useCommonData();

  const cpuOptions = useMemo(() => {
    let maxCpu = 0
    if (!selectedHostId) {
      maxCpu = 0
    } else if (selectedHostId === "public_host") {
      maxCpu = 8
    } else {
      const host = hosts.find(host => host.id === selectedHostId)
      maxCpu = host?.cores || 0
    }
    return Array.from({ length: maxCpu }, (_, i) => ({
      label: `${i + 1} 核`,
      value: `${i + 1}`,
      cores: i + 1,
    }))
  }, [selectedHostId])
  
  const memoryOptions = useMemo(() => {
    let maxMemory = 0
    if (!selectedHostId) {
      maxMemory = 0
    } else if (selectedHostId === "public_host") {
      maxMemory = 32
    } else {
      const host = hosts.find(host => host.id === selectedHostId)
      maxMemory = Math.floor((host?.memory || 0) / 1024 / 1024 / 1024)
    }
    return Array.from({ length: maxMemory }, (_, i) => ({
      label: `${i + 1} GB`,
      value: `${i + 1}`,
      memoryMB: (i + 1) * 1024 * 1024 * 1024, // 转换为 MB
    }))
  }, [selectedHostId])

  useEffect(() => {
    if (open) {      
      setSelectedHostId(selectHost(hosts, true));
      setSelectedImageId(selectImage(images, true));
      setSelectedModelId(selectModel(models, true));

      setCpu("1")
      setMemory("2")
      setLife("1h")
    }
  }, [open])

  const handleCreate = async () => {
    // 验证必填项
    if (!vmName.trim()) {
      toast.error("请输入开发环境名称")
      return
    }
    if (!selectedHostId) {
      toast.error("请选择宿主机")
      return
    }
    if (!selectedImageId) {
      toast.error("请选择操作系统镜像")
      return
    }
    if (!repoUrl.trim()) {
      toast.error("请输入仓库地址")
      return
    }
    if (!selectedModelId) {
      toast.error("请选择 AI 大模型")
      return
    }

    // 构建请求参数
    const requestData: any = {
      git_identity_id: selectedIdentityId || undefined,
      host_id: selectedHostId,
      image_id: selectedImageId,
      install_coding_agents: false,
      model_id: selectedModelId,
      name: vmName.trim(),
      repo: {
        repo_url: repoUrl,
        branch: repoBranch || undefined,
      }
    }
    if (life) {
      const selectedOption = lifeOptions.find(opt => opt.value === life)
      if (selectedOption) {
        requestData.life = selectedOption.seconds
      }
    }
    if (cpu || memory) {
      requestData.resource = {}
      if (cpu) {
        const selectedCpuOption = cpuOptions.find(opt => opt.value === cpu)
        if (selectedCpuOption) {
          requestData.resource.cpu = selectedCpuOption.cores
        }
      }
      if (memory) {
        const selectedMemoryOption = memoryOptions.find(opt => opt.value === memory)
        if (selectedMemoryOption) {
          requestData.resource.memory = selectedMemoryOption.memoryMB
        }
      }
      // 如果 resource 对象为空，则不添加
      if (Object.keys(requestData.resource).length === 0) {
        delete requestData.resource
      }
    }

    setLoading(true)
    await apiRequest('v1UsersHostsVmsCreate', requestData, [], (resp) => {
      if (resp.code === 0) {
        toast.success("开发环境创建成功")
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error("开发环境创建失败: " + resp.message);
      }
    })
    setLoading(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>创建开发环境</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-4">
            <Field className="col-span-2">
              <FieldLabel>宿主机</FieldLabel>
              <FieldContent>
                <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择宿主机" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={"public_host"}>
                      <div className="flex items-center gap-2">
                        <span>MonkeyCode</span>
                        <Badge variant="outline">平台内置</Badge>
                      </div>
                    </SelectItem>
                    {hosts.map((host) => {
                      return (
                        <SelectItem key={host.id} value={host.id!} disabled={host.status !== ConstsHostStatus.HostStatusOnline}>
                          <div className="flex items-center gap-2">
                            <span>{host.remark || `${host.name}-${host.external_ip}`}</span>
                            {getHostBadges(host)}
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>开发环境名称</FieldLabel>
              <FieldContent>
                <Input
                  value={vmName}
                  onChange={(e) => setVmName(e.target.value)}
                />
              </FieldContent>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field className="col-span-2">
              <FieldLabel>仓库地址</FieldLabel>
              <FieldContent>
                <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/chaitin/monkeycode" />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>仓库分支</FieldLabel>
              <FieldContent>
                <Input value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder="不填则为主分支" />
              </FieldContent>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel>仓库身份凭证</FieldLabel>
              <FieldContent>
                <Select value={selectedIdentityId} onValueChange={setSelectedIdentityId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择仓库身份凭证" />
                  </SelectTrigger>
                  <SelectContent>
                    {identities.map((identity) => (
                      <SelectItem key={identity.id} value={identity.id || ""}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 w-full">
                              {getGitPlatformIcon(identity.platform || '')}
                              <span>{identity.remark || identity.username}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            13
                          </TooltipContent>
                        </Tooltip>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>系统镜像</FieldLabel>
              <FieldContent>
                <Select value={selectedImageId} onValueChange={setSelectedImageId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {images.filter(image => image.id).map((image) => (
                      <SelectItem key={image.id} value={image.id!}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Icon name={getOSFromImageName(image.name || '')} className="h-4 w-4" />
                              <span>{image.remark || getImageShortName(image.name || '')}</span>
                              {image.is_default && <Badge>默认</Badge>}
                              {getOwnerTypeBadge(image.owner)}
                            </div>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {image.name}
                            </TooltipContent>
                          </Tooltip>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel>AI 大模型</FieldLabel>
              <FieldContent>
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>

                    <SelectItem value={"premium"}>
                      <div className="flex items-center gap-2">
                        <IconCoinYen className="text-primary" />
                        <span>强力模型</span>
                        <Badge variant="outline">
                          付费
                        </Badge>
                        <Badge variant="outline">平台内置</Badge>
                      </div>
                    </SelectItem>
                    {models.filter(model => model.id).map((model) => (
                      <SelectItem key={model.id} value={model.id!}>
                        <div className="flex items-center gap-2">
                          <Icon name={getBrandFromModelName(model.model || '')} className="size-4" />
                          {getModelHealthBadge(model)}
                          <span>{model.model || '未知模型'}</span>
                          {model.is_default && <Badge>默认</Badge>}
                          {getOwnerTypeBadge(model.owner)}
                          {getInterfaceTypeBadge(model.interface_type)}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
            
          </div>

          <Field>
            <FieldLabel>开发机资源</FieldLabel>
            <div className="grid grid-cols-3 gap-4">
              <FieldContent>
                <Select value={cpu} onValueChange={setCpu} disabled={!selectedHostId || cpuOptions.length === 0}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cpuOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
              <FieldContent>
                <Select value={memory} onValueChange={setMemory} disabled={!selectedHostId || memoryOptions.length === 0}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {memoryOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
              <FieldContent>
                <Select value={life} onValueChange={setLife}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lifeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </div>
          </Field>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading && <Spinner className="mr-2 h-4 w-4" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

