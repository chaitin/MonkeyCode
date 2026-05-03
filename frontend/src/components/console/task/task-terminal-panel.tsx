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
import { useCallback, useEffect, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"

interface TaskTerminalPanelProps {
  envid?: string
  disabled?: boolean
  onClosePanel?: () => void
}

export function TaskTerminalPanel({ envid, disabled, onClosePanel }: TaskTerminalPanelProps) {
  const [sessions, setSessions] = useState<DomainTerminal[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [signal, setSignal] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected")
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [sessionToClose, setSessionToClose] = useState<string | null>(null)

  const fetchSessions = useCallback(async (): Promise<DomainTerminal[]> => {
    if (!envid) return []

    let nextConnections: DomainTerminal[] = []

    await apiRequest("v1UsersHostsVmsTerminalsDetail", {}, [envid], (resp) => {
      if (resp.code === 0) {
        nextConnections = ((resp.data || []) as DomainTerminal[]).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        setSessions(nextConnections)
      }
    })

    return nextConnections
  }, [envid])

  const handleDeleteSession = async (terminalId: string) => {
    if (!envid) return

    await apiRequest("v1UsersHostsVmsTerminalsDelete", {}, [envid, terminalId], (resp) => {
      if (resp.code === 0) {
        toast.success("终端会话已关闭")
      } else {
        toast.error("关闭终端会话失败: " + resp.message)
      }
    })

    const nextSessions = await fetchSessions()
    if (currentSessionId === terminalId) {
      setCurrentSessionId(nextSessions[0]?.id || null)
      setSignal((prev) => prev + 1)
    }

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
  }, [disabled, envid, fetchSessions])

  useEffect(() => {
    if (connectionStatus === "connected") {
      fetchSessions()
    }
  }, [connectionStatus, fetchSessions])

  useEffect(() => {
    if (sessions.length > 0 && currentSessionId === null) {
      setCurrentSessionId(sessions[0].id || null)
      setSignal((prev) => prev + 1)
    }
  }, [currentSessionId, sessions])

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

  const sidebar = (
    <div className="flex w-48 shrink-0 flex-col border-r bg-muted/10">
      <div className="flex items-center justify-between gap-2 border-b p-2">
        <Button variant="ghost" size="icon-sm" className="size-5" onClick={handleNewSession} disabled={disabled}>
          <IconPlus className="size-4" />
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="size-5" onClick={() => fetchSessions()} disabled={disabled}>
            <IconReload className="size-4" />
          </Button>
          {onClosePanel && (
            <Button variant="ghost" size="icon-sm" className="size-5" onClick={onClosePanel}>
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {displaySessions.length > 0 ? (
          <div className="flex flex-col gap-1">
            {displaySessions.map((session) => {
              const sid = session.id || ""
              const isActive = currentSessionId === sid

              return (
                <div
                  key={sid}
                  className={cn(
                    "group flex items-center gap-2 rounded-md border px-2 transition-colors",
                    isActive
                      ? "border-transparent bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
                    onClick={() => handleSelectSession(sid)}
                  >
                    {getTabIcon(sid)}
                    <span className="truncate text-xs">{getTabTitle(session)}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="hidden size-5 shrink-0 group-hover:flex hover:bg-destructive/10 hover:text-primary"
                    onClick={(e) => handleCloseTab(e, sid)}
                  >
                    <IconX className="size-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="px-1 text-sm text-muted-foreground">
            {disabled ? "开发环境未就绪" : "暂无终端连接"}
          </div>
        )}
      </div>
    </div>
  )

  if (disabled) {
    return (
      <div className="flex h-full min-h-0">
        {sidebar}
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
    <div className="flex h-full min-h-0">
      {sidebar}
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
