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

// Normalize timestamps with any precision to nanoseconds, then snap them to a 10 ms boundary.
// REST endpoints return nanoseconds, while WebSocket chunks return milliseconds.
// Nanosecond timestamps exceed Number.MAX_SAFE_INTEGER, so JSON parsing can introduce tiny
// precision drift. A 10 ms boundary keeps IDs stable across REST and WebSocket sources.
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
