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
import { getHostBadges } from "@/utils/common"
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
import { IconAlertHexagon, IconPencil, IconStar, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"

export default function Hosts() {
  const [open, setOpen] = useState(false)
  const [command, setCommand] = useState<string>("")
  const [loadingCommand, setLoadingCommand] = useState(false)
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false)
  const [editingHost, setEditingHost] = useState<DomainHost | null>(null)
  const [remarkInput, setRemarkInput] = useState("")
  const [remarkLoading, setRemarkLoading] = useState(false)

  const { hosts, reloadHosts, loadingHosts } = useCommonData();

  const fetchInstallCommand = async () => {
    setLoadingCommand(true)
    await apiRequest('v1UsersHostsInstallCommandList', {}, [], (resp) => {
      if (resp.code === 0) {
        setCommand(resp.data?.command || "")
      } else {
        toast.error("获取安装命令失败: " + resp.message)
      }
    })
    setLoadingCommand(false)
  }

  useEffect(() => {
    if (open) {
      fetchInstallCommand()
    }
  }, [open])

  const handleCopy = async () => {
    if (!command) return
    
    try {
      await navigator.clipboard.writeText(command)
      toast.success("命令已复制到剪贴板")
    } catch (error) {
      toast.error("复制失败")
      console.error("复制失败:", error)
    }
  }

  const handleDelete = (host: DomainHost) => {
    if (!host.id) {
      toast.error("宿主机信息不完整")
      return
    }

    apiRequest('v1UsersHostsDelete', {}, [host.id], (resp) => {
      if (resp.code === 0) {
        toast.success("宿主机移除成功")
        reloadHosts()
      } else {
        toast.error("移除宿主机失败: " + resp.message)
      }
    })
  }

  const handleSetDefault = async (host: DomainHost) => {
    if (!host.id) {
      toast.error("宿主机信息不完整")
      return
    }

    await apiRequest('v1UsersHostsUpdate', { is_default: true }, [host.id], (resp) => {
      if (resp.code === 0) {
        toast.success("设置成功")
      } else {
        toast.error("设置默认宿主机失败: " + resp.message)
      }
    })
    reloadHosts?.()
  }

  const handleOpenRemarkDialog = (host: DomainHost) => {
    setEditingHost(host)
    setRemarkInput(host.remark || "")
    setRemarkDialogOpen(true)
  }

  const handleUpdateRemark = async () => {
    if (!editingHost?.id) {
      toast.error("宿主机信息不完整")
      return
    }

    setRemarkLoading(true)
    await apiRequest('v1UsersHostsUpdate', { remark: remarkInput }, [editingHost.id], (resp) => {
      if (resp.code === 0) {
        toast.success("备注修改成功")
        setRemarkDialogOpen(false)
        setEditingHost(null)
        setRemarkInput("")
        reloadHosts?.()
      } else {
        toast.error("修改备注失败: " + resp.message)
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
            正在加载宿主机列表...
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
            暂无配置，请先绑定宿主机
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
                共 {host.virtualmachines?.length || 0} 个开发环境，{host.virtualmachines?.filter((vm) => vm.status !== TaskflowVirtualMachineStatus.VirtualMachineStatusOffline).length || 0} 个正在使用
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
                  <DropdownMenuItem onClick={() => handleSetDefault(host)} disabled={host.is_default}>
                    <IconStar />
                    设为默认
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenRemarkDialog(host)} disabled={host.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                    <IconPencil />
                    修改备注
                  </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                        disabled={host.owner?.type !== ConstsOwnerType.OwnerTypePrivate}
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
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(host)
                          }}
                        >
                          确认移除
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
              开发环境宿主机
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              用于在宿主机上创建开发环境
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>绑定</Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {loadingHosts ? loadHosts() : hosts.length === 0 ? noHosts() : listHosts()}
        </div>
      </div>

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
                  className="bg-muted p-4 rounded-md whitespace-pre-wrap break-words text-sm cursor-pointer hover:text-primary"
                  onClick={handleCopy}
                >
                  <code className="code-font">{loadingCommand ? "正在生成安装命令..." : command}</code>
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

      <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>修改备注</DialogTitle>
            <DialogDescription>
              为宿主机 "{editingHost?.remark || `${editingHost?.name}-${editingHost?.external_ip}`}" 设置备注
            </DialogDescription>
          </DialogHeader>
          <Input
            id="remark"
            placeholder="请输入备注信息"
            value={remarkInput}
            onChange={(e) => setRemarkInput(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemarkDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleUpdateRemark} disabled={remarkLoading}>
              {remarkLoading ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
