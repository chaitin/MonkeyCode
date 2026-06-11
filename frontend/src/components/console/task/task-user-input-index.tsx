import type { DomainTaskUserInputItem } from "@/api/Api"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"
import React from "react"
import { toast } from "sonner"
import type { MessageType } from "./message"

interface UserInputIndexEntry {
  id: string
  timestamp: number
  content: string
  truncated: boolean
}

export interface TaskUserInputIndexProps {
  taskId: string | null | undefined
  liveMessages: MessageType[]
  getScrollContainer: () => HTMLElement | null
  historyHasMore: boolean
  loadMoreHistory: () => Promise<void>
}

const PAGE_SIZE = 20

// 统一把任何精度的时间戳归一化到 纳秒，并截到 10ms 边界：
//   - 后端 REST `/user-inputs` 返回纳秒
//   - 后端 REST `/rounds`  返回纳秒
//   - 后端 WebSocket 推送的 chunk.timestamp 是毫秒（task.go: chunk.Timestamp/1e6）
//   纳秒时间戳（~1.7e18）超出 Number.MAX_SAFE_INTEGER（~9e15），不同 API 返回的同一
//   条消息经 JSON 解析后浮点精度损失（~256ns）可能不同，截到 1ms 边界偶发跨界。
//   截到 10ms 彻底避免此问题（256ns << 10ms），同时兼容 WS 已丢失 sub-ms 精度的场景。
function normalizeTimestampToNs(ts: number): number {
  if (!Number.isFinite(ts) || ts <= 0) return 0
  let ns: number
  if (ts >= 1e17) ns = ts
  else if (ts >= 1e14) ns = ts * 1_000
  else if (ts >= 1e11) ns = ts * 1_000_000
  else ns = ts * 1_000_000_000
  return Math.floor(ns / 10_000_000) * 10_000_000
}

function decodeUserInputContent(message: MessageType): string {
  if (message.type !== "user_input") return ""
  const raw = message.data?.content
  return typeof raw === "string" ? raw : ""
}

export function TaskUserInputIndex(props: TaskUserInputIndexProps) {
  const { taskId, liveMessages, getScrollContainer, historyHasMore, loadMoreHistory } = props
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
          const items = (resp.data?.items ?? []).map((item: DomainTaskUserInputItem) => {
            const ts = normalizeTimestampToNs(item.timestamp ?? 0)
            return {
              id: ts > 0 ? `user-input-${ts}` : (item.id ?? ""),
              timestamp: ts,
              content: item.content ?? "",
              truncated: !!item.truncated,
            }
          })
          setEntries((prev) => (nextCursor ? [...prev, ...items] : items))
          setCursor(resp.data?.next_cursor ?? null)
          setHasMore(!!resp.data?.has_more)
          setInitialized(true)
        } else {
          toast.error(resp.message || "获取对话列表失败")
        }
      },
      () => undefined,
    )
    loadingRef.current = false
    setLoading(false)
  }, [taskId])

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
  }, [taskId])

  const mergedEntries = React.useMemo(() => {
    const seen = new Set<string>()
    const uniqueEntries: UserInputIndexEntry[] = []
    for (const e of entries) {
      if (!e.id || seen.has(e.id)) continue
      seen.add(e.id)
      uniqueEntries.push(e)
    }
    const tail: UserInputIndexEntry[] = []
    for (const m of liveMessages) {
      if (m.type !== "user_input") continue
      if (!m.id || seen.has(m.id)) continue
      seen.add(m.id)
      tail.push({
        id: m.id,
        timestamp: normalizeTimestampToNs(m.time ?? 0),
        content: decodeUserInputContent(m),
        truncated: false,
      })
    }
    return [...uniqueEntries, ...tail].sort((a, b) => a.timestamp - b.timestamp)
  }, [entries, liveMessages])

  const [jumpingId, setJumpingId] = React.useState<string | null>(null)

  const handleJump = React.useCallback(async (entry: UserInputIndexEntry) => {
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
          target = findTarget()
          pages++
        }
      } finally {
        setJumpingId(null)
      }
      if (!target) {
        toast.info("未找到对应消息")
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
  }, [getScrollContainer])

  if (mergedEntries.length === 0 && !loading) return null

  const miniLines = mergedEntries.slice(0, 8)

  return (
    <div
      className="absolute right-2 top-1/2 z-20 -translate-y-1/2"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* 收起态：迷你竖条 */}
      <div className={cn(
        "flex flex-col items-center gap-[5px] rounded-lg border bg-popover/90 px-[6px] py-3 shadow-md backdrop-blur-sm transition-opacity cursor-pointer",
        expanded ? "opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2" : "opacity-60 hover:opacity-100",
      )}>
        {miniLines.map((e) => (
          <div key={e.id} className="h-[2px] w-4 rounded-full bg-muted-foreground/50" />
        ))}
      </div>

      {/* 展开态：完整列表 */}
      <div
        className={cn(
          "rounded-xl border bg-popover/95 shadow-xl backdrop-blur-sm transition-all origin-right overflow-y-auto overflow-x-hidden",
          expanded
            ? "scale-100 opacity-100 pointer-events-auto"
            : "scale-95 opacity-0 pointer-events-none absolute right-0 top-1/2 -translate-y-1/2",
        )}
        style={{ maxHeight: "min(480px, 70vh)", width: "280px" }}
        onScroll={(e) => {
          if (!hasMore || loading) return
          const el = e.currentTarget
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
            fetchPage(cursor ?? undefined)
          }
        }}
      >
        {jumpingId && (
          <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-popover/95 px-4 py-2 text-xs text-muted-foreground">
            <Spinner className="size-3" />
            正在定位消息...
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
          {loading && (
            <div className="flex justify-center py-2">
              <Spinner className="size-4" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
