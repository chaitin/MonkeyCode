import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Box, MoreVertical } from "lucide-react";
import { useState, useEffect } from "react";
import { apiRequest } from "@/utils/requestUtils";
import { toast } from "sonner";
import { TaskflowVirtualMachineStatus, type DomainHost, type DomainTeamGroup, type DomainVirtualMachine } from "@/api/Api";
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


export default function TeamManagerHosts() {
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<string>("")
  const [hosts, setHosts] = useState<DomainHost[]>([])
  const [loadingInstallCommand, setLoadingInstallCommand] = useState(false)
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [removingHost, setRemovingHost] = useState(false)
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<DomainHost | null>(null)
  


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
  }, [])

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
                  className="bg-muted p-4 rounded-md whitespace-pre-wrap break-words text-sm cursor-pointer hover:text-green-500"
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

