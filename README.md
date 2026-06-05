# MonkeyCode

<p align="center">
  <img src="./frontend/public/logo-dark.png" alt="MonkeyCode" width="200" />
</p>

<p align="center">
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml/badge.svg" alt="Service Images" /></a>
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml/badge.svg" alt="Client Release" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" /></a>
</p>

<p align="center">
  <a href="https://monkeycode-ai.com/">在线使用</a> ·
  <a href="https://monkeycode.docs.baizhi.cloud/">使用文档</a> ·
  <a href="#独立部署使用">独立部署</a> ·
  <a href="https://baizhi.cloud/consult">企业咨询</a>
</p>

> MonkeyCode 是面向真实研发流程的云端 AI 开发平台。开发者只需要描述目标，AI Agent 就可以在独立云开发环境中读取仓库、修改代码、运行命令、预览结果、审查变更，并把结果接回 Git 协作流程。

## MonkeyCode 是什么

MonkeyCode 不是传统代码补全插件，也不是只在本地终端运行的 CLI 工具。它把 AI Agent、云端运行环境、在线终端、文件管理、端口预览、多模型能力和 Git 协作放在同一个平台里，让 AI 真正进入 `需求 -> 设计 -> 开发 -> Review` 的研发链路。

你可以直接使用在线版，也可以在企业内网中独立部署。对于个人开发者，MonkeyCode 提供开箱即用的在线 AI 开发体验；对于团队，MonkeyCode 提供统一的模型、镜像、权限、宿主机和任务管理能力。

## 界面展示

<table>
  <tr>
    <td align="center">
      <img src="./frontend/public/monkeycode-1.png" alt="MonkeyCode AI 任务工作台" />
      <br />
      <sub>AI 任务工作台</sub>
    </td>
    <td align="center">
      <img src="./frontend/public/monkeycode-2.png" alt="MonkeyCode 云端终端与任务执行" />
      <br />
      <sub>云端终端与任务执行</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="./frontend/public/monkeycode-3.png" alt="MonkeyCode 项目协作与文件管理" />
      <br />
      <sub>项目协作与文件管理</sub>
    </td>
    <td align="center">
      <img src="./frontend/public/monkeycode-mobile.png" alt="MonkeyCode 移动端任务与文件管理" />
      <br />
      <sub>移动端任务与文件管理</sub>
    </td>
  </tr>
</table>

## 功能与特色

你不需要自己拼工具、搭环境、来回切流程。把需求交给 MonkeyCode，它会从开发到验证一路接住，真正把 AI 编程变成可持续的工作流。

| 特色 | 说明 |
|---|---|
| 免费即用 | 无需下载客户端，也不用折腾环境。浏览器打开、注册账号，几秒钟就能开始执行第一个 AI 开发任务。 |
| 云端开发环境 | 不依赖本地开发机。每个任务背后都有一台真实服务器提供运行环境，编译、测试、预览都在云上完成。 |
| 全量主流模型 | GLM、Kimi、MiniMax、Qwen、DeepSeek 等都已接入，支持按任务类型切换，也能手动指定。 |
| 移动端原生支持 | 深度适配 iOS / Android，PC 和手机数据实时同步。通勤路上也能把任务交给 Agent 继续跑。 |
| 完全开源 | 核心代码全部公开在 GitHub。任何人都能审计、fork、二次开发，技术选型和安全策略自己掌控。 |
| 私有化离线部署 | 对数据隐私要求高的企业和团队，可以把 MonkeyCode 独立部署到自己的内网中，数据不出本地。 |

## 能在 MonkeyCode 上做什么？

从正经项目到灵感试验，从白天的工作任务到晚上的个人想法，只要你说清目标，MonkeyCode 就能陪你把它真正做出来。

