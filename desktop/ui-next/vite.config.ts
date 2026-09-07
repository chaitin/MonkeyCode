import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// 绿地重写工程(与旧 desktop/ui 并行,见 tasks/todo.md 与计划文件):
// - 端口 1421:旧工程占 1420,两个 dev server 可同时起;壳内开发用
//   `npx tauri dev --config tauri.dev-next.conf.json`(devUrl 指 1421)。
// - outDir 仍是 ../uidist(壳的编译期契约,build.rs::validate_uidist 校验
//   index.html + assets/):与旧工程互斥,后 build 者生效;本地验壳前显式
//   重建目标工程。P9 切换时本工程改名回 ui、端口改回 1420。
// 壳内 WebView 跟系统走:macOS 用系统 WKWebView(bundle.macos.conf.json 最低 11.0,
// 出厂内核是 Safari 14),Windows 是常青的 WebView2,Linux 是发行版的 WebKitGTK。
// Vite/oxc 只降级语法不补 API,源码或依赖里随手一个 toSorted/at/hasOwn 在
// Safari 15/14 上就是整屏「启动异常」(2026-09-04 报障)。这里让 plugin-legacy
// 按产物实际用量注入 core-js polyfill(modernPolyfills: true),并由它把
// build.target 设成 WEBVIEW_TARGETS 对应的语法目标——不要再手动设 build.target,
// 插件会覆盖并告警。不出 legacy(SystemJS)分包:壳内内核一定支持 ESM。
// 注意它只在 build 生效;dev server 不注入,老内核上跑 dev 不作数。
// core-js 管不到的 Web API(crypto.randomUUID 等)见 src/lib/webApiPolyfills.ts。
const WEBVIEW_TARGETS = ["safari >= 14"];
// CSS 目标**不跟 JS 目标走**:Tailwind v4 本身只支持 Safari 16.4 / Chrome 111 /
// Firefox 128,CSS 再往下降没有收益,反而有害——cssTarget 默认继承 build.target
// (即上面的 safari14),Vite 8 用 lightningcss 压缩时会把逻辑属性(end-full 的
// inset-inline-end、ps/pe/ms/me 等)改写成多参数 :lang(...) 区分左右;Chromium 不认
// 多参数 :lang(),整条规则作废——Windows 的 WebView2 上待发送列表的「立即发送/
// 修改/删除」直接消失,WKWebView 支持所以 mac 看不出来(2026-09-05 报障)。
const CSS_TARGETS = ["safari16.4", "chrome111", "firefox128"];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    legacy({ renderLegacyChunks: false, modernPolyfills: true, modernTargets: WEBVIEW_TARGETS }),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 1421,
    strictPort: true,
  },
  build: {
    outDir: "../uidist",
    emptyOutDir: true,
    cssTarget: CSS_TARGETS,
  },
});
