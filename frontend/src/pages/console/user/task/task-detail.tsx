import { type DomainProjectTask } from "@/api/Api"
import { useBreadcrumbTask } from "@/components/console/breadcrumb-task-context"
import { MessageItem, type MessageType } from "@/components/console/task/message"
import { TaskFileExplorer } from "@/components/console/task/task-file-explorer"
import { TaskTerminalPanel } from "@/components/console/task/task-terminal-panel"
import { TaskWebSocketManager, type RepoFileChange, type TaskStreamStatus, type TaskWebSocketState } from "@/components/console/task/ws-manager"
import { TaskChangesPanel } from "@/components/console/task/task-changes-panel"
import { TaskPreviewPanel } from "@/components/console/task/task-preview-panel"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import { IconDeviceDesktop, IconFile, IconGitBranch, IconSend, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { TypesVirtualMachineStatus } from "@/api/Api"

const MOCK_MESSAGES: MessageType[] = [
  {
    id: "1",
    time: Date.now() - 300000,
    role: "user",
    type: "user_input",
    data: { content: "请帮我写个 Frida 脚本，来实现自动收取企业微信消息的逻辑" },
  },
  {
    id: "2",
    time: Date.now() - 270000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "这个请求我不能直接帮你写。企业微信涉及敏感的企业通信数据，建议通过以下合规方式实现：\n\n1. **官方 API**：使用企业微信提供的 Webhook、回调接口接收消息\n2. **会话存档**：开通企业微信的会话内容存档能力\n3. **群机器人**：在群内添加机器人，通过 Webhook 接收消息推送\n\n如需示例，我可以帮你写 Node.js 或 Python 调用上述接口的代码。",
    },
  },
  {
    id: "3",
    time: Date.now() - 240000,
    role: "user",
    type: "user_input",
    data: { content: "那就用官方 API 的方式，写一个 Python 示例吧" },
  },
  {
    id: "4",
    time: Date.now() - 210000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "好的，下面是一个基于企业微信 Webhook 的 Python 示例：\n\n```python\nimport requests\n\nWEBHOOK_URL = \"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY\"\n\ndef send_message(content):\n    requests.post(WEBHOOK_URL, json={\"msgtype\": \"text\", \"text\": {\"content\": content}})\n```\n\n将 `YOUR_KEY` 替换为你的 Webhook 地址中的 key 即可。",
    },
  },
  {
    id: "5",
    time: Date.now() - 180000,
    role: "user",
    type: "user_input",
    data: { content: "能不能加上接收消息的功能？不只是发送" },
  },
  {
    id: "6",
    time: Date.now() - 150000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "接收消息需要用到**企业微信的回调模式**。大致流程：\n\n1. 在应用管理后台配置「接收消息」的 URL\n2. 企业微信会向该 URL 发送 POST 请求，携带加密的消息体\n3. 服务端解密后即可拿到消息内容\n\n需要你提供：\n- 应用的 `corpid` 和 `corpsecret`\n- 已配置好的接收消息 URL（需公网可访问）\n- 消息加解密的 `EncodingAESKey`\n\n我可以帮你写一个 Flask 示例，接收并解析这些回调。",
    },
  },
  {
    id: "7",
    time: Date.now() - 120000,
    role: "user",
    type: "user_input",
    data: { content: "好的，用 Flask 写一个完整的接收示例" },
  },
  {
    id: "8",
    time: Date.now() - 90000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "```python\nfrom flask import Flask, request\nimport xml.etree.ElementTree as ET\nfrom wechatpy.enterprise import WeChatClient\nfrom wechatpy.enterprise.crypto import WeChatCrypto\n\napp = Flask(__name__)\n\n# 配置\nCORP_ID = \"your_corp_id\"\nAGENT_SECRET = \"your_agent_secret\"\nTOKEN = \"your_token\"\nAES_KEY = \"your_aes_key\"  # 43 位\n\ncrypto = WeChatCrypto(TOKEN, AGENT_SECRET, CORP_ID)\n\n@app.route(\"/wechat\", methods=[\"GET\", \"POST\"])\ndef wechat_callback():\n    if request.method == \"GET\":\n        # 验证 URL\n        msg_signature = request.args.get(\"msg_signature\")\n        timestamp = request.args.get(\"timestamp\")\n        nonce = request.args.get(\"nonce\")\n        echostr = request.args.get(\"echostr\")\n        decrypted = crypto.decrypt_message(msg_signature, timestamp, nonce, echostr)\n        return decrypted\n    else:\n        # 接收消息\n        msg = crypto.decrypt_message(\n            request.args.get(\"msg_signature\"),\n            request.args.get(\"timestamp\"),\n            request.args.get(\"nonce\"),\n            request.get_data(as_text=True)\n        )\n        xml = ET.fromstring(msg)\n        msg_type = xml.find(\"MsgType\").text\n        content = xml.find(\"Content\").text if xml.find(\"Content\") is not None else \"\"\n        # 处理消息...\n        return \"\"\n```\n\n安装依赖：`pip install flask wechatpy`",
    },
  },
  {
    id: "9",
    time: Date.now() - 60000,
    role: "user",
    type: "user_input",
    data: { content: "MsgType 都有哪些类型？" },
  },
  {
    id: "10",
    time: Date.now() - 30000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "企业微信回调中常见的 `MsgType` 包括：\n\n| 类型 | 说明 |\n|------|------|\n| `text` | 文本消息 |\n| `image` | 图片消息 |\n| `voice` | 语音消息 |\n| `video` | 视频消息 |\n| `location` | 位置消息 |\n| `link` | 链接消息 |\n| `event` | 事件推送（如关注、取消关注、菜单点击等） |\n\n事件类消息的 `Event` 字段会进一步区分具体事件类型。",
    },
  },
  {
    id: "11",
    time: Date.now() - 10000,
    role: "user",
    type: "user_input",
    data: { content: "谢谢，我先试试" },
  },
  {
    id: "12",
    time: Date.now(),
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content: "不客气，有问题随时问我。",
    },
  },
]

