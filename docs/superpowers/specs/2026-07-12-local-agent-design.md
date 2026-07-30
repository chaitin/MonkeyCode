# 本地客户端(全新)+ 自研 Agent 内核设计

## 背景

MonkeyCode 目前的手机端、桌面端本质上都是 Web 客户端,任务统一在云端开发环境(taskflow → Runner → VM → codingmatrix agent → 第三方 coding agent CLI)中执行。

需求:提供类似 **Codex App / Claude Code 桌面版**形态的本地产品(macOS / Windows / Linux):

- **agent 完全自研**,不封装第三方 CLI;
- **客户端全新开发**,不基于现有 `desktop/`(Electron Web 壳)改造;
- 用户打开 App,登录 MonkeyCode 账号,选择本地代码目录,agent 直接在本机执行。

**战略定位**:自研 agent 内核(下称 **mc-agent core**)设计为独立组件,本期随桌面 App 在本地运行;远期同一内核可部署进云端 VM,作为 `CodingAgent` 枚举的新成员(仓库内已有自研 agent 先例 MCAIReview,`backend/pkg/taskflow/types.go:562`),逐步降低对第三方 CLI 的依赖。

## 目标与非目标

**目标**

- 自研 agent 内核:完整 agentic loop(LLM 调用、工具执行、权限控制、上下文管理、会话持久化),对国产主流模型(GLM / Kimi / MiniMax / Qwen / DeepSeek)的 tool-calling 做鲁棒适配。
- 全新桌面客户端:轻量壳 + Web 技术 UI,单机闭环(选目录 → 发任务 → 流式展示 → 权限弹窗 → review diff)。
- LLM 流量走后端 LLMProxy(模型管理、计量、审计保留)。
- 内核与 UI 之间用现有流式帧协议解耦;从第一天建立 eval 体系。

**非目标(本期)**

- 手机端远程向本地机器派发任务(远期方向,见文末)。
- 云端 VM 部署 mc-agent core(远期,架构上预留)。
- 本地任务云端同步;改造现有 `desktop/`(维持原样直至新客户端接替)。

## 总体架构:薄壳 + 内核本地服务

关键设计:**mc-agent core 除 stdio 模式外,内置一个 localhost HTTP/WS 服务**,对 UI 讲与云端完全一致的流式帧协议。UI 连本地内核和 Web 前端连云端后端,是同一套协议、同一种编程模型。

```
┌─ 桌面客户端(新项目)──────────────────────────────────────┐
│  UI:React + TS(系统 WebView 内)                          │
│      │ WS ws://127.0.0.1:<port>(帧协议,launch token 鉴权) │
│  壳(Tauri 2):窗口/托盘/自更新/keychain/深链/内核进程管理   │
└──────┼──────────────────────────────────────────────────────┘
       ▼
┌─ mc-agent core(Go 单二进制)────────────────────────────────┐
│  宿主接口:localhost WS/HTTP ┃ stdio ┃ headless CLI(三选一) │
│  Session:任务/轮次/事件日志(JSONL+SQLite)、resume          │
│  Loop:LLM↔工具循环、压缩、中断恢复                          │
│  Provider:OpenAI/Anthropic 兼容、tool-call 归一化            │
│  Tools:read/write/edit/bash/grep/glob/git/todo + MCP 客户端  │
│  Policy:权限规则引擎(工具×路径×命令),审批上抛              │
│  Context:系统提示、规则/技能装配、repo 概览、窗口管理         │
└──────┬───────────────────────────────────────────────────────┘
       │ HTTPS
       ▼
  MonkeyCode 后端:OAuth 登录 │ LLMProxy(运行时 key)│ 技能/规则下发
```

这个切分的含义:

- **壳几乎不承载业务**:文件访问、进程、网络全在内核;壳只做窗口、托盘、自更新、keychain、深链回调和内核进程拉起。壳的技术选型因此变成低风险决策,将来可换。
- **同一内核四种宿主**:桌面壳(localhost WS)、headless CLI(开发/eval)、未来的云端 VM 接入器(stdio/gRPC)、未来的 IDE 插件(localhost WS 直连)——全部零改内核。
- taskflow / Runner / VM **完全不参与**。

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| agent 来源 | 完全自研 Go 内核 | 自主可控、深度调优国产模型;与后端同栈;单二进制三平台 |
| 客户端 | 全新项目,壳用 **Tauri 2**,UI 用 React + TS | 见下节选型对比;不改现有 desktop/ |
| UI↔内核通道 | 内核内置 localhost WS 服务,帧协议与云端一致 | UI 编程模型与 Web 前端相同;壳零业务逻辑;为 IDE 插件/远程附着留缝 |
| 本地服务安全 | 仅绑 127.0.0.1 + 每次启动随机 launch token | 防本机其他进程访问内核 |
| 登录 | 系统浏览器 OAuth + 深链回调(`monkeycode://auth`) | 桌面产品标准做法(Codex App 同款);不内嵌登录页,凭证入系统 keychain |
| LLM 接入 | 后端 LLMProxy,每任务运行时 key,不落盘 | 企业模型管控、计量不旁路 |
| 编辑工具方案 | 精确字符串替换为主,整文件重写兜底 | 弱模型下失败率最低的编辑范式 |
| 上下文策略 | 规则装配 + 工具结果窗口管理 + 阈值触发压缩 | 长任务不爆上下文 |
| 扩展机制 | MCP 客户端 + 复用 AgentSkill/AgentRule 下发 | 与平台已有资产打通 |
| 质量保障 | eval harness(headless CLI 驱动),内部任务集 + SWE-bench 子集 | 自研 agent 无评测则无迭代方向 |

### 客户端壳选型对比

| 方案 | 优势 | 劣势 | 结论 |
|------|------|------|------|
| **Tauri 2** | 安装包 ~10MB;系统 WebView;托盘/自更新/深链/keychain 官方插件齐全;安全模型好 | 壳层是 Rust(但本方案壳几乎无逻辑,Rust 面积很小);Linux WebKitGTK 偶有渲染差异 | **推荐** |
| Wails(Go) | 全 Go 栈,无新语言 | v2 生态弱(自更新等要自建),v3 未稳定 | 备选:若团队坚决不引入 Rust |
| Electron(新建) | 生态最成熟,渲染一致 | 100MB+ 体积、内存高;且团队已验证过 Web 壳形态,无增量价值 | 不推荐 |
| 原生三端 | 体验上限最高 | 三套代码,成本不成比例 | 不推荐 |

UI 为本地产品全新设计(桌面信息密度、快捷键优先),技术栈与 `frontend/` 同源:React 19 + TS + Vite + Tailwind 4(+ xterm.js),成熟纯渲染组件(diff 视图、消息流)按件移植,不整体依赖。

**开发模式**:因 UI↔内核走 localhost WS,日常开发 `vite dev` + `mc-agent serve` 浏览器直连即可,壳仅参与集成测试与发版——壳的选型因此可替换、低风险。

**决策规则**:若团队评估后不愿引入任何 Rust,退到 Electron(成熟度最高、Codex App/Claude Desktop 同款、已有 electron-release 流水线经验),而非 Wails(v2 缺自更新/多窗口,v3 未稳定)。无论选哪个壳,"内核独立进程 + WS 边界"不可破——不因壳自带 Node 主进程而把业务逻辑内迁。

## 详细设计

### 1. mc-agent core:agentic loop

```
用户输入 → 装配上下文(系统提示+规则+历史) → LLM 流式请求
  → 解析输出:文本(转发 UI)/ tool_calls
  → 逐个工具调用:Policy 检查 → [需审批则上抛等待] → 执行 → 结果入上下文
  → 回到 LLM,直到无工具调用(轮次结束)或用户停止
```

关键工程点:

- **tool-call 归一化**:GLM/Kimi/Qwen/DeepSeek 的 function calling 质量参差,Provider 层负责 JSON 参数容错解析与修复、非法调用带错误反馈自动重试、必要时降级为结构化文本协议(XML 标签式)。这是自研内核对国产模型体验差异化的核心。
- **流式**:LLM token 流与工具执行进度(bash 输出)实时转帧推送。
- **中断/恢复**:停止 → 取消 LLM 请求、终止工具(POSIX 进程组 / Windows Job Object);事件日志保证任意时刻可续聊。
- **错误恢复**:请求失败指数退避重试、上下文超限触发压缩后重试、工具超时熔断。

