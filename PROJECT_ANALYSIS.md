# MonkeyCode 项目分析报告

## 📋 项目概述

**MonkeyCode** 是由长亭科技推出的**企业级 AI 开发平台**，采用前后端分离架构，覆盖**需求 → 设计 → 开发 → 代码审查**全流程。

| 项目属性 | 详情 |
|---------|------|
| **项目名称** | MonkeyCode |
| **开发语言** | Go 1.25 (后端) |
| **开源协议** | AGPL-3.0 |
| **所属公司** | 长亭科技 |

---

## 🏗️ 技术架构

### 后端技术栈

| 组件 | 技术选型 |
|------|---------|
| **Web 框架** | Echo (via GoYoko/web) |
| **ORM** | Ent (entgo.io/ent) |
| **数据库** | PostgreSQL |
| **缓存** | Redis |
| **依赖注入** | samber/do |
| **配置管理** | Viper |
| **WebSocket** | coder/websocket |
| **LLM 集成** | sashabaranov/go-openai |

### 架构设计模式

项目采用**整洁架构 (Clean Architecture)** 和 **领域驱动设计 (DDD)** 模式：

```
backend/
├── cmd/server/main.go      # 应用入口
├── config/                  # 配置管理
├── biz/                     # 业务模块
│   ├── git/                 # Git 集成模块
│   ├── host/                # 宿主机管理
│   ├── notify/              # 通知系统
│   ├── project/             # 项目管理
│   ├── setting/             # 系统设置
│   ├── task/                # 任务管理
│   ├── team/                # 团队管理
│   └── user/                # 用户管理
├── db/                      # 数据库层
├── domain/                  # 领域模型定义
├── pkg/                     # 公共组件库
└── consts/                  # 常量定义
```

每个业务模块遵循**三层架构**：
- **handler/v1** - HTTP 处理器层
- **repo** - 数据仓储层
- **usecase** - 业务逻辑层

---

## 📦 核心功能模块

### 1. 智能任务系统 (Task)
- 支持**自然语言描述需求**
- AI 自动完成开发、设计、代码审查
- 任务生命周期管理（状态机模式）
- 集成 Loki 日志系统

### 2. Git 平台集成 (Git)
支持多平台 Git 集成：
- **GitHub** - OAuth + Token 认证
- **GitLab** - 多实例支持
- **Gitea** - 自建 Git 服务
- **Gitee** - 国内代码托管

核心功能：
- GitBot 自动代码审查
- Webhook 事件处理
- PR/MR 自动审查

### 3. 项目管理 (Project)
- 项目与 Git 仓库关联
- 需求文档管理
- 任务分配与追踪
- 协作者权限管理

### 4. 虚拟机管理 (Host)
- 在线开发环境
- 资源配额管理 (CPU/内存)
- 虚拟机生命周期管理
- 公共主机池支持

### 5. 通知系统 (Notify)
多渠道通知支持：
- 钉钉 (DingTalk)
- 飞书 (Feishu)
- 企业微信 (WeCom)
- 自定义 Webhook

### 6. 团队协作 (Team)
- 团队成员管理
- 资源分配 (宿主机/镜像/模型)
- 审计日志
- 权限控制

---

## 🗄️ 数据模型

项目使用 Ent ORM，主要实体包括：

| 实体 | 说明 |
|------|------|
| `Users` | 用户信息 |
| `Teams` | 团队组织 |
| `Projects` | 项目管理 |
| `Tasks` | AI 任务 |
| `GitBots` | Git 机器人配置 |
| `GitIdentities` | Git 身份认证 |
| `Hosts` | 宿主机资源 |
| `Images` | 开发镜像 |
| `Models` | AI 模型配置 |
| `NotifyChannels` | 通知渠道 |

---

## 🔧 基础设施组件 (pkg/)