type PanelType = "files" | "terminal" | "changes" | "preview"

export default function TaskDetailPage() {
  const { taskId } = useParams()
  const { setTaskName } = useBreadcrumbTask() ?? {}
  const [task, setTask] = React.useState<DomainProjectTask | null>(null)
  const [activePanel, setActivePanel] = React.useState<PanelType | null>(null)
  const [inputValue, setInputValue] = React.useState("")
  const [fileChangesMap, setFileChangesMap] = React.useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = React.useState<string[]>([])
  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>("inited")
  const taskManager = React.useRef<TaskWebSocketManager | null>(null)
  const connectedRef = React.useRef(false)

  const vmOnline = task?.virtualmachine?.status === TypesVirtualMachineStatus.VirtualMachineStatusOnline
  const envid = task?.virtualmachine?.id

  const fetchTaskDetail = React.useCallback(async () => {
    if (!taskId) return null
    let result: DomainProjectTask | null = null
    await apiRequest("v1UsersTasksDetail", {}, [taskId], (resp) => {
      if (resp.code === 0) {
        result = resp.data
        setTask(resp.data)
      } else {
        toast.error(resp.message || "获取任务详情失败")
      }
    })
    return result
  }, [taskId])

  const fetchFileChanges = React.useCallback(() => {
    taskManager.current?.getFileChanges().then((changes: RepoFileChange[] | null) => {
      if (changes === null) return
      const newMap = new Map<string, RepoFileChange>()
      const newPaths: string[] = []
      changes.forEach((change) => {
        newMap.set(change.path, change)
        newPaths.push(change.path)
      })
      setFileChangesMap(newMap)
      setChangedPaths(newPaths)
    })
  }, [])

  const updateTaskState = (state: TaskWebSocketState) => {
    setStreamStatus(state.status)
    if (state.fileChanges.version !== undefined) {
      fetchFileChanges()
    }
  }

  React.useEffect(() => {
    if (!taskId) return
    fetchTaskDetail()
  }, [taskId, fetchTaskDetail])

  React.useEffect(() => {
    if (!setTaskName) return
    if (task) {
      const name = task.summary || task.content
      setTaskName(name?.trim() || "未知任务名称")
    }
    return () => setTaskName?.(null)
  }, [task, setTaskName])

  React.useEffect(() => {
    if (!taskId) return
    connectedRef.current = false
    const manager = new TaskWebSocketManager(taskId, updateTaskState, false, false)
    taskManager.current = manager
    return () => {
      manager.disconnect()
      taskManager.current = null
      connectedRef.current = false
    }
  }, [taskId])

  React.useEffect(() => {
    if (!taskManager.current || connectedRef.current) return
    if (task?.virtualmachine?.status !== undefined && task?.virtualmachine?.status !== TypesVirtualMachineStatus.VirtualMachineStatusPending) {
      taskManager.current.connect()
      connectedRef.current = true
    }
  }, [task?.virtualmachine?.status])

  React.useEffect(() => {
    if (vmOnline && (streamStatus === "waiting" || streamStatus === "executing")) {
      fetchFileChanges()
    }
  }, [vmOnline, streamStatus, fetchFileChanges])

  const handleSend = () => {
    if (!inputValue.trim()) return
    // TODO: 发送后续变更请求
    setInputValue("")
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

    const hasPanel = activePanel !== null
  const togglePanel = (panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel))
  }


  const chatSection = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className={cn("flex flex-col gap-4", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          {MOCK_MESSAGES.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-4 bg-background">
        <div className={cn("flex flex-col gap-2", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          <InputGroup className="rounded-lg">
            <InputGroupTextarea
              className="min-h-10 max-h-32 text-sm break-all resize-none"
              placeholder="要求后续变更"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <InputGroupAddon align="block-end" className="flex justify-end">
              <InputGroupButton
                variant="default"
                size="sm"
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className="gap-1"
              >
                <IconSend className="size-4" />
                发送
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "files" && "text-primary bg-accent")}
              onClick={() => togglePanel("files")}
            >
              <IconFile className="size-3.5" />
              文件
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "terminal" && "text-primary bg-accent")}
              onClick={() => togglePanel("terminal")}
            >
              <IconTerminal2 className="size-3.5" />
              终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "changes" && "text-primary bg-accent")}
              onClick={() => togglePanel("changes")}
            >
              <IconGitBranch className="size-3.5" />
              修改
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "preview" && "text-primary bg-accent")}
              onClick={() => togglePanel("preview")}
            >
              <IconDeviceDesktop className="size-3.5" />
              预览
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  if (!hasPanel) {
    return (
      <div className="flex flex-col h-full min-h-0 -mx-4">
        {chatSection}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 -mx-4">
      <ResizablePanelGroup direction="horizontal" className="gap-1">
        <ResizablePanel defaultSize={55} minSize={35} className="min-w-0">
          {chatSection}
        </ResizablePanel>
        <ResizableHandle withHandle className="shrink-0" />
        <ResizablePanel defaultSize={45} minSize={25} className="min-w-0">
          <div className="h-full overflow-hidden animate-in slide-in-from-right fade-in-0 duration-200 flex flex-col">
            {activePanel === "files" && (
              <div className="flex-1 min-h-0 flex flex-col p-0">
                {envid && vmOnline ? (
                  <TaskFileExplorer
                    disabled={!vmOnline}
                    streamStatus={streamStatus}
                    fileChangesMap={fileChangesMap}
                    changedPaths={changedPaths}
                    taskManager={taskManager.current}
                    onRefresh={fetchFileChanges}
                    envid={envid}
                  />
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {!task ? "加载中..." : "开发环境未就绪，请先进入开发页面启动任务"}
                  </div>
                )}
              </div>
            )}
            {activePanel === "terminal" && (
              <div className="flex-1 min-h-0 overflow-auto p-0">
                {envid ? (
                  <div className="h-full w-full border rounded-md overflow-hidden">
                    <TaskTerminalPanel envid={envid} disabled={!vmOnline} />
                  </div>
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {!task ? "加载中..." : "开发环境未就绪"}
                  </div>
                )}
              </div>
            )}
            {activePanel === "changes" && (
              <div className="flex-1 min-h-0 overflow-hidden">
                {vmOnline ? (
                  <TaskChangesPanel
                    fileChanges={changedPaths}
                    fileChangesMap={fileChangesMap}
                    taskManager={taskManager.current}
                  />
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {!task ? "加载中..." : "开发环境未就绪，无法查看变更"}
                  </div>
                )}
              </div>
            )}
            {activePanel === "preview" && (
              <div className="flex-1 min-h-0 overflow-hidden">
                {vmOnline ? (
                  <TaskPreviewPanel
                    ports={task?.virtualmachine?.ports}
                    hostId={task?.virtualmachine?.host?.id}
                    vmId={task?.virtualmachine?.id}
                    onSuccess={fetchTaskDetail}
                    disabled={!vmOnline}
                  />
                ) : (
                  <div className="p-4 text-sm text-muted-foreground">
                    {!task ? "加载中..." : "开发环境未就绪，无法预览"}
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
