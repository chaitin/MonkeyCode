import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 两组 project:
// - unit:node 环境,纯逻辑层(lib/gen/app 的 .ts)——零 DOM,启动快;
// - dom:happy-dom 环境,组件与视图(.tsx)用 @testing-library/react,
//   按 role/文本/aria 断言,禁断 daisyUI/Tailwind 类名(样式宪法)。
// JSX 由 Vite 内建 esbuild(jsx: automatic)转换,无需 react 插件。
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/{lib,gen,app}/**/*.test.ts",
            "src/features/{chat/composer,cloud}/**/*.test.ts",
          ],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "dom",
          // jsdom 而非 happy-dom:DOMPurify 官方只支持真 DOM/jsdom,
          // happy-dom 的解析会丢块级元素,净化器是安全关键路径不能凑合
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          // @testing-library/react 的自动 cleanup 依赖全局 afterEach
          globals: true,
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
