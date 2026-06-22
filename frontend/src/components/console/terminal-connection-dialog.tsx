import type { DomainTerminal } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { apiRequest } from "@/utils/requestUtils"
import { IconCirclePlus, IconReload, IconX } from "@tabler/icons-react"
import { useCallback, useEffect, useState } from "react"
import dayjs from "dayjs"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
  const [connections, setConnections] = useState<DomainTerminal[]>([])

  const fetchConnections = useCallback(async () => {
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsTerminalsDetail', {}, [envid], (resp) => {
      if (resp.code === 0) {
        const connections = resp.data || []
        connections.sort((a: DomainTerminal, b: DomainTerminal) => {
          return (b.created_at || 0) - (a.created_at || 0)
        })
        setConnections(connections)
      } else {
        toast.error(t("consoleVm.connection.fetchFailed", { message: resp.message }));
      }
    })
  }, [envid, t])

  const handleDeleteTerminal = async (terminalId: string) => {
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsTerminalsDelete', {}, [envid, terminalId], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleVm.connection.closed"))
        fetchConnections()
      } else {
        toast.error(t("consoleVm.connection.closeFailed", { message: resp.message }));
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
  }, [envid, fetchConnections, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-2xl" 
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("consoleVm.connection.title")}</DialogTitle>
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
                    {connection.created_at && <Badge variant="secondary">{t("consoleVm.connection.createdAgo", { time: dayjs.unix(connection.created_at).fromNow() })}</Badge>}
                    <Badge variant="secondary">{t("consoleVm.connection.connectionCount", { count: connection.connected_count })}</Badge>
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button variant="ghost" size="sm" onClick={() => handleConnect(connection.id || '')}>
                    <IconReload />
                    {t("consoleVm.connection.connect")}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <IconX />
                        {t("consoleVm.connection.close")}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("consoleVm.connection.closeTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("consoleVm.connection.closeDescription", { id: connection.id })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("consoleVm.common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDeleteTerminal(connection.id || '')
                          }}
                        >
                          {t("consoleVm.connection.confirmClose")}
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
            {t("consoleVm.connection.newConnection")}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
