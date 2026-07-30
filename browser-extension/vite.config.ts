import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

// MV3 扩展的多入口构建:background 必须落在 dist 根且文件名固定
// (manifest 的 service_worker 路径写死),popup/options 走 HTML 入口,
// vite 会按源码目录结构输出到 dist/src/**,manifest 直接引用该路径。
// manifest 与 icons 不走 rollup 管线,构建收尾时原样拷贝进 dist。
function copyStatic(): Plugin {
  return {
    name: "copy-extension-static",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      mkdirSync(dist, { recursive: true });
      cpSync(resolve(__dirname, "manifest.json"), resolve(dist, "manifest.json"));
      cpSync(resolve(__dirname, "src/icons"), resolve(dist, "icons"), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [copyStatic()],
  build: {
    target: "chrome116",
    // module service worker 不允许动态 import,预加载 polyfill 也没有意义
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        popup: resolve(__dirname, "src/popup/popup.html"),
        options: resolve(__dirname, "src/options/options.html"),
      },
      output: {
        // background 钉死在根目录,其余入口/分包带 hash 进 assets
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
