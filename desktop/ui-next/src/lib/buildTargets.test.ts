import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

// 打包目标契约(vite.config.ts):JS 目标由 plugin-legacy 按 WEBVIEW_TARGETS 接管,
// 但 CSS 目标必须独立钉在 Tailwind v4 的下限上。cssTarget 一旦跟着 JS 目标掉到
// Safari 14,lightningcss 会把逻辑属性改写成多参数 :lang() 的左右两条规则,Chromium
// 不认这种写法、整条作废——Windows 的 WebView2 上待发送列表的操作按钮消失,mac 的
// WKWebView 却正常(2026-09-05 报障)。这里断言的是 resolveConfig 后的**实际生效值**。
describe("vite 打包目标", () => {
  it("JS 目标降到 Safari 14,CSS 目标独立钉在 Tailwind v4 下限", async () => {
    const config = await resolveConfig(
      { configFile: new URL("../../vite.config.ts", import.meta.url).pathname, logLevel: "silent" },
      "build",
    );
    expect(config.build.target).toEqual(["safari14"]);
    expect(config.build.cssTarget).toEqual(["safari16.4", "chrome111", "firefox128"]);
  }, 30_000);
});