<table>
  <tr>
    <td>
      <sub>CASE / 01 · #game</sub>
      <h3>做个小游戏</h3>
      <p>一句话描述玩法，AI 帮你搭框架、处理碰撞检测、补音效，一个下午就能跑出可玩的版本。</p>
      <sub>HTML5 · Canvas · TypeScript · 零依赖</sub>
    </td>
    <td>
      <sub>CASE / 02 · #feature</sub>
      <h3>实现一个需求</h3>
      <p>把需求丢进去，AI 读你的代码仓库、理解项目约定，直接改文件、跑测试、开 PR。</p>
      <sub>读懂代码风格 · 自动写单测 · 一键开 PR</sub>
    </td>
    <td>
      <sub>CASE / 03 · #security</sub>
      <h3>安全审查</h3>
      <p>上线前做一次体检。AI 扫常见漏洞、硬编码密钥、依赖风险，输出可修复的清单。</p>
      <sub>OWASP Top 10 · 依赖 CVE · SAST 规则</sub>
    </td>
  </tr>
  <tr>
    <td>
      <sub>CASE / 04 · #paper</sub>
      <h3>写毕业论文</h3>
      <p>帮你查文献、列提纲、补实验代码、跑数据、画图、排版 LaTeX，从选题到定稿都能接力。</p>
      <sub>文献检索 · 实验脚本 · LaTeX 排版</sub>
    </td>
    <td>
      <sub>CASE / 05 · #data</sub>
      <h3>数据分析</h3>
      <p>丢一份 CSV 或 Parquet，描述你想看的角度。AI 自动清洗、建模、画图，再写一段可读结论。</p>
      <sub>Pandas / Polars · Matplotlib · 自动写结论</sub>
    </td>
    <td>
      <sub>CASE / 06 · #research</sub>
      <h3>产品 / 技术调研</h3>
      <p>AI 拉公开资料、跑 benchmark、出对比报告，带引用链接，适合做技术选型和产品预研。</p>
      <sub>公开资料聚合 · 横向对比 · 带引用</sub>
    </td>
  </tr>
</table>

## 使用指南

### 在线使用

最简单的方式是直接访问在线版：

