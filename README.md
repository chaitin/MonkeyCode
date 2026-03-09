MonkeyCode 是由长亭科技推出的企业级 AI 开发平台，致力于为开发者提供更专业、更可靠、更可扩展的 AI Coding 体验。

MonkeyCode 不只是一个 AI 编程工具，而是一个面向专业团队的 AI 研发基础设施，它覆盖了 **`需求 → 设计 → 开发 → Review`** 全流程，提供了安全、隔离、可并行的开发环境。

:::alert {variant="default"}
MonkeyCode 当前仅提供了 SaaS 版，地址见 [https://monkeycode-ai.com/](https://monkeycode-ai.com/)
后续还计划推出 **离线部署版** 和 **开源版**，以满足更多企业和社区用户的需求，敬请期待。
:::

## ✨ 产品定位

- 企业级 AI Coding 平台
- 面向专业开发者与研发团队
- 支持真实工程场景，支持复杂项目与多人协作
- 不只是写代码，而是参与 **`需求 → 设计 → 开发 → Review`** 的完整研发流程

## 🔥 开始使用

见 [上手指南](https://monkeycode.docs.baizhi.cloud/node/019afd79-5842-7a4e-9ade-e2c566e73d32)

## 🚀 AI 智能开发任务

智能任务是 MonkeyCode 提供的核心能力，支持通过自然语言驱动 AI 执行开发任务。

<img src="https://monkeycode.docs.baizhi.cloud/static-file/6229f59f-4333-4999-b0ff-897bc1e493fc/7278f971-1857-4f67-baa6-896f12327e77.png" width="350" /> 
<img src="https://monkeycode.docs.baizhi.cloud/static-file/aa3c3109-460c-47d5-bdd5-c14241d309c7/480af390-a2b3-457b-b4f0-206d3e920474.png" width="350" />

MonkeyCode 本身不实现 AI Coding Agent，它的开发能力由业内顶尖工具 `OpenAI Codex` 和 `Claude Code` 驱动。

对于已经在使用 Codex 或 Claude Code 的用户，无需改变使用习惯，可无缝迁移至 MonkeyCode。

同时，MonkeyCode 也对国内主流模型做了完整适配，让用户在使用 `OpenAI Codex` 和 `Claude Code` 的过程中也可以使用国产模型，包括但不限于：DeepSeek、Qwen、Kimi、GLM 等。

> 关于智能任务的更多介绍见 [智能任务](https://monkeycode.docs.baizhi.cloud/node/019b25dd-a7f9-7455-9312-22da2b2cf346)


## 🚀 在线开发环境

MonkeyCode 提供了灵活、安全的在线开发环境方案：本地开发机 + 云端控制。

<img src="https://monkeycode.docs.baizhi.cloud/static-file/a80862b7-169c-4e18-9dc8-243421f9a74e/f587f49f-6f79-4774-906f-1cd040b93ad1.png" width="350" /> 
<img src="https://monkeycode.docs.baizhi.cloud/static-file/afb91814-f2e7-45b1-8cc4-afdad5bb66a0/63a356cb-ce00-40fb-a901-960512301f79.png" width="350" />

用户在自己本地的开发机上安装 MonkeyCode 探针程序，让本地开发机与 MonkeyCode 平台建立连接，通过 MonkeyCode Web 页面远程驱动本地算力。

每次执行开发任务都会自动创建一台虚拟机，所有 AI 操作仅在虚拟机内执行，即使发生破坏性操作，也不会影响真实开发环境，任务失败可直接重试，系统会重新创建新的虚拟机。

支持多个 AI 任务并行运行，每个任务使用独立的虚拟开发环境，任务之间完全隔离、互不影响。

支持 PC 与移动端访问，用户无需随身携带电脑即可随时随地驱动 AI 执行研发任务。

> 关于开发环境的更多介绍见 [开发环境](https://monkeycode.docs.baizhi.cloud/node/019b25de-570b-72dc-b0f3-3055419ff13f)

## 🚀 SDD 协作开发

:::alert {variant="default"}
SDD（Specification-Driven Development）又叫“规范驱动开发”，它是一种软件开发方法，它强调在编写任何实际代码之前，必须首先编写一份详尽、精确、可执行的规范。。
:::

相比 “Vibe coding”，MonkeyCode 更强调可控性、可追溯性与工程质量。

MonkeyCode 内置了标准的 SDD 开发流程 **`原始需求 -> 产品设计 -> 技术设计 -> 任务列表`**，每个阶段都有 AI 深度参与，可支持专业的研发任务。

MonkeyCode 支持多角色协作推进项目：

- 产品经理：需求拆解与产品设计
- 项目管理：流程与进度管理
- 研发工程师：技术设计与实现

最终，AI 会基于 TODO List 逐步执行开发任务，实现对大型项目的系统化管理。

> 关于 SDD 协作开发的更多介绍见 [SDD 开发](https://monkeycode.docs.baizhi.cloud/node/019b25dd-f3ae-76eb-b374-6cc85efba66b)

## 🚀 Git 集成

<img src="https://monkeycode.docs.baizhi.cloud/static-file/67f1f51b-7eed-423a-9fb7-15b954302316/9610e052-216a-41ed-9787-62249f6d4de9.png" width="350" /> 
<img src="https://monkeycode.docs.baizhi.cloud/static-file/13a3380c-d626-4457-a711-e28a3054882f/4fe1e6cc-bf32-466b-82e1-7b437e4b3b0b.png" width="350" />

MonkeyCode 已经与 GitHub、GitLab、Gitea、Gitee 深度集成，可以在线直接使用，也支持在独立部署的私有化 GitLab 中集成。

常见使用场景：

- 在 Issue 中 at @MonkeyCode，他可以参与需求讨论，给出有价值的技术建议，还可以根据 Issue 描述直接实现需求
- 在 PR / MR 中 at @MonkeyCode，他会自动进行代码 Review，提出改进建议
- 将 MonkeyCode 接入 DevOps 流程，在代码提交时自动触发 AI Review

> 关于 Git 集成的更多介绍见 [Git 集成](https://monkeycode.docs.baizhi.cloud/node/019a6cdc-9a3e-7243-8885-727ba6573694)

## 特色

- **工具无关性**：底层工具支持 OpenAI Codex、Claude Code 等，如果你已经熟悉了某种 Agent，可以无缝切换到 MonkeyCode 上。
- **模型无关性**：兼容 GPT、Claude、Deepseek、GLM、Kimi、Qwen、Doubao 等大模型，或其他本地模型。
- **SDD 驱动的项目管理**：将技术设计严格管理起来，解决 AI 写代码随意放飞自我的问题，让 AI 完善 code review 和 unit test 流程，让工程师聚焦于业务需求和架构设计，而不是繁琐的编码任务。
- **随时随地执行研发任务**：开发形式不再局限，可以通过 IDE 发起任务，也可以通过 MonkeyCode 在线页面发起任务，还可以通过 git 平台发起任务，甚至可以通过 API 接入其他开发平台
- **开发环境隔离**：允许用户将自己的开发机接入 MonkeyCode，任务启动时会创建一个全新的操作系统供当前任务使用。
- **企业级配置**：专为企业研发团队打造的研发管理模式，支持调用离线大模型，支持在企业内网中使用。
