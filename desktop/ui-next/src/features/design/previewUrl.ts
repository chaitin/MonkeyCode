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

/** 地址栏输入专用:补全用户省略的 scheme(浏览器同款),再走同一条严格白名单。
 *  文本扫描不能用这个——那里必须要求显式 scheme,否则消息里任何
 *  "localhost:xxx" 字样都会被当成可预览地址。 */
export function normalizeTypedPreviewUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const direct = normalizePreviewUrl(value);
  if (direct) return direct;
  // 已经带了 scheme 却没通过白名单的(https://evil.com)不再补前缀重试。
  // 注意不能靠 try/catch 判断有没有 scheme:new URL("localhost:5173") 不抛错,
  // 它会把 "localhost:" 当成协议——所以显式看有没有 "://"。
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  return normalizePreviewUrl(`http://${value}`);
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
