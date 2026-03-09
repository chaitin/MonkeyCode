import React, { useState } from "react";
import Header from "@/components/welcome/header"
import { useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/components/auth-provider";
import { TaskWebSocketManager, type TaskPlan, type TaskStreamStatus, type TaskWebSocketState } from "@/components/console/task/ws-manager";
import type { MessageType } from "@/components/console/task/message";
import { TaskChatPanel } from "@/components/console/task/chat-panel";

const PublicTaskPage = () => {
  const [searchParams] = useSearchParams()
  const [taskId] = useState(searchParams.get('id'));
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const [thinkingMessage, setThinkingMessage] = React.useState("")
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>('inited')
  const [messages, setMessages] = React.useState<MessageType[]>([])
  const [plan, setPlan] = React.useState<TaskPlan | null>(null)
  const [sending, setSending] = React.useState(false)

  // 初始化 websocket
  React.useEffect(() => {
    if (!taskId) {
      return
    }

    const manager = new TaskWebSocketManager(taskId, (state: TaskWebSocketState) => {
      // 直接更新状态，创建新的数组引用让 React 正确检测变化
      setStreamStatus(state.status)
      setMessages([...state.messages])
      setPlan(state.plan)
      setSending(state.sending)
      setThinkingMessage(state.thinkingMessage)
    }, searchParams.get('fast') === null, true)
    taskManager.current = manager
    manager.connect()

    return () => {
      manager.disconnect()
      taskManager.current = null
    }
  }, [taskId])



  return (
    <AuthProvider>
      <div className="flex flex-col h-screen">
        <Header />
        <div className="flex flex-1 w-full flex-row py-2 h-full gap-2 justify-center items-center overflow-y-auto mt-15 max-w-[1200px] mx-auto">
          <TaskChatPanel 
            messages={messages} 
            streamStatus={streamStatus}
            disabled={true} 
            sending={sending}
            thinkingMessage={thinkingMessage}
            plan={plan}
            availableCommands={null}
            queueSize={0}
            sendUserInput={() => {}}
            sendCancelCommand={() => {}}
            sendResetSession={() => {}}
            sendReloadSession={() => {}}
            fileChanges={[]}
            fileChangesMap={new Map()}
            taskManager={taskManager.current}
          />
        </div>
      </div>

    </AuthProvider>
  )
}

export default PublicTaskPage


