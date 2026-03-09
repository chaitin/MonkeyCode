import type { DomainTerminal } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { apiRequest } from "@/utils/requestUtils"
import { IconCirclePlus, IconReload, IconX } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import dayjs from "dayjs"
import { toast } from "sonner"

interface TerminalConnectionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  envid: string
  onConnectionSelected: (connectionId: string) => void
  onNewConnection: () => void
}

export default function TerminalConnectionDialog({
  open,
  onOpenChange,
  envid,
  onConnectionSelected,
  onNewConnection,
}: TerminalConnectionDialogProps) {
  const [connections, setConnections] = useState<DomainTerminal[]>([])

  const fetchConnections = async () => {
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsTerminalsDetail', {}, [envid], (resp) => {
      if (resp.code === 0) {
        const connections = resp.data || []
        // 根据 created_at 降序排序（最新的在前）
        connections.sort((a: DomainTerminal, b: DomainTerminal) => {
          return (b.created_at || 0) - (a.created_at || 0)
        })
        setConnections(connections)
      } else {
        toast.error("获取终端连接失败: " + resp.message);
      }
    })
  }

  const handleDeleteTerminal = async (terminalId: string) => {
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsTerminalsDelete', {}, [envid, terminalId], (resp) => {
      if (resp.code === 0) {
        toast.success("终端连接已关闭")
        fetchConnections()
      } else {
        toast.error("关闭终端连接失败: " + resp.message);
      }
    })
  }

  const handleConnect = (connectionId: string) => {
    onConnectionSelected(connectionId)
    onOpenChange(false)
  }

  const handleCreateNew = () => {
    onNewConnection()
    onOpenChange(false)
  }

  useEffect(() => {
    if (open && envid) {
      fetchConnections()
    }
  }, [open, envid])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-2xl" 
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>选择终端连接</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
          <ItemGroup className="gap-2">
            {connections.map((connection) => (
              <Item variant="outline" size="sm" key={connection.id}>
                <ItemContent>
                  <ItemTitle>
                    {connection.id?.slice(0, 18)}
                  </ItemTitle>
                  <ItemDescription className="flex items-center gap-2">
                    {connection.created_at && <Badge variant="secondary">{dayjs.unix(connection.created_at).fromNow()}创建</Badge>}
                    <Badge variant="secondary">{connection.connected_count} 个连接</Badge>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" onClick={() => handleConnect(connection.id || '')}>
                    <IconReload />
                    连接
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <IconX />
                        关闭
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认关闭</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要关闭终端连接 "{connection.id}" 吗？此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDeleteTerminal(connection.id || '')
                          }}
                        >
                          确认关闭
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </div>
        <Button variant="outline" className="w-full" onClick={handleCreateNew}>
            <IconCirclePlus />
            新建连接
        </Button>
      </DialogContent>
    </Dialog>
  )
}

