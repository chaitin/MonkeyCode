import { useState, useEffect, useRef } from "react"
import { Button } from "../ui/button"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "../ui/input-group"
import { IconSend, IconTerminal2, IconVocabulary, IconBug, IconSquareRoundedLetterOFilled } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import Icon from "../common/Icon";
import { Link } from "react-router-dom"

const InputBox = () => {
  const [value, setValue] = useState("")
  const [taskType, setTaskType] = useState<string>("development")
  const [taskTypePopoverOpen, setTaskTypePopoverOpen] = useState<boolean>(false)
  const fullText = `请先阅读 ./docs/ 目录下的文档，在理解项目架构后为 http 服务增加一个中间件来实现限速功能，使每个用户每分钟内只能请求 10 次，超过则返回 429 状态码`
  const currentIndexRef = useRef(0)
  const isDeletingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTypingRef = useRef(true)
  
  useEffect(() => {
    if (!isTypingRef.current) return
    
    const type = () => {
      if (!isTypingRef.current) return
      
      if (!isDeletingRef.current && currentIndexRef.current < fullText.length) {
        // 打字阶段
        currentIndexRef.current++
        setValue(fullText.slice(0, currentIndexRef.current))
        timerRef.current = setTimeout(type, 100)
      } else if (!isDeletingRef.current && currentIndexRef.current === fullText.length) {
        // 完成打字，等待后开始删除
        isDeletingRef.current = true
        timerRef.current = setTimeout(type, 2000) // 等待2秒
      } else if (isDeletingRef.current && currentIndexRef.current > 0) {
        // 删除阶段
        currentIndexRef.current--
        setValue(fullText.slice(0, currentIndexRef.current))
        timerRef.current = setTimeout(type, 50)
      } else {
        // 删除完成，重新开始
        isDeletingRef.current = false
        timerRef.current = setTimeout(type, 500) // 等待0.5秒后重新开始
      }
    }
    
    timerRef.current = setTimeout(type, 500) // 初始延迟
    
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [fullText])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    isTypingRef.current = false // 用户开始输入时停止打字机效果
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
  }

  return (
    <InputGroup className="bg-background text-primary">
      <InputGroupTextarea 
        value={value} 
        onChange={handleChange}
        className="mb-6 text-foreground" 
      />
      <InputGroupAddon align="block-end" className="flex flex-row justify-between w-full">
        <div className="flex flex-row gap-2">
          <Popover open={taskTypePopoverOpen} onOpenChange={setTaskTypePopoverOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="rounded-full text-primary hover:text-primary">
                {taskType === "development" && <><IconTerminal2 />开发</>}
                {taskType === "design" && <><IconVocabulary />设计</>}
                {taskType === "review" && <><IconBug />审查</>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0">
              <Command>
                <CommandList>
                  <CommandGroup>
                    <CommandItem value="development" onSelect={() => {
                      setTaskType("development")
                      setTaskTypePopoverOpen(false)
                    }} >
                      <div className="flex flex-row gap-2 items-center" >
                        <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                          <IconTerminal2 className="size-5 text-foreground" />
                        </div>
                        <div className="flex flex-col" >
                          <div className="font-bold">
                            开发
                          </div>
                          <div className="text-muted-foreground text-xs">
                            根据需求执行开发编码任务
                          </div>
                        </div>
                      </div>
                    </CommandItem>
                    <CommandItem value="design" onSelect={() => {
                      setTaskType("design")
                      setTaskTypePopoverOpen(false)
                    }}>
                      <div className="flex flex-row gap-2 items-center" >
                        <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                          <IconVocabulary className="size-5 text-foreground" />
                        </div>
                        <div className="flex flex-col" >
                          <div className="font-bold">
                            设计
                          </div>
                          <div className="text-muted-foreground text-xs">
                            进行架构设计，输出技术方案与设计文档
                          </div>
                        </div>
                      </div>
                    </CommandItem>
                    <CommandItem value="review" onSelect={() => {
                      setTaskType("review")
                      setTaskTypePopoverOpen(false)
                    }}>
                      <div className="flex flex-row gap-2 items-center" >
                        <div className="size-8 bg-accent rounded-full flex items-center justify-center">
                          <IconBug className="size-5 text-foreground" />
                        </div>
                        <div className="flex flex-col" >
                          <div className="font-bold">
                            审查
                          </div>
                          <div className="text-muted-foreground text-xs">
                            审查代码，识别风险，提出改进建议
                          </div>
                        </div>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Select>
              <SelectTrigger className="max-w-[200px] rounded-full hidden md:flex">
              <SelectValue placeholder="开发工具" />
              </SelectTrigger>
              <SelectContent>
              <SelectItem value="1">
                  <Icon name="openai" />
                  OpenAI Codex
              </SelectItem>
              <SelectItem value="2">
                  <Icon name="claude" />
                  Claude Code
              </SelectItem>
              <SelectItem value="3">
                  <IconSquareRoundedLetterOFilled className="size-4 text-primary" />
                  OpenCode
              </SelectItem>
              </SelectContent>
          </Select>
          <Select>
              <SelectTrigger className="max-w-[200px] rounded-full hidden md:flex">
              <SelectValue placeholder="大模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">
                    <Icon name="openai" />
                    GPT-5
                </SelectItem>
                <SelectItem value="2">
                    <Icon name="claude" />
                    Claude-Sonnet-4.5
                </SelectItem>
                <SelectItem value="3">
                    <Icon name="deepseek" />
                    Deekseek-v3.1
                </SelectItem>
                <SelectItem value="4">
                    <Icon name="kimi" />
                    Kimi-K2
                </SelectItem>
                <SelectItem value="5">
                    <Icon name="qwen" />
                    Qwen3-coder-plus
                </SelectItem>
              </SelectContent>
          </Select>
        </div>
        <Button className="rounded-full" asChild>
          <Link to="/console/">
            执行任务
            <IconSend />
          </Link>
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
};

export default InputBox;