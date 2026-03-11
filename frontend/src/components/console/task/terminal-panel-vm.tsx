import type { DomainTerminal } from "@/api/Api"
import Terminal from "@/components/common/terminal"
import { Button } from "@/components/ui/button"
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { apiRequest } from "@/utils/requestUtils"
import {
  IconAlertCircle,
  IconCirclePlus,
  IconLoader,
  IconReload,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react"
import { useEffect, useState } from "react"
import { v4 as uuidv4 } from "uuid"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"

export const TerminalPanelVm = ({
  envid,
  disabled,
}: {
  envid?: string
  disabled?: boolean
}) => {
  const [sessions, setSessions] = useState<DomainTerminal[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [signal, setSignal] = useState<number>(0)
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("disconnected")
  const [title, setTitle] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const fetchSessions = async (needLoading: boolean = true) => {
    if (!envid) return
    if (needLoading) setLoading(true)

    await apiRequest("v1UsersHostsVmsTerminalsDetail", {}, [envid], (resp) => {
      if (resp.code === 0) {
        const connections = resp.data || []
        connections.sort((a: DomainTerminal, b: DomainTerminal) => {
          return (b.created_at || 0) - (a.created_at || 0)
        })
        setSessions(connections)
      }
    })
    if (needLoading) setLoading(false)
  }

  const handleDeleteSession = async (terminalId: string) => {
    if (!envid) return

    await apiRequest(
      "v1UsersHostsVmsTerminalsDelete",
      {},
      [envid, terminalId],
      (resp) => {
        if (resp.code === 0) {
          toast.success("终端会话已关闭")
          fetchSessions(false)
          if (currentSessionId === terminalId) {
            setCurrentSessionId(null)
            setConnectionStatus("disconnected")
          }
        } else {
          toast.error("关闭终端会话失败: " + resp.message)
        }
      }
    )
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

  useEffect(() => {
    if (!envid || disabled) return
    fetchSessions(true)
  }, [envid, disabled])

  useEffect(() => {
    if (connectionStatus === "connected") {
      fetchSessions(false)
    }
  }, [connectionStatus])

  const renderSessionIcon = (sessionId: string) => {
    if (currentSessionId === sessionId) {
      if (connectionStatus === "connecting") {
        return <Spinner className="w-4 h-4 min-w-4" />
      } else if (connectionStatus === "connected") {
        return <IconTerminal2 className="w-4 h-4 min-w-4 text-green-500" />
      } else {
        return <IconAlertCircle className="w-4 h-4 min-w-4 text-red-500" />
      }
    }
    return <IconTerminal2 className="w-4 h-4 min-w-4 text-muted-foreground" />
  }

  const renderSessionTitle = (session: DomainTerminal) => {
    if (currentSessionId === session.id && connectionStatus === "connected" && title) {
      return title
    }
    return session.title || session.id?.slice(0, 8)
  }

  const renderLoading = () => (
    <div className="flex w-full h-full">
      <Empty className="opacity-50">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLoader className="animate-spin" />
          </EmptyMedia>
          <EmptyDescription>正在加载...</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const renderEmpty = () => (
    <div className="flex w-full h-full">
      <Empty className="opacity-50">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconTerminal2 />
          </EmptyMedia>
          <EmptyDescription>暂无终端连接</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const renderDisabled = () => (
    <div className="flex w-full h-full">
      <Empty className="opacity-50">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconTerminal2 />
          </EmptyMedia>
          <EmptyDescription>开发环境不可用</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )

  const renderSessionList = () =>
    sessions.map((session) => (
      <div
        key={session.id}
        className={cn(
          "group flex flex-row px-2 py-1.5 rounded-md hover:bg-muted cursor-default items-center"
        )}
        onClick={() => handleSelectSession(session.id || "")}
      >
        <div className="flex flex-1 items-center gap-1 overflow-hidden">
          {renderSessionIcon(session.id || "")}
          <div
            className={cn(
              "text-xs truncate cursor-pointer hover:text-primary",
              currentSessionId === session.id && "text-primary"
            )}
          >
            {renderSessionTitle(session)}
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-2 w-2 hover:text-primary cursor-pointer group-hover:flex hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <IconX className="h-2 w-2" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认关闭</AlertDialogTitle>
              <AlertDialogDescription>
                确定要关闭此终端会话吗？此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleDeleteSession(session.id || "")}>
                确认关闭
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    ))

  const renderContent = () => {
    if (disabled) return renderDisabled()
    if (loading) return renderLoading()
    if (sessions.length === 0) return renderEmpty()
    return renderSessionList()
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="flex-1 h-full">
      <ResizablePanel defaultSize={30} minSize={20}>
        <div className="h-full flex flex-col">
          <div className="p-2 flex items-center justify-between border-b bg-muted/50">
            <Label>
              <IconTerminal2 className="size-4 text-primary" />
              终端
            </Label>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => fetchSessions(true)}
                    disabled={disabled}
                  >
                    <IconReload className={loading ? "animate-spin" : ""} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>刷新列表</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleNewSession}
                    disabled={disabled}
                  >
                    <IconCirclePlus />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>新建会话</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="p-1 flex-1 h-0 overflow-y-auto">{renderContent()}</div>
        </div>
      </ResizablePanel>

      {currentSessionId ? (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={70} minSize={50}>
            <div className="h-full w-full">
              <Terminal
                ws={`/api/v1/users/hosts/vms/${envid}/terminals/connect?terminal_id=${currentSessionId}`}
                theme="Tomorrow"
                signal={signal}
                onTitleChanged={setTitle}
                onUserNameChanged={() => {}}
                onConnectionStatusChanged={setConnectionStatus}
              />
            </div>
          </ResizablePanel>
        </>
      ) : null}
    </ResizablePanelGroup>
  )
}
