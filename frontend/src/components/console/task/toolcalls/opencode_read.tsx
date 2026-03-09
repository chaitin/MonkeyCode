import type { MessageType } from "../message";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { IconFileText } from "@tabler/icons-react";


export const renderTitle = (message: MessageType) => {
  return `读取文件${message.data.rawInput?.filePath ? ` "${message.data.rawInput?.filePath}"` : ''}`
}

export const renderDetail = (message: MessageType) => {

  const lines = message.data.rawOutput?.output?.split('\n').map((line: string) => {
    return line.match(/^(\d+)\| (.*)$/)
  }).filter((line: any) => line !== null).map((line: any) => {
    return {
      number: parseInt(line[1]),
      content: line[2]
    }
  })
  
  if ((lines || []).length === 0) {
    return <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText className="" />
        </EmptyMedia>
        <EmptyTitle>没有内容</EmptyTitle>
      </EmptyHeader>
    </Empty>
  }

  return <div className="text-xs flex flex-col max-h-[50vh] overflow-auto bg-accent/30 rounded-md">
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