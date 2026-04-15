import { useState, useRef } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { IconCommand, IconLoader, IconPlayerStopFilled, IconSend, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { VoiceInputButton } from "./voice-input-button"
import type { TaskMessageHandlerStatus } from "@/components/console/task/task-message-handler"
import type { AvailableCommand, AvailableCommands, TaskStreamStatus } from "./task-shared"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"


interface TaskChatInputBoxProps {
  streamStatus: TaskStreamStatus | TaskMessageHandlerStatus
  availableCommands: AvailableCommands | null
  onSend: (content: string) => void
  sending: boolean
  queueSize: number
  executionTimeMs?: number
  onCancel?: () => void
}

export const TaskChatInputBox = ({ streamStatus, availableCommands, onSend, sending, queueSize, executionTimeMs = 0, onCancel }: TaskChatInputBoxProps) => {
  const [content, setContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isExecuting = (streamStatus === 'connected' || streamStatus === 'inited')

  const handleSend = () => {
    if (content.trim() === '') {
      return
    }
    onSend(content)
    setContent('')
  }

  const handleTextRecognized = (text: string) => {
    setContent(text)
  }

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isExecuting) {
      return
    }
    // 如果正在输入法组合过程中，不触发提交
    if (isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 处理输入法组合开始
  const handleCompositionStart = () => {
    setIsComposing(true)
  }

  // 处理输入法组合结束
  const handleCompositionEnd = () => {
    setIsComposing(false)
  }

  const canInput = React.useMemo(() => {
    return !sending && !isExecuting && queueSize === 0
  }, [sending, isExecuting, queueSize])

  const inputDisabled = React.useMemo(() => {
    return !canInput
  }, [canInput])

  const controlsDisabled = React.useMemo(() => {
    return !canInput
  }, [canInput])

  const commandItems = availableCommands?.commands ?? []
  const showCommandItems = !isExecuting && commandItems.length > 0

  return (
    <div className="relative w-full">
      <InputGroup>
        {!isExecuting && (
          <InputGroupTextarea
            ref={textareaRef}
            className="min-h-8 max-h-48 text-sm break-all"
            placeholder="描述你的需求，Shift+Enter 换行，Enter 发送。"
            value={content}
            onChange={(e) => setContent(e.target.value)} 
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd} />
        )}
        <InputGroupAddon align="block-end" className="pb-1.5">
          <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-2 items-center min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="rounded-full" disabled={controlsDisabled || !showCommandItems}>
                    <IconTerminal2 />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className={showCommandItems ? "w-[min(90vw,32rem)] min-w-80 max-w-[min(90vw,32rem)]" : "w-48 min-w-48"}>
                  {showCommandItems && (
                    <>
                      {commandItems.map((command: AvailableCommand, index: number) => (
                        <DropdownMenuItem key={index} className="flex flex-col items-start gap-1 whitespace-normal" onClick={() => setContent(`/${command.name}`)}>
                          <div className="flex min-w-0 flex-row flex-wrap items-center gap-2">
                            <IconCommand />
                            <div className="font-bold text-xs">/{command.name}</div>
                            {command.input?.hint && <div className="text-muted-foreground text-xs">[{command.input.hint}]</div>}
                          </div>
                          <div className="max-w-full truncate pl-6 text-xs text-muted-foreground">
                            {command.description}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-row gap-2 items-center min-w-0">
              {isExecuting && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <IconLoader className="size-4 animate-spin shrink-0" />
                  <span className="truncate">耗时 {(executionTimeMs / 1000).toFixed(1)} 秒</span>
                </div>
              )}
              {!isExecuting && (
                <VoiceInputButton
                  onTextRecognized={handleTextRecognized}
                  disabled={controlsDisabled}
                />
              )}
              <InputGroupButton 
                className={cn("flex flex-row gap-2 items-center", isExecuting && "rounded-full")}
                variant={isExecuting ? "destructive" : "default"}
                size={isExecuting ? "icon-sm" : "sm"} 
                onClick={isExecuting ? onCancel : handleSend}
                disabled={isExecuting ? !onCancel : content.trim() === '' || inputDisabled}
              >
                {isExecuting ? <IconPlayerStopFilled /> : <IconSend />}
                {!isExecuting && "发送"}
              </InputGroupButton>
            </div>
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