### 2. 工具集(v1)

| 工具 | 说明 |
|------|------|
| `read_file` / `write_file` | 带行号、分页;写入经 Policy |
| `edit_file` | 精确字符串替换(唯一性校验),失败返回上下文引导重试 |
| `bash` | 持久 shell(POSIX)/ PowerShell(Windows);超时、输出截断;命令级 Policy |
| `grep` / `glob` | 内嵌 ripgrep,规避平台差异 |
| `git` | 状态/diff/log 结构化输出,供 UI diff 视图与 agent 自查 |
| `todo` / `plan` | 任务分解外显(UI 渲染清单) |
| MCP 工具 | 加载用户/平台配置的 MCP server(含 `monkeycode-ai`) |

后续:sub-agent、web fetch、LSP。

### 3. 上下文管理

- 系统提示 = 内核内置基础版 + 平台下发增量(随技能/规则通道热更新,不必发版)。
- 项目上下文:兼容读取 `AGENTS.md`/`CLAUDE.md` + MonkeyCode AgentRule 下发;repo 目录树摘要。
- 窗口管理:工具结果按新鲜度截断;历史超阈值(如 80%)触发 LLM 压缩,保留关键决策与文件清单。
- 技能:复用 `AgentResources` presigned zip 下发(`types.go:620`),按需注入。

### 4. Policy 层(权限与安全)

- 规则引擎:`工具 × 路径 × 命令模式`,动作 allow / deny / ask。默认:工作区内读放行;写/编辑首次询问可记住;bash 按命令前缀分级。
- 审批经帧协议上抛(复用现有 permission 消息类型),UI 弹窗,支持"本次/本任务/此目录永久"三级记忆,持久化到项目配置。
- 文件类工具强制限制在所选项目目录;可选 worktree 模式(任务在 `git worktree` 执行,结束一键应用/丢弃)。
- localhost 服务仅绑 127.0.0.1,launch token 由壳生成、经环境变量传内核、注入 UI;运行时模型 key 短时效按任务换取,不落盘。

### 5. 宿主接口(内核的部署边界)

- 帧格式沿用 `{type, kind, data, timestamp, seq}`(`consts/task.go`:task-started/running/ended、file-change、permission、user-input、call/call-response 等),缺的 kind 按同风格扩展。
- 下行:文本流、工具事件、权限请求、状态变更、file-change;上行:用户输入、停止、权限响应、`call` 同步查询(文件列表/读文件/diff)。
- 三种宿主模式一套协议:localhost WS(桌面 UI)、stdio(云端接入器预留)、headless CLI(`mc-agent run -p "..."`,开发调试与 eval 执行器)。

### 6. 桌面客户端

- **壳(Tauri 2)**:窗口/托盘、开机自启(可选)、自更新(壳与内核独立更新,版本经帧协议握手协商)、keychain 存凭证、`monkeycode://` 深链、内核进程拉起与守护。
- **UI(React + TS)**:会话列表、任务工作台(消息流/diff/权限卡片/todo)、项目目录管理、模型选择(来自后端模型列表)、设置。通过 WS 连内核,数据层与 Web 前端连云端同构。
- **登录流**:App 点登录 → 系统浏览器打开后端 OAuth 授权页 → 深链回调携 code → 壳换 token 入 keychain → 内核用其向后端换运行时 key。需后端补一个桌面客户端 OAuth client(见改动清单)。

### 7. 评测体系(与内核同步启动)

- headless CLI 驱动任务集自动判分(测试通过率、diff 正确性、步数/token 成本)。
- 任务集:内部真实场景(中文需求、国产模型)为主 + SWE-bench Verified 子集对标。
- 内核/提示词/模型变更必跑回归;按模型出分数矩阵,反哺 LLMProxy 模型路由推荐。

## 附录:内核 Go 技术选型

