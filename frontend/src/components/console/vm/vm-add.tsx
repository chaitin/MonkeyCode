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
import { ConstsHostStatus, type DomainCreateVMReq } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { canManageDevEnvironment, getOSFromImageName, getImageShortName, getBrandFromModel, getGitPlatformIcon, getModelDisplayNameForModel, getOwnerTypeBadge, getHostBadges, selectImage, selectHost, selectPreferredTaskModel, getInterfaceTypeBadge } from "@/utils/common"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { useCommonData } from "../data-provider"
import { useTranslation } from "react-i18next"

interface VmAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

const BASE_LIFE_OPTIONS = [
  { value: "1h", seconds: 60 * 60 },
  { value: "2h", seconds: 2 * 60 * 60 },
  { value: "3h", seconds: 3 * 60 * 60 },
  { value: "6h", seconds: 6 * 60 * 60 },
  { value: "12h", seconds: 12 * 60 * 60 },
  { value: "1d", seconds: 24 * 60 * 60 },
  { value: "3d", seconds: 3 * 24 * 60 * 60 },
  { value: "7d", seconds: 7 * 24 * 60 * 60 },
]

export default function VmAddDialog({
  open,
  onOpenChange,
  onSuccess,
}: VmAddDialogProps) {
  const { t } = useTranslation()
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

  const [loading, setLoading] = useState(false)

  // Public hosts cannot select a lifetime longer than 3 hours.
  const lifeOptions = useMemo(() => {
    if (selectedHostId === "public_host") {
      return BASE_LIFE_OPTIONS.filter(option => option.seconds <= 3 * 60 * 60);
    }
    return BASE_LIFE_OPTIONS;
  }, [selectedHostId]);
  const { models, images, identities, hosts, subscription, user } = useCommonData();
  const canCreateVm = canManageDevEnvironment(user)

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
      value: `${i + 1}`,
      cores: i + 1,
    }))
  }, [hosts, selectedHostId])
  
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
      value: `${i + 1}`,
      memoryMB: (i + 1) * 1024 * 1024 * 1024,
    }))
  }, [hosts, selectedHostId])

  useEffect(() => {
    if (!open) return

    setSelectedHostId(selectHost(hosts, true))
    setSelectedImageId(selectImage(images, true))
    setSelectedModelId(selectPreferredTaskModel(models, subscription))
    setCpu("1")
    setMemory("2")
    setLife("1h")
  }, [open])

  useEffect(() => {
    if (!open) return

    const hostIsValid = selectedHostId === "public_host"
      || hosts.some((host) => host.id === selectedHostId && host.status === ConstsHostStatus.HostStatusOnline)

    if (!hostIsValid) {
      setSelectedHostId(selectHost(hosts, true))
    }
  }, [hosts, open, selectedHostId])

  useEffect(() => {
    if (!open) return

    const imageIsValid = images.some((image) => image.id === selectedImageId)
    if (!imageIsValid) {
      setSelectedImageId(selectImage(images, true))
    }
  }, [images, open, selectedImageId])

  useEffect(() => {
    if (!open) return

    const modelIsValid = models.some((model) => model.id === selectedModelId)
    if (!modelIsValid) {
      setSelectedModelId(selectPreferredTaskModel(models, subscription))
    }
  }, [models, open, selectedModelId, subscription])

  useEffect(() => {
    if (!open) return

    if (cpuOptions.some((option) => option.value === cpu)) return
    setCpu(cpuOptions[0]?.value || "")
  }, [cpu, cpuOptions, open])

  useEffect(() => {
    if (!open) return

    if (memoryOptions.some((option) => option.value === memory)) return
    setMemory(memoryOptions[0]?.value || "")
  }, [memory, memoryOptions, open])

  useEffect(() => {
    if (!open) return

    if (lifeOptions.some((option) => option.value === life)) return
    setLife(lifeOptions[0]?.value || "")
  }, [life, lifeOptions, open])

  const handleCreate = async () => {
    if (!canCreateVm) {
      toast.error(t("consoleSettings.vms.add.toast.teamOnly"))
      onOpenChange(false)
      return
    }

    if (!vmName.trim()) {
      toast.error(t("consoleSettings.vms.add.toast.nameRequired"))
      return
    }
    if (!selectedHostId) {
      toast.error(t("consoleSettings.vms.add.toast.hostRequired"))
      return
    }
    if (!selectedImageId) {
      toast.error(t("consoleSettings.vms.add.toast.imageRequired"))
      return
    }
    if (!repoUrl.trim()) {
      toast.error(t("consoleSettings.vms.add.toast.repoRequired"))
      return
    }
    if (!selectedModelId) {
      toast.error(t("consoleSettings.vms.add.toast.modelRequired"))
      return
    }

    const selectedCpuOption = cpuOptions.find(opt => opt.value === cpu)
    if (!selectedCpuOption) {
      toast.error(t("consoleSettings.vms.add.toast.cpuRequired"))
      return
    }

    const selectedMemoryOption = memoryOptions.find(opt => opt.value === memory)
    if (!selectedMemoryOption) {
      toast.error(t("consoleSettings.vms.add.toast.memoryRequired"))
      return
    }

    const requestData: DomainCreateVMReq = {
      git_identity_id: selectedIdentityId || undefined,
      host_id: selectedHostId,
      image_id: selectedImageId,
      install_coding_agents: false,
      model_id: selectedModelId,
      name: vmName.trim(),
      repo: {
        repo_url: repoUrl,
        branch: repoBranch || undefined,
      },
      resource: {
        cpu: selectedCpuOption.cores,
        memory: selectedMemoryOption.memoryMB,
      },
    }
    if (life) {
      const selectedOption = lifeOptions.find(opt => opt.value === life)
      if (selectedOption) {
        requestData.life = selectedOption.seconds
      }
    }

    setLoading(true)
    await apiRequest('v1UsersHostsVmsCreate', requestData, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.vms.add.toast.createSuccess"))
        onOpenChange(false)
        onSuccess?.()
      } else {
        toast.error(t("consoleSettings.vms.add.toast.createFailed", { message: resp.message }));
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
          <DialogTitle>{t("consoleSettings.vms.add.title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-4">
            <Field className="col-span-2">
              <FieldLabel>{t("consoleSettings.vms.add.labels.host")}</FieldLabel>
              <FieldContent>
                <Select value={selectedHostId} onValueChange={setSelectedHostId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleSettings.vms.add.placeholders.host")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={"public_host"}>
                      <div className="flex items-center gap-2">
                        <span>MonkeyCode</span>
                        <Badge variant="outline">{t("consoleSettings.vms.add.platformBuiltIn")}</Badge>
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
              <FieldLabel>{t("consoleSettings.vms.add.labels.name")}</FieldLabel>
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
              <FieldLabel>{t("consoleSettings.vms.add.labels.repoUrl")}</FieldLabel>
              <FieldContent>
                <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/chaitin/monkeycode" />
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("consoleSettings.vms.add.labels.repoBranch")}</FieldLabel>
              <FieldContent>
                <Input value={repoBranch} onChange={(e) => setRepoBranch(e.target.value)} placeholder={t("consoleSettings.vms.add.placeholders.repoBranch")} />
              </FieldContent>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field>
              <FieldLabel>{t("consoleSettings.vms.add.labels.identity")}</FieldLabel>
              <FieldContent>
                <Select value={selectedIdentityId} onValueChange={setSelectedIdentityId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("consoleSettings.vms.add.placeholders.identity")} />
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
                            {identity.username || identity.remark || t("consoleSettings.vms.add.fallback.unnamedIdentity")}
                          </TooltipContent>
                        </Tooltip>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>{t("consoleSettings.vms.add.labels.image")}</FieldLabel>
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
              <FieldLabel>{t("consoleSettings.vms.add.labels.model")}</FieldLabel>
              <FieldContent>
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                    <SelectContent>
                      {models.filter(model => model.id).map((model) => (
                      <SelectItem key={model.id} value={model.id!}>
                        <div className="flex items-center gap-2">
                          <Icon name={getBrandFromModel(model)} className="size-4" />
                          <span>{getModelDisplayNameForModel(model) || t("consoleSettings.vms.add.fallback.unknownModel")}</span>
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
            <FieldLabel>{t("consoleSettings.vms.add.labels.resource")}</FieldLabel>
            <div className="grid grid-cols-3 gap-4">
              <FieldContent>
                <Select value={cpu} onValueChange={setCpu} disabled={!selectedHostId || cpuOptions.length === 0}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cpuOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {t("consoleSettings.vms.add.cpuOption", { count: option.cores })}
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
                        {t("consoleSettings.vms.add.memoryOption", { count: Number(option.value) })}
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
                        {t(`consoleSettings.vms.add.lifeOptions.${option.value}`)}
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
            {t("consoleSettings.vms.actions.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={loading || !canCreateVm}>
            {loading && <Spinner className="mr-2 h-4 w-4" />}
            {t("consoleSettings.vms.add.actions.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
