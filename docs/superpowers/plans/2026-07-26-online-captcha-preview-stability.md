# Online 预览验证码稳定性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 online 预览在 API 代理目标缺失时立即失败，并通过统一健康检查阻止验证码链路异常的预览进入 UI 验收。

**Architecture:** Vite 配置在 online serve 阶段验证显式 `TARGET`，同时保持 online build 无目标可执行。独立 Node.js 脚本通过预览 URL 验证 CAP JavaScript、WASM 和 challenge API，并把固定命令与故障定位写入项目工作流记录。

**Tech Stack:** Vite 7、TypeScript 5.9、Node.js 22 原生 test runner、Node.js Fetch API、pnpm 9。

## Global Constraints

- online serve 必须显式提供合法的 HTTP(S) `TARGET`。
- online build 必须继续支持无 `TARGET` 执行。
- 健康检查不得输出 challenge 内容、验证码 token、Cookie 或认证头。
- 服务端验证码算法、token 校验、前端登录逻辑和 `@cap.js/widget` 保持现状。
- 新增脚本不得引入第三方依赖。
- 实现遵循 RED-GREEN-REFACTOR，每个任务提交前必须获得用户明确授权。
- online 预览启动后必须先通过自动健康检查，再进行真实验证码与登录人工验收。

---

## 文件结构

- Modify: `frontend/vite.config.ts`：验证 online serve 的代理目标并向 Vite proxy 提供有效 URL。
- Create: `frontend/test/vite-online-proxy.test.mjs`：覆盖缺失、非法、合法目标和 build 边界。
- Create: `frontend/scripts/check-online-preview.mjs`：执行无敏感信息输出的预览验证码健康检查。
- Create: `frontend/test/online-preview-health.test.mjs`：使用本地 HTTP server 覆盖健康与失败响应。
- Modify: `frontend/package.json`：提供统一的 `check:online-preview` 命令。
- Create: `.monkeycode/MEMORY.md`：记录构建、预览、健康检查、人工验收和排错流程。

### Task 1: Online 代理目标 fail-fast

**Files:**
- Modify: `frontend/vite.config.ts:7-62`
- Create: `frontend/test/vite-online-proxy.test.mjs`

**Interfaces:**
- Consumes: Vite 的 `command`、`VITE_APP_EDITION` 和 `TARGET`。
- Produces: `resolveOnlineProxyTarget(options): string | undefined`，供 Vite 配置和回归测试共同使用。

- [ ] **Step 1: 写入代理目标失败测试**

创建 `frontend/test/vite-online-proxy.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";

import { resolveOnlineProxyTarget } from "../vite.config.ts";

test("online serve 缺少 TARGET 时立即失败", () => {
  assert.throws(
    () =>
      resolveOnlineProxyTarget({
        command: "serve",
        appEdition: "online",
        target: undefined,
      }),
    /TARGET is required for online preview/,
  );
});

test("online serve 拒绝非 HTTP 协议 TARGET", () => {
  assert.throws(
    () =>
      resolveOnlineProxyTarget({
        command: "serve",
        appEdition: "online",
        target: "file:///tmp/backend",
      }),
    /TARGET must be an absolute HTTP\(S\) URL/,
  );
});

test("online serve 返回规范化的 HTTP TARGET", () => {
  assert.equal(
    resolveOnlineProxyTarget({
      command: "serve",
      appEdition: "online",
      target: "  https://example.com/api  ",
    }),
    "https://example.com/api",
  );
});

test("online build 缺少 TARGET 时保持可用", () => {
  assert.equal(
    resolveOnlineProxyTarget({
      command: "build",
      appEdition: "online",
      target: undefined,
    }),
    undefined,
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs
```

Working directory: `frontend`

Expected: FAIL，提示 `vite.config.ts` 未导出 `resolveOnlineProxyTarget`。

- [ ] **Step 3: 实现最小代理目标校验**

在 `frontend/vite.config.ts` 的 import 后新增：

