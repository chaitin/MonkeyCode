import { Api, ConstsPortStatus, type DomainVMPort, type GithubComGoYokoWebResp } from "@/api/Api"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemTitle, ItemGroup, ItemActions, ItemDescription } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { apiRequest } from "@/utils/requestUtils"
import { IconAccessPoint, IconAlertCircle, IconCopy, IconDotsVertical, IconHandStop, IconReload, IconTrash } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface VmPortForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostId: string | undefined
  vmId: string | undefined
  onSuccess?: () => void
}

export function VmPortForwardDialog({
  open,
  onOpenChange,
  hostId,
  vmId,
  onSuccess,
}: VmPortForwardDialogProps) {
  const { t } = useTranslation()
  const [ports, setPorts] = useState<DomainVMPort[] | undefined>(undefined)
  const [portsLoading, setPortsLoading] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [portToDelete, setPortToDelete] = useState<DomainVMPort | null>(null)
  const [portToOpen, setPortToOpen] = useState<number>(0)
  const [portToClose, setPortToClose] = useState<number>(0)
  const [whitelistDialogOpen, setWhitelistDialogOpen] = useState(false)
  const [portToEditWhitelist, setPortToEditWhitelist] = useState<DomainVMPort | null>(null)
  const [whitelistInput, setWhitelistInput] = useState("")
  const [whitelistSaving, setWhitelistSaving] = useState(false)

  const fetchPorts = useCallback(async () => {
    if (!hostId || !vmId) {
      setPorts(undefined)
      return
    }

    setPortsLoading(true)
    try {
      const api = new Api()
      const response = await api.api.v1UsersHostsVmsPortsDetail(
        hostId,
        vmId,
        undefined as unknown as never,
      )
      const resp = response.data as GithubComGoYokoWebResp & { data?: DomainVMPort[] }

      if (resp.code === 0) {
        setPorts(resp.data || [])
      } else {
        toast.error(resp.message || t("consoleVm.port.fetchFailed"))
      }
    } catch (error) {
      toast.error((error as Error)?.message || t("consoleVm.port.fetchFailed"))
    } finally {
      setPortsLoading(false)
    }
  }, [hostId, t, vmId])

  useEffect(() => {
    if (!open) {
      return
    }
    void fetchPorts()
  }, [fetchPorts, open])

  const confirmDeletePort = () => {
    if (!hostId || !vmId || !portToDelete) {
      setDeleteDialogOpen(false)
      return
    }

    setPortToClose(portToDelete.port as number)
    setDeleteDialogOpen(false)

    apiRequest('v1UsersHostsVmsPortsDelete', {
      forward_id: portToDelete.forward_id
    }, [hostId, vmId, String(portToDelete.port)], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleVm.port.closed"))
        void fetchPorts()
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleVm.port.closeFailed"))
      }
      setPortToClose(0)
    })
  }

  const getMyIP = async (): Promise<string | null> => {
    try {
      const resp = await fetch('https://monkeycode-ai.online/get-my-ip', {
        method: 'GET',
        mode: 'cors',
      })
      if (!resp.ok) {
        throw new Error()
      }
      const data = await resp.json()
      return data.ip
    } catch {
      return null
    }
  }

  const handleOpenPort = async (port: number, forwardId: string) => {
    if (!hostId || !vmId || !port) {
      return
    }

    setPortToOpen(port)

    const ip = await getMyIP()
    if (!ip) {
      toast.error(t("consoleVm.port.getIpFailed"))
      setPortToOpen(0)
      return
    } 

    
    await apiRequest('v1UsersHostsVmsPortsCreate', {
      forward_id: forwardId,
      port: port,
      white_list: [ip]
    }, [hostId, vmId], (resp: GithubComGoYokoWebResp) => {
      if (resp.code === 0 && resp.data?.success) {
        toast.success(t("consoleVm.port.opened"))
        void fetchPorts()
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleVm.port.openFailed"))
      }
    })

    setPortToOpen(0)
  }

  const handleOpenWhitelistDialog = (port: DomainVMPort) => {
    setPortToEditWhitelist(port)
    setWhitelistInput(port.white_list?.join('\n') || '')
    setWhitelistDialogOpen(true)
  }

  const handleSaveWhitelist = async () => {
    if (!hostId || !vmId || !portToEditWhitelist) {
      return
    }

    const whitelistArray = whitelistInput
      .split('\n')
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0)

    if (whitelistArray.length === 0) {
      toast.error(t("consoleVm.port.whitelistRequired"))
      return
    }

    setWhitelistSaving(true)
    await apiRequest('v1UsersHostsVmsPortsCreate', {
      forward_id: portToEditWhitelist.forward_id,
      port: portToEditWhitelist.port,
      white_list: whitelistArray
    }, [hostId, vmId], (resp: GithubComGoYokoWebResp) => {
      if (resp.code === 0) {
        toast.success(t("consoleVm.port.whitelistUpdated"))
        setWhitelistDialogOpen(false)
        void fetchPorts()
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleVm.port.whitelistUpdateFailed"))
      }
    })
    setWhitelistSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="flex-row items-center gap-3 pr-10">
          <DialogTitle>{t("consoleVm.port.title")}</DialogTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={t("consoleVm.port.refresh")}
                onClick={() => void fetchPorts()}
                disabled={portsLoading || !hostId || !vmId}
              >
                {portsLoading ? <Spinner className="size-3.5" /> : <IconReload className="size-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("consoleVm.port.refresh")}</TooltipContent>
          </Tooltip>
        </DialogHeader>
        <ItemGroup className="gap-3">
          {portsLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Spinner className="mr-2" />
              {t("consoleVm.port.loading")}
            </div>
          ) : null}
          {(!portsLoading && ports && ports.length > 0) ? ports.map((port: DomainVMPort) => (
            <Item variant="outline" size="sm" key={port.port?.toString()} className="group hover:border-primary/50">
              <ItemContent>
                <ItemTitle>
                  <span
                    className="group-hover:text-primary hover:underline cursor-pointer"
                    onClick={() => {
                      if (port.status === ConstsPortStatus.PortStatusConnected) {
                        window.open(port.preview_url, '_blank')
                      } else {
                        toast.error(t("consoleVm.port.notOpen"))
                      }
                    }}
                  >
                    {port.port}
                  </span>
                  {port.error_message && <Tooltip>
                    <TooltipTrigger asChild>
                      <IconAlertCircle className="size-4" />
                    </TooltipTrigger>
                    <TooltipContent>
                      {port.error_message}
                    </TooltipContent>
                  </Tooltip>}
                  {port.status === ConstsPortStatus.PortStatusConnected && <Badge variant="secondary">http</Badge>}
                </ItemTitle>
                <ItemDescription>
                  {port.status === ConstsPortStatus.PortStatusConnected && port.white_list && port.white_list.length > 0
                    ? t("consoleVm.port.allowedList", { ips: port.white_list?.join(', ') })
                    : t("consoleVm.port.notOpenAccess")}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {port.status === ConstsPortStatus.PortStatusReversed && (
                  <Button size="sm" variant="secondary" onClick={() => handleOpenPort(port.port as number, port.forward_id as string)}>
                    {portToOpen === port.port && <Spinner />}
                    {t("consoleVm.port.openAccess")}
                  </Button>
                )}
                {port.status === ConstsPortStatus.PortStatusConnected && (
                  <Button size="sm" variant="secondary" onClick={() => window.open(port.preview_url, '_blank')}>
                    {portToClose === port.port && <Spinner />}
                    {t("consoleVm.port.visit")}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost">
                      <IconDotsVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem 
                      disabled={port.status !== ConstsPortStatus.PortStatusConnected}
                      onClick={async () => {
                        if (port.preview_url) {
                          try {
                            await navigator.clipboard.writeText(port.preview_url)
                            toast.success(t("consoleVm.port.copySuccess"))
                          } catch {
                            toast.error(t("consoleVm.port.copyFailed", { url: port.preview_url }))
                          }
                        }
                      }}
                    >
                      <IconCopy />
                      {t("consoleVm.port.copyAddress")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleOpenWhitelistDialog(port)} disabled={port.status !== ConstsPortStatus.PortStatusConnected}>
                      <IconHandStop />
                      {t("consoleVm.port.whitelistIp")}
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={port.status !== ConstsPortStatus.PortStatusConnected} onClick={() => {
                      setPortToDelete(port)
                      setDeleteDialogOpen(true)
                    }}>
                      <IconTrash />
                      {t("consoleVm.port.closeAccess")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          )) : null}

          {!portsLoading && (!ports || ports.length === 0) ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconAccessPoint className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                {t("consoleVm.port.empty")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          ) : null}
        </ItemGroup>
      </DialogContent>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleVm.port.recycleTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleVm.port.recycleDescription", { port: portToDelete?.port })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false)
            }}>
              {t("consoleVm.common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePort}>
              {t("consoleVm.port.confirmRecycle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={whitelistDialogOpen} onOpenChange={setWhitelistDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("consoleVm.port.whitelistTitle", { port: portToEditWhitelist?.port })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {t("consoleVm.port.whitelistDescription")}
            </div>
            <textarea
              className="w-full h-32 p-3 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              placeholder={t("consoleVm.port.whitelistPlaceholder")}
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWhitelistDialogOpen(false)}>
                {t("consoleVm.common.cancel")}
              </Button>
              <Button onClick={handleSaveWhitelist} disabled={whitelistSaving}>
                {whitelistSaving && <Spinner />}
                {t("consoleVm.common.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
