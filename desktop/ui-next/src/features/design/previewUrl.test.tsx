import { describe, expect, it } from "vitest";
import { currentTurnAgentPreviewUrl, newestAgentPreviewUrl, normalizePreviewUrl, normalizeTypedPreviewUrl, previewUrlsInText } from "./previewUrl";
import type { ChatItem } from "@/lib/protocol/types";

describe("design preview URL policy", () => {
  it("accepts only loopback HTTP(S) and preserves the complete resource", () => {
    expect(normalizePreviewUrl("http://localhost:3000/a?q=1#hero")).toBe("http://localhost:3000/a?q=1#hero");
    expect(normalizePreviewUrl("https://[::1]:444/a?x=y#z")).toBe("https://[::1]:444/a?x=y#z");
    expect(normalizePreviewUrl("https://localhost.evil.test/")).toBeNull();
    expect(normalizePreviewUrl("file:///tmp/index.html")).toBeNull();
  });

  // 地址栏是手输的,没人会打 http://。浏览器都替你补,这里也得补——但补全
  // 只能发生在输入框这条路上,文本自动发现仍要求显式 scheme。
  it("infers the scheme for typed input without widening the whitelist", () => {
    expect(normalizeTypedPreviewUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeTypedPreviewUrl("127.0.0.1:8080/app?x=1")).toBe("http://127.0.0.1:8080/app?x=1");
    expect(normalizeTypedPreviewUrl("[::1]:3000")).toBe("http://[::1]:3000/");
    expect(normalizeTypedPreviewUrl("http://localhost:3000/keep")).toBe("http://localhost:3000/keep");

    // 白名单本身不放宽
    expect(normalizeTypedPreviewUrl("evil.com")).toBeNull();
    expect(normalizeTypedPreviewUrl("https://evil.com")).toBeNull();
    expect(normalizeTypedPreviewUrl("localhost.evil.test")).toBeNull();
    // 工作区路径必须落空,好让调用方转去按文件解析
    expect(normalizeTypedPreviewUrl("pages/about.html")).toBeNull();
    expect(normalizeTypedPreviewUrl("")).toBeNull();

    // 严格版不受影响:文本扫描仍不认无 scheme 的写法
    expect(normalizePreviewUrl("localhost:5173")).toBeNull();
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
