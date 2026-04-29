import { IconSparkles, IconTargetArrow } from "@tabler/icons-react";
import type { MessageType } from "../message";

export const renderTitle = (message: MessageType) => {
  const prompt = message.data.rawInput?.prompt
  return typeof prompt === "string" && prompt.trim().length > 0
    ? `图片识别 "${prompt.trim()}"`
    : "图片识别"
}

export const renderResultTitle = () => "获取图片识别结果"

const getOutput = (message: MessageType) => {
  const rawOutput = message.data.rawOutput?.output
  const textContent = message.data.content?.find?.((item: { type?: string; content?: { type?: string; text?: string } }) => (
    item?.type === "content" && item?.content?.type === "text"
  ))?.content?.text

  return typeof rawOutput === "string" && rawOutput.trim().length > 0
    ? rawOutput
    : typeof textContent === "string"
      ? textContent
      : ""
}

export const renderDetail = (message: MessageType) => {
  const rawQuery = message.data.rawInput?.query ?? message.data.rawInput?.prompt
  const rawImageUrl = message.data.rawInput?.url
  const query = typeof rawQuery === "string" ? rawQuery.trim() : ""
  const imageUrl = typeof rawImageUrl === "string" ? rawImageUrl.trim() : ""
  const output = getOutput(message)

  return (
    <div className="p-3 text-xs leading-5">
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
        {imageUrl && (
          <a
            href={imageUrl}
            target="_blank"
            rel="noreferrer"
            className="block h-40 overflow-hidden rounded-md bg-muted sm:h-full sm:min-h-32"
          >
            <div className="h-full w-full">
              <img
                src={imageUrl}
                alt="图片识别"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          </a>
        )}
        <div className="min-w-0 rounded-md border border-border/70 bg-background/80 px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
            <IconTargetArrow className="size-4 text-primary" />
            识别邀请
          </div>
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">
            {query || "暂无识别要求"}
          </pre>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-border/70 bg-background/80 px-3 py-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
          <IconSparkles className="size-4 text-primary" />
          识别结果
        </div>
        <pre className="whitespace-pre-wrap break-words text-muted-foreground">
          {output || "暂无图片识别结果"}
        </pre>
      </div>
    </div>
  )
}

export const renderResultDetail = (message: MessageType) => {
  const output = getOutput(message)

  return (
    <div className="p-3">
      <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
        {output || "暂无图片识别结果"}
      </pre>
    </div>
  )
}