```ts
interface OnlineProxyTargetOptions {
  command: string
  appEdition: string | undefined
  target: string | undefined
}

export function resolveOnlineProxyTarget({
  command,
  appEdition,
  target,
}: OnlineProxyTargetOptions): string | undefined {
  const normalizedTarget = target?.trim()

  if (command !== 'serve' || appEdition !== 'online') {
    return normalizedTarget || undefined
  }

  if (!normalizedTarget) {
    throw new Error(
      'TARGET is required for online preview. Example: TARGET=https://monkeycode-ai.com pnpm run dev:online',
    )
  }

  let parsedTarget: URL
  try {
    parsedTarget = new URL(normalizedTarget)
  } catch {
    throw new Error('TARGET must be an absolute HTTP(S) URL')
  }

  if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
    throw new Error('TARGET must be an absolute HTTP(S) URL')
  }

  return normalizedTarget
}
```

把配置回调签名和 proxy target 修改为：

```ts
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appEdition = process.env.VITE_APP_EDITION ?? env.VITE_APP_EDITION
  const proxyTarget = resolveOnlineProxyTarget({
    command,
    appEdition,
    target: env.TARGET,
  })
```

```ts
        '/api': {
          target: proxyTarget,
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs
```

Expected: 4 tests PASS。

- [ ] **Step 5: 验证真实配置边界**

使用后台终端执行：

```bash
pnpm run dev:online -- --host 127.0.0.1 --port 4216
```

Expected: 进程立即失败，并输出 `TARGET is required for online preview`。

Run:

```bash
pnpm run build:online
```

Expected: TypeScript 和 Vite 构建成功，无需 `TARGET`。

- [ ] **Step 6: 运行代码质量检查**

Run:

```bash
pnpm exec eslint vite.config.ts test/vite-online-proxy.test.mjs
git diff --check
```

Expected: ESLint 零错误，`git diff --check` 无输出。

- [ ] **Step 7: 请求并创建 Task 1 独立提交**

先向用户展示测试结果和精确变更文件，获得明确授权后执行：

```bash
git add frontend/vite.config.ts frontend/test/vite-online-proxy.test.mjs
git commit -m "修复：校验 online 预览代理目标"
```

### Task 2: 验证码预览健康检查

**Files:**
- Create: `frontend/scripts/check-online-preview.mjs`
- Create: `frontend/test/online-preview-health.test.mjs`
- Modify: `frontend/package.json:8-17`

**Interfaces:**
- Consumes: `PREVIEW_URL` 环境变量和标准 Fetch API。
- Produces: `checkOnlinePreview(baseUrl, fetchImpl): Promise<void>` 与 `pnpm run check:online-preview`。

- [ ] **Step 1: 写入健康检查失败测试**

创建 `frontend/test/online-preview-health.test.mjs`：

```js
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { checkOnlinePreview } from "../scripts/check-online-preview.mjs";

const validChallenge = JSON.stringify({
  challenge: { c: 50, s: 32, d: 3 },
  expires: Date.now() + 120_000,
  token: "test-challenge-token",
});

async function withPreviewServer(overrides, callback) {
  const server = createServer((request, response) => {
    const override = overrides[request.url] ?? {};

    if (request.url === "/captcha/cap_wasm.js") {
      response.writeHead(override.status ?? 200, {
        "content-type": override.contentType ?? "text/javascript",
      });
      response.end(override.body ?? "export default async function init() {};");
      return;
    }

    if (request.url === "/captcha/cap_wasm_bg.wasm") {
      response.writeHead(override.status ?? 200, {
        "content-type": override.contentType ?? "application/wasm",
      });
      response.end(override.body ?? Buffer.from([0, 97, 115, 109]));
      return;
    }

    if (
      request.url === "/api/v1/public/captcha/challenge" &&
      request.method === "POST"
    ) {
      response.writeHead(override.status ?? 201, {
        "content-type": override.contentType ?? "application/json",
      });
      response.end(override.body ?? validChallenge);
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("验证码预览资源和 challenge 健康时通过", async () => {
  await withPreviewServer({}, async (baseUrl) => {
    await assert.doesNotReject(() => checkOnlinePreview(baseUrl));
  });
});

test("网络错误包含当前检查阶段", async () => {
  await assert.rejects(
    () =>
      checkOnlinePreview("https://preview.example", async () => {
        throw new Error("connection refused");
      }),
    /CAP JavaScript request failed/,
  );
});

test("WASM MIME 类型错误时失败", async () => {
  await withPreviewServer(
    {
      "/captcha/cap_wasm_bg.wasm": { contentType: "text/plain" },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /CAP WASM check failed: status=200, content-type=text\/plain/,
      );
    },
  );
});

test("challenge 代理失败时只输出 HTTP 元数据", async () => {
  const sensitiveBody = "sensitive-response-body";

  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        status: 500,
        contentType: "text/plain",
        body: sensitiveBody,
      },
    },
    async (baseUrl) => {
      await assert.rejects(async () => {
        try {
          await checkOnlinePreview(baseUrl);
        } catch (error) {
          assert.doesNotMatch(error.message, new RegExp(sensitiveBody));
          throw error;
        }
      }, /Captcha challenge check failed: status=500, content-type=text\/plain/);
    },
  );
});

test("challenge JSON 结构缺失时失败", async () => {
  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        body: JSON.stringify({ success: true }),
      },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /Captcha challenge response has an invalid structure/,
      );
    },
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/online-preview-health.test.mjs
```

