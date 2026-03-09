import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import type { MessageType } from "./message"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useMemo } from "react"
import { ConstsCliName } from "@/api/Api"
import * as fallbackRender from "./toolcalls/fallback"
import * as opencodeSearchRender from "./toolcalls/opencode_search"
import * as opencodeReadRender from "./toolcalls/opencode_read"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import * as opencodeEditRender from "./toolcalls/opencode_edit"
import * as claudeEditRender from "./toolcalls/claude_edit"
import * as claudeReadRender from "./toolcalls/claude_read"
import * as opencodeFetchRender from "./toolcalls/opencode_fetch"
import * as opencodeLoadSkillRender from "./toolcalls/opencode_load_skill"

export const ToolCallMessageItem = ({ message, cli }: { message: MessageType, cli?: ConstsCliName }) => {
  let renderTitle = fallbackRender.renderTitle
  let renderDetail = fallbackRender.renderDetail
  
  const renderStatus = () => {
    switch (message.data.status) {
      case 'in_progress':
        return <Spinner className="size-4" />
      case 'pending':
        return <Spinner className="size-4" />
      case 'completed':
        return <IconCircleCheck className="size-4" />
      case 'failed':
        return <IconAlertTriangle className="size-4" />
    }
  }

  if (cli === ConstsCliName.CliNameOpencode && message.data.kind === 'search') {
    renderTitle = opencodeSearchRender.renderTitle
    renderDetail = opencodeSearchRender.renderDetail
  } else if (cli === ConstsCliName.CliNameOpencode && message.data.kind === 'read') {
    renderTitle = opencodeReadRender.renderTitle
    renderDetail = opencodeReadRender.renderDetail
  } else if (cli === ConstsCliName.CliNameOpencode && message.data.kind === 'edit') {
    renderTitle = opencodeEditRender.renderTitle
    renderDetail = opencodeEditRender.renderDetail
  } else if (cli === ConstsCliName.CliNameOpencode && message.data.kind === 'fetch') {
    renderTitle = opencodeFetchRender.renderTitle
    renderDetail = opencodeFetchRender.renderDetail
  } else if (cli === ConstsCliName.CliNameOpencode && message.data.kind === 'other' && message.data.title?.startsWith('Loaded skill: ')) {
    renderTitle = opencodeLoadSkillRender.renderTitle
    renderDetail = opencodeLoadSkillRender.renderDetail
  } else if (cli === ConstsCliName.CliNameClaude && message.data.kind === 'edit') {
    renderTitle = claudeEditRender.renderTitle
    renderDetail = claudeEditRender.renderDetail
  } else if (cli === ConstsCliName.CliNameClaude && message.data.kind === 'read') {
    renderTitle = claudeReadRender.renderTitle
    renderDetail = claudeReadRender.renderDetail
  }
  
  const title = useMemo(() => {
    return renderTitle(message)
  }, [message])

  const detail = useMemo(() => {
    return renderDetail(message)
  }, [message])

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Badge variant="outline" className="max-w-[80%] cursor-pointer hover:text-primary">
          {renderStatus()}
          <div className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all">
            {title}
          </div>
        </Badge>
      </DialogTrigger>
      <DialogContent className="w-fit min-w-[480px] sm:max-w-[90vw] md:max-w-[80vw] lg:max-w-[70vw] xl:max-w-[60vw]">
        <DialogHeader>
          <Tooltip>
            <TooltipTrigger asChild>
              <DialogTitle className="line-clamp-1 break-all w-fit">
                {title}
              </DialogTitle>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {title}
            </TooltipContent>
          </Tooltip>
        </DialogHeader>
        {detail}
      </DialogContent>
    </Dialog>
  )
}

