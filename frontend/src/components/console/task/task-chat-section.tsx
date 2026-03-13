import { MessageItem, type MessageType } from "@/components/console/task/message"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { IconDeviceDesktop, IconFile, IconGitBranch, IconSend, IconTerminal2 } from "@tabler/icons-react"

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
    time: Date.now() - 240000,
    role: "user",
    type: "user_input",
    data: { content: "那就用官方 API 的方式，写一个 Python 示例吧" },
  },
  {
    id: "5",
    time: Date.now() - 270000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "这个请求我不能直接帮你写。企业微信涉及敏感的企业通信数据，建议通过以下合规方式实现：\n\n1. **官方 API**：使用企业微信提供的 Webhook、回调接口接收消息\n2. **会话存档**：开通企业微信的会话内容存档能力\n3. **群机器人**：在群内添加机器人，通过 Webhook 接收消息推送\n\n如需示例，我可以帮你写 Node.js 或 Python 调用上述接口的代码。",
    },
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
    id: "2",
    time: Date.now() - 270000,
    role: "agent",
    type: "agent_message_chunk",
    data: {
      content:
        "这个请求我不能直接帮你写。企业微信涉及敏感的企业通信数据，建议通过以下合规方式实现：\n\n1. **官方 API**：使用企业微信提供的 Webhook、回调接口接收消息\n2. **会话存档**：开通企业微信的会话内容存档能力\n3. **群机器人**：在群内添加机器人，通过 Webhook 接收消息推送\n\n如需示例，我可以帮你写 Node.js 或 Python 调用上述接口的代码。",
    },
  },
]

export type PanelType = "files" | "terminal" | "changes" | "preview"

export interface TaskChatSectionProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  hasPanel: boolean
  activePanel: PanelType | null
  onTogglePanel: (panel: PanelType) => void
}

export function TaskChatSection({
  inputValue,
  onInputChange,
  onSend,
  onKeyDown,
  hasPanel,
  activePanel,
  onTogglePanel,
}: TaskChatSectionProps) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={cn("flex flex-col gap-4", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          {MOCK_MESSAGES.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <div className="shrink-0 bg-background">
        <div className={cn("flex flex-col gap-2", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          <InputGroup className="rounded-lg">
            <InputGroupTextarea
              className="min-h-10 max-h-32 text-sm break-all resize-none"
              placeholder="要求后续变更"
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <InputGroupAddon align="block-end" className="flex justify-end">
              <InputGroupButton
                variant="default"
                size="sm"
                onClick={onSend}
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
              onClick={() => onTogglePanel("files")}
            >
              <IconFile className="size-3.5" />
              文件
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "terminal" && "text-primary bg-accent")}
              onClick={() => onTogglePanel("terminal")}
            >
              <IconTerminal2 className="size-3.5" />
              终端
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "changes" && "text-primary bg-accent")}
              onClick={() => onTogglePanel("changes")}
            >
              <IconGitBranch className="size-3.5" />
              修改
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", activePanel === "preview" && "text-primary bg-accent")}
              onClick={() => onTogglePanel("preview")}
            >
              <IconDeviceDesktop className="size-3.5" />
              预览
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
