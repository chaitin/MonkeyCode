# Online 预览验证码稳定性修复设计

## 背景

Web 前端完成 online 构建并启动预览后，登录操作会提示“验证码验证失败”。该现象容易在新的预览进程中重复出现，阻塞移动端输入栏等需要登录的人工验收。

仓库已有一次 CAP WASM 本地化修复：`frontend/index.html` 在模块加载前设置 `CAP_CUSTOM_WASM_URL`，并从 `frontend/public/captcha/` 提供 JavaScript glue 和 WASM 文件。本次诊断确认这部分资源可正常访问。

## 根因证据

当前预览的检查结果为：

- `/captcha/cap_wasm.js` 返回 `200`，响应内容与仓库文件 SHA-256 一致
- `/captcha/cap_wasm_bg.wasm` 返回 `200 application/wasm`，响应内容与仓库文件 SHA-256 一致
- `/api/v1/public/captcha/challenge` 返回 `500 text/plain` 和空响应
- Vite 日志记录 `Error: Must set target or forward`
- `vite.config.ts` 将 `/api` 代理目标设置为 `env.TARGET`
- 当前 online 预览命令未设置 `TARGET`
- 生产验证码 challenge 接口直连返回 `201 application/json`

因此，故障发生在 Vite `/api` 代理初始化阶段。Vite 允许缺少代理目标的开发服务器启动，页面和静态验证码资源仍可加载；首次 API 请求才暴露运行时错误，前端统一显示验证码失败提示。

## 目标

1. online 开发服务缺少或收到非法 `TARGET` 时立即终止启动，并输出可执行的错误信息。
2. online 生产构建继续支持无 `TARGET` 执行。
3. online 预览必须显式选择 API 目标，避免隐式连接意外环境。
4. 构建后自动验证 CAP 静态资源和 challenge API 链路。
5. 将固定验证流程记录为项目工作流，供后续构建和 UI 验收复用。
6. 保持服务端验证码算法、token 校验和登录状态机不变。

## 方案比较

### 方案 A：在 `.env.online` 固定生产 API

所有 online 开发服务自动代理到生产 API，启动步骤最少。

代价：环境选择变成隐式行为，开发者容易在不知情时向生产环境发送登录和管理请求。

### 方案 B：显式目标加启动时校验

online 开发服务要求调用方显式提供 `TARGET`。Vite 在创建代理前验证该值，缺失或格式错误时立即失败。

优点：

- 环境选择清晰可审计
- 配置错误在启动阶段暴露
- online build 与开发代理解耦
- 可通过配置测试稳定覆盖

代价：每次启动 online 预览都需要提供一个环境变量。

### 方案 C：预览同时启动本地后端

前端始终代理到本地后端，提供完整的本地联调环境。

代价：需要数据库、后端配置和更多服务依赖，不适合作为轻量 UI 分支的默认验收路径。

采用方案 B。

## 启动与代理设计

`frontend/vite.config.ts` 使用 Vite 配置上下文中的 `command` 区分开发服务和生产构建。

当 `command === "serve"` 且 `VITE_APP_EDITION === "online"` 时：

1. 读取并去除 `TARGET` 首尾空白。
2. 缺少 `TARGET` 时抛出包含示例命令的配置错误。
3. 使用 `URL` 解析目标。
4. 仅接受 `http:` 和 `https:` 协议。
5. 将验证后的绝对地址写入 `/api` proxy 的 `target`。

当 `command === "build"` 时，构建过程不创建实际代理服务，因此无需提供 `TARGET`。现有 `pnpm run build:online` 保持可用。

offline 开发模式维持当前配置边界，本次修复不扩展其后端启动策略。

## 构建后健康检查

新增无第三方依赖的 Node.js 检查脚本，通过 `PREVIEW_URL` 接收本次预览地址。脚本按顺序执行：

1. 请求 `/captcha/cap_wasm.js`，要求 HTTP 200 和 JavaScript MIME 类型。
2. 请求 `/captcha/cap_wasm_bg.wasm`，要求 HTTP 200 和 `application/wasm`。
3. POST `/api/v1/public/captcha/challenge`，要求 HTTP 201 和 JSON MIME 类型。
4. 验证 challenge 响应具有 CAP 客户端求解所需的结构。

任一步失败时，脚本以非零状态退出，并输出检查阶段、状态码和 MIME 类型。响应正文、challenge 数据和验证码 token 不写入日志。

`frontend/package.json` 提供统一脚本入口，避免后续验收手工拼接多个请求。

## 安全边界

- API 目标由启动者显式提供，仓库不固化生产环境代理地址。
- 代理目标只接受 HTTP(S) 绝对地址。
- 健康检查只创建短期 challenge，不执行登录、管理操作或 token 兑换。
- 健康检查日志不包含 challenge 内容、验证码 token、Cookie 或认证头。
- 服务端 challenge 生成、redeem 和业务 token 校验保持原样。
- 前端继续把验证码求解结果交给服务端验证，不引入跳过或降级路径。

## 测试设计

### 配置回归测试

1. online serve 缺少 `TARGET` 时立即失败。
2. online serve 的 `TARGET` 使用非 HTTP(S) 协议时立即失败。
3. online serve 提供合法目标时，`/api` proxy 使用规范化后的目标。
4. online build 缺少 `TARGET` 时配置仍可生成。

### 健康检查测试

使用本地测试服务器覆盖：

1. JS、WASM 和 challenge 均正确时退出码为 0。
2. 任一资源状态错误时退出码非 0，并定位失败阶段。
3. WASM MIME 类型错误时检查失败。
4. challenge 返回非 201 或非 JSON 时检查失败。
5. 错误输出不包含响应正文。

### 预览验收

online 预览使用以下等价启动方式：

```bash
TARGET=https://monkeycode-ai.com pnpm run dev:online -- --host 0.0.0.0 --port 4215
```

获得预览地址后运行健康检查，再在浏览器完成一次真实验证码求解和登录。健康检查与人工登录均通过后，继续移动端输入栏响应式验收。

## 工作流记录

在 `.monkeycode/MEMORY.md` 新增“Online 预览构建与验证码验收”项目知识条目，记录：

- online build 命令
- 显式 `TARGET` 的 preview 启动要求
- 预览健康检查命令
- 登录前验证码人工验收要求
- `Must set target or forward` 的定位含义

该记录属于构建、测试和排错工作流，可指导后续 Agent 在每次 online 预览中复用同一流程。

## 非目标

- 修改 CAP challenge 难度或有效期
- 修改验证码 token 的服务端验证规则
- 更换 `@cap.js/widget` 或 Go CAP 实现
- 将生产 API 地址写入默认环境配置
- 为 offline 模式引入新的后端启动方式
