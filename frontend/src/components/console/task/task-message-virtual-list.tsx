import type { ConstsCliName } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { useVirtualizer } from "@tanstack/react-virtual"
import { IconHistory } from "@tabler/icons-react"
import React from "react"
import { useTranslation } from "react-i18next"
import { MessageItem, shouldRenderMessage, type MessageType } from "./message"
import {
  getTaskMessageVirtualRow,
  getTaskMessageVirtualRowCount,
  getTaskMessageVirtualRowIndex,
} from "./task-message-virtual-list-model"

export interface TaskMessageVirtualListHandle {
  scrollToMessage: (messageId: string, options?: TaskMessageVirtualListScrollOptions) => boolean
  scrollToBottom: (behavior?: ScrollBehavior) => boolean
}

export interface TaskMessageVirtualListScrollOptions {
  align?: "start" | "center" | "end" | "auto"
  behavior?: ScrollBehavior
  highlight?: boolean
}

interface TaskMessageVirtualListProps {
  messages: MessageType[]
  cli?: ConstsCliName
  fileLinkEnvid?: string
  onWorkspaceFileClick?: (path: string) => void
  contentRef?: React.Ref<HTMLDivElement>
  className?: string
  getScrollContainer: () => HTMLDivElement | null
  showHistoryLoadButton: boolean
  historyLoading: boolean
  historyLoaded: boolean
  onLoadHistory: () => void
}

function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === "function") {
    ref(value)
    return
  }
  ref.current = value
}

function getMessageTextLength(message: MessageType) {
  const content = message.data.content
  if (typeof content === "string") {
    return content.length
  }
  if (typeof message.data.text === "string") {
    return message.data.text.length
  }
  return 0
}

function estimateMessageSize(message: MessageType) {
  if (message.type === "user_input") {
    return 72
  }
  if (message.type === "tool_call" || message.type === "agent_thought_chunk") {
    return 156
  }
  if (message.type === "error_message" || message.type === "ask_user_question") {
    return 132
  }

  const textLength = getMessageTextLength(message)
  if (textLength <= 0) {
    return 72
  }

  return Math.min(Math.max(72 + Math.ceil(textLength / 90) * 22, 72), 420)
}