[https://monkeycode-ai.com/](https://monkeycode-ai.com/)

1. 注册或登录 MonkeyCode。
2. 创建第一个 AI 开发任务。
3. 选择项目来源、任务类型、模型和运行环境。
4. 在工作台中查看终端输出、文件改动、任务计划和预览结果。
5. 继续对话迭代，或将结果接回 Git 协作流程。

详细使用方式请参考[使用文档](https://monkeycode.docs.baizhi.cloud/)。

### 独立部署使用

独立部署版适合企业内网、私有代码仓库、数据不出本地、统一资源管理和接入自有模型的场景。部署完成后，团队可以在自己的网络边界内使用 MonkeyCode，并接入内部 Git 平台、模型网关、Ollama、vLLM 或其他兼容 OpenAI API 的模型服务。

环境要求：

| 项目 | 要求 |
|---|---|
| 操作系统 | Linux 服务器 |
| 架构 | x86_64 / amd64 |
| 权限 | 安装过程需要 root 权限 |
| 容器运行时 | Docker / Docker Compose |
| 网络 | 在线安装需要访问公网；离线安装需要提前准备离线安装包和镜像包 |
| 访问地址 | 建议准备固定 IP 或域名，用于 Web 访问、回调、对象存储公开地址和宿主机连接 |

#### 联网安装

联网安装适用于目标服务器可以访问公网的环境。在目标服务器上执行：

```bash
bash -c "$(curl -fsSL 'https://monkeycode-ai.com/online/install')"
```

安装完成后，通过浏览器访问 MonkeyCode 控制台，并进入管理后台配置 AI 模型、Git 平台、系统镜像和宿主机。

#### 离线安装

离线安装适用于目标服务器无法访问公网，或生产环境不允许直接拉取公网镜像的场景。

1. 在可访问公网的机器上下载离线安装包。

```bash
curl -fL -o monkeycode-offline-linux-amd64.tgz \
  https://monkeycode-release.oss-cn-hangzhou.aliyuncs.com/public/offline-package/monkeycode-offline-linux-amd64.tgz
```

2. 将 `monkeycode-offline-linux-amd64.tgz` 传输到目标服务器后执行：

```bash
tar -zxvf monkeycode-offline-linux-amd64.tgz
cd monkeycode-offline-linux-amd64/
sh install.sh
```

安装完成后，通过浏览器访问 MonkeyCode 控制台，并完成 AI 模型、Git 平台、系统镜像和宿主机配置。更多部署、升级、卸载和故障排查步骤请参考[使用文档](https://monkeycode.docs.baizhi.cloud/)；企业内网部署、离线包获取和商业支持可以通过[企业咨询](https://baizhi.cloud/consult)联系。

## 在线版与独立部署版

| 对比项 | 在线版 | 独立部署版 |
|---|---|---|
| 上手方式 | 注册即用 | 部署到自己的服务器或内网 |
| 运维成本 | 由 MonkeyCode 平台维护 | 由团队或企业运维 |
| 数据边界 | 使用平台云端环境 | 数据留在自有网络边界内 |
| 模型接入 | 使用平台配置的模型能力 | 可接入自有模型、私有网关、Ollama、vLLM |
| Git 平台 | 接入公网 Git 平台 | 可接入内部 Git 平台 |
| 资源管理 | 使用平台资源 | 自主管理宿主机、镜像和计算资源 |
| 适用对象 | 个人开发者、快速体验、小团队 | 企业团队、内网研发、合规场景 |

## 产品对比

和依赖本地 IDE、CLI 或开发环境的工具不同，MonkeyCode 打开浏览器就能随时开始开发，并支持围绕同一个项目持续迭代、长期管理与协作。

| 对比维度 | MonkeyCode | Cursor | Claude Code | Codex |
|---|:---:|:---:|:---:|:---:|
| 在线使用 | ✓ | ✓ | ✓ | ✓ |
| 本地 IDE | - | ✓ | ✓ | ✓ |
| 本地 CLI | - | ✓ | ✓ | ✓ |
| 需求与 SPEC 管理 | ✓ | - | - | - |
| 云端开发环境 | ✓ | ◐ | ◐ | ◐ |
| 代码补全 | - | ✓ | - | - |
| PR / MR 自动代码审查 | ✓ | ◐ | ◐ | ◐ |
| 团队协作 | ✓ | - | - | - |
| 适配国产大模型 | ✓ | - | - | - |
| 私有化部署 | ✓ | - | - | - |
| 开源 | ✓ | - | - | - |

`✓` 表示完整支持，`◐` 表示部分支持，`-` 表示当前产品公开能力中未作为核心能力提供。数据基于各产品公开特性整理，如有遗漏欢迎提交 issue 或 PR。

MonkeyCode 的核心差异不是再做一个本地 Coding 工具，而是把 AI 开发任务放进可运行、可协作、可持续管理的云端研发工作流。

## 开源开发

### 项目结构

```text
.
├── backend/   # Go 后端服务、任务、团队、模型、宿主机和部署相关能力
├── frontend/  # React / Vite Web 控制台
├── desktop/   # Electron 桌面客户端构建
├── mobile/    # Capacitor Android / iOS 移动客户端
├── docs/      # 项目设计与开发文档
└── LICENSE
```

### 本地开发入口

前端：

```bash
cd frontend
pnpm install
pnpm run dev:online
```

移动端：

```bash
cd mobile
pnpm install
pnpm run sync
pnpm run open:android
```

iOS 构建与发布说明见 [mobile/ios/README.md](./mobile/ios/README.md)。

后端服务配置样例见 [backend/config/server/config.yaml.example](./backend/config/server/config.yaml.example)，容器编排文件见 [backend/docker-compose.yml](./backend/docker-compose.yml)。

## 社区与支持

欢迎加入技术社区，与更多开发者交流 MonkeyCode 的使用、部署和开发经验。

<table>
  <tr>
    <td align="center"><img src="./frontend/public/wechat.png" width="160" /><br/>微信交流群</td>
    <td align="center"><img src="./frontend/public/feishu.png" width="160" /><br/>飞书交流群</td>
    <td align="center"><img src="./frontend/public/dingtalk.png" width="160" /><br/>钉钉交流群</td>
  </tr>
</table>

你也可以通过以下入口获取支持：

- 使用文档：[https://monkeycode.docs.baizhi.cloud/](https://monkeycode.docs.baizhi.cloud/)
- 在线使用：[https://monkeycode-ai.com/](https://monkeycode-ai.com/)
- 企业咨询：[https://baizhi.cloud/consult](https://baizhi.cloud/consult)
- GitHub Issues：[https://github.com/chaitin/MonkeyCode/issues](https://github.com/chaitin/MonkeyCode/issues)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=chaitin/MonkeyCode&type=Date)](https://star-history.com/#chaitin/MonkeyCode&Date)

## License

MonkeyCode 使用 [GNU Affero General Public License v3.0](./LICENSE) 开源。