Working directory: `frontend`

Expected: FAIL，提示缺少 `scripts/check-online-preview.mjs`。

- [ ] **Step 3: 实现最小健康检查脚本**

创建 `frontend/scripts/check-online-preview.mjs`：

```js
import { pathToFileURL } from "node:url";

const checks = [
  {
    label: "CAP JavaScript",
    path: "/captcha/cap_wasm.js",
    expectedStatus: 200,
    contentTypePattern: /^(application|text)\/javascript(?:;|$)/i,
  },
  {
    label: "CAP WASM",
    path: "/captcha/cap_wasm_bg.wasm",
    expectedStatus: 200,
    contentTypePattern: /^application\/wasm(?:;|$)/i,
  },
  {
    label: "Captcha challenge",
    path: "/api/v1/public/captcha/challenge",
    method: "POST",
    expectedStatus: 201,
    contentTypePattern: /^application\/json(?:;|$)/i,
    validateBody: true,
  },
];

function resolveBaseUrl(rawBaseUrl) {
  if (!rawBaseUrl) {
    throw new Error("PREVIEW_URL is required");
  }

  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("PREVIEW_URL must be an absolute HTTP(S) URL");
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("PREVIEW_URL must be an absolute HTTP(S) URL");
  }

  return baseUrl;
}

function isValidChallenge(data) {
  return Boolean(
    data &&
      typeof data.token === "string" &&
      data.token.length > 0 &&
      Number.isFinite(data.expires) &&
      data.challenge &&
      Number.isFinite(data.challenge.c) &&
      Number.isFinite(data.challenge.s) &&
      Number.isFinite(data.challenge.d),
  );
}

export async function checkOnlinePreview(rawBaseUrl, fetchImpl = fetch) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);

  for (const check of checks) {
    let response;
    try {
      response = await fetchImpl(new URL(check.path, baseUrl), {
        method: check.method ?? "GET",
        headers:
          check.method === "POST" ? { "content-type": "application/json" } : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error(`${check.label} request failed`);
    }
    const contentType = response.headers.get("content-type") ?? "(missing)";

    if (
      response.status !== check.expectedStatus ||
      !check.contentTypePattern.test(contentType)
    ) {
      throw new Error(
        `${check.label} check failed: status=${response.status}, content-type=${contentType}`,
      );
    }

    if (check.validateBody) {
      let challenge;
      try {
        challenge = await response.json();
      } catch {
        throw new Error("Captcha challenge response has an invalid structure");
      }

      if (!isValidChallenge(challenge)) {
        throw new Error("Captcha challenge response has an invalid structure");
      }
    }
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  checkOnlinePreview(process.env.PREVIEW_URL)
    .then(() => {
      console.log("Online preview captcha health check passed.");
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: 增加统一 package script**

在 `frontend/package.json` 的 scripts 中添加：

```json
"check:online-preview": "node scripts/check-online-preview.mjs"
```

保持相邻脚本为：

```json
"build:offline": "tsc -b && vite build --mode offline",
"check:online-preview": "node scripts/check-online-preview.mjs",
"lint": "eslint ."
```

- [ ] **Step 5: 运行聚焦测试并确认 GREEN**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/online-preview-health.test.mjs
```

Expected: 5 tests PASS。

- [ ] **Step 6: 验证 CLI 缺参错误**

Run:

```bash
pnpm run check:online-preview
```

Expected: 退出码非 0，输出 `PREVIEW_URL is required`。

- [ ] **Step 7: 运行代码质量检查**

Run:

