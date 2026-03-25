# MonkeyCode

<p align="center">
  <img src="./frontend/public/logo-colored.png" alt="MonkeyCode" width="200" />
</p>

<p align="center">
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/build.yml/badge.svg" alt="Service Images" /></a>
  <a href="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml"><img src="https://github.com/chaitin/MonkeyCode/actions/workflows/electron-release.yml/badge.svg" alt="Client Release" /></a>
</p>

<p align="center">
  <a href="https://monkeycode-ai.com/">🚀 在线使用</a> ·
  <a href="https://monkeycode.docs.baizhi.cloud/">📖 使用文档</a>
</p>

> 由长亭科技推出的企业级 AI 开发平台，覆盖需求 → 设计 → 开发 → 代码审查全流程

## 简介

MonkeyCode 是面向研发团队的企业级 AI 开发平台。通过自然语言交互，让 AI 完成从需求分析、技术设计、代码开发到代码审查的完整开发流程。平台集成 GitHub / GitLab / Gitee 等主流 Git 平台，支持多种 AI 模型，并提供在线 IDE、终端、文件管理等完整开发环境。

## 产品对比

市面上的 AI 编程工具大多聚焦于代码补全或 CLI 交互，MonkeyCode 则面向研发团队，覆盖从需求到代码审查的完整开发流程，并提供开箱即用的在线开发环境。

| | MonkeyCode | Cursor | Claude Code | GitHub Copilot | OpenCode | Codex |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **在线使用** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **离线使用** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **本地 IDE** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **本地 CLI** | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| **手机客户端** | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **桌面客户端** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **需求与 SPEC 管理** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **提供开发环境** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **代码补全** | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **PR/MR 自动代码审查** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **团队协作** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **接入第三方模型** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **适配国产大模型** | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **开源** | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |

## 核心功能

### 智能任务
用自然语言描述需求，AI 自动完成开发、设计或代码审查。支持从 Git 仓库或 ZIP 文件导入代码，可自由选择开发工具和 AI 模型。

### 项目管理
关联 Git 仓库，管理项目需求和任务。可创建需求文档、启动设计任务和开发任务，实现需求驱动的完整开发流程。

### 在线开发环境
提供完整的在线开发环境：
- **在线 IDE**：支持多语言语法高亮的代码编辑器
- **Web 终端**：支持多会话的浏览器终端
- **文件管理**：在线浏览、编辑、上传、下载文件
- **在线预览**：一键预览 Web 服务运行效果
- **远程协助**：支持与他人共享终端会话

### 代码审查
配置 Git 机器人，自动审查 GitHub / GitLab / Gitee 的 PR/MR，提供智能代码改进建议。

### 团队协作
团队管理员可管理成员、分配资源（宿主机、镜像、AI 模型），实现权限控制和资源统一管理。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS |
| 后端 | Go + Echo + Ent ORM |
| 数据库 | PostgreSQL 16 + Redis 7 |
| 桌面端 | Electron 35 |
| 移动端 | Capacitor 7（Android / iOS） |

## 项目结构

```
MonkeyCode/
├── frontend/          # Web 前端（React + TypeScript）
├── backend/           # 后端服务（Go）
├── desktop/           # 桌面客户端（Electron）
└── mobile/            # 移动客户端（Capacitor）
```

## 快速开始

访问 [https://monkeycode-ai.com/](https://monkeycode-ai.com/) 即可免费在线使用，无需部署。

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
