import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Box, Clock3, MoreVertical, Save } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { toast } from "sonner";
import { TaskflowVirtualMachineStatus, type DomainHost, type DomainTeamGroup, type DomainTeamTaskVMIdlePolicy, type DomainVirtualMachine } from "@/api/Api";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import EditHost from "@/components/manager/edit-host";
import { formatMemory, getHostStatusBadge } from "@/utils/common";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const secondsToHours = (seconds?: number) => {
  if (!seconds) {
    return ""
  }
  return String(Math.round((seconds / 3600) * 100) / 100)
}

const hoursToSeconds = (hours: string) => {
  const value = Number(hours)
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.round(value * 3600)
}

const formatPolicyDuration = (seconds?: number) => {
  if (!seconds) {
    return "未配置"
  }
  const hours = seconds / 3600
  return Number.isInteger(hours) ? `${hours} 小时` : `${Math.round(hours * 100) / 100} 小时`
}

export default function TeamManagerHosts() {
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<string>("")
  const [hosts, setHosts] = useState<DomainHost[]>([])
  const [loadingInstallCommand, setLoadingInstallCommand] = useState(false)
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [removingHost, setRemovingHost] = useState(false)
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<DomainHost | null>(null)
  const [policy, setPolicy] = useState<DomainTeamTaskVMIdlePolicy | null>(null)
  const [loadingPolicy, setLoadingPolicy] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [sleepEnabled, setSleepEnabled] = useState(true)
  const [sleepHours, setSleepHours] = useState("")
  const [recycleEnabled, setRecycleEnabled] = useState(true)
  const [recycleHours, setRecycleHours] = useState("")
  


  const fetchHosts = async () => {
    setLoadingHosts(true)
    await apiRequest('v1TeamsHostsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setHosts(resp.data.hosts || [])
      } else {
        toast.error("获取宿主机列表失败: " + resp.message)
      }
    })
    setLoadingHosts(false)
  }

  const syncPolicyForm = (nextPolicy: DomainTeamTaskVMIdlePolicy) => {
    setPolicy(nextPolicy)
    setSleepEnabled(nextPolicy.sleep_enabled ?? true)
    setSleepHours(secondsToHours(nextPolicy.sleep_seconds))
    setRecycleEnabled(nextPolicy.recycle_enabled ?? true)
    setRecycleHours(secondsToHours(nextPolicy.recycle_seconds))
  }

  const fetchPolicy = async () => {
    setLoadingPolicy(true)
    await apiRequest('v1TeamsTaskVmIdlePolicyList', {}, [], (resp) => {
      if (resp.code === 0 && resp.data) {
        syncPolicyForm(resp.data)
      } else {
        toast.error("获取任务开发环境策略失败: " + resp.message)
      }
    })
    setLoadingPolicy(false)
  }

  const fetchInstallCommand = async () => {
    setLoadingInstallCommand(true)
    await apiRequest('v1TeamsHostsInstallCommandList', {}, [], (resp) => {
      if (resp.code === 0) {
        setCommand(resp.data.command || "")
      } else {
        toast.error("获取安装命令失败: " + resp.message)
      }
    })
    setLoadingInstallCommand(false)
  }

  useEffect(() => {
    if (open) {
      fetchInstallCommand()
    }
  }, [open])

  useEffect(() => {
    fetchHosts()
    fetchPolicy()
  }, [])

  const handleSavePolicy = async () => {
    setSavingPolicy(true)
    await apiRequest('v1TeamsTaskVmIdlePolicyUpdate', {
      sleep_enabled: sleepEnabled,
      sleep_seconds: hoursToSeconds(sleepHours),
      recycle_enabled: recycleEnabled,
      recycle_seconds: hoursToSeconds(recycleHours),
    }, [], (resp) => {
      if (resp.code === 0 && resp.data) {
        syncPolicyForm(resp.data)
        toast.success("任务开发环境策略已保存")
      } else {
        toast.error("保存任务开发环境策略失败: " + resp.message)
      }
    })
    setSavingPolicy(false)
  }

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success("命令已复制到剪贴板")
    } catch (error) {
      toast.error("复制失败")
      console.error("复制失败:", error)
    }
  }

  const handleDeleteHost = async (hostId: string) => {
    setRemovingHost(true)
    await apiRequest('v1TeamsHostsDelete', {}, [hostId], (resp) => {
      if (resp.code === 0) {
        toast.success("宿主机已移除")
        fetchHosts()
      } else {
        toast.error("移除宿主机失败: " + resp.message)
      }
    })
    setRemovingHost(false)
  }

  const handleEdit = (host: DomainHost) => {
    setEditingHost(host)
    setIsEditDialogOpen(true)
  }

  const handleEditCancel = () => {
    setEditingHost(null)
    setIsEditDialogOpen(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 />
            任务开发环境策略
          </CardTitle>
          <CardDescription>
            只影响通过任务创建的开发环境，手动创建的开发环境不受此配置影响
          </CardDescription>
          <CardAction>
            <Button size="sm" onClick={handleSavePolicy} disabled={savingPolicy || loadingPolicy}>
              {savingPolicy ? <Spinner className="size-4" /> : <Save className="size-4" />}
              保存
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loadingPolicy ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner className="size-6" />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="task-vm-sleep-enabled">自动休眠</Label>
                    <p className="text-sm text-muted-foreground">
                      空闲达到设置时长后休眠任务开发环境
                    </p>
                  </div>
                  <Switch
                    id="task-vm-sleep-enabled"
                    checked={sleepEnabled}
                    onCheckedChange={setSleepEnabled}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="task-vm-sleep-hours">休眠时长（小时）</Label>
                  <Input
                    id="task-vm-sleep-hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={sleepHours}
                    disabled={!sleepEnabled}
                    placeholder={policy?.sleep_inherited ? `继承默认 ${formatPolicyDuration(policy.effective_sleep_seconds)}` : "继承全局默认"}
                    onChange={(e) => setSleepHours(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    留空或填 0 表示继承全局默认，当前生效：{sleepEnabled ? formatPolicyDuration(policy?.effective_sleep_seconds) : "已关闭"}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="task-vm-recycle-enabled">自动回收</Label>
                    <p className="text-sm text-muted-foreground">
                      空闲达到设置时长后回收任务开发环境
                    </p>
                  </div>
                  <Switch
                    id="task-vm-recycle-enabled"
                    checked={recycleEnabled}
                    onCheckedChange={setRecycleEnabled}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="task-vm-recycle-hours">回收时长（小时）</Label>
                  <Input
                    id="task-vm-recycle-hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={recycleHours}
                    disabled={!recycleEnabled}
                    placeholder={policy?.recycle_inherited ? `继承默认 ${formatPolicyDuration(policy.effective_recycle_seconds)}` : "继承全局默认"}
                    onChange={(e) => setRecycleHours(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    留空或填 0 表示继承全局默认，当前生效：{recycleEnabled ? formatPolicyDuration(policy?.effective_recycle_seconds) : "已关闭"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box />
            开发环境宿主机
          </CardTitle>
          <CardDescription>
            用于在宿主机上创建开发环境
          </CardDescription>
          <CardAction>
            <Button variant={"outline"} size="sm" onClick={() => setOpen(true)}>绑定宿主机</Button>
          </CardAction>
        </CardHeader>
        <CardContent>

        {loadingHosts ? (
          <Empty className="bg-muted">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="flex flex-col gap-4">
            {hosts.map((host) => (
              <Item key={host.id} variant="outline" className="hover:border-primary/30" size="sm">
                <ItemContent>
                  <ItemTitle className="break-all">
                    {host.remark || `${host.name}-${host.external_ip}`}
                    {getHostStatusBadge(host.status)}
                    <Badge variant="secondary" className="hidden sm:inline">{host.cores} 核</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{formatMemory(host.memory)}</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{host.arch}</Badge>
                    <Badge variant="secondary" className="hidden sm:inline">{host.external_ip}</Badge>
                  </ItemTitle>
                  <ItemDescription className="hidden md:block">
                    共 {host.virtualmachines?.length || 0} 个开发环境，{host.virtualmachines?.filter((vm: DomainVirtualMachine) => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).length || 0} 个正在使用
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
                      <DropdownMenuItem onClick={() => handleEdit(host)}>
                        <IconPencil />
                        修改
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem 
                            className="text-destructive" 
                            onSelect={(e) => { e.preventDefault() }}
                          >
                            <IconTrash />
                            移除
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认移除</AlertDialogTitle>
                            <AlertDialogDescription>
                              确定要移除宿主机 "{host.remark || `${host.name}-${host.external_ip}`}" 吗？此操作不可撤销。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteHost(host.id!)} disabled={removingHost}>
                              确认移除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
                <ItemFooter className="flex flex-col gap-2 items-start">
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {host.groups && host.groups.length > 0 ? host.groups?.map((group: DomainTeamGroup) => (
                      <Badge variant="outline" key={group.id}>{group.name}</Badge>
                    )) : (
                      <div className="text-sm text-muted-foreground">暂无分组</div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {host.virtualmachines?.filter(vm => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).map(vm => (
                      <Badge variant="outline" key={vm.id}>{`${vm.owner?.email} - ${vm.cores} 核, ${formatMemory(vm.memory)}`}</Badge>
                    ))}
                  </div>
                </ItemFooter>
              </Item>)
            )}
          </ItemGroup>
        )}
        </CardContent>
        <EditHost
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleEditCancel()
            }
          }}
          host={editingHost ? { id: editingHost.id || '', name: editingHost.name || '', external_ip: editingHost.external_ip || '', remark: editingHost.remark || '', groups: editingHost.groups } : null}
          onRefresh={fetchHosts}
        />
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>绑定宿主机</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              以 root 权限登录你的 Linux 服务器，并执行以下命令
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <pre
                  className="bg-muted p-4 rounded-md whitespace-pre-wrap break-words text-sm cursor-pointer hover:text-success"
                  onClick={handleCopyCommand}
                >
                  <code className="code-font">{loadingInstallCommand ? "正在生成安装命令..." : command}</code>
                </pre>
              </TooltipTrigger>
              <TooltipContent>
                <p>复制命令</p>
              </TooltipContent>
            </Tooltip>
            <p className="text-sm text-muted-foreground">
              执行完毕后刷新页面，你将会看到宿主机信息
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
