// Design preview URL policy. Keep this independent from the native child so links and
// automatic discovery use exactly the same localhost-only boundary as preview.rs.
import type { ChatItem } from "@/lib/protocol/types";

const URL_CANDIDATE = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[^\s<>"'`\])}]*)?/gi;

export function normalizePreviewUrl(raw: string): string | null {
  const value = raw.trim().replace(/[.,;:!?]+$/, "");
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    // URL preserves path/query/hash and canonicalizes IPv6 and default paths for IPC.
    return url.href;
  } catch {
    return null;
  }
}

export function previewUrlsInText(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const normalized = normalizePreviewUrl(match[0]);
    if (normalized && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

/** Scan newest Agent message first; never infer a URL from user/tool output. */
export function newestAgentPreviewUrl(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || item.kind !== "agent") continue;
    const urls = previewUrlsInText(item.text);
    if (urls[0]) return urls[0];
  }
  return null;
}

export function currentTurnAgentPreviewUrl(items: ChatItem[]): string | null {
  const lastUserIndex = items.findLastIndex((item) => item.kind === "user");
  return newestAgentPreviewUrl(items.slice(lastUserIndex + 1));
}
