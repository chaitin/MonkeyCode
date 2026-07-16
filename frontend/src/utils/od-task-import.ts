import { MAX_TASK_CONTENT_LENGTH } from "@/components/console/task/task-content-limit"

// Open Design "export to MonkeyCode" handoff: od-web puts the development
// prompt into the URL fragment as `#od-task=<base64url(utf8)>`. Fragments are
// never sent to the server, so the presigned OSS link inside the prompt stays
// out of access logs. The tasks page decodes it and pre-fills the task input.
//
// The decoded prompt is persisted to sessionStorage the moment it is seen,
// because the 401 login redirect (window.location.href = '/login') discards
// the current URL: sessionStorage survives the login round trip in the same
// tab, so the pre-fill works whether or not the user was signed in when the
// link opened. The fragment itself is stripped immediately — it has no
// further job, and leaving it invites refresh re-fills and link leaks.

const OD_TASK_HASH_RE = /(?:^#|[#&])od-task=([A-Za-z0-9_-]+)/
const PENDING_KEY = "mc-od-task-pending"

function decodeOdTaskHash(): string | null {
  const match = OD_TASK_HASH_RE.exec(window.location.hash)
  if (!match) return null
  try {
    const b64 = match[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
    let text = new TextDecoder().decode(bytes).slice(0, MAX_TASK_CONTENT_LENGTH)
    // .slice counts UTF-16 units and can cut an astral pair in half; drop a
    // trailing lone high surrogate rather than hand the textarea invalid text.
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    return text
  } catch {
    return null
  }
}

/**
 * Resolve the pending Open Design prompt for the task input, if any: a fresh
 * `#od-task=` fragment wins (persisted to sessionStorage and stripped from the
 * URL on the spot), otherwise a previously persisted value — e.g. from the
 * mount that ran right before a 401 bounced this tab through /login.
 */
export function takeOdTaskContent(): string | null {
  const fromHash = decodeOdTaskHash()
  if (fromHash != null) {
    try {
      sessionStorage.setItem(PENDING_KEY, fromHash)
    } catch {
      // sessionStorage unavailable (private mode etc.): the prompt still
      // pre-fills this mount; it just won't survive a login round trip.
    }
    history.replaceState(null, "", window.location.pathname + window.location.search)
    return fromHash
  }
  try {
    return sessionStorage.getItem(PENDING_KEY)
  } catch {
    return null
  }
}

/**
 * Call once the user is proven signed in (first successful authenticated
 * fetch on the tasks page): the displayed pre-fill is now stable, so drop the
 * persisted copy to keep later visits from resurrecting a stale prompt.
 */
export function confirmOdTaskConsumed(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Best-effort cleanup; a leftover value is bounded by the tab's lifetime.
  }
}
