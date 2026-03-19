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
import { useEffect, useState, useMemo } from "react";
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
import { getOSFromImageName, humanTime, translateStatus, getStatusBadgeProps, formatMemory, renderHoverCardContent, getVmMessage, getLastCondition } from "@/utils/common";
import { Badge } from "@/components/ui/badge";
import dayjs from "dayjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconTrash } from "@tabler/icons-react";
import { type DomainVirtualMachine, GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType, TypesVirtualMachineStatus } from "@/api/Api";
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
import { useCommonData } from "@/components/console/common-data";
import { VmRenewDialog } from "@/components/console/vm/vm-renew";
import { Switch } from "@/components/ui/switch";

export default function VmsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [vmToDelete, setVmToDelete] = useState<DomainVirtualMachine | null>(null)
  const [showOfflineVms, setShowOfflineVms] = useState(false)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false)
  const [vmToRenew, setVmToRenew] = useState<DomainVirtualMachine | null>(null)

  const { reloadHosts, loadingHosts, hostsInited, vms } = useCommonData();

  const showVms = useMemo(() => {
    if (showOfflineVms) {
      return vms
    } else {
      return vms.filter(vm => vm.status !== TypesVirtualMachineStatus.VirtualMachineStatusOffline)
    }
  }, [vms, showOfflineVms])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const poll = () => {
      reloadHosts();
      // 检查 vms 里是否有 pending 状态的机器
      const hasPending = vms.some(vm => vm.status === 'pending');
      timeoutId = setTimeout(poll, hasPending ? 3000 : 30000);
    };

    poll();

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

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
      toast.error("无法获取开发环境 ID")
      setDeleteDialogOpen(false)
      setVmToDelete(null)
      return
    }

    const hostId = vm.host?.id
    if (!hostId) {
      toast.error("无法获取宿主机 ID")
      setDeleteDialogOpen(false)
      setVmToDelete(null)
      return
    }

    apiRequest('v1UsersHostsVmsDelete', {}, [hostId, vm.id], (resp) => {
      if (resp.code === 0) {
        toast.success("开发环境移除成功")
        reloadHosts()
      } else {
        toast.error(resp.message || "移除开发环境失败")
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
            正在加载开发环境列表...
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
          <EmptyTitle>没有开发环境</EmptyTitle>
          <EmptyDescription>
            还没有创建任何开发环境
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => reloadHosts()}>
              <IconReload />
              刷新
            </Button>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <CirclePlusIcon />
              创建开发环境
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
            您有 {vms.length} 个离线开发环境，开启「离线开发环境」可查看
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
            <ItemContent>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <ItemTitle className="flex items-center gap-2 break-all">
                    {vm.name || "未命名开发环境"}
                    <Badge {...getStatusBadgeProps(vm.status)}>{translateStatus(vm.status)}</Badge>
                    {vm.host?.arch !== 'x86_64' && <Badge variant={"outline"} className="hidden md:flex">{vm.host?.arch}</Badge>}
                  </ItemTitle>
                </HoverCardTrigger>
                {renderHoverCardContent([
                  {title: "开发环境名称", content: vm.name || "未命名开发环境"},
                  {title: "开发环境状态", content: translateStatus(vm.status)},
                  {title: "开发环境状态信息", content: getVmMessage(vm)},
                  {title: "宿主机", content: vm.host?.remark || `${vm.host?.name}-${vm.host?.external_ip}`},
                  {title: "操作系统", content: vm.os || "未知"},
                  {title: "资源限制", content: `${vm.cores} 核 CPU，${formatMemory(vm.memory)} 内存`},
                  {title: "创建时间", content: dayjs.unix(vm.created_at as number).format("YYYY-MM-DD HH:mm:ss")},
                  {title: "回收时间", content: vm.life_time_seconds ? dayjs.unix(new Date().getTime() / 1000).add(vm.life_time_seconds as number, 'seconds').format("YYYY-MM-DD HH:mm:ss") : "永不回收"},
                ])}
              </HoverCard>
              <ItemDescription className="line-clamp-1 truncate">
                {vm.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline && <>
                  {Boolean(vm.cores) && `${vm.cores} 核 CPU，`}
                  {Boolean(vm.memory) && `${formatMemory(vm.memory)} 内存，`}
                  {`${dayjs.unix(vm.created_at as number).fromNow()}创建，`}
                  {vm.life_time_seconds === 0 ? "永不回收" : `${humanTime(vm.life_time_seconds as number)}后回收`}
                </>}
                {vm.status === TypesVirtualMachineStatus.VirtualMachineStatusOffline && <>
                  {getLastCondition(vm)?.type === GitInChaitinNetAiMonkeycodeMonkeycodeAiEntTypesConditionType.ConditionTypeFailed ? (
                      getVmMessage(vm)
                    ) : (
                      '已离线'
                    )
                  }
                </>}
                {vm.status === TypesVirtualMachineStatus.VirtualMachineStatusPending && getVmMessage(vm)}
              </ItemDescription>
            </ItemContent>
            <ItemActions className="w-full md:w-auto flex">
              <Button variant="ghost" size="sm" className="flex-1 bg-secondary md:bg-transparent" disabled={vm.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} onClick={() => window.open(`/console/terminal?envid=${vm.id}`, '_blank')}>
                <IconTerminal2 />
                终端
              </Button>
              <Button variant="ghost" size="sm" className="flex-1 bg-secondary md:bg-transparent" disabled={vm.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline} onClick={() => window.open(`/console/files?envid=${vm.id}&path=/workspace`, '_blank')}>
                <IconFolderOpen />
                文件
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="bg-secondary md:bg-transparent">
                    <IconDotsVertical />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={vm.life_time_seconds === 0 || vm.status !== TypesVirtualMachineStatus.VirtualMachineStatusOnline}
                    onClick={() => handleRenewVM(vm)}
                  >
                    <IconClockHour4 className="size-4" />
                    续期
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => handleDeleteVM(vm)}
                  >
                    <IconTrash className="size-4" />
                    移除
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
            开发环境
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            用于在宿主机上创建开发环境
          </p>
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem  onClick={() => setCreateDialogOpen(true)}>
                <CirclePlusIcon />
                创建开发环境
              </DropdownMenuItem>
              <DropdownMenuItem onClick={reloadHosts} disabled={loadingHosts}>
                <IconReload className={loadingHosts ? "animate-spin" : ""} />
                刷新
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => {
                setShowOfflineVms(!showOfflineVms)
                e.preventDefault()
              }}>
                {showOfflineVms ? <IconCircleCheck className="text-primary" /> : <IconCircle /> }
                离线开发环境
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
              <AlertDialogTitle>确认移除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要移除开发环境 "{vmToDelete?.name || '未命名开发环境'}" 吗？此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setDeleteDialogOpen(false)
                setVmToDelete(null)
              }}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteVM}
              >
                确认移除
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
