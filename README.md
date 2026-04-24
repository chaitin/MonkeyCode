# MonkeyCode

<p align="center">
  <img src="./frontend/public/logo-dark.png" alt="MonkeyCode" width="200" />
</p>

<p align="center">
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml/badge.svg" alt="Service Images" /></a>
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml/badge.svg" alt="Client Release" /></a>
</p>

<p align="center">
  <a href="https://monkeycode-ai.com/">🚀 立即在线使用</a> ·
  <a href="https://baizhi.cloud/consult">🏢 企业离线部署咨询</a> ·
  <a href="https://monkeycode.docs.baizhi.cloud/">📖 使用文档</a> ·
  <a href="https://github.com/chaitin/MonkeyCode/releases">⬇️ 客户端下载</a>
</p>

> MonkeyCode 是在线 AI 开发平台。无需安装，无需连接本地开发机，打开浏览器即可让 AI 在云端开发环境中帮你写代码、跑命令、改文件、做审查，并把结果接回真实 Git 协作流程。

## 立即开始

最推荐的使用方式是直接访问在线版：

**在线使用地址：[https://monkeycode-ai.com/](https://monkeycode-ai.com/)**

个人开发者可以免费开始使用；企业团队如果需要内网部署、数据不出本地、统一资源管理和商业支持，可以咨询企业级离线部署：

**企业离线部署咨询：[https://baizhi.cloud/consult](https://baizhi.cloud/consult)**

## MonkeyCode 是什么

MonkeyCode 不是传统代码补全插件，也不是只在本地终端里运行的 CLI 工具。它把 AI Agent、云端运行环境、在线终端、文件管理、端口预览、Git 协作和多模型能力放在同一个平台里。

你只需要用自然语言描述目标，MonkeyCode 会在独立云开发环境中理解项目、执行命令、修改代码、验证结果，并支持继续迭代或回到 PR / MR 流程。

## 为什么选择在线版

| 能力 | 说明 |
|---|---|
| 免费即用 | 注册后即可开始，不需要先购买额度或准备本地环境 |
| 云端开发环境 | 每个任务背后都有独立运行环境，编译、测试、预览都可以在云上完成 |
| 不依赖本地开发机 | 不需要连接自己的电脑，也不用先配置复杂工具链 |
| 主流模型接入 | 支持 GPT、Claude、GLM、Kimi、MiniMax、Qwen、DeepSeek 等模型 |
| 跨设备继续任务 | Web、桌面端和移动端接入同一套任务与项目数据 |
| 回到 Git 协作 | 支持 GitHub、GitLab、Gitea、Gitee 等平台，让 AI 结果进入真实研发流程 |

## 核心功能

### 智能任务

用自然语言描述需求，选择开发、设计或审查任务，AI 会根据上下文推进执行。它不是只返回一段回答，而是可以在真实项目环境里读代码、改文件、跑命令和反馈结果。

### 云开发环境

平台内置在线工作台，提供终端、文件管理、端口预览、任务日志和远程协助能力。你可以在浏览器中完成开发、调试、预览和交付。

### 多模型与工具链

内置主流大模型，并支持按任务类型选择模型。也支持接入第三方兼容接口，方便团队按成本、速度和能力灵活配置。

### Git 协作与代码审查

支持接入 GitHub、GitLab、Gitea、Gitee 等平台。你可以让 AI 实现需求、生成改动、辅助提交，也可以配置 Git 机器人自动审查 PR / MR。

### 项目与需求管理

围绕项目持续管理需求、设计、开发任务和审查结果，让 AI 不只是一次性生成代码，而是参与完整研发链路。

### 团队与资源管理

团队管理员可以统一管理成员、宿主机、镜像、AI 模型和权限，适合研发团队集中使用和成本管控。

## 典型场景

| 场景 | MonkeyCode 可以做什么 |
|---|---|
| 开发项目 | 读取仓库、理解项目约定、实现需求、补测试、运行验证 |
| 快速原型 | 一句话描述玩法或产品想法，让 AI 搭框架并跑出可预览版本 |
| 安全审查 | 检查常见漏洞、硬编码密钥、依赖风险和可疑代码变更 |
| 数据分析 | 处理 CSV / Parquet 数据，自动清洗、建模、画图并总结结论 |
| 技术调研 | 聚合公开资料，输出方案对比、选型建议和调研报告 |
| 文档写作 | 辅助写技术文档、方案说明、论文提纲和实验脚本 |
| 移动办公 | 在手机或平板上查看任务进度，让 Agent 继续在云端执行 |

## 企业级离线部署

对于数据安全、网络边界和合规要求更高的团队，MonkeyCode 支持企业级离线部署和私有化落地。

企业版适合以下场景：

- 代码、Prompt、任务记录和运行数据不出企业内网
- 接入企业自有模型、私有模型网关、Ollama 或 vLLM
- 统一管理团队成员、权限、模型、镜像和计算资源
- 对接内部 Git 平台和研发流程
- 获得企业级安全、审计、运维和商业支持

如果你希望在企业内网部署 MonkeyCode，请访问：

[https://baizhi.cloud/consult](https://baizhi.cloud/consult)

## 产品对比

| 能力 | MonkeyCode | Cursor | Claude Code | Codex |
|---|:---:|:---:|:---:|:---:|
| 在线使用 | ✅ | ✅ | ✅ | ✅ |
| 本地 IDE | ❌ | ✅ | ✅ | ✅ |
| 本地 CLI | ❌ | ✅ | ✅ | ✅ |
| 云端开发环境 | ✅ | 部分 | 部分 | 部分 |
| 需求与 SPEC 管理 | ✅ | ❌ | ❌ | ❌ |
| PR / MR 自动代码审查 | ✅ | 部分 | 部分 | 部分 |
| 团队协作 | ✅ | ❌ | ❌ | ❌ |
| 适配国产大模型 | ✅ | ❌ | ❌ | ❌ |
| 私有化部署 | ✅ | ❌ | ❌ | ❌ |
| 开源 | ✅ | ❌ | ❌ | ❌ |

MonkeyCode 的核心差异不是“再做一个代码补全工具”，而是把 AI 开发任务放进可运行、可协作、可持续管理的云端工作流里。

## 快速开始

1. 访问 [https://monkeycode-ai.com/](https://monkeycode-ai.com/)
2. 创建你的第一个 AI 开发任务
3. 选择任务类型、模型和项目来源
4. 在云开发环境中查看终端、文件改动和预览结果
5. 将结果继续迭代，或接回 Git 协作流程

详细使用指南请参考[使用文档](https://monkeycode.docs.baizhi.cloud/)。

## 技术社区

欢迎加入我们的技术交流群，与更多开发者一起交流探讨：

<table>
  <tr>
    <td align="center"><img src="./frontend/public/wechat.png" width="160" /><br/>微信交流群</td>
    <td align="center"><img src="./frontend/public/feishu.png" width="160" /><br/>飞书交流群</td>
    <td align="center"><img src="./frontend/public/dingtalk.png" width="160" /><br/>钉钉交流群</td>
  </tr>
</table>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chaitin/MonkeyCode&type=Date)](https://star-history.com/#chaitin/MonkeyCode&Date)