```bash
pnpm exec eslint scripts/check-online-preview.mjs test/online-preview-health.test.mjs
git diff --check
```

Expected: ESLint 零错误，`git diff --check` 无输出。

- [ ] **Step 8: 请求并创建 Task 2 独立提交**

先向用户展示测试结果和精确变更文件，获得明确授权后执行：

```bash
git add frontend/scripts/check-online-preview.mjs frontend/test/online-preview-health.test.mjs frontend/package.json
git commit -m "测试：增加 online 预览验证码健康检查"
```

### Task 3: 工作流记录与端到端验收

**Files:**
- Create: `.monkeycode/MEMORY.md`

**Interfaces:**
- Consumes: Task 1 的显式 `TARGET` 契约和 Task 2 的 `check:online-preview` 命令。
- Produces: 后续 Agent 可直接执行的 online 构建、预览、验证码检查和排错流程。

- [ ] **Step 1: 创建项目工作流记录**

创建 `.monkeycode/MEMORY.md`：

```md
# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[Online 预览构建与验证码验收]
- Date: 2026-07-26
- Context: Agent 在排查 online 构建后登录验证码失败时发现
- Category: 构建方法|测试方法|排错调试
- Instructions:
  - 在 `frontend` 运行 `pnpm run build:online` 验证 online 生产构建。
  - 启动 online 开发预览时显式设置 API 目标，例如 `TARGET=https://monkeycode-ai.com pnpm run dev:online -- --host 0.0.0.0 --port <PORT>`。
  - 获得预览地址后运行 `PREVIEW_URL=<URL> pnpm run check:online-preview`，验证 CAP JavaScript、WASM 和 challenge API。
  - 自动健康检查通过后，在浏览器完成一次真实验证码求解和登录，再开始登录后页面的 UI 验收。
  - Vite 日志出现 `Must set target or forward` 表示 `/api` proxy 缺少 `TARGET`，应使用显式目标重启预览。
```

- [ ] **Step 2: 运行聚焦与完整自动测试**

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/vite-online-proxy.test.mjs test/online-preview-health.test.mjs test/input-group-orientation.test.mjs test/task-chat-input-mobile-layout.test.mjs
```

Expected: 13 tests PASS。

Run:

```bash
/root/.local/share/pnpm/nodejs/22.23.1/bin/node --test test/*.test.mjs test/*.test.ts
```

Expected: 本分支新增测试全部通过；现有基线失败按文件和测试名记录，不得扩大失败集合。

- [ ] **Step 3: 运行完整 lint、build 和 whitespace 检查**

Run:

```bash
pnpm run lint
pnpm run build:online
git diff --check origin/main...HEAD
```

Expected: lint 与 build 成功，`git diff --check` 无输出。

- [ ] **Step 4: 请求并创建工作流记录独立提交**

先向用户展示记录内容和验证结果，获得明确授权后执行：

```bash
git add .monkeycode/MEMORY.md
git commit -m "文档：记录 online 预览验证码验收流程"
```

- [ ] **Step 5: 停止无目标的旧预览并启动有效预览**

使用 `deploy-website` skill 和后台终端管理能力停止当前 terminal `term_1784999619747_101`，然后从 `frontend` 使用以下等价命令启动新预览：

```bash
TARGET=https://monkeycode-ai.com pnpm run dev:online -- --host 0.0.0.0 --port 4215
```

Expected: Vite 成功启动，日志不再出现 `Must set target or forward`。

- [ ] **Step 6: 对真实预览运行验证码健康检查**

Run:

```bash
PREVIEW_URL=<平台返回的预览 URL> pnpm run check:online-preview
```

Working directory: `frontend`

Expected: 输出 `Online preview captcha health check passed.`，退出码为 0。

- [ ] **Step 7: 完成人工验证码与移动端输入栏验收**

在真实预览中完成一次验证码求解和登录，然后按移动端输入栏原计划验证 320px、375px、390px、430px 和 1280px。

Expected:

- 验证码成功兑换，登录请求进入正常业务流程
- 手机端输入区、工具区和发送区互不重叠
- 手机端触控目标至少 44px
- 页面不产生横向滚动
- 桌面端现有视觉、文案和交互保持一致

- [ ] **Step 8: 检查最终分支状态**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: 工作树干净，所有预期提交位于当前分支，whitespace 检查通过。push 和 PR 继续等待独立明确授权。
