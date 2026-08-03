import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// 绿地重写工程(与旧 desktop/ui 并行,见 tasks/todo.md 与计划文件):
// - 端口 1421:旧工程占 1420,两个 dev server 可同时起;壳内开发用
//   `npx tauri dev --config tauri.dev-next.conf.json`(devUrl 指 1421)。
// - outDir 仍是 ../uidist(壳的编译期契约,build.rs::validate_uidist 校验
//   index.html + assets/):与旧工程互斥,后 build 者生效;本地验壳前显式
//   重建目标工程。P9 切换时本工程改名回 ui、端口改回 1420。
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
});
