import { IconAlertTriangle, IconChevronDown, IconChevronUp, IconCircleCheck } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import type { MessageType } from "./message"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useMemo, useState } from "react"
import { ConstsCliName } from "@/api/Api"
import * as fallbackRender from "./toolcalls/fallback"
import * as opencodeSearchRender from "./toolcalls/opencode_search"
import * as opencodeReadRender from "./toolcalls/opencode_read"
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

  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full max-w-[80%]">
      <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer outline-none"
          >
            {renderStatus()}
            <span className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all text-xs">
              {title}
            </span>
            <span className="shrink-0 text-muted-foreground">
              {open ? (
                <IconChevronUp className="size-4" />
              ) : (
                <IconChevronDown className="size-4" />
              )}
            </span>
          </button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mt-1 rounded-md border border-border bg-muted/30 text-xs max-h-[50vh] overflow-auto">
          {detail}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

