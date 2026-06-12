export interface UserInputIndexEntry {
  id: string
  timestamp: number
  content: string
  truncated: boolean
}

export interface UserInputIndexSourceItem {
  id?: string
  timestamp?: number
  content?: string
  truncated?: boolean
}

export interface UserInputIndexLiveMessage {
  id: string
  time: number
  type: string
  data: {
    content?: unknown
  }
}

export interface UserInputIndexDot {
  key: string
  startIndex: number
  endIndex: number
}

export interface UserInputViewportCandidate {
  id: string
  top: number
  bottom: number
}

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

function decodeUserInputContent(message: UserInputIndexLiveMessage): string {
  if (message.type !== "user_input") return ""
  const raw = message.data?.content
  return typeof raw === "string" ? raw : ""
}

export function normalizeUserInputIndexPage(items: UserInputIndexSourceItem[]) {
  return items
    .map((item) => {
      const ts = normalizeTimestampToNs(item.timestamp ?? 0)
      return {
        id: ts > 0 ? `user-input-${ts}` : (item.id ?? ""),
        timestamp: ts,
        content: item.content ?? "",
        truncated: !!item.truncated,
      }
    })
    .reverse()
}

export function mergeLoadedUserInputIndexEntries(
  currentEntries: UserInputIndexEntry[],
  pageEntries: UserInputIndexEntry[],
  isLoadingMore: boolean,
) {
  return isLoadingMore ? [...pageEntries, ...currentEntries] : pageEntries
}

export function mergeUserInputIndexEntries<TMessage extends UserInputIndexLiveMessage>(
  entries: UserInputIndexEntry[],
  liveMessages: TMessage[],
) {
  const seen = new Set<string>()
  const uniqueEntries: UserInputIndexEntry[] = []
  for (const entry of entries) {
    if (!entry.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    uniqueEntries.push(entry)
  }

  const tail: UserInputIndexEntry[] = []
  for (const message of liveMessages) {
    if (message.type !== "user_input") continue
    if (!message.id || seen.has(message.id)) continue
    seen.add(message.id)
    tail.push({
      id: message.id,
      timestamp: normalizeTimestampToNs(message.time ?? 0),
      content: decodeUserInputContent(message),
      truncated: false,
    })
  }

  return [...uniqueEntries, ...tail]
}

export function getUserInputIndexDots(entries: UserInputIndexEntry[], maxDots: number): UserInputIndexDot[] {
  if (entries.length === 0 || maxDots <= 0) {
    return []
  }

  const dotCount = Math.min(entries.length, maxDots)
  return Array.from({ length: dotCount }, (_, dotIndex) => {
    const startIndex = Math.floor((dotIndex * entries.length) / dotCount)
    const endIndex = Math.floor(((dotIndex + 1) * entries.length) / dotCount) - 1
    return {
      key: entries[startIndex]?.id ?? `dot-${dotIndex}`,
      startIndex,
      endIndex: Math.max(startIndex, endIndex),
    }
  })
}

export function getUserInputIndexDotIndexForEntryId(
  entries: UserInputIndexEntry[],
  entryId: string | null,
  maxDots: number,
) {
  if (!entryId) {
    return null
  }

  const entryIndex = entries.findIndex((entry) => entry.id === entryId)
  if (entryIndex === -1) {
    return null
  }

  const dots = getUserInputIndexDots(entries, maxDots)
  const dotIndex = dots.findIndex((dot) => entryIndex >= dot.startIndex && entryIndex <= dot.endIndex)
  return dotIndex === -1 ? null : dotIndex
}

export function getNearestUserInputIdToViewport(
  candidates: UserInputViewportCandidate[],
  viewportTop: number,
  viewportBottom: number,
) {
  if (candidates.length === 0) {
    return null
  }

  const viewportCenter = viewportTop + (viewportBottom - viewportTop) / 2
  let nearestId: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const candidateCenter = candidate.top + (candidate.bottom - candidate.top) / 2
    const distance = Math.abs(candidateCenter - viewportCenter)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestId = candidate.id
    }
  }

  return nearestId
}