**原则**:① loop/上下文/工具调度是核心 IP,不用 agent 框架(LangChainGo、Eino 等),官方 SDK + 自研 loop;② 全程 CGO-free,保证三平台六产物一条命令交叉编译;③ 沿用后端惯例(`slog`、`samber/do`)。

| 领域 | 选型 | 说明 |
|------|------|------|
| LLM 客户端 | `openai/openai-go` + `anthropics/anthropic-sdk-go` | 仅作传输层;tool-call 归一化/容错/流式解析自研 |
| MCP | `modelcontextprotocol/go-sdk`(官方) | 备选 `mark3labs/mcp-go` |
| WS/本地服务 | `coder/websocket` + 标准库 `net/http` | localhost 服务不引 web 框架 |
| 会话存储 | JSONL 事件日志 + `modernc.org/sqlite` | 纯 Go;不用 ent |
| 持久 shell | `creack/pty`(POSIX)/ ConPTY 封装(Windows) | Windows 终端语义是重点打磨项 |
| 搜索/glob | 捆绑 ripgrep 平台二进制 + `bmatcuk/doublestar` | 不用纯 Go 重写搜索 |
| git / diff | shell out 系统 git;`sergi/go-diff` | 不用 go-git |
| 工具 schema | `invopop/jsonschema` | struct 生成 JSON Schema,单一来源 |
| 重试 / 配置 / CLI | `cenkalti/backoff` / `koanf` / `cobra` | — |
| token 计数 | API usage 为准 + 字符启发式兜底 | 国产模型 tokenizer 各异,不依赖本地精确计数 |

架构参考:charmbracelet/crush(Go,FSL 许可仅作参考)、plandex(长任务/会话)、codex-rs(模块切分与 App Server 协议蓝本)。

## 改动清单

| 位置 | 改动 |
|------|------|
| **新仓库** `mc-agent`(内核) | Go:loop、provider、tools、policy、context、session、MCP、localhost WS/stdio/CLI 三宿主、eval harness |
| **新仓库** `mc-desktop`(客户端) | Tauri 2 壳 + React UI;CI 出三平台签名安装包 |
| 后端 | 桌面 OAuth client(授权码 + 深链回调);运行时 key 换取接口(若移动端无现成等价);LLMProxy 终端用户 IP 限流策略 |
| `frontend/` | 无强制改动;diff/消息流等纯渲染组件可抽包供 mc-desktop 复用 |
| `desktop/` / taskflow / Runner / codingmatrix | **本期无改动** |

## 里程碑

1. **M1 内核可用(headless)**:loop + read/edit/bash/grep + Policy 基础 + 会话持久化,CLI 模式在真实仓库完成中等复杂度任务;eval harness 出基线分。
2. **M2 桌面闭环(macOS)**:Tauri 壳 + UI + localhost WS + OAuth 登录 + LLMProxy,流式/权限弹窗/diff 可用。
3. **M3 完整体验**:压缩/长任务、MCP、技能/规则同步、todo/plan、Windows/Linux 安装包、worktree 模式。
4. **M4 平台协同**:内核云端部署试点(stdio 宿主接入 codingmatrix/taskflow,成为新 CodingAgent)、模型分数矩阵驱动路由、sub-agent。

## 远期方向(不在本设计内)

- **云端同内核**:mc-agent core 进云 VM 替代/并列第三方 CLI——宿主接口(§5)已预留。
- **手机远程派发到本地**:本地常驻 daemon 接入云编排,单独立项;内核复用,仅宿主层更换。
- **IDE 插件**:直连本机内核 localhost WS,复用同一协议。

## 开放问题

1. LLMProxy 对 tool-calling 的透传完整度(parallel tool calls、流式 tool_call delta)是否满足内核需要?
2. 后端 OAuth 是否已支持授权码 + 自定义 scheme 回调的桌面客户端形态?
3. LLMProxy 面向终端用户外网 IP 直连的限流与防滥用策略。
4. 内核与客户端建独立仓库还是进主仓(monorepo)?本设计倾向独立仓库(发布节奏与主仓解耦),需定 CI/签名基建归属。
