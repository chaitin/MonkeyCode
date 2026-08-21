import { describe, expect, it } from "vitest";
import { currentTurnAgentPreviewUrl, newestAgentPreviewUrl, normalizePreviewUrl, previewUrlsInText } from "./previewUrl";
import type { ChatItem } from "@/lib/protocol/types";

describe("design preview URL policy", () => {
  it("accepts only loopback HTTP(S) and preserves the complete resource", () => {
    expect(normalizePreviewUrl("http://localhost:3000/a?q=1#hero")).toBe("http://localhost:3000/a?q=1#hero");
    expect(normalizePreviewUrl("https://[::1]:444/a?x=y#z")).toBe("https://[::1]:444/a?x=y#z");
    expect(normalizePreviewUrl("https://localhost.evil.test/")).toBeNull();
    expect(normalizePreviewUrl("file:///tmp/index.html")).toBeNull();
  });

  it("strips sentence punctuation and scans newest Agent message only", () => {
    expect(previewUrlsInText("Ready: http://127.0.0.1:5173/app?x=1#top.")).toEqual(["http://127.0.0.1:5173/app?x=1#top"]);
    const items: ChatItem[] = [
      { kind: "agent", text: "old http://localhost:3000/" },
      { kind: "user", text: "ignore http://localhost:9999/" },
      { kind: "agent", text: "latest https://localhost:8443/new?q=1#x" },
    ];
    expect(newestAgentPreviewUrl(items)).toBe("https://localhost:8443/new?q=1#x");
  });

  it("only auto-detects a URL produced in the current turn", () => {
    const previousTurnUrl: ChatItem[] = [
      { kind: "agent", text: "http://localhost:3000/old" },
      { kind: "user", text: "make another page" },
      { kind: "agent", text: "done without a preview" },
    ];
    expect(currentTurnAgentPreviewUrl(previousTurnUrl)).toBeNull();

    previousTurnUrl.push({ kind: "agent", text: "ready at http://127.0.0.1:5173/new" });
    expect(currentTurnAgentPreviewUrl(previousTurnUrl)).toBe("http://127.0.0.1:5173/new");
  });
});
