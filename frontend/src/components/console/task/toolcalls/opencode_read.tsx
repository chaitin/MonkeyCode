import type { MessageType } from "../message";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { IconFileText } from "@tabler/icons-react";
import { taskDetailT } from "../task-i18n";


export const renderTitle = (message: MessageType) => {
  return `${taskDetailT("toolcall.readFile")}${message.data.rawInput?.filePath ? ` "${message.data.rawInput?.filePath}"` : ''}`
}

export const renderDetail = (message: MessageType) => {
  
  if ((message.data.rawOutput?.output || '').trim().length === 0) {
    return <Empty className="">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFileText className="size-6 opacity-50" />
        </EmptyMedia>
        <EmptyDescription>{taskDetailT("toolcall.noContent")}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  }

  return <pre className="text-xs p-3">
    {message.data.rawOutput?.output}
  </pre>
}
