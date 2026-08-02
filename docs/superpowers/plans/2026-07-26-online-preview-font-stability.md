# Online 预览字体稳定性修复实施计划

> 执行说明：字体目录白名单已实现。为兼容 CI 的 Node.js 20，最终测试通过 Vite `loadConfigFromFile` 加载 TypeScript 配置并验证生成结果；代理安全复审同时补充了 origin-only `TARGET`、Basic Auth 传输保护和健康检查响应正文校验。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 online 开发预览中 JetBrains Mono 与 Noto Sans SC 字体文件返回 403 导致的系统字体回退。

**Architecture:** 在 `frontend/vite.config.ts` 中解析两个字体包的 `wght.css` 入口，转换为包目录并加入 Vite `server.fs.allow`。配置测试通过注入解析器验证白名单精确范围；预览验证通过代表性 WOFF2 请求状态、MIME 和浏览器字体加载状态确认字体链路完整。

**Tech Stack:** Vite、TypeScript、Node.js `node:test`、pnpm、Fontsource Variable 字体包。

## Global Constraints

- 只允许 JetBrains Mono 与 Noto Sans SC 两个字体包目录，禁止把 pnpm store 根目录或用户目录加入白名单。
- 保持全局字体族、字号、字重、行高、字距和生产构建行为不变。
- 不新增第三方依赖。
- Online 预览启动继续显式要求合法 HTTP(S) `TARGET`。
- 真实字体资源请求必须返回 HTTP 200 和字体 MIME 类型。
- 浏览器验收必须等待 `document.fonts.ready`，再检查字体族和视觉一致性。
- 全量测试的既有 8 项失败基线保持不变，失败集合不得扩大。
- 每个代码或文档 commit 均需单独获得用户授权；push 和 PR 另行授权。

---

### Task 1: 增加字体目录解析与安全白名单回归测试

**Files:**
- Modify: `frontend/test/vite-online-proxy.test.mjs`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Produces: `resolveFontPackageDirectories(resolveModule)`，接收 `(specifier: string) => string` 解析器，返回去重后的字体包目录绝对路径数组。

- [x] **Step 1: Write the failing test**

在 `frontend/test/vite-online-proxy.test.mjs` 增加：

```js
import path from "node:path";

import { resolveFontPackageDirectories } from "../vite.config.ts";

test("字体文件系统白名单只包含两个 Fontsource 包目录", () => {
  const fakeResolver = (specifier) =>
    `file:///repo/node_modules/${specifier}`;

  assert.deepEqual(
    resolveFontPackageDirectories(fakeResolver),
    [
      path.resolve(
        "/repo/node_modules/@fontsource-variable/jetbrains-mono",
      ),
      path.resolve("/repo/node_modules/@fontsource-variable/noto-sans-sc"),
    ],
  );
});
```

该测试同时验证目录粒度和包数量；断言数组不包含 `/repo/node_modules`、`/repo` 或用户目录等父目录。

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs
```

Expected: FAIL with `resolveFontPackageDirectories is not a function`。

- [x] **Step 3: Write minimal implementation**

在 `frontend/vite.config.ts` 增加：

```ts
import { fileURLToPath } from "node:url"

const fontPackageSpecifiers = [
  "@fontsource-variable/jetbrains-mono",
  "@fontsource-variable/noto-sans-sc",
]

export function resolveFontPackageDirectories(
  resolveModule: (specifier: string) => string = (specifier) =>
    import.meta.resolve(specifier),
): string[] {
  return [...new Set(
    fontPackageSpecifiers.map((specifier) =>
      path.dirname(fileURLToPath(resolveModule(`${specifier}/wght.css`))),
    ),
  )]
}
```

实现时解析器应接收完整的 `${specifier}/wght.css` 入口，并对入口文件使用 `path.dirname` 得到包目录。配置返回值中加入项目根目录与上述两个目录：

```ts
server: {
  fs: {
    allow: [
      searchForWorkspaceRoot(process.cwd()),
      ...resolveFontPackageDirectories(),
    ],
  },
}
```

从 `vite` 导入 `searchForWorkspaceRoot`，保留现有 `server` 的 host、port、allowedHosts 和 proxy 配置。

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs
```

Expected: 5 tests pass。

- [x] **Step 5: Run type and lint checks**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js vite.config.ts test/vite-online-proxy.test.mjs
```

