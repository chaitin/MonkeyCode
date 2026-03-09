import { useState, useEffect, useRef } from "react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { IconCommand, IconMenu4, IconRecycle, IconReload, IconSend, IconTerminal2 } from "@tabler/icons-react"
import React from "react"
import { VoiceInputButton } from "./voice-input-button"
import type { AvailableCommand, AvailableCommands, TaskStreamStatus } from "@/components/console/task/ws-manager"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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


interface TaskChatInputBoxProps {
  streamStatus: TaskStreamStatus
  availableCommands: AvailableCommands | null
  onSend: (content: string) => void
  sending: boolean
  queueSize: number
  sendResetSession: () => void
  sendReloadSession: () => void
}

export const TaskChatInputBox = ({ streamStatus, availableCommands, onSend, sending, queueSize, sendResetSession, sendReloadSession }: TaskChatInputBoxProps) => {
  const [content, setContent] = useState('')
  const [isComposing, setIsComposing] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    if (content.trim() === '') {
      return
    }
    onSend(content)
  }

  const handleTextRecognized = (text: string) => {
    setContent(text)
  }

  useEffect(() => {
    if (!sending) {
      setContent('')
    }
  }, [sending])

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

  const disabled = React.useMemo(() => {
    return sending || streamStatus !== 'waiting' || queueSize > 0
  }, [sending, streamStatus, queueSize])

  return (
    <div className="relative w-full">
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          className="min-h-8 max-h-48 text-sm break-all"
          placeholder={disabled ? '任务正在执行，暂时无法输入' : '在这里描述你的需求，Shift+Enter 换行，Enter 发送。'}
          value={content}
          disabled={disabled}
          onChange={(e) => setContent(e.target.value)} 
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd} />
        <InputGroupAddon align="block-end">
          <div className="flex flex-row justify-between w-full">
            <div className="flex flex-row gap-2 items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="rounded-full" disabled={disabled}>
                    <IconMenu4 />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => setResetDialogOpen(true)}>
                    <IconRecycle />
                    重置上下文
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => sendReloadSession()}>
                    <IconReload />
                    重新加载开发工具
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" className="rounded-full" disabled={disabled}>
                    <IconTerminal2 />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {availableCommands?.commands?.map((command: AvailableCommand, index: number) => (
                    <DropdownMenuItem key={index} className="flex flex-col gap-1 items-start" onClick={() => setContent(`/${command.name}`)}>
                      <div className="flex flex-row gap-2 items-center">
                        <IconCommand />
                        <div className="font-bold text-xs">/{command.name}</div>
                        {command.input?.hint && <div className="text-muted-foreground text-xs">[{command.input.hint}]</div>}
                      </div>
                      <div className="text-xs text-muted-foreground pl-6">
                        {command.description}
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

            </div>
            <div className="flex flex-row gap-2 items-center">
              <VoiceInputButton
                onTextRecognized={handleTextRecognized}
                disabled={disabled}
              />
              <InputGroupButton 
                className="flex flex-row gap-2 items-center" 
                variant="default" 
                size="sm" 
                onClick={handleSend} 
                disabled={content.trim() === '' || disabled}
              >
                <IconSend />
                发送
              </InputGroupButton>
            </div>
          </div>
        </InputGroupAddon>
      </InputGroup>

      {/* Reset Session 确认对话框 */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置上下文</AlertDialogTitle>
            <AlertDialogDescription>
              确定要重置当前上下文吗？后续操作将会基于新的上下文进行。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                sendResetSession()
                setResetDialogOpen(false)
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}

