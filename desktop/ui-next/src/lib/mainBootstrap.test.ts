import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const main = readFileSync(fileURLToPath(new URL("../main.tsx", import.meta.url)), "utf8");

describe("Desktop 启动背景初始化", () => {
  it("隐藏入口时跳过背景资产读取，且不使用 Safari 14 无法解析的顶层 await", () => {
    expect(main).not.toMatch(/^\s*await\s+initializeStoredBackground\(\)/m);
    expect(main).toContain("customBackgroundEnabled() ? initializeStoredBackground() : Promise.resolve()");
    expect(main).toContain("void backgroundReady.then(mountApp, mountApp);");
    expect(main.indexOf("function mountApp")).toBeLessThan(main.indexOf("const backgroundReady"));
  });
});