Expected: both commands exit 0。

- [x] **Step 6: Commit after explicit authorization**

提交前向用户请求本任务单独授权。授权后只提交 `frontend/vite.config.ts` 与 `frontend/test/vite-online-proxy.test.mjs`，使用中文提交信息：

```bash
git add frontend/vite.config.ts frontend/test/vite-online-proxy.test.mjs
git commit -m "修复：允许 online 预览加载字体资源"
```

### Task 2: 验证开发预览实际字体资源

**Files:**
- No source changes expected.
- Verify: `frontend/scripts/check-online-preview.mjs`

**Interfaces:**
- Consumes: Task 1 Vite `server.fs.allow` configuration and the running preview URL.
- Produces: repeatable commands proving representative WOFF2 resources are reachable.

- [x] **Step 1: Build online mode**

Run:

```bash
VITE_APP_EDITION=online /root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/typescript/bin/tsc -b
VITE_APP_EDITION=online /root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/vite/bin/vite.js build --mode online
```

Expected: build exits 0 and `dist/assets/` contains JetBrains Mono and Noto Sans SC WOFF2 assets.

- [x] **Step 2: Restart the online preview with explicit TARGET**

Stop only the preview terminal created for this work, then run through the managed background terminal:

```bash
TARGET=https://monkeycode-ai.com pnpm run dev:online -- --host 0.0.0.0 --port 4215
```

Expected: preview starts without `Must set target or forward` and exposes the existing preview URL.

- [x] **Step 3: Confirm representative WOFF2 responses**

Read the transformed Fontsource CSS to obtain the JetBrains Mono Latin and Noto Sans SC Latin WOFF2 paths. Store each complete URL in `jetbrains_font_url` and `noto_font_url`, then request both with a 15-second timeout:

```bash
curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code} %{content_type} %{size_download}\n' "$jetbrains_font_url"
curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code} %{content_type} %{size_download}\n' "$noto_font_url"
```

Expected: both responses return `200`, a font MIME type, and a positive byte count. The same paths returned `403` before Task 1.

- [x] **Step 4: Run existing CAPTCHA health check**

Run:

```bash
PREVIEW_URL=https://4215-e84020e6e952be3c.monkeycode-ai.online pnpm run check:online-preview
```

Expected: `Online preview captcha health check passed.`

### Task 3: Complete regression and visual acceptance

**Files:**
- No source changes expected.
- Review: `.monkeycode/MEMORY.md`

**Interfaces:**
- Consumes: Task 2 running preview URL and the recorded font验收 workflow.
- Produces: verified font loading state and responsive layout evidence.

- [x] **Step 1: Run focused tests and lint**

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs test/online-preview-health.test.mjs test/input-group-orientation.test.mjs test/task-chat-input-mobile-layout.test.mjs
/root/.local/share/pnpm/nodejs/22.23.1/bin/node node_modules/eslint/bin/eslint.js .
```

Expected: focused tests pass and ESLint exits 0。

- [x] **Step 2: Run full frontend test suite**

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/*.test.ts test/*.test.mjs
```

Expected: 281 or more tests execute; the same eight baseline failures remain and no new failures appear。

- [ ] **Step 3: Check browser font state**

After opening the preview and logging in manually, wait for fonts and run in DevTools:

```js
await document.fonts.ready;
[
  document.fonts.check('400 16px "JetBrains Mono Variable"'),
  document.fonts.check('400 16px "Noto Sans SC Variable"'),
  getComputedStyle(document.body).fontFamily,
]
```

Expected: both checks return `true`; the body font family contains the project font stack. Network and console show no font resource error.

- [ ] **Step 4: Check responsive typography and input layout**

At 320px, 375px, 390px, 430px and 1280px verify body/input font family, font size, font weight, line height, no horizontal scroll, and no overlap between input, tools and send controls. Confirm touch targets remain at least 44px.

- [x] **Step 5: Final diff and status review**

```bash
git diff --check
git status --short
git diff --stat
```

Expected: only explicitly authorized changes are present and whitespace validation passes。

- [ ] **Step 6: Request separate authorization for implementation commit, push, and PR**

Implementation commit, remote push, and PR creation each require separate user authorization. Keep the eight baseline failures documented in the handoff.
