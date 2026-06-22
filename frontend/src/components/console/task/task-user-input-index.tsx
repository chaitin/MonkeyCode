import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import React from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { MessageType } from "./message"
import {
  getNearestUserInputIdToViewport,
  getUserInputIndexDotIndexForEntryId,
  getUserInputIndexDots,
  mergeLoadedUserInputIndexEntries,
  mergeUserInputIndexEntries,
  normalizeUserInputIndexPage,
  type UserInputIndexEntry,
} from "./task-user-input-index-model"

export interface TaskUserInputIndexProps {
  taskId: string | null | undefined
  liveMessages: MessageType[]
  getScrollContainer: () => HTMLElement | null
  scrollToMessage?: (messageId: string, options?: { align?: "start" | "center" | "end" | "auto"; behavior?: ScrollBehavior; highlight?: boolean }) => boolean
  historyHasMore: boolean
  loadMoreHistory: () => Promise<void>
}

const PAGE_SIZE = 10
const MAX_INDEX_DOTS = 20

export function TaskUserInputIndex(props: TaskUserInputIndexProps) {
  const { taskId, liveMessages, getScrollContainer, scrollToMessage, historyHasMore, loadMoreHistory } = props
  const { t } = useTranslation()
  const historyHasMoreRef = React.useRef(historyHasMore)
  React.useEffect(() => { historyHasMoreRef.current = historyHasMore }, [historyHasMore])
  const loadMoreHistoryRef = React.useRef(loadMoreHistory)
  React.useEffect(() => { loadMoreHistoryRef.current = loadMoreHistory }, [loadMoreHistory])

  const [entries, setEntries] = React.useState<UserInputIndexEntry[]>([])
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [initialized, setInitialized] = React.useState(false)
  const loadingRef = React.useRef(false)
  const [expanded, setExpanded] = React.useState(false)
  const [activeUserInputId, setActiveUserInputId] = React.useState<string | null>(null)

  const fetchPage = React.useCallback(async (nextCursor?: string) => {
    if (!taskId || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    await apiRequest(
      "v1UsersTasksUserInputsList",
      {
        id: taskId,
        limit: PAGE_SIZE,
        ...(nextCursor ? { cursor: nextCursor } : {}),
      },
      [],
      (resp) => {
        if (resp.code === 0) {
          const items = normalizeUserInputIndexPage(resp.data?.items ?? [])
          setEntries((prev) => mergeLoadedUserInputIndexEntries(prev, items, Boolean(nextCursor)))
          setCursor(resp.data?.next_cursor ?? null)
          setHasMore(!!resp.data?.has_more)
          setInitialized(true)
        } else {
          toast.error(resp.message || t("taskDetail.userInputIndex.fetchFailed"))
        }
      },
      () => undefined,
    )
    loadingRef.current = false
    setLoading(false)
  }, [taskId, t])

  React.useEffect(() => {
    if (!taskId) return
    if (initialized) return
    fetchPage()
  }, [taskId, initialized, fetchPage])

  React.useEffect(() => {
    setEntries([])
    setCursor(null)
    setHasMore(false)
    setInitialized(false)
    setActiveUserInputId(null)
  }, [taskId])

  const mergedEntries = React.useMemo(() => {
    return mergeUserInputIndexEntries(entries, liveMessages)
  }, [entries, liveMessages])
  const miniDots = React.useMemo(() => getUserInputIndexDots(mergedEntries, MAX_INDEX_DOTS), [mergedEntries])
  const activeDotIndex = React.useMemo(() => (
    getUserInputIndexDotIndexForEntryId(mergedEntries, activeUserInputId, MAX_INDEX_DOTS)
  ), [activeUserInputId, mergedEntries])

  const updateActiveUserInputId = React.useCallback(() => {
    const container = getScrollContainer()
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const candidates = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-type="user_input"]'),
    )
      .map((element) => {
        const id = element.dataset.messageId ?? ""
        const rect = element.getBoundingClientRect()
        return {
          id,
          top: rect.top,
          bottom: rect.bottom,
        }
      })
      .filter((candidate) => candidate.id)

    const nearestId = getNearestUserInputIdToViewport(candidates, containerRect.top, containerRect.bottom)
    if (!nearestId) return

    setActiveUserInputId((prev) => (prev === nearestId ? prev : nearestId))
  }, [getScrollContainer])

  React.useEffect(() => {
    const container = getScrollContainer()
    if (!container) return

    let frame: number | null = null
    const scheduleUpdate = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        updateActiveUserInputId()
      })
    }

    container.addEventListener("scroll", scheduleUpdate, { passive: true })
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(container)
    scheduleUpdate()

    return () => {
      container.removeEventListener("scroll", scheduleUpdate)
      resizeObserver.disconnect()
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [getScrollContainer, updateActiveUserInputId])

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      updateActiveUserInputId()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [mergedEntries, updateActiveUserInputId])

  const [jumpingId, setJumpingId] = React.useState<string | null>(null)

  const handleJump = React.useCallback(async (entry: UserInputIndexEntry) => {
    const scrollVirtualMessage = () => scrollToMessage?.(entry.id, {
      align: "start",
      behavior: "smooth",
      highlight: true,
    }) ?? false

    if (scrollVirtualMessage()) {
      return
    }

    const container = getScrollContainer()
    if (!container) return
    const findTarget = () => container.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(entry.id)}"]`)
    let target = findTarget()

    if (!target) {
      setJumpingId(entry.id)
      try {
        const MAX_PAGES = 200
        let pages = 0
        while (!target && historyHasMoreRef.current && pages < MAX_PAGES) {
          await loadMoreHistoryRef.current()
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          if (scrollVirtualMessage()) {
            return
          }
          target = findTarget()
          pages++
        }
      } finally {
        setJumpingId(null)
      }
      if (!target) {
        toast.info(t("taskDetail.userInputIndex.notFound"))
        return
      }
    }

    const containerTop = container.getBoundingClientRect().top
    container.scrollTo({
      top: container.scrollTop + target.getBoundingClientRect().top - containerTop - 8,
      behavior: "smooth",
    })
    const bubble = target.querySelector<HTMLElement>(".bg-accent\\/50") ?? target
    bubble.classList.add("jump-highlight")
    bubble.addEventListener("animationend", () => {
      bubble.classList.remove("jump-highlight")
    }, { once: true })
  }, [getScrollContainer, scrollToMessage, t])

  if (mergedEntries.length <= 1 && !loading) return null

  return (
    <div
      className="absolute right-2 top-1/2 z-20 -translate-y-1/2"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className={cn(
        "flex flex-col items-center gap-[5px] rounded-full border bg-popover/90 p-3 shadow-md backdrop-blur-sm transition-opacity cursor-pointer",
        expanded ? "opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2" : "opacity-60 hover:opacity-100",
      )}>
        {miniDots.map((dot, index) => (
          <div
            key={dot.key}
            className={cn(
              "size-2 rounded-full transition-colors",
              index === activeDotIndex ? "bg-foreground" : "bg-muted-foreground/50",
            )}
          />
        ))}
      </div>

      <div
        className={cn(
          "rounded-xl border bg-popover/95 shadow-xl backdrop-blur-sm transition-all origin-right overflow-y-auto overflow-x-hidden",
          expanded
            ? "scale-100 opacity-100 pointer-events-auto"
            : "scale-95 opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2",
        )}
        style={{ maxHeight: "min(480px, 70vh)", width: "280px" }}
      >
        {(jumpingId || hasMore) && (
          <div className="sticky top-0 z-10 border-b bg-popover/95">
            {jumpingId && (
              <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-muted-foreground">
                <Spinner className="size-3" />
                {t("taskDetail.userInputIndex.locating")}
              </div>
            )}
            {hasMore && (
              <div className="p-1.5">
                <button
                  type="button"
                  onClick={() => fetchPage(cursor ?? undefined)}
                  disabled={loading}
                  className={cn(
                    "flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-sm transition-colors",
                    "text-muted-foreground hover:bg-accent hover:text-popover-foreground",
                    "disabled:pointer-events-none disabled:opacity-60",
                  )}
                >
                  {loading && <Spinner className="size-3.5" />}
                  {t("taskDetail.userInputIndex.loadMore")}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col py-1.5">
          {mergedEntries.map((entry) => {
            const isJumping = jumpingId === entry.id
            return (
              <button
                type="button"
                key={entry.id}
                onClick={() => handleJump(entry)}
                disabled={isJumping}
                className={cn(
                  "w-full min-w-0 truncate px-4 py-2 text-left text-sm transition-colors",
                  "text-popover-foreground/80 hover:bg-accent hover:text-popover-foreground",
                  isJumping && "opacity-50",
                )}
              >
                {isJumping && <Spinner className="mr-1.5 inline size-3" />}
                {entry.content || "..."}
              </button>
            )
          })}
          {loading && !hasMore && (
            <div className="flex justify-center py-2">
              <Spinner className="size-4" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
