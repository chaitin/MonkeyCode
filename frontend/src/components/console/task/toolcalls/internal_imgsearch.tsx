import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { IconPhotoSearch } from "@tabler/icons-react";
import type { MessageType } from "../message";

type ImgsearchResultItem = {
  title?: string
  url?: string
  image?: {
    url?: string
    width?: number
    height?: number
  }
}

type ImgsearchPayload = {
  results?: ImgsearchResultItem[]
}

function parsePayload(message: MessageType): ImgsearchPayload | null {
  const rawOutput = message.data.rawOutput?.output
  if (typeof rawOutput === "string" && rawOutput.trim().length > 0) {
    try {
      return JSON.parse(rawOutput) as ImgsearchPayload
    } catch {
      return null
    }
  }

  const textContent = message.data.content?.find?.((item: { type?: string; content?: { type?: string; text?: string } }) => (
    item?.type === "content" && item?.content?.type === "text"
  ))?.content?.text

  if (typeof textContent === "string" && textContent.trim().length > 0) {
    try {
      return JSON.parse(textContent) as ImgsearchPayload
    } catch {
      return null
    }
  }

  return null
}

export const renderTitle = (message: MessageType) => {
  const query = message.data.rawInput?.query
  return `图片搜索 - ${query ? `“${query}”` : "搜索结果"}`
}

export const renderDetail = (message: MessageType) => {
  const payload = parsePayload(message)
  const results = (payload?.results ?? []).filter((result) => !!result.image?.url)

  if (results.length === 0) {
    return (
      <Empty className="min-h-32 gap-2 p-6">
        <EmptyHeader className="gap-2">
          <EmptyMedia variant="icon">
            <IconPhotoSearch className="size-5 opacity-60" />
          </EmptyMedia>
          <EmptyDescription>没有图片结果</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-2 p-2">
      {results.map((result, index) => {
        const imageUrl = result.image?.url ?? ""
        const content = (
          <div className="flex gap-2 overflow-hidden rounded-md border border-border/70 bg-background/70 p-2">
            <div className="h-16 w-20 shrink-0 overflow-hidden rounded bg-muted">
              <img
                src={imageUrl}
                alt={result.title || "图片搜索结果"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="min-w-0 flex-1 py-0.5">
              <div className="line-clamp-2 text-xs font-medium leading-4 text-foreground">
                {result.title || "未命名图片"}
              </div>
              {result.url && (
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {result.url}
                </div>
              )}
            </div>
          </div>
        )

        if (result.url) {
          return (
            <a
              key={`${imageUrl}-${index}`}
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="block transition-opacity hover:opacity-85"
            >
              {content}
            </a>
          )
        }

        return (
          <div key={`${imageUrl}-${index}`}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
