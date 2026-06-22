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
import { useCallback, useEffect, useState } from "react"
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
import { useTranslation } from "react-i18next"

export default function TerminalPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [envid] = useState<string>(searchParams.get('envid') || '')
  const [vm, setVm] = useState<DomainVirtualMachine | null>(null)
  const [title, setTitle] = useState<string>('')
  const [connectionId, setConnectionId] = useState<string | null>()
  const [signal, setSignal] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState<boolean>(false)
  const [connectionErrorDialogOpen, setConnectionErrorDialogOpen] = useState(false)
  const [connectionDialogOpen, setConnectionDialogOpen] = useState<boolean>(true)
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState<boolean>(false)

  const [currentTheme, setCurrentTheme] = useState(() => {
    const savedTheme = localStorage.getItem('terminalTheme');
    return savedTheme ? savedTheme : 'MonkeyCode';
  });

  // Remote assistance state
  const [assistMode, setAssistMode] = useState<ConstsTerminalMode>(ConstsTerminalMode.TerminalModeReadOnly)
  const [assistPassword, setAssistPassword] = useState<string>('')
  const [isGeneratingPassword, setIsGeneratingPassword] = useState<boolean>(false)
  const [hasGeneratedPassword, setHasGeneratedPassword] = useState<boolean>(false)
  const [isAssistDialogOpen, setIsAssistDialogOpen] = useState<boolean>(false)

  // Fetch virtual machine details
  const fetchVMInfo = useCallback(async () => {
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsDetail', {}, [envid], (resp) => {
      if (resp.code === 0) {
        setVm(resp.data || null)
        setConnectionErrorDialogOpen(false)
      } else {
        toast.error(resp.message || t("consoleTerminal.vm.fetchFailed"))
        setConnectionErrorDialogOpen(true)
      }
    })
  }, [envid, t])


  // Generate remote assistance password
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
        toast.error(resp.message || t("consoleTerminal.assist.generateFailed"))
      }
      setIsGeneratingPassword(false)
    })
  }

  // Build shared link
  const getSharedUrl = () => {
    if (!connectionId) return ''
    return `${window.location.origin}/sharedterminal?id=${connectionId}`
  }

  // Copy connection details to clipboard
  const handleCopyConnectionInfo = async () => {
    const connectionInfo = t("consoleTerminal.assist.copyText", {
      url: getSharedUrl(),
      password: assistPassword,
    })
    
    try {
      await navigator.clipboard.writeText(connectionInfo)
      toast.success(t("consoleTerminal.assist.copySuccess"))
    } catch {
      toast.error(t("consoleTerminal.assist.copyFailed"))
    }
  }

  const handleAssistDialogOpenChange = (open: boolean) => {
    setIsAssistDialogOpen(open)
    if (!open) {
      setAssistPassword('')
      setHasGeneratedPassword(false)
      setAssistMode(ConstsTerminalMode.TerminalModeReadOnly)
    }
  }

  useEffect(() => {
    fetchVMInfo()
    const interval = setInterval(() => {
      fetchVMInfo()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchVMInfo])

  
  const renderTitle = () => {
    if (signal) {
      if (connectionStatus === 'connecting') {
        return <>
          <Spinner className="w-4 h-4 min-w-4 min-h-4 animate-spin" />
          {t("sharedTerminal.status.connecting")}
        </>
      } else if (connectionStatus === 'disconnected') {
        return <>
          <IconXboxXFilled className="w-4 h-4 min-w-4 min-h-4 text-danger" />
          {t("sharedTerminal.status.disconnected")}
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
      {t("sharedTerminal.status.notEstablished")}
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
              {t("consoleTerminal.vm.os")}
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
                  {t("consoleTerminal.actions.reconnect")}
                </Button>
                <Button variant="outline" size="sm" className="hidden sm:flex" disabled={connectionStatus !== 'connected'} onClick={() => setPortForwardDialogOpen(true)}>
                  <IconDeviceDesktop />
                  {t("consoleTerminal.actions.preview")}
                </Button>
                <Button variant="outline" size="sm" className="hidden lg:flex" disabled={connectionStatus !== 'connected'} onClick={() => { window.open(`/console/files?envid=${envid}&path=/workspace`, '_blank'); }}>
                  <IconFolderOpen />
                  {t("consoleTerminal.actions.files")}
                </Button>
                <Dialog open={isAssistDialogOpen} onOpenChange={handleAssistDialogOpenChange}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="hidden md:flex" disabled={connectionStatus !== 'connected'}>
                      <IconScreenShare />
                      {t("consoleTerminal.actions.remoteAssist")}
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>{t("consoleTerminal.assist.title")}</DialogTitle>
                      {!hasGeneratedPassword ? (
                        <>
                          <DialogDescription className="py-2">
                            <RadioGroup value={assistMode} onValueChange={(value) => setAssistMode(value as ConstsTerminalMode)}>
                              <FieldLabel htmlFor="terminal-mode-readonly">
                                <Field orientation="horizontal" className="cursor-pointer">
                                  <FieldContent>
                                    <FieldTitle className="text-foreground">{t("consoleTerminal.assist.readOnlyTitle")}</FieldTitle>
                                    <FieldDescription>
                                      {t("consoleTerminal.assist.readOnlyDescription")}
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem value={ConstsTerminalMode.TerminalModeReadOnly} id="terminal-mode-readonly" className="cursor-pointer" />
                                </Field>
                              </FieldLabel>
                                <FieldLabel htmlFor="terminal-mode-readwrite">
                                <Field orientation="horizontal" className="cursor-pointer">
                                  <FieldContent>
                                    <FieldTitle className="text-foreground">{t("consoleTerminal.assist.controlTitle")}</FieldTitle>
                                    <FieldDescription>
                                      {t("consoleTerminal.assist.controlDescription")}
                                    </FieldDescription>
                                  </FieldContent>
                                  <RadioGroupItem value={ConstsTerminalMode.TerminalModeReadWrite} id="terminal-mode-readwrite" className="cursor-pointer" />
                                </Field>
                              </FieldLabel>
                            </RadioGroup>
                          </DialogDescription>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAssistDialogOpen(false)}>
                              {t("consoleTerminal.actions.cancel")}
                            </Button>
                            <Button onClick={handleGenerateAssistPassword}>
                              {isGeneratingPassword && <Spinner className="w-4 h-4 mr-2" />}
                              {t("consoleTerminal.assist.generateConnection")}
                            </Button>
                          </DialogFooter>
                        </>
                      ) : (
                        <>
                          <DialogDescription className="py-2 space-y-4">
                            <Field>
                              <FieldLabel className="text-foreground">{t("consoleTerminal.assist.address")}</FieldLabel>
                              <Input
                                className="text-foreground"
                                value={getSharedUrl()}
                                readOnly
                              />
                            </Field>
                            <Field>
                              <FieldLabel className="text-foreground">{t("consoleTerminal.assist.password")}</FieldLabel>
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
                              {t("consoleTerminal.assist.copyConnection")}
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
                    <SelectValue placeholder={t("sharedTerminal.theme.label")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t("sharedTerminal.theme.label")}</SelectLabel>
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
            <AlertDialogTitle>{t("consoleTerminal.alerts.disconnectedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleTerminal.alerts.disconnectedDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setDisconnectDialogOpen(false);
                setSignal(signal + 1);
              }}
            >
              {t("consoleTerminal.actions.reconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={connectionErrorDialogOpen} onOpenChange={setConnectionErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleTerminal.alerts.hostConnectionFailed")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => window.close()}>{t("consoleTerminal.actions.close")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => window.location.reload()}>{t("consoleTerminal.actions.refresh")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VmPortForwardDialog
        open={portForwardDialogOpen}
        onOpenChange={setPortForwardDialogOpen}
        hostId={vm?.host?.id}
        vmId={vm?.id}
      />
    </div>
  )
}
