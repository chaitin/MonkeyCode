import type { DomainVirtualMachine } from "@/api/Api"
import { ConstsTerminalMode } from "@/api/Api"
import Terminal from "@/components/common/terminal"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { getStatusBadgeProps, translateStatus } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { IconCopy, IconDeviceDesktop, IconFolderOpen, IconReload, IconScreenShare, IconTerminal2, IconXboxXFilled } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { v4 as uuidv4 } from 'uuid';
import themes from '@/utils/terminalThemes';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field"
import { toast } from "sonner"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import TerminalConnectionDialog from "@/components/console/terminal-connection-dialog"
import { VmPortForwardDialog } from "@/components/console/vm/vm-port-forward"

export default function TerminalPage() {
  const [searchParams] = useSearchParams()
  const [envid] = useState<string>(searchParams.get('envid') || '')
  const [vm, setVm] = useState<DomainVirtualMachine | null>(null)
  const [title, setTitle] = useState<string>('')
  const [connectionId, setConnectionId] = useState<string | null>()
  const [signal, setSignal] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState<boolean>(false)
  const [connectionErrorDialogOpen, setConnectionErrorDialogOpen] = useState(false)
  const [connectionDialogOpen, setConnectionDialogOpen] = useState<boolean>(false)
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState<boolean>(false)

  const [currentTheme, setCurrentTheme] = useState(() => {
    const savedTheme = localStorage.getItem('terminalTheme');
    return savedTheme ? savedTheme : 'MonkeyCode';
  });

  // 远程协助相关状态
  const [assistMode, setAssistMode] = useState<ConstsTerminalMode>(ConstsTerminalMode.TerminalModeReadOnly)
  const [assistPassword, setAssistPassword] = useState<string>('')
  const [isGeneratingPassword, setIsGeneratingPassword] = useState<boolean>(false)
  const [hasGeneratedPassword, setHasGeneratedPassword] = useState<boolean>(false)
  const [isAssistDialogOpen, setIsAssistDialogOpen] = useState<boolean>(false)

  // 获取虚拟机详情
  const fetchVMInfo = async () => {    
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsDetail', {}, [envid], (resp) => {
      if (resp.code === 0) {
        setVm(resp.data || null)
        setConnectionErrorDialogOpen(false)
      } else {
        toast.error(resp.message || "获取虚拟机详情失败")
        setConnectionErrorDialogOpen(true)
      }
    })
  }


  // 生成远程协助密码
  const handleGenerateAssistPassword = async () => {
    if (!envid || !connectionId) {
      return
    }

    setIsGeneratingPassword(true)
    await apiRequest('v1UsersHostsVmsTerminalsShareCreate', {
      id: envid,
      terminal_id: connectionId,
      mode: assistMode
    }, [envid], (resp) => {
      if (resp.code === 0) {
        setAssistPassword(resp.data?.password || '')
        setHasGeneratedPassword(true)
      } else {
        toast.error(resp.message || "生成远程协助密码失败")
      }
      setIsGeneratingPassword(false)
    })
  }

  // 获取共享链接
  const getSharedUrl = () => {
    if (!connectionId) return ''
    return `${window.location.origin}/sharedterminal?id=${connectionId}`
  }

  // 复制连接信息到剪贴板
  const handleCopyConnectionInfo = async () => {
    const connectionInfo = `邀请你对我进行远程协助

连接地址：${getSharedUrl()}
连接密码：${assistPassword}`
    
    try {
      await navigator.clipboard.writeText(connectionInfo)
      toast.success('连接信息已复制到剪贴板')
    } catch (err) {
      toast.error('复制连接信息失败，请手动复制')
    }
  }

  // 重置远程协助状态
  useEffect(() => {
    if (!isAssistDialogOpen) {
      setAssistPassword('')
      setHasGeneratedPassword(false)
      setAssistMode(ConstsTerminalMode.TerminalModeReadOnly)
    }
  }, [isAssistDialogOpen])

  useEffect(() => {
    fetchVMInfo()
    // 页面首次加载时，如果没有连接ID，显示连接选择对话框
    if (!connectionId) {
      setConnectionDialogOpen(true)
    }
    const interval = setInterval(() => {
      fetchVMInfo()
    }, 10000) // 每10秒钟调用一次
    return () => clearInterval(interval)
  }, [])

  
  const renderTitle = () => {
    if (signal) {
      if (connectionStatus === 'connecting') {
        return <>
          <Spinner className="w-4 h-4 min-w-4 min-h-4 animate-spin" />
          正在连接
        </>
      } else if (connectionStatus === 'disconnected') {
        return <>
          <IconXboxXFilled className="w-4 h-4 min-w-4 min-h-4 text-red-500" />
          连接已断开
        </>
      } else if (connectionStatus === 'connected') {
        return <>
          <IconTerminal2 className="w-4 h-4 min-w-4 min-h-4" />
          {title}
        </>
      }
    }
    return <>
      <IconTerminal2 className="w-4 h-4 min-w-4 min-h-4" />
      连接未建立
    </>
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center gap-2">
          {vm?.name}
          <Badge {...getStatusBadgeProps(vm?.status)}>{translateStatus(vm?.status)}</Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="hidden md:block cursor-default">{vm?.os}</Badge>
            </TooltipTrigger>
            <TooltipContent>
              操作系统
            </TooltipContent>
          </Tooltip>
        </div>
        {/*<ModeToggle />*/}
      </div>
      <div className="flex-1 p-2 pt-0 flex flex-col">
        <div className="flex flex-col flex-1 border rounded-lg overflow-hidden">
          <>
            <div className="flex justify-between items-center p-2">
              <div className="flex items-center gap-1 border rounded-md py-1.5 px-2 text-sm max-w-[300px] truncate px-2">
                {renderTitle()}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="hidden sm:flex" onClick={() => { setSignal(signal + 1); }}>
                  <IconReload />
                  重新连接
                </Button>
                <Button variant="outline" size="sm" className="hidden sm:flex" disabled={connectionStatus !== 'connected'} onClick={() => setPortForwardDialogOpen(true)}>
                  <IconDeviceDesktop />
                  在线预览
                </Button>
                <Button variant="outline" size="sm" className="hidden lg:flex" disabled={connectionStatus !== 'connected'} onClick={() => { window.open(`/console/files?envid=${envid}&path=/workspace`, '_blank'); }}>
                  <IconFolderOpen />
                  文件管理
                </Button>
                <Dialog open={isAssistDialogOpen} onOpenChange={setIsAssistDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="hidden md:flex" disabled={connectionStatus !== 'connected'}>
                      <IconScreenShare />
                      远程协助
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>远程协助</DialogTitle>
                      {!hasGeneratedPassword ? (
                        <>
                          <DialogDescription className="py-2">
                            <RadioGroup value={assistMode} onValueChange={(value) => setAssistMode(value as ConstsTerminalMode)}>
                              <FieldLabel htmlFor="terminal-mode-readonly">
                                <Field orientation="horizontal" className="cursor-pointer">
                                  <FieldContent>
                                    <FieldTitle className="text-foreground">只读模式</FieldTitle>
                                    <FieldDescription>
                                      对方只能看到你的终端界面，无法输入或操作
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem value={ConstsTerminalMode.TerminalModeReadOnly} id="terminal-mode-readonly" className="cursor-pointer" />
                                </Field>
                              </FieldLabel>
                                <FieldLabel htmlFor="terminal-mode-readwrite">
                                <Field orientation="horizontal" className="cursor-pointer">
                                  <FieldContent>
                                    <FieldTitle className="text-foreground">控制模式</FieldTitle>
                                    <FieldDescription>
                                      对方可以看到你的终端界面且可进行输入和交互操作
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem value={ConstsTerminalMode.TerminalModeReadWrite} id="terminal-mode-readwrite" className="cursor-pointer" />
                                </Field>
                              </FieldLabel>
                            </RadioGroup>
                          </DialogDescription>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAssistDialogOpen(false)}>
                              取消
                            </Button>
                            <Button onClick={handleGenerateAssistPassword}>
                              {isGeneratingPassword && <Spinner className="w-4 h-4 mr-2" />}
                              生成连接信息
                            </Button>
                          </DialogFooter>
                        </>
                      ) : (
                        <>
                          <DialogDescription className="py-2 space-y-4">
                            <Field>
                              <FieldLabel className="text-foreground">连接地址</FieldLabel>
                              <Input
                                className="text-foreground"
                                value={getSharedUrl()}
                                readOnly
                              />
                            </Field>
                            <Field>
                              <FieldLabel className="text-foreground">连接密码</FieldLabel>
                              <Input
                                className="text-foreground"
                                value={assistPassword}
                                readOnly
                              />
                            </Field>
                          </DialogDescription>
                          <DialogFooter>
                            <Button onClick={handleCopyConnectionInfo}>
                              <IconCopy />
                              复制连接信息
                            </Button>
                          </DialogFooter>
                        </>
                      )}
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
                <Select value={currentTheme} onValueChange={(value) => {
                  setCurrentTheme(value);
                  localStorage.setItem('terminalTheme', value);
                }}>
                  <SelectTrigger className="w-[150px] hidden md:flex" size="sm">
                    <SelectValue placeholder="配色方案" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>配色方案</SelectLabel>
                      {Object.keys(themes).map((theme) => (
                        <SelectItem key={theme} value={theme}>{themes[theme as keyof typeof themes].name}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="block h-full w-full overflow-hidden">
              <Terminal
                ws={connectionId ? `/api/v1/users/hosts/vms/${envid}/terminals/connect?terminal_id=${connectionId}` : ''} 
                theme={currentTheme}
                signal={signal}
                onTitleChanged={setTitle}
                onUserNameChanged={() => {}}
                onConnectionStatusChanged={(status) => {
                  setConnectionStatus(status);
                }}
              />
            </div>
          </>
        </div>
      </div>
      <TerminalConnectionDialog
        open={connectionDialogOpen}
        onOpenChange={setConnectionDialogOpen}
        envid={envid}
        onConnectionSelected={(connectionId) => {
          setConnectionId(connectionId)
          setSignal(signal + 1)
        }}
        onNewConnection={() => {
          setConnectionId(uuidv4())
          setSignal(signal + 1)
        }}
      />
      <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>终端连接已断开</AlertDialogTitle>
            <AlertDialogDescription>
              终端连接已断开，请检查网络连接或稍后重试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setDisconnectDialogOpen(false);
                setSignal(signal + 1);
              }}
            >
              重新连接
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={connectionErrorDialogOpen} onOpenChange={setConnectionErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>无法连接主机</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => window.close()}>关闭</AlertDialogCancel>
            <AlertDialogAction onClick={() => window.location.reload()}>刷新</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VmPortForwardDialog
        open={portForwardDialogOpen}
        onOpenChange={setPortForwardDialogOpen}
        ports={vm?.ports}
        hostId={vm?.host?.id}
        vmId={vm?.id}
        onSuccess={fetchVMInfo}
      />
    </div>
  )
}