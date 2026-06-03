const POINTS_ACTIVITY_HIDE_DURATION_MS = 7 * 24 * 60 * 60 * 1000

export const POINTS_ACTIVITY_STORAGE_KEYS = {
  invite: "monkeycode.pointsActivity.invite.openedAt",
  essay: "monkeycode.pointsActivity.essay.openedAt",
} as const

export function shouldHidePointsActivity(storageKey: string, now = Date.now()): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const openedAt = Number(window.localStorage.getItem(storageKey))
  return Number.isFinite(openedAt) && now - openedAt < POINTS_ACTIVITY_HIDE_DURATION_MS
}

export function markPointsActivityOpened(storageKey: string, now = Date.now()) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(storageKey, String(now))
}
