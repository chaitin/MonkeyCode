import type { DomainTerminal } from "@/api/Api"
import Terminal from "@/components/common/terminal"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiRequest } from "@/utils/requestUtils"
import { IconAlertCircle, IconCloudOff, IconPlus, IconReload, IconTerminal2, IconX } from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"

interface TaskTerminalPanelProps {
  envid?: string
  disabled?: boolean
}

export function TaskTerminalPanel({ envid, disabled }: TaskTerminalPanelProps) {
  const [sessions, setSessions] = useState<DomainTerminal[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [signal, setSignal] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [sessionToClose, setSessionToClose] = useState<string | null>(null)

  const fetchSessions = async () => {
    if (!envid) return

    await apiRequest("v1UsersHostsVmsTerminalsDetail", {}, [envid], (resp) => {
      if (resp.code === 0) {
        const connections = (resp.data || []) as DomainTerminal[]
        connections.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        setSessions(connections)
      }
    })
  }

  const handleDeleteSession = async (terminalId: string) => {
    if (!envid) return

    await apiRequest("v1UsersHostsVmsTerminalsDelete", {}, [envid, terminalId], (resp) => {
      if (resp.code === 0) {
        toast.success("终端会话已关闭")
        if (currentSessionId === terminalId) {
          const remaining = sessions.filter((s) => s.id !== terminalId)
          setCurrentSessionId(remaining[0]?.id || null)
          setSignal((prev) => prev + 1)
        }
        fetchSessions()
      } else {
        toast.error("关闭终端会话失败: " + resp.message)
      }
    })
    setCloseDialogOpen(false)
    setSessionToClose(null)
  }

  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setSignal((prev) => prev + 1)
  }

  const handleNewSession = () => {
    const newId = uuidv4()
    setCurrentSessionId(newId)
    setSignal((prev) => prev + 1)
  }

  const handleCloseTab = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation()
    setSessionToClose(sessionId)
    setCloseDialogOpen(true)
  }

  const onTitleChanged = (title: string) => {
    if (currentSessionId) {
      setTitles((prev) => ({ ...prev, [currentSessionId]: title }))
    }
  }

  useEffect(() => {
    if (!envid || disabled) return
    fetchSessions()
  }, [envid, disabled])

  useEffect(() => {
    if (connectionStatus === "connected") {
      fetchSessions()
    }
  }, [connectionStatus])

  useEffect(() => {
    if (sessions.length > 0 && currentSessionId === null) {
      setCurrentSessionId(sessions[0].id || null)
      setSignal((prev) => prev + 1)
    }
  }, [sessions])

  const displaySessions = [...sessions]
  if (currentSessionId && !sessions.some((s) => s.id === currentSessionId)) {
    displaySessions.unshift({
      id: currentSessionId,
      title: "新终端",
      created_at: Date.now() / 1000,
    })
  }

  const getTabTitle = (session: DomainTerminal) => {
    if (currentSessionId === session.id && connectionStatus === "connected" && titles[session.id || ""]) {
      return titles[session.id || ""]
    }
    return session.title || session.id?.slice(0, 8) || "终端"
  }

  const getTabIcon = (sessionId: string) => {
    if (currentSessionId !== sessionId) {
      return <IconTerminal2 className="size-3.5 text-muted-foreground shrink-0" />
    }
    if (connectionStatus === "connecting") {
      return <Spinner className="size-3.5 shrink-0" />
    }
    if (connectionStatus === "connected") {
      return <IconTerminal2 className="size-3.5 text-green-500 shrink-0" />
    }
    return <IconAlertCircle className="size-3.5 text-red-500 shrink-0" />
  }

  if (disabled) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/50 shrink-0">
          <IconTerminal2 className="size-4 text-primary" />
          <span className="text-sm font-medium">终端</span>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <Empty className="border border-dashed w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconCloudOff className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                开发环境未就绪
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className={cn(
          "flex items-center border-b bg-muted/30 shrink-0 overflow-x-auto px-2 gap-1",
          displaySessions.length === 0 && "min-h-12 py-2"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 cursor-pointer hover:text-primary"
          onClick={handleNewSession}
          disabled={disabled}
        >
          <IconPlus className="size-4" />
        </Button>
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto py-1.5 divide-x divide-border/50">
          {displaySessions.map((session) => {
              const sid = session.id || ""
              const isActive = currentSessionId === sid
              return (
                <div
                  key={sid}
                  className={cn(
                    "group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-md cursor-pointer shrink-0 min-w-0 max-w-[140px] transition-all duration-150",
                    isActive
                      ? "bg-background text-primary border border-border/50"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60 border border-transparent"
                  )}
                  onClick={() => handleSelectSession(sid)}
                >
                  {getTabIcon(sid)}
                  <span className="truncate text-xs font-medium">{getTabTitle(session)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5 shrink-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-primary rounded cursor-pointer"
                    onClick={(e) => handleCloseTab(e, sid)}
                  >
                    <IconX className="size-3" />
                  </Button>
                </div>
              )
            })}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 cursor-pointer hover:text-primary"
          onClick={() => fetchSessions()}
          disabled={disabled}
        >
          <IconReload className="size-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {currentSessionId ? (
          <Terminal
            ws={`/api/v1/users/hosts/vms/${envid}/terminals/connect?terminal_id=${currentSessionId}`}
            theme="Tomorrow"
            signal={signal}
            onTitleChanged={onTitleChanged}
            onUserNameChanged={() => {}}
            onConnectionStatusChanged={setConnectionStatus}
          />
        ) : (
          <Empty className="w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconTerminal2 className="size-6" />
              </EmptyMedia>
              <EmptyDescription>点击 + 创建终端</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <AlertDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认关闭</AlertDialogTitle>
            <AlertDialogDescription>确定要关闭此终端会话吗？此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCloseDialogOpen(false)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => sessionToClose && handleDeleteSession(sessionToClose)}>
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
