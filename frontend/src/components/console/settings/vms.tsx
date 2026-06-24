import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { apiRequest } from "@/utils/requestUtils";
import {
  IconCircle,
  IconCircleCheck,
  IconClockHour4,
  IconDotsVertical,
  IconFolderOpen,
  IconReload,
  IconTerminal2
} from "@tabler/icons-react"
import { CirclePlusIcon, MonitorCloud, MoreVertical, Server } from "lucide-react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ItemGroup,
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemMedia,
} from "@/components/ui/item";
import CreateVM from "@/components/console/vm/vm-add";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Icon from "@/components/common/Icon";
import { canManageDevEnvironment, getOSFromImageName, getStatusBadgeProps, formatMemory, renderHoverCardContent, getVmMessage, getLastCondition } from "@/utils/common";
import { Badge } from "@/components/ui/badge";
import dayjs from "dayjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTrash } from "@tabler/icons-react";
import { type DomainVirtualMachine, GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, GithubComChaitinMonkeyCodeBackendPkgTaskflowVirtualMachineStatus as TaskflowVirtualMachineStatus } from "@/api/Api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { useCommonData } from "@/components/console/data-provider";
import { VmRenewDialog } from "@/components/console/vm/vm-renew";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";

export default function VmsPage() {
  const { t } = useTranslation()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [vmToDelete, setVmToDelete] = useState<DomainVirtualMachine | null>(null)
  const [showOfflineVms, setShowOfflineVms] = useState(false)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false)
  const [vmToRenew, setVmToRenew] = useState<DomainVirtualMachine | null>(null)

  const { reloadHosts, loadingHosts, hostsInited, vms, user } = useCommonData();
  const reloadHostsRef = useRef(reloadHosts)
  const canCreateVm = canManageDevEnvironment(user)

  useEffect(() => {
    reloadHostsRef.current = reloadHosts
  }, [reloadHosts])

  const showVms = useMemo(() => {
    if (showOfflineVms) {
      return vms
    } else {
      return vms.filter(vm => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline)
    }
  }, [vms, showOfflineVms])

  useEffect(() => {
    if (!hostsInited) {
      reloadHostsRef.current()
    }
  }, [hostsInited])

  useEffect(() => {
    if (!hostsInited) {
      return
    }

    // Poll faster while environments are being created so the list does not stay stale.
    const hasPending = vms.some((vm) => vm.status === TaskflowVirtualMachineStatus.VirtualMachineStatusPending)
    const timeoutId = setTimeout(() => {
      reloadHostsRef.current()
    }, hasPending ? 3000 : 30000)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [hostsInited, vms])

  const formatVmStatus = (status?: TaskflowVirtualMachineStatus) => {
    switch (status) {
      case TaskflowVirtualMachineStatus.VirtualMachineStatusOnline:
        return t("consoleSettings.vms.status.online")
      case TaskflowVirtualMachineStatus.VirtualMachineStatusPending:
        return t("consoleSettings.vms.status.pending")
      case TaskflowVirtualMachineStatus.VirtualMachineStatusOffline:
        return t("consoleSettings.vms.status.offline")
      default:
        return status || t("consoleSettings.vms.fallback.unknown")
    }
  }

  const formatDuration = (seconds: number) => {
    const normalizedSeconds = seconds > 0 ? seconds : 0
    if (normalizedSeconds < 60) {
      return t("consoleSettings.vms.duration.seconds", { count: Math.floor(normalizedSeconds) })
    }
    if (normalizedSeconds < 60 * 60) {
      return t("consoleSettings.vms.duration.minutes", { count: Math.floor(normalizedSeconds / 60) })
    }
    if (normalizedSeconds < 60 * 60 * 24) {
      return t("consoleSettings.vms.duration.hours", { count: Math.floor(normalizedSeconds / 60 / 60) })
    }
    return t("consoleSettings.vms.duration.days", { count: Math.floor(normalizedSeconds / 60 / 60 / 24) })
  }

  const formatVmName = (vm: DomainVirtualMachine | null | undefined) =>
    vm?.name || t("consoleSettings.vms.fallback.unnamed")

  const formatVmMemory = (memory?: number) =>
    memory ? formatMemory(memory) : t("consoleSettings.vms.fallback.unknown")

  const formatOnlineSummary = (vm: DomainVirtualMachine) => {
    const parts = [
      vm.cores ? t("consoleSettings.vms.card.cpu", { cores: vm.cores }) : "",
      vm.memory ? t("consoleSettings.vms.card.memory", { memory: formatMemory(vm.memory) }) : "",
      t("consoleSettings.vms.card.createdAgo", { time: dayjs.unix(vm.created_at as number).fromNow() }),
      vm.life_time_seconds === 0
        ? t("consoleSettings.vms.card.neverRecycle")
        : t("consoleSettings.vms.card.recycleAfter", { time: formatDuration(vm.life_time_seconds as number) }),
    ].filter(Boolean)

    return parts.join(t("consoleSettings.vms.card.separator"))
  }

  const handleDeleteVM = (vm: DomainVirtualMachine) => {
    setVmToDelete(vm)
    setDeleteDialogOpen(true)
  }

  const confirmDeleteVM = () => {
    if (!vmToDelete) {
      return
    }

    const vm = vmToDelete
    if (!vm.id) {
      toast.error(t("consoleSettings.vms.toast.missingVmId"))
      setDeleteDialogOpen(false)
      setVmToDelete(null)
      return
    }

    const hostId = vm.host?.id
    if (!hostId) {
      toast.error(t("consoleSettings.vms.toast.missingHostId"))
      setDeleteDialogOpen(false)
      setVmToDelete(null)
      return
    }

    apiRequest('v1UsersHostsVmsDelete', {}, [hostId, vm.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.vms.toast.removeSuccess"))
        reloadHosts()
      } else {
        toast.error(resp.message || t("consoleSettings.vms.toast.removeFailed"))
      }
      setDeleteDialogOpen(false)
      setVmToDelete(null)
    })
  }

  const handleRenewVM = (vm: DomainVirtualMachine) => {
    setVmToRenew(vm)
    setRenewDialogOpen(true)
  }

  const handleRenewDialogOpenChange = (open: boolean) => {
    setRenewDialogOpen(open)
    if (!open) {
      setVmToRenew(null)
    }
  }

  const loadVms = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            {t("consoleSettings.vms.loading")}
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const NoVms = () => {
    return (
      <Empty className="min-h-full border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Server />
          </EmptyMedia>
          <EmptyTitle>{t("consoleSettings.vms.empty.title")}</EmptyTitle>
          <EmptyDescription>
            {t("consoleSettings.vms.empty.description")}
          </EmptyDescription>
        </EmptyHeader>
          <EmptyContent>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => reloadHosts()}>
                <IconReload />
                {t("consoleSettings.vms.actions.refresh")}
              </Button>
            <Button onClick={() => setCreateDialogOpen(true)} disabled={!canCreateVm}>
              <CirclePlusIcon />
              {t("consoleSettings.vms.actions.create")}
            </Button>
            </div>
          </EmptyContent>
      </Empty>
    )
  }

  const AllOfflineVms = () => {
    return (
      <Empty className="min-h-full border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MonitorCloud />
          </EmptyMedia>
          <EmptyDescription>
            {t("consoleSettings.vms.offlineOnly", { count: vms.length })}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const VmsList = () => {
    return (
      <ItemGroup className="flex flex-col gap-4">
        {showVms?.map((vm) => (
          <Item key={vm.id} variant="outline" className="hover:border-primary/50" size={"sm"}>
            <ItemMedia className="hidden sm:flex">
              <Avatar>
                <AvatarFallback>
                  {vm.status === 'pending' ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Icon name={getOSFromImageName(vm.os || '')} className="size-4" />
                  )}
                </AvatarFallback>
              </Avatar> 
            </ItemMedia>
            <ItemContent className="min-w-0">
              <HoverCard>
                <HoverCardTrigger asChild>
                  <ItemTitle className="flex items-center gap-2 break-all">
                    {formatVmName(vm)}
                    <Badge {...getStatusBadgeProps(vm.status)}>{formatVmStatus(vm.status)}</Badge>
                    {vm.host?.arch !== 'x86_64' && <Badge variant={"outline"} className="hidden md:flex">{vm.host?.arch}</Badge>}
                  </ItemTitle>
                </HoverCardTrigger>
                {renderHoverCardContent([
                  {title: t("consoleSettings.vms.hover.name"), content: formatVmName(vm)},
                  {title: t("consoleSettings.vms.hover.status"), content: formatVmStatus(vm.status)},
                  {title: t("consoleSettings.vms.hover.statusMessage"), content: getVmMessage(vm)},
                  {title: t("consoleSettings.vms.hover.host"), content: vm.host?.remark || `${vm.host?.name}-${vm.host?.external_ip}`},
                  {title: t("consoleSettings.vms.hover.os"), content: vm.os || t("consoleSettings.vms.fallback.unknown")},
                  {title: t("consoleSettings.vms.hover.resource"), content: t("consoleSettings.vms.card.resourceLimit", { cores: vm.cores, memory: formatVmMemory(vm.memory) })},
                  {title: t("consoleSettings.vms.hover.createdAt"), content: dayjs.unix(vm.created_at as number).format("YYYY-MM-DD HH:mm:ss")},
                  {title: t("consoleSettings.vms.hover.recycleAt"), content: vm.life_time_seconds ? dayjs.unix(new Date().getTime() / 1000).add(vm.life_time_seconds as number, 'seconds').format("YYYY-MM-DD HH:mm:ss") : t("consoleSettings.vms.card.neverRecycle")},
                ])}
              </HoverCard>
              <ItemDescription className="min-w-0 max-w-full overflow-hidden line-clamp-1 truncate">
                {vm.status === TaskflowVirtualMachineStatus.VirtualMachineStatusOnline && <>
                  {formatOnlineSummary(vm)}
                </>}
                {vm.status === TaskflowVirtualMachineStatus.VirtualMachineStatusOffline && <>
                  {getLastCondition(vm)?.type === GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed ? (
                      getVmMessage(vm)
                    ) : (
                      t("consoleSettings.vms.status.offline")
                    )
                  }
                </>}
                {vm.status === TaskflowVirtualMachineStatus.VirtualMachineStatusPending && getVmMessage(vm)}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="w-full md:w-auto flex">
              <Button variant="ghost" size="sm" className="flex-1 bg-secondary md:bg-transparent" disabled={vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOnline} onClick={() => window.open(`/console/terminal?envid=${vm.id}`, '_blank')}>
                <IconTerminal2 />
                {t("consoleSettings.vms.actions.terminal")}
              </Button>
              <Button variant="ghost" size="sm" className="flex-1 bg-secondary md:bg-transparent" disabled={vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOnline} onClick={() => window.open(`/console/files?envid=${vm.id}&path=/workspace`, '_blank')}>
                <IconFolderOpen />
                {t("consoleSettings.vms.actions.files")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="bg-secondary md:bg-transparent">
                    <IconDotsVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={vm.life_time_seconds === 0 || vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOnline}
                    onClick={() => handleRenewVM(vm)}
                  >
                    <IconClockHour4 className="size-4" />
                    {t("consoleSettings.vms.actions.renew")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDeleteVM(vm)}
                  >
                    <IconTrash className="size-4" />
                    {t("consoleSettings.vms.actions.remove")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <MonitorCloud />
            {t("consoleSettings.vms.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.vms.description")}
          </p>
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-46 min-w-46">
              <DropdownMenuItem className="whitespace-nowrap" onClick={() => setCreateDialogOpen(true)} disabled={!canCreateVm}>
                <CirclePlusIcon />
                {t("consoleSettings.vms.actions.create")}
              </DropdownMenuItem>
              <DropdownMenuItem className="whitespace-nowrap" onClick={reloadHosts} disabled={loadingHosts}>
                <IconReload className={loadingHosts ? "animate-spin" : ""} />
                {t("consoleSettings.vms.actions.refresh")}
              </DropdownMenuItem>
              <DropdownMenuItem className="whitespace-nowrap" onClick={(e) => {
                setShowOfflineVms(!showOfflineVms)
                e.preventDefault()
              }}>
                {showOfflineVms ? <IconCircleCheck className="text-primary" /> : <IconCircle /> }
                {t("consoleSettings.vms.actions.offline")}
                <Switch checked={showOfflineVms} onCheckedChange={setShowOfflineVms} />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingHosts && !hostsInited ? loadVms() : vms.length === 0 ? <NoVms /> : showVms.length === 0 ? <AllOfflineVms /> : <VmsList />}
        <CreateVM
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          onSuccess={reloadHosts}
        />
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("consoleSettings.vms.remove.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("consoleSettings.vms.remove.description", { name: formatVmName(vmToDelete) })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setDeleteDialogOpen(false)
                setVmToDelete(null)
              }}>
                {t("consoleSettings.vms.actions.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteVM}
              >
                {t("consoleSettings.vms.remove.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <VmRenewDialog
          open={renewDialogOpen}
          onOpenChange={handleRenewDialogOpenChange}
          hostId={vmToRenew?.host?.id}
          vmId={vmToRenew?.id}
          onSuccess={reloadHosts}
        />
      </div>
    </div>
  )
}
