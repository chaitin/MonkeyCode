import { ConstsPortStatus, type DomainVMPort, type WebResp } from "@/api/Api"
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
import { IconAccessPoint, IconAlertCircle, IconCopy, IconDotsVertical, IconHandStop, IconTrash } from "@tabler/icons-react"
import { useState } from "react"
import { toast } from "sonner"

interface VmPortForwardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ports: DomainVMPort[] | undefined
  hostId: string | undefined
  vmId: string | undefined
  onSuccess?: () => void
}

export function VmPortForwardDialog({
  open,
  onOpenChange,
  ports,
  hostId,
  vmId,
  onSuccess,
}: VmPortForwardDialogProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [portToDelete, setPortToDelete] = useState<DomainVMPort | null>(null)
  const [portToOpen, setPortToOpen] = useState<number>(0)
  const [portToClose, setPortToClose] = useState<number>(0)
  const [whitelistDialogOpen, setWhitelistDialogOpen] = useState(false)
  const [portToEditWhitelist, setPortToEditWhitelist] = useState<DomainVMPort | null>(null)
  const [whitelistInput, setWhitelistInput] = useState("")
  const [whitelistSaving, setWhitelistSaving] = useState(false)

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
        toast.success("端口已关闭访问")
        onSuccess?.()
      } else {
        toast.error(resp.message || "关闭访问失败")
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
    } catch (e) {
      return null
    }
  }

  const handleOpenPort = async (port: number, forwardId: string) => {
    if (!hostId || !vmId || !port) {
      return
    }

    setPortToOpen(port)

    let ip = await getMyIP()
    if (!ip) {
      toast.error("获取本机 IP 失败")
      setPortToOpen(0)
      return
    } 

    
    await apiRequest('v1UsersHostsVmsPortsCreate', {
      forward_id: forwardId,
      port: port,
      white_list: [ip]
    }, [hostId, vmId], (resp: WebResp) => {
      if (resp.code === 0 && resp.data?.success) {
        toast.success("端口开放成功")
        onSuccess?.()
      } else {
        toast.error(resp.message || "端口开放失败")
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
      toast.error("请至少输入一个 IP 地址")
      return
    }

    setWhitelistSaving(true)
    await apiRequest('v1UsersHostsVmsPortsCreate', {
      forward_id: portToEditWhitelist.forward_id,
      port: portToEditWhitelist.port,
      white_list: whitelistArray
    }, [hostId, vmId], (resp: WebResp) => {
      if (resp.code === 0) {
        toast.success("白名单更新成功")
        setWhitelistDialogOpen(false)
        onSuccess?.()
      } else {
        toast.error(resp.message || "白名单更新失败")
      }
    })
    setWhitelistSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>端口管理</DialogTitle>
        </DialogHeader>
        <ItemGroup className="gap-3">
          {(ports && ports.length > 0) ? ports?.map((port: DomainVMPort) => (
            <Item variant="outline" size="sm" key={port.port?.toString()} className="group hover:border-primary/50">
              <ItemContent>
                <ItemTitle>
                  <span
                    className="group-hover:text-primary hover:underline cursor-pointer"
                    onClick={() => {
                      if (port.status === ConstsPortStatus.PortStatusConnected) {
                        window.open(port.preview_url, '_blank')
                      } else {
                        toast.error('端口未开放')
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
                  {port.status === ConstsPortStatus.PortStatusConnected && port.white_list && port.white_list.length > 0 ? `允许 ${port.white_list?.join(', ')} 访问` : '未开放访问'}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {port.status === ConstsPortStatus.PortStatusReversed && (
                  <Button size="sm" variant="secondary" onClick={() => handleOpenPort(port.port as number, port.forward_id as string)}>
                    {portToOpen === port.port && <Spinner />}
                    开放访问
                  </Button>
                )}
                {port.status === ConstsPortStatus.PortStatusConnected && (
                  <Button size="sm" variant="secondary" onClick={() => window.open(port.preview_url, '_blank')}>
                    {portToClose === port.port && <Spinner />}
                    访问
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
                            toast.success("访问地址已复制到剪贴板")
                          } catch {
                            toast.error(`复制失败，请手动复制：${port.preview_url}`)
                          }
                        }
                      }}
                    >
                      <IconCopy />
                      复制地址
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleOpenWhitelistDialog(port)} disabled={port.status !== ConstsPortStatus.PortStatusConnected}>
                      <IconHandStop />
                      白名单 IP
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={port.status !== ConstsPortStatus.PortStatusConnected} onClick={() => {
                      setPortToDelete(port)
                      setDeleteDialogOpen(true)
                    }}>
                      <IconTrash />
                      关闭访问
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          )) : (

          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconAccessPoint className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                开发环境中没有发现正在监听的端口
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          )}
        </ItemGroup>
      </DialogContent>
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认回收</AlertDialogTitle>
            <AlertDialogDescription>
              确定要回收端口 "{portToDelete?.port}" 吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false)
            }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePort}>
              确认回收
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={whitelistDialogOpen} onOpenChange={setWhitelistDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑白名单 IP - 端口 {portToEditWhitelist?.port}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              每行输入一个 IP 地址，只有白名单中的 IP 才能访问此端口。
            </div>
            <textarea
              className="w-full h-32 p-3 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary bg-background"
              placeholder="例如：&#10;192.168.1.1&#10;10.0.0.1"
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWhitelistDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleSaveWhitelist} disabled={whitelistSaving}>
                {whitelistSaving && <Spinner />}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