const TaskMessageVirtualList = React.forwardRef<TaskMessageVirtualListHandle, TaskMessageVirtualListProps>(
  function TaskMessageVirtualList(props, ref) {
    const {
      messages,
      cli,
      fileLinkEnvid,
      onWorkspaceFileClick,
      contentRef,
      className,
      getScrollContainer,
      showHistoryLoadButton,
      historyLoading,
      historyLoaded,
      onLoadHistory,
    } = props
    const { t } = useTranslation()

    const contentElementRef = React.useRef<HTMLDivElement | null>(null)
    const highlightTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const renderableMessages = React.useMemo(() => messages.filter(shouldRenderMessage), [messages])
    const latestMessageId = renderableMessages.at(-1)?.id ?? null
    const rowCount = getTaskMessageVirtualRowCount(renderableMessages.length, showHistoryLoadButton)
    const messageIndexById = React.useMemo(() => {
      const indexById = new Map<string, number>()
      renderableMessages.forEach((message, index) => {
        indexById.set(message.id, index)
      })
      return indexById
    }, [renderableMessages])

    const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
      count: rowCount,
      getScrollElement: getScrollContainer,
      estimateSize: (index) => {
        const row = getTaskMessageVirtualRow(index, renderableMessages.length, showHistoryLoadButton)
        if (!row) return 72
        if (row.type === "history-loader") return 44
        return estimateMessageSize(renderableMessages[row.messageIndex])
      },
      getItemKey: (index) => {
        const row = getTaskMessageVirtualRow(index, renderableMessages.length, showHistoryLoadButton)
        if (!row) return `message-row-${index}`
        if (row.type === "history-loader") return "history-loader"
        return renderableMessages[row.messageIndex]?.id ?? `message-row-${index}`
      },
      overscan: 8,
      paddingEnd: 16,
      useAnimationFrameWithResizeObserver: true,
    })

    const setContentElementRef = React.useCallback((node: HTMLDivElement | null) => {
      contentElementRef.current = node
      setRef(contentRef, node)
    }, [contentRef])

    const highlightMessage = React.useCallback((messageId: string) => {
      const container = getScrollContainer()
      if (!container) return false

      const target = container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(messageId)}"]`)
      if (!target) return false

      const bubble = target.querySelector<HTMLElement>(".bg-accent\\/50") ?? target
      bubble.classList.add("jump-highlight")
      bubble.addEventListener("animationend", () => {
        bubble.classList.remove("jump-highlight")
      }, { once: true })
      return true
    }, [getScrollContainer])

    const scheduleHighlightMessage = React.useCallback((messageId: string) => {
      if (highlightTimeoutRef.current !== null) {
        clearTimeout(highlightTimeoutRef.current)
        highlightTimeoutRef.current = null
      }

      let attempts = 0
      const tryHighlight = () => {
        if (highlightMessage(messageId) || attempts >= 12) {
          highlightTimeoutRef.current = null
          return
        }

        attempts += 1
        highlightTimeoutRef.current = setTimeout(tryHighlight, 80)
      }

      tryHighlight()
    }, [highlightMessage])

    const scrollToMessage = React.useCallback((messageId: string, options?: TaskMessageVirtualListScrollOptions) => {
      const messageIndex = messageIndexById.get(messageId)
      if (messageIndex === undefined) {
        return false
      }

      const rowIndex = getTaskMessageVirtualRowIndex(messageIndex, showHistoryLoadButton)
      virtualizer.scrollToIndex(rowIndex, {
        align: options?.align ?? "start",
        behavior: options?.behavior ?? "smooth",
      })

      if (options?.highlight !== false) {
        scheduleHighlightMessage(messageId)
      }

      return true
    }, [messageIndexById, scheduleHighlightMessage, showHistoryLoadButton, virtualizer])

    const scrollToBottom = React.useCallback((behavior: ScrollBehavior = "smooth") => {
      const container = getScrollContainer()
      if (!container) return false

      if (rowCount <= 0) {
        container.scrollTo({ top: container.scrollHeight, behavior })
        return true
      }

      virtualizer.scrollToIndex(rowCount - 1, { align: "end", behavior })
      return true
    }, [getScrollContainer, rowCount, virtualizer])

    React.useImperativeHandle(ref, () => ({
      scrollToMessage,
      scrollToBottom,
    }), [scrollToBottom, scrollToMessage])

    React.useEffect(() => {
      return () => {
        if (highlightTimeoutRef.current !== null) {
          clearTimeout(highlightTimeoutRef.current)
          highlightTimeoutRef.current = null
        }
      }
    }, [])

    if (rowCount === 0) {
      return (
        <div ref={setContentElementRef} className={cn("min-h-full", className)}>
          {historyLoaded && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t("taskDetail.messages.empty")}</div>
          )}
        </div>
      )
    }

    return (
      <div
        ref={setContentElementRef}
        className={cn("relative min-h-full", className)}
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = getTaskMessageVirtualRow(virtualRow.index, renderableMessages.length, showHistoryLoadButton)
          if (!row) return null

          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.type === "history-loader" ? (
                <div className="flex justify-center pb-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    onClick={onLoadHistory}
                    disabled={historyLoading}
                  >
                    {!historyLoading && <IconHistory className="size-4" />}
                    {historyLoading && <Spinner className="size-4" />}
                    {historyLoading
                      ? t("taskDetail.messages.loadingHistory")
                      : historyLoaded
                        ? t("taskDetail.messages.loadMore")
                        : t("taskDetail.messages.loadHistory")}
                  </Button>
                </div>
              ) : (
                <div className="pb-1">
                  <MessageItem
                    message={renderableMessages[row.messageIndex]}
                    cli={cli}
                    isLatest={renderableMessages[row.messageIndex]?.id === latestMessageId}
                    fileLinkEnvid={fileLinkEnvid}
                    onWorkspaceFileClick={onWorkspaceFileClick}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  },
)

export { TaskMessageVirtualList }
