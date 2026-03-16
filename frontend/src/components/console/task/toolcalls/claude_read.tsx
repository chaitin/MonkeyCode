import type { MessageType } from "../message";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { IconFileText } from "@tabler/icons-react";

export const renderTitle = (message: MessageType) => {
  return `读取文件 "${message.data.rawInput?.file_path || message.data._meta?.claudeCode?.toolResponse?.file?.filePath}"`
}

export const renderDetail = (message: MessageType) => {
  const startLine = message.data._meta?.claudeCode?.toolResponse?.file?.startLine || 0
  const lines = message.data._meta?.claudeCode?.toolResponse?.file?.content?.split('\n').map((line: string, index: number) => {
    return {
      number: startLine + index + 1,
      content: line
    }
  })
  
  if ((lines || []).length === 0) {
    return <Empty className="">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText className="size-6 opacity-50" />
        </EmptyMedia>
        <EmptyDescription>没有内容</EmptyDescription>
      </EmptyHeader>
    </Empty>
  }

  return <div className="text-xs flex flex-col p-3">
    <div className="w-12 pl-2 bg-accent min-h-2"></div>
    {lines.map((line: any) => {
      return (
        <div key={line.number} className="flex flex-row h-4.5">
          <div className="text-muted-foreground w-12 select-none pl-2 flex items-center flex-shrink-0 bg-accent">{line.number}</div>
          <div className="whitespace-pre flex-1 pr-2 flex items-center px-2">{line.content}</div>
        </div>
      )
    })}
    <div className="w-12 pl-2 bg-accent min-h-2"></div>
  </div>
}