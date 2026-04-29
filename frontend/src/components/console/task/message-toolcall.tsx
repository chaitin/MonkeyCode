import { IconAlertTriangle, IconChevronDown, IconChevronUp, IconCircleCheck } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import type { MessageType } from "./message"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useMemo, useState, type ReactNode } from "react"
import { ConstsCliName } from "@/api/Api"
import * as fallbackRender from "./toolcalls/fallback"
import * as opencodeSearchRender from "./toolcalls/opencode_search"
import * as opencodeReadRender from "./toolcalls/opencode_read"
import * as opencodeEditRender from "./toolcalls/opencode_edit"
import * as claudeEditRender from "./toolcalls/claude_edit"
import * as claudeReadRender from "./toolcalls/claude_read"
import * as opencodeFetchRender from "./toolcalls/opencode_fetch"
import * as opencodeLoadSkillRender from "./toolcalls/opencode_load_skill"
import * as internalReportUserAbuseRender from "./toolcalls/internal_report_user_abuse"
import * as internalWebsearchRender from "./toolcalls/internal_websearch"
import * as internalImgsearchRender from "./toolcalls/internal_imgsearch"
import * as internalImageAnalysisRender from "./toolcalls/internal_image_analysis"

type ToolCallRenderer = {
  match: (message: MessageType, cli?: ConstsCliName) => boolean
  renderTitle: (message: MessageType) => ReactNode
  renderDetail: (message: MessageType) => ReactNode
  expandable?: boolean
}

const toolCallRenderers: ToolCallRenderer[] = [
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_internal__report_user_abuse"
    ),
    renderTitle: internalReportUserAbuseRender.renderTitle,
    renderDetail: internalReportUserAbuseRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_request_preview"
    ),
    renderTitle: (message) => {
      const port = message.data.rawInput?.port
      return `请求预览${port !== undefined && port !== null ? ` ${port} 端口` : "端口"}`
    },
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_list"
    ),
    renderTitle: () => "查看后台任务列表",
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_create"
    ),
    renderTitle: () => "创建后台任务",
    renderDetail: fallbackRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "mcaiBuiltin_background_terminal_output_path"
    ),
    renderTitle: () => "查看后台任务的运行日志",
    renderDetail: fallbackRender.renderDetail,
    expandable: false,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__websearch_aisearch"
    ),
    renderTitle: internalWebsearchRender.renderTitle,
    renderDetail: internalWebsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__websearch_search"
    ),
    renderTitle: internalWebsearchRender.renderTitle,
    renderDetail: internalWebsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_MonkeyCode__imgsearch_search"
    ),
    renderTitle: internalImgsearchRender.renderTitle,
    renderDetail: internalImgsearchRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_shitu__image_analysis_create_task"
    ),
    renderTitle: internalImageAnalysisRender.renderTitle,
    renderDetail: internalImageAnalysisRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && message.data.title === "monkeycode-ai_shitu__image_analysis_get_result"
    ),
    renderTitle: internalImageAnalysisRender.renderResultTitle,
    renderDetail: internalImageAnalysisRender.renderResultDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "search",
    renderTitle: opencodeSearchRender.renderTitle,
    renderDetail: opencodeSearchRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "read",
    renderTitle: opencodeReadRender.renderTitle,
    renderDetail: opencodeReadRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "edit",
    renderTitle: opencodeEditRender.renderTitle,
    renderDetail: opencodeEditRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameOpencode && message.data.kind === "fetch",
    renderTitle: opencodeFetchRender.renderTitle,
    renderDetail: opencodeFetchRender.renderDetail,
  },
  {
    match: (message, cli) => (
      cli === ConstsCliName.CliNameOpencode
      && message.data.kind === "other"
      && !!message.data.title?.startsWith("Loaded skill: ")
    ),
    renderTitle: opencodeLoadSkillRender.renderTitle,
    renderDetail: opencodeLoadSkillRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "edit",
    renderTitle: claudeEditRender.renderTitle,
    renderDetail: claudeEditRender.renderDetail,
  },
  {
    match: (message, cli) => cli === ConstsCliName.CliNameClaude && message.data.kind === "read",
    renderTitle: claudeReadRender.renderTitle,
    renderDetail: claudeReadRender.renderDetail,
  },
]

export const ToolCallMessageItem = ({ message, cli }: { message: MessageType, cli?: ConstsCliName }) => {
  const renderer = toolCallRenderers.find((item) => item.match(message, cli)) ?? {
    renderTitle: fallbackRender.renderTitle,
    renderDetail: fallbackRender.renderDetail,
    expandable: true,
  }
  
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
  
  const title = useMemo(() => {
    return renderer.renderTitle(message)
  }, [message, renderer])

  const detail = useMemo(() => {
    return renderer.renderDetail(message)
  }, [message, renderer])

  const [open, setOpen] = useState(false)

  if (renderer.expandable === false) {
    return (
      <div className="w-full max-w-[80%]">
        <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2">
          {renderStatus()}
          <span className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all text-xs leading-4">
            {title}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full max-w-[80%]">
      <div className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 hover:bg-muted/30 transition-colors">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer outline-none"
          >
            {renderStatus()}
            <span className="min-w-0 flex-1 whitespace-normal line-clamp-1 break-all text-xs leading-4">
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
