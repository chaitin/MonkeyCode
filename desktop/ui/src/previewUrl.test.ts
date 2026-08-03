import { describe, expect, it } from "vitest";
import { latestPreviewUrl } from "./previewUrl";
import type { LogItem } from "./types";

const agent = (text: string): LogItem => ({ kind: "agent", text });

describe("latestPreviewUrl", () => {
  it("提取 Agent 最后给出的本地预览地址", () => {
    expect(latestPreviewUrl([
      agent("先打开 http://localhost:3000"),
      agent("最终地址：http://127.0.0.1:4173/admin.html"),
    ])).toBe("http://127.0.0.1:4173/admin.html");
  });

  it("忽略用户消息、远程地址和尾随标点", () => {
    const items: LogItem[] = [
      { kind: "user", text: "http://localhost:9999" },
      agent("文档 https://example.com，预览 http://localhost:5173/demo。"),
    ];
    expect(latestPreviewUrl(items)).toBe("http://localhost:5173/demo");
  });

  it("去掉 URL 末尾的 Markdown 标记", () => {
    expect(latestPreviewUrl([agent("预览地址：**http://127.0.0.1:8080/index.html**")])).toBe("http://127.0.0.1:8080/index.html");
  });

  it("不把 Markdown 标记后的中文括号说明识别为 URL", () => {
    expect(latestPreviewUrl([agent("http://localhost:8081/gomoku.html**（返回")])).toBe("http://localhost:8081/gomoku.html");
  });

  it("支持 IPv6 loopback", () => {
    expect(latestPreviewUrl([agent("http://[::1]:8080/")])).toBe("http://[::1]:8080/");
  });
});
