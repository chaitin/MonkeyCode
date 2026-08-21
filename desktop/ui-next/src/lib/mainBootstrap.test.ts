import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = readFileSync(fileURLToPath(new URL("../main.tsx", import.meta.url)), "utf8");

describe("Desktop 启动背景初始化", () => {
  it("不使用 Safari 14 WKWebView 无法解析的顶层 await，且初始化收敛后才挂载 React", () => {
    expect(main).not.toMatch(/^\s*await\s+initializeStoredBackground\(\)/m);
    expect(main).toContain("void initializeStoredBackground().then(mountApp, mountApp);");
    expect(main.indexOf("function mountApp")).toBeLessThan(main.indexOf("void initializeStoredBackground()"));
  });
});