| 组件 | 路径 | 功能 |
|------|------|------|
| **生命周期管理** | pkg/lifecycle | 任务/VM 状态机 |
| **延迟队列** | pkg/delayqueue | VM 过期/任务摘要 |
| **LLM 客户端** | pkg/llm | AI 模型调用 |
| **TaskFlow 客户端** | pkg/taskflow | 任务执行引擎 |
| **WebSocket** | pkg/ws | 实时通信 |
| **通知渠道** | pkg/notify/channel | 多渠道消息发送 |
| **通知分发** | pkg/notify/dispatcher | 通知分发器 |
| **Git 操作** | pkg/git | 多平台 Git 操作封装 |
| **验证码** | pkg/captcha | 图形验证码 |
| **加密** | pkg/crypto | 密码加密、Token 生成 |
| **邮件** | pkg/email | SMTP 邮件发送 |
| **日志** | pkg/logger | 结构化日志 |
| **Loki** | pkg/loki | 日志聚合查询 |
| **会话** | pkg/session | 用户会话管理 |
| **存储** | pkg/store | 数据库/Redis 连接 |

---

## 🚀 部署与运维

### 构建方式
```bash
# 生成 Swagger 文档
make swag

# 生成 Ent 代码
make generate

# 构建 Docker 镜像
make image PLATFORM=linux/amd64
```

### 配置管理
配置文件位于 `config/server/config.yaml.example`，支持：
- 数据库主从配置
- Redis 缓存
- SMTP 邮件服务
- 多 Git 平台 OAuth
- LLM 模型配置

### 主要配置项
```yaml
server:
  addr: ":8888"
  base_url: "http://localhost:8888"

database:
  master: "postgres://..."
  slave: "postgres://..."

redis:
  host: "localhost"
  port: 6379

llm:
  base_url: "https://api.openai.com/v1"
  api_key: "sk-..."
  model: "gpt-4"

github:
  enabled: true
  oauth:
    client_id: "..."
    client_secret: "..."
```

---

## 📊 项目特点

### ✅ 优势

1. **架构清晰** - 采用整洁架构，模块职责分明
2. **可扩展性强** - 依赖注入设计，易于扩展
3. **多平台支持** - 兼容主流 Git 托管平台
4. **企业级特性** - 团队管理、权限控制、审计日志
5. **AI 驱动** - 全流程 AI 辅助开发

### 🔧 技术亮点

1. **状态机模式** - 任务和 VM 生命周期采用状态机管理
2. **事件驱动** - Webhook + 延迟队列实现异步处理
3. **多租户设计** - 支持团队级别的资源隔离
4. **软删除** - 数据安全保护

---

## 📁 关键文件索引

| 文件 | 说明 |
|------|------|
| cmd/server/main.go | 应用入口 |
| config/config.go | 配置定义 |
| biz/register.go | 业务模块注册 |
| pkg/register.go | 基础设施注册 |
| db/migrate/schema.go | 数据库 Schema |
| domain/task.go | 任务领域模型 |
| biz/task/usecase/task.go | 任务业务逻辑 |
| biz/git/usecase/gitbot.go | GitBot 业务逻辑 |

---

## 📈 业务流程

### 任务创建流程
1. 用户提交任务请求（自然语言描述）
2. 系统验证用户权限和资源配额
3. 选择宿主机和开发镜像
4. 创建虚拟机实例
5. 启动 AI 任务执行
6. 实时推送任务状态（WebSocket）
7. 任务完成后生成摘要

### GitBot 代码审查流程
1. 配置 GitBot 关联仓库
2. 设置 Webhook 接收 PR/MR 事件
3. 触发自动代码审查任务
4. AI 分析代码并生成建议
5. 将审查结果评论到 PR/MR

---

## 🔗 相关链接

- [MonkeyCode 官网](https://monkeycode-ai.com/)
- [MonkeyCode 文档](https://monkeycode.docs.baizhi.cloud/)
- [长亭科技](https://chaitin.cn/)
- [GitHub 仓库](https://github.com/chaitin/MonkeyCode)

---

*报告生成时间: 2026-03-21*
