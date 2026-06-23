export interface TaskQuickInputItem {
  text: string
  count: number
  updatedAt: number
}

export const MAX_TASK_QUICK_INPUT_ITEMS = 50
export const TASK_QUICK_INPUT_EXPIRE_DAYS = 30
export const TASK_QUICK_INPUT_EXPIRE_MS = TASK_QUICK_INPUT_EXPIRE_DAYS * 24 * 60 * 60 * 1000
export const MIN_TASK_QUICK_INPUT_RECOMMEND_COUNT = 3
export const TASK_QUICK_INPUT_STORAGE_KEY = "task-chat-quick-inputs"
export const TASK_QUICK_INPUT_FALLBACK_VISIBLE_COUNT = 4
export const TASK_QUICK_INPUT_MONO_CHAR_WIDTH = 8
export const TASK_QUICK_INPUT_ITEM_HORIZONTAL_PADDING = 20
export const TASK_QUICK_INPUT_MORE_EXTRA_WIDTH = 38
export const TASK_QUICK_INPUT_GAP_WIDTH = 8

export function normalizeQuickInputText(text: string) {
  return text.trim().replace(/\s+/g, " ")
}

export function shouldRecordShortQuickInput(text: string) {
  const normalizedText = normalizeQuickInputText(text)
  return normalizedText.length > 0 && normalizedText.length < 10 && !normalizedText.startsWith("/")
}

export function parseTaskQuickInputStorage(raw: string | null): TaskQuickInputItem[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item): TaskQuickInputItem | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null
        }

        const maybeItem = item as Partial<TaskQuickInputItem>
        const text = typeof maybeItem.text === "string" ? normalizeQuickInputText(maybeItem.text) : ""
        if (!text) {
          return null
        }

        return {
          text,
          count: Math.max(0, Math.floor(Number(maybeItem.count) || 0)),
          updatedAt: Math.max(0, Math.floor(Number(maybeItem.updatedAt) || 0)),
        }
      })
      .filter((item): item is TaskQuickInputItem => item !== null)
  } catch {
    return []
  }
}

export function sortTaskQuickInputs(items: TaskQuickInputItem[]) {
  return [...items].sort((a, b) => (
    b.count - a.count
    || b.updatedAt - a.updatedAt
    || a.text.localeCompare(b.text)
  ))
}

export function limitTaskQuickInputs(items: TaskQuickInputItem[]) {
  return sortTaskQuickInputs(items).slice(0, MAX_TASK_QUICK_INPUT_ITEMS)
}

export function normalizeTaskQuickInputs(items: TaskQuickInputItem[], now = Date.now()) {
  const byText = new Map<string, TaskQuickInputItem>()

  for (const item of items) {
    const text = normalizeQuickInputText(item.text)
    if (!text) {
      continue
    }

    const nextItem = {
      ...item,
      text,
      count: Math.max(0, Math.floor(item.count)),
      updatedAt: Math.max(0, Math.floor(item.updatedAt)),
    }
    if (now - nextItem.updatedAt > TASK_QUICK_INPUT_EXPIRE_MS) {
      continue
    }

    const existing = byText.get(text)

    if (!existing || nextItem.count > existing.count || nextItem.updatedAt > existing.updatedAt) {
      byText.set(text, nextItem)
    }
  }

  return limitTaskQuickInputs(Array.from(byText.values()))
}

export function getRecommendedTaskQuickInputs(items: TaskQuickInputItem[]) {
  return sortTaskQuickInputs(items)
    .filter((item) => item.count > MIN_TASK_QUICK_INPUT_RECOMMEND_COUNT && shouldRecordShortQuickInput(item.text))
}

export function getTaskQuickInputTextWidthUnits(text: string) {
  return Array.from(text).reduce((sum, character) => {
    const codePoint = character.codePointAt(0) ?? 0
    const isWideCharacter = (
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7af)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xff00 && codePoint <= 0xffef)
      || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
    )

    return sum + (isWideCharacter ? 2 : 1)
  }, 0)
}

export function getTaskQuickInputItemWidth(text: string) {
  return Math.ceil(
    getTaskQuickInputTextWidthUnits(text) * TASK_QUICK_INPUT_MONO_CHAR_WIDTH
    + TASK_QUICK_INPUT_ITEM_HORIZONTAL_PADDING,
  )
}

export function getTaskQuickInputMoreWidth(label: string) {
  return Math.ceil(
    getTaskQuickInputTextWidthUnits(label) * TASK_QUICK_INPUT_MONO_CHAR_WIDTH
    + TASK_QUICK_INPUT_MORE_EXTRA_WIDTH,
  )
}

function getTaskQuickInputTotalWidth(items: TaskQuickInputItem[]) {
  return items.reduce((sum, item, index) => (
    sum + getTaskQuickInputItemWidth(item.text) + (index > 0 ? TASK_QUICK_INPUT_GAP_WIDTH : 0)
  ), 0)
}

export function getTaskQuickInputVisibleCount(
  items: TaskQuickInputItem[],
  containerWidth: number,
  moreLabel: string,
) {
  if (items.length <= 0) {
    return 0
  }

  if (containerWidth <= 0) {
    return Math.min(items.length, TASK_QUICK_INPUT_FALLBACK_VISIBLE_COUNT)
  }

  if (getTaskQuickInputTotalWidth(items) <= containerWidth) {
    return items.length
  }

  const moreWidth = getTaskQuickInputMoreWidth(moreLabel)
  let usedWidth = moreWidth
  let visibleCount = 0

  for (const item of items.slice(0, -1)) {
    const nextWidth = usedWidth + TASK_QUICK_INPUT_GAP_WIDTH + getTaskQuickInputItemWidth(item.text)
    if (nextWidth > containerWidth) {
      break
    }

    usedWidth = nextWidth
    visibleCount += 1
  }

  return Math.max(1, visibleCount)
}

export function incrementTaskQuickInput(
  items: TaskQuickInputItem[],
  text: string,
  options?: { force?: boolean; now?: number },
) {
  const normalizedText = normalizeQuickInputText(text)
  if (!normalizedText || (!options?.force && !shouldRecordShortQuickInput(normalizedText))) {
    return items
  }

  const now = options?.now ?? Date.now()
  const byText = new Map(items.map((item) => [item.text, item]))
  const existing = byText.get(normalizedText)

  byText.set(normalizedText, {
    text: normalizedText,
    count: (existing?.count ?? 0) + 1,
    updatedAt: now,
  })

  return normalizeTaskQuickInputs(Array.from(byText.values()), now)
}
