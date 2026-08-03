import type { LogItem } from "./types";

const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?[^\s<>"'`，。；！？（）]*/gi;

export function latestPreviewUrl(items: LogItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind !== "agent") continue;
    const matches = item.text.match(LOCAL_URL);
    if (!matches) continue;
    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const candidate = matches[matchIndex].replace(/[*)_,.;:!?\]}]+$/, "");
      try {
        const url = new URL(candidate);
        if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.toString();
      } catch {}
    }
  }
  return null;
}
