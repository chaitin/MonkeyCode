import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { IconSearch } from "@tabler/icons-react";
import type { MessageType } from "../message";

type WebsearchResultItem = {
  title?: string
  url?: string
}

type WebsearchPayload = {
  results?: WebsearchResultItem[]
}

function parsePayload(message: MessageType): WebsearchPayload | null {
  const rawOutput = message.data.rawOutput?.output
  if (typeof rawOutput === "string" && rawOutput.trim().length > 0) {
    try {
      return JSON.parse(rawOutput) as WebsearchPayload
    } catch {
      return null
    }
  }

  const textContent = message.data.content?.find?.((item: { type?: string; content?: { type?: string; text?: string } }) => (
    item?.type === "content" && item?.content?.type === "text"
  ))?.content?.text

  if (typeof textContent === "string" && textContent.trim().length > 0) {
    try {
      return JSON.parse(textContent) as WebsearchPayload
    } catch {
      return null
    }
  }

  return null
}

export const renderTitle = (message: MessageType) => {
  const query = message.data.rawInput?.query
  return `联网搜索 - ${query ? `“${query}”` : "搜索结果"}`
}

export const renderDetail = (message: MessageType) => {
  const payload = parsePayload(message)
  const results = payload?.results ?? []

  if (results.length === 0) {
    return (
      <Empty className="min-h-32 gap-2 p-6">
        <EmptyHeader className="gap-2">
          <EmptyMedia variant="icon">
            <IconSearch className="size-5 opacity-60" />
          </EmptyMedia>
          <EmptyDescription>没有搜索结果</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="divide-y divide-border/70 p-2">
      {results.map((result, index) => (
        <div
          key={`${result.url ?? result.title ?? "result"}-${index}`}
          className="rounded-md px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="line-clamp-2 text-xs font-medium text-foreground">
              {result.title || "未命名结果"}
            </div>
            <a
              href={result.url || "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              <span className="truncate">{result.url || "无链接"}</span>
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}
