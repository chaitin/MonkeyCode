import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  HardDrive,
  MoreVertical,
} from "lucide-react"
import { apiRequest } from "@/utils/requestUtils"
import { canManageDevEnvironment, getHostBadges } from "@/utils/common"
import { toast } from "sonner"
import { type DomainHost, ConstsOwnerType, TaskflowVirtualMachineStatus } from "@/api/Api"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IconAlertHexagon, IconPencil, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"
import { useTranslation } from "react-i18next"

export default function Hosts() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<string>("")
  const [loadingCommand, setLoadingCommand] = useState(false)
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<DomainHost | null>(null)
  const [remarkInput, setRemarkInput] = useState("")
  const [remarkLoading, setRemarkLoading] = useState(false)

  const { hosts, reloadHosts, loadingHosts, user } = useCommonData();
  const canManageHosts = canManageDevEnvironment(user)

  const fetchInstallCommand = async () => {
    if (!canManageHosts) {
      toast.error(t("consoleSettings.hosts.toast.teamOnly"))
      setOpen(false)
      return
    }

    setLoadingCommand(true)
    await apiRequest('v1UsersHostsInstallCommandList', {}, [], (resp) => {
      if (resp.code === 0) {
        setCommand(resp.data?.command || "")
      } else {
        toast.error(t("consoleSettings.hosts.toast.installCommandFailed", { message: resp.message }))
      }
    })
    setLoadingCommand(false)
  }

  useEffect(() => {
    if (open) {
      fetchInstallCommand()
    }
  }, [open, canManageHosts])

  const handleCopy = async () => {
    if (!command) return
    
    try {
      await navigator.clipboard.writeText(command)
      toast.success(t("consoleSettings.hosts.toast.commandCopied"))
    } catch (error) {
      toast.error(t("consoleSettings.hosts.toast.copyFailed"))
      console.error("Copy failed:", error)
    }
  }

  const handleDelete = (host: DomainHost) => {
    if (!host.id) {
      toast.error(t("consoleSettings.hosts.toast.incomplete"))
      return
    }

    apiRequest('v1UsersHostsDelete', {}, [host.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.hosts.toast.removeSuccess"))
        reloadHosts()
      } else {
        toast.error(t("consoleSettings.hosts.toast.removeFailed", { message: resp.message }))
      }
    })
  }

  const handleOpenRemarkDialog = (host: DomainHost) => {
    setEditingHost(host)
    setRemarkInput(host.remark || "")
    setRemarkDialogOpen(true)
  }

  const handleUpdateRemark = async () => {
    if (!editingHost?.id) {
      toast.error(t("consoleSettings.hosts.toast.incomplete"))
      return
    }

    setRemarkLoading(true)
    await apiRequest('v1UsersHostsUpdate', { remark: remarkInput }, [editingHost.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.hosts.toast.remarkUpdated"))
        setRemarkDialogOpen(false)
        setEditingHost(null)
        setRemarkInput("")
        reloadHosts?.()
      } else {
        toast.error(t("consoleSettings.hosts.toast.remarkUpdateFailed", { message: resp.message }))
      }
    })
    setRemarkLoading(false)
  }

  const loadHosts = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
          <EmptyDescription>
            {t("consoleSettings.hosts.loading")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const noHosts = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertHexagon />
          </EmptyMedia>
          <EmptyDescription>
            {t("consoleSettings.hosts.empty")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const listHosts = () => {
    return (
      <ItemGroup className="flex flex-col gap-4">
        {hosts.map((host: DomainHost) => (
          <Item key={host.id} variant="outline" className="hover:border-primary/50" size="sm">
            <ItemContent>
              <ItemTitle className="break-all">
                {host.remark || `${host.name}-${host.external_ip}`}
                {getHostBadges(host)}
              </ItemTitle>
              <ItemDescription className="hidden md:block">
                {t("consoleSettings.hosts.vmSummary", {
                  total: host.virtualmachines?.length || 0,
                  active: host.virtualmachines?.filter((vm) => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).length || 0,
                })}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleOpenRemarkDialog(host)} disabled={host.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                    <IconPencil />
                    {t("consoleSettings.hosts.actions.editRemark")}
                  </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                        disabled={host.owner?.type !== ConstsOwnerType.OwnerTypePrivate}
                      >
                        <IconTrash />
                        {t("consoleSettings.hosts.actions.remove")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("consoleSettings.hosts.remove.title")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("consoleSettings.hosts.remove.description", { name: host.remark || `${host.name}-${host.external_ip}` })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("consoleSettings.hosts.actions.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(host)
                          }}
                        >
                          {t("consoleSettings.hosts.remove.confirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    )
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-2 font-semibold leading-none">
              <HardDrive />
              {t("consoleSettings.hosts.title")}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("consoleSettings.hosts.description")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={!canManageHosts}
          >
            {t("consoleSettings.hosts.actions.bind")}
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {loadingHosts ? loadHosts() : hosts.length === 0 ? noHosts() : listHosts()}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("consoleSettings.hosts.bind.title")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("consoleSettings.hosts.bind.instruction")}
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <pre
                  className="bg-muted p-4 rounded-md whitespace-pre-wrap break-words text-sm cursor-pointer hover:text-success"
                  onClick={handleCopy}
                >
                  <code className="code-font">{loadingCommand ? t("consoleSettings.hosts.bind.generatingCommand") : command}</code>
                </pre>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("consoleSettings.hosts.actions.copyCommand")}</p>
              </TooltipContent>
            </Tooltip>
            <p className="text-sm text-muted-foreground">
              {t("consoleSettings.hosts.bind.afterRun")}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("consoleSettings.hosts.remark.title")}</DialogTitle>
            <DialogDescription>
              {t("consoleSettings.hosts.remark.description", { name: editingHost?.remark || `${editingHost?.name}-${editingHost?.external_ip}` })}
            </DialogDescription>
          </DialogHeader>
          <Input
            id="remark"
            placeholder={t("consoleSettings.hosts.remark.placeholder")}
            value={remarkInput}
            onChange={(e) => setRemarkInput(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarkDialogOpen(false)}>
              {t("consoleSettings.hosts.actions.cancel")}
            </Button>
            <Button onClick={handleUpdateRemark} disabled={remarkLoading}>
              {remarkLoading ? t("consoleSettings.hosts.actions.saving") : t("consoleSettings.hosts.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
