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
import { UnifiedDiffViewer } from "./unified-diff-viewer"

type ToolCallRenderer = {
  match: (message: MessageType, cli?: ConstsCliName) => boolean
  renderTitle: (message: MessageType) => ReactNode
  renderDetail: (message: MessageType) => ReactNode
  expandable?: boolean | ((message: MessageType) => boolean)
}

const imageAnalysisCreateTaskTitles = new Set([
  "monkeycode-ai_MonkeyCode__image_analysis_create_task",
])

const imageAnalysisGetResultTitles = new Set([
  "monkeycode-ai_MonkeyCode__image_analysis_get_result",
])

const getPatchUpdatedFileLabel = (message: MessageType) => {
  const files = message.data.rawOutput?.metadata?.files
  if (Array.isArray(files) && files.length > 0) {
    return files
      .map((file) => file?.relativePath || file?.filePath)
      .filter((filePath): filePath is string => typeof filePath === "string" && filePath.trim().length > 0)
      .join(", ")
  }

  const title = message.data.title ?? ""
  return title
    .split("\n")
    .slice(1)
    .map((line) => line.replace(/^[A-Z]+\s+/, "").trim())
    .filter(Boolean)
    .join(", ")
}

const getPatchUpdatedDiff = (message: MessageType) => {
  const diff = message.data.rawOutput?.metadata?.diff
  if (typeof diff === "string" && diff.trim().length > 0) {
    return diff
  }

  const files = message.data.rawOutput?.metadata?.files
  if (Array.isArray(files)) {
    const fileDiff = files
      .map((file) => file?.patch)
      .filter((patch): patch is string => typeof patch === "string" && patch.trim().length > 0)
      .join("\n")
    if (fileDiff.trim().length > 0) {
      return fileDiff
    }
  }

  return ""
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
      && message.data.title === "apply_patch"
    ),
    renderTitle: (message) => {
      if (message.data.status === "pending") return "正在修改文件"
      if (message.data.status === "failed") return "修改文件失败"
      return message.data.title
    },
    renderDetail: fallbackRender.renderDetail,
    expandable: (message) => message.data.status !== "pending" && message.data.status !== "failed",
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && !!message.data.title?.startsWith("Success. Updated the following files:")
    ),
    renderTitle: (message) => {
      const fileLabel = getPatchUpdatedFileLabel(message)
      return `修改文件${fileLabel ? ` "${fileLabel}"` : ""}`
    },
    renderDetail: (message) => {
      const diff = getPatchUpdatedDiff(message)
      if (diff) {
        return <UnifiedDiffViewer diffText={diff} />
      }

      return (
        <pre className="whitespace-pre-wrap break-words p-3 text-xs">
          {message.data.rawInput?.patchText || "暂无 patch 内容"}
        </pre>
      )
    },
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
      && imageAnalysisCreateTaskTitles.has(message.data.title ?? "")
    ),
    renderTitle: internalImageAnalysisRender.renderTitle,
    renderDetail: internalImageAnalysisRender.renderDetail,
  },
  {
    match: (message) => (
      message.data.kind === "other"
      && imageAnalysisGetResultTitles.has(message.data.title ?? "")
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
  const expandable = typeof renderer.expandable === "function"
    ? renderer.expandable(message)
    : renderer.expandable

  if (expandable === false) {
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
