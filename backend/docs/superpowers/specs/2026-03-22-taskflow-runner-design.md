# TaskFlow + Runner 系统设计文档

## 1. 概述

### 1.1 背景

MonkeyCode 是一个企业级 AI 开发平台，其核心功能依赖于 TaskFlow 服务和 Runner 组件。当前 GitHub 开源仓库仅包含前端和后端业务代码，缺少 TaskFlow 和 Runner 的实现。本文档描述如何从零实现 TaskFlow + Runner 完整服务。

### 1.2 目标

- 实现 TaskFlow 服务：提供 HTTP API 给 MonkeyCode 后端调用，提供 gRPC 服务给 Runner 连接
- 实现 Runner 服务：部署在 Linux 服务器上，管理 Docker 容器，执行 AI 编码任务
- 与现有 MonkeyCode 后端无缝集成

### 1.3 技术选型

| 决策项 | 选择 | 理由 |
|--------|------|------|
| VM 实现 | Docker 容器 | 易于实现，资源开销小，适合开发测试 |
| 技术栈 | Go | 与现有 MonkeyCode 后端保持一致 |
| 部署环境 | Linux 生产环境 | 生产级部署 |
| AI Agent | OpenCode | 开源方案 |
| 通讯协议 | HTTP + gRPC | 后端使用 HTTP，Runner 使用 gRPC |

---

## 2. 系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TaskFlow + Runner 系统架构                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        控制平面                                      │   │
│   │  ┌───────────────┐         ┌───────────────────────────────────┐   │   │
│   │  │   前端        │  HTTP   │        MonkeyCode 后端            │   │   │
│   │  │   (React)     │────────▶│        (Go - 现有项目)            │   │   │
│   │  └───────────────┘         │                                   │   │   │
│   │                            │   pkg/taskflow (HTTP Client)      │   │   │
│   │                            └──────────────┬────────────────────┘   │   │
│   └───────────────────────────────────────────│─────────────────────────┘   │
│                                               │ HTTP                       │
│                                               ▼                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     TaskFlow 服务 (新建)                             │   │
│   │  ┌─────────────────────────────────────────────────────────────┐   │   │
│   │  │                      核心组件                                │   │   │
│   │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │   │
│   │  │  │ HTTP API │ │ gRPC     │ │ 调度器   │ │ 状态管理     │   │   │   │
│   │  │  │ Server   │ │ Server   │ │ Scheduler│ │ (Redis)      │   │   │   │
│   │  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │   │
│   │  └─────────────────────────────────────────────────────────────┘   │   │
│   └───────────────────────────────────────────│─────────────────────────┘   │
│                                               │ gRPC                       │
│                                               ▼                            │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Runner 服务 (新建)                              │   │
│   │  ┌─────────────────────────────────────────────────────────────┐   │   │
│   │  │                      核心组件                                │   │   │
│   │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │   │   │
│   │  │  │ gRPC     │ │ Docker   │ │ OpenCode │ │ WebSocket     │   │   │   │
│   │  │  │ Client   │ │ Manager  │ │ Agent    │ │ Terminal      │   │   │   │
│   │  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │   │   │
│   │  └─────────────────────────────────────────────────────────────┘   │   │
│   │                                                                      │   │
│   │  ┌─────────────────────────────────────────────────────────────┐   │   │
│   │  │                    Docker 容器池                             │   │   │
│   │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │   │   │
│   │  │  │ 容器 1  │ │ 容器 2  │ │ 容器 3  │ │ 容器 N  │           │   │   │
│   │  │  │ (VM)    │ │ (VM)    │ │ (VM)    │ │ (VM)    │           │   │   │
│   │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │   │   │
│   │  └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 组件职责

| 组件 | 职责 | 技术实现 |
|------|------|---------|
| **TaskFlow HTTP API** | 接收 MonkeyCode 后端请求 | Echo + WebSocket |
| **TaskFlow gRPC Server** | 接收 Runner 连接和心跳 | gRPC |
| **TaskFlow 调度器** | 分配任务到合适的 Runner | 内置调度算法 |
| **TaskFlow 状态管理** | 存储运行时状态 | Redis |
| **Runner gRPC Client** | 连接 TaskFlow，接收指令 | gRPC |
| **Runner Docker Manager** | 创建/管理 Docker 容器 | Docker SDK |
| **Runner OpenCode Agent** | 执行 AI 编码任务 | OpenCode CLI |
| **Runner WebSocket Terminal** | 提供终端访问 | WebSocket + pty |

---

## 3. TaskFlow 服务设计

### 3.1 项目结构

```
taskflow/
├── cmd/
│   └── server/
│       └── main.go              # 入口文件
├── internal/
│   ├── config/
│   │   └── config.go            # 配置管理
│   ├── server/
│   │   ├── http.go              # HTTP 服务器
│   │   └── grpc.go              # gRPC 服务器
│   ├── handler/
│   │   ├── host.go              # 宿主机管理 API
│   │   ├── vm.go                # 虚拟机管理 API
│   │   ├── task.go              # 任务管理 API
│   │   ├── file.go              # 文件管理 API
│   │   ├── portforward.go       # 端口转发 API
│   │   └── stats.go             # 统计信息 API
│   ├── scheduler/
│   │   └── scheduler.go         # 任务调度器
│   ├── runner/
│   │   └── manager.go           # Runner 连接管理
│   └── store/
│       └── redis.go             # Redis 状态存储
├── pkg/
│   └── proto/
│       └── taskflow.proto       # gRPC 协议定义
├── go.mod
└── Makefile
```

### 3.2 HTTP API 端点

| 模块 | 方法 | 端点 | 说明 |
|------|------|------|------|
| **Host** | GET | `/internal/host/list` | 列出用户的宿主机 |
| **Host** | POST | `/internal/host/is-online` | 检查宿主机在线状态 |
| **VM** | POST | `/internal/vm` | 创建虚拟机 |
| **VM** | DELETE | `/internal/vm` | 删除虚拟机 |
| **VM** | GET | `/internal/vm/list` | 列出虚拟机 |
| **VM** | GET | `/internal/vm/info` | 获取虚拟机信息 |
| **VM** | POST | `/internal/vm/is-online` | 检查 VM 在线状态 |
| **VM** | GET | `/internal/ws/vm/terminal` | WebSocket 终端连接 |
| **VM** | GET | `/internal/ws/vm/reports` | WebSocket 报告订阅 |
| **Task** | POST | `/internal/task` | 创建任务 |
| **Task** | POST | `/internal/task/stop` | 停止任务 |
| **Task** | POST | `/internal/task/restart` | 重启任务 |
| **Task** | POST | `/internal/task/cancel` | 取消任务 |
| **Task** | POST | `/internal/task/continue` | 继续任务 |
| **Task** | POST | `/internal/task/auto-approve` | 自动批准 |
| **Task** | POST | `/internal/task/ask-user-question` | 回答用户问题 |
| **Task** | POST | `/internal/task/repo-list-files` | 列出仓库文件 |
| **Task** | POST | `/internal/task/repo-read-file` | 读取文件 |
| **Task** | POST | `/internal/task/repo-file-diff` | 文件差异 |
| **Task** | POST | `/internal/task/repo-file-changes` | 文件变更 |
| **File** | POST | `/internal/files` | 文件操作 |
| **File** | GET | `/internal/ws/files/download` | WebSocket 文件下载 |
| **File** | GET | `/internal/ws/files/upload` | WebSocket 文件上传 |
| **PortForward** | GET | `/internal/port-forward` | 列出端口转发 |
| **PortForward** | POST | `/internal/port-forward` | 创建端口转发 |
| **PortForward** | PUT | `/internal/port-forward` | 更新端口转发 |
| **PortForward** | POST | `/internal/port-forward/close` | 关闭端口转发 |
| **Stats** | GET | `/internal/stats` | 获取统计信息 |

### 3.3 gRPC 协议定义

```protobuf
syntax = "proto3";

package taskflow;

option go_package = "github.com/your-org/taskflow/pkg/proto;proto";

// Runner 服务 - TaskFlow 作为服务端
service RunnerService {
    // Runner 注册和心跳
    rpc Register(RegisterRequest) returns (RegisterResponse);
    rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
    
    // VM 操作
    rpc CreateVM(CreateVMRequest) returns (CreateVMResponse);
    rpc DeleteVM(DeleteVMRequest) returns (DeleteVMResponse);
    rpc ListVMs(ListVMsRequest) returns (ListVMsResponse);
    rpc GetVMInfo(GetVMInfoRequest) returns (GetVMInfoResponse);
    
    // Task 操作
    rpc CreateTask(CreateTaskRequest) returns (CreateTaskResponse);
    rpc StopTask(StopTaskRequest) returns (StopTaskResponse);
    rpc RestartTask(RestartTaskRequest) returns (RestartTaskResponse);
    
    // 文件操作
    rpc OperateFile(OperateFileRequest) returns (OperateFileResponse);
    rpc StreamFile(stream FileChunk) returns (StreamFileResponse);
    
    // 端口转发
    rpc CreatePortForward(CreatePortForwardRequest) returns (CreatePortForwardResponse);
    rpc ClosePortForward(ClosePortForwardRequest) returns (ClosePortForwardResponse);
    
    // 双向流 - 终端和报告
    rpc TerminalStream(stream TerminalData) returns (stream TerminalData);
    rpc ReportStream(ReportRequest) returns (stream ReportEntry);
}

// 注册请求
message RegisterRequest {
    string token = 1;
    string hostname = 2;
    string ip = 3;
    int32 cores = 4;
    int64 memory = 5;
    int64 disk = 6;
}

// 注册响应
message RegisterResponse {
    string runner_id = 1;
    bool success = 2;
    string message = 3;
}

// 心跳请求
message HeartbeatRequest {
    string runner_id = 1;
    int64 timestamp = 2;
    int32 running_vms = 3;
    int32 running_tasks = 4;
}

// 心跳响应
message HeartbeatResponse {
    bool success = 1;
    repeated string pending_commands = 2;
}

// 创建 VM 请求
message CreateVMRequest {
    string vm_id = 1;
    string user_id = 2;
    string image_url = 3;
    string git_url = 4;
    string git_token = 5;
    int32 cores = 6;
    int64 memory = 7;
    map<string, string> env_vars = 8;
    int64 ttl_seconds = 9;
}

// 创建 VM 响应
message CreateVMResponse {
    string vm_id = 1;
    string container_id = 2;
    bool success = 3;
    string message = 4;
}

// 终端数据
message TerminalData {
    string vm_id = 1;
    string terminal_id = 2;
    bytes data = 3;
    TerminalResize resize = 4;
}

message TerminalResize {
    uint32 cols = 1;
    uint32 rows = 2;
}

// 报告条目
message ReportEntry {
    string task_id = 1;
    string source = 2;
    int64 timestamp = 3;
    bytes data = 4;
}
```

### 3.4 Redis 数据结构

```
# Runner 注册信息
runner:{runner_id} -> {
  "id": "runner-xxx",
  "hostname": "server-1",
  "ip": "192.168.1.100",
  "status": "online",
  "last_heartbeat": 1700000000,
  "capacity": {"cpu": 8, "memory": 16384}
}
TTL: 60s (心跳续期)

# Runner 列表
runners -> Set{runner_id1, runner_id2, ...}

# VM 状态
vm:{vm_id} -> {
  "id": "vm-xxx",
  "runner_id": "runner-xxx",
  "user_id": "user-xxx",
  "status": "running",
  "container_id": "docker-xxx",
  "created_at": 1700000000
}

# Task 状态
task:{task_id} -> {
  "id": "task-xxx",
  "vm_id": "vm-xxx",
  "status": "running",
  "agent": "opencode",
  "created_at": 1700000000
}

# 用户 -> Runner 映射
user:runners:{user_id} -> Set{runner_id1, ...}

# 用户 -> VM 映射
user:vms:{user_id} -> Set{vm_id1, ...}
```

---

## 4. Runner 服务设计

### 4.1 项目结构

```
runner/
├── cmd/
│   └── runner/
│       └── main.go              # 入口文件
├── internal/
│   ├── config/
│   │   └── config.go            # 配置管理
│   ├── client/
│   │   └── grpc.go              # gRPC 客户端
│   ├── docker/
│   │   ├── manager.go           # Docker 管理器
│   │   ├── container.go         # 容器操作
│   │   ├── image.go             # 镜像管理
│   │   └── network.go           # 网络管理
│   ├── terminal/
│   │   ├── pty.go               # PTY 终端
│   │   └── websocket.go         # WebSocket 桥接
│   ├── agent/
│   │   ├── opencode.go          # OpenCode Agent 集成
│   │   └── task.go              # 任务执行
│   ├── file/
│   │   └── manager.go           # 文件管理
│   └── portforward/
│       └── forward.go           # 端口转发
├── scripts/
│   └── install.sh               # 安装脚本
├── go.mod
└── Makefile
```

### 4.2 核心流程

#### 4.2.1 Runner 启动流程

```
1. 启动 Runner
   │
   ▼
2. 读取配置 (TOKEN, GRPC_HOST, GRPC_PORT, GRPC_URL)
   │
   ▼
3. 连接 TaskFlow gRPC 服务
   │
   ▼
4. 发送 Register 请求 (携带 TOKEN)
   │
   ▼
5. 启动心跳协程 (每 10 秒)
   │
   ▼
6. 监听 TaskFlow 指令 (双向流)
   │
   ├──▶ CreateVM  → 创建 Docker 容器
   ├──▶ DeleteVM  → 删除 Docker 容器
   ├──▶ CreateTask → 启动 OpenCode Agent
   ├──▶ StopTask  → 停止任务
   └──▶ TerminalStream → 建立 PTY 终端
```

#### 4.2.2 Docker 容器生命周期

```
CreateVM 请求
   │
   ▼
1. 拉取/检查镜像
   - 默认镜像: ubuntu:22.04 或自定义镜像
   - 包含 OpenCode CLI 预装
   │
   ▼
2. 创建容器配置
   - CPU/Memory 限制
   - 挂载卷 (代码目录)
   - 网络配置
   - 环境变量 (LLM API Key 等)
   │
   ▼
3. 启动容器
   - docker run -d
   - 记录 container_id
   │
   ▼
4. 初始化环境
   - 克隆 Git 仓库 (如有)
   - 配置 Git 凭证
   - 安装依赖
   │
   ▼
容器运行中，等待任务...
```

#### 4.2.3 OpenCode Agent 执行流程

```
CreateTask 请求
   │
   ▼
1. 准备任务环境
   - 进入容器 (docker exec)
   - 设置工作目录
   - 配置环境变量 (LLM_API_KEY, LLM_BASE_URL, etc.)
   │
   ▼
2. 启动 OpenCode CLI
   opencode --task "实现用户登录功能" \
            --model claude-3-sonnet \
            --workspace /workspace \
            --output json
   │
   ▼
3. 监控执行过程
   - 实时读取 stdout/stderr
   - 解析 JSON 输出
   - 上报进度到 TaskFlow
   │
   ▼
4. 任务完成
   - 收集结果
   - 生成报告
   - 上报 TaskFlow
```

#### 4.2.4 终端实现

```
用户浏览器
   │
   │ WebSocket
   ▼
TaskFlow (HTTP Server)
   │
   │ gRPC 双向流
   ▼
Runner
   │
   ▼
1. docker exec -it {container_id} /bin/bash
   │
   ▼
2. 创建 PTY (pseudo-terminal)
   - pty.Start() -> pts/pty
   │
   ▼
3. 桥接数据流
   - WebSocket → PTY (用户输入)
   - PTY → WebSocket (终端输出)
   │
   ▼
4. 处理 resize 事件
   - pty.Setsize(rows, cols)
```

---

## 5. 数据流和交互流程

### 5.1 用户创建任务完整流程

```
1. 用户在前端点击 "创建任务"
   │
   ▼
2. 前端 → MonkeyCode 后端
   POST /api/v1/users/hosts/vms
   {
     "host_id": "runner-xxx",
     "git": {"url": "https://github.com/user/repo"},
     "llm": {"api_key": "sk-xxx", "model": "claude-3-sonnet"}
   }
   │
   ▼
3. MonkeyCode 后端 → TaskFlow
   POST /internal/vm
   │
   ▼
4. TaskFlow 处理
   ├── 验证用户权限
   ├── 选择目标 Runner (调度器)
   ├── 记录 VM 状态到 Redis
   └── 发送 gRPC CreateVM 到 Runner
   │
   ▼
5. Runner 执行
   ├── 拉取 Docker 镜像
   ├── 创建容器 (CPU/Memory/Volume 配置)
   ├── 克隆 Git 仓库
   └── 返回 VM 信息
   │
   ▼
6. TaskFlow → MonkeyCode 后端 → 前端
   返回 VM 创建成功
   │
   ▼
7. 用户创建任务
   POST /api/v1/tasks
   {"vm_id": "vm-xxx", "text": "实现用户登录功能"}
   │
   ▼
8. MonkeyCode 后端 → TaskFlow
   POST /internal/task
   │
   ▼
9. TaskFlow → Runner (gRPC)
   CreateTask {task_id, vm_id, text, llm_config}
   │
   ▼
10. Runner 执行任务
    ├── docker exec 进入容器
    ├── 启动 OpenCode CLI
    ├── 实时上报进度 (gRPC ReportStream)
    └── 任务完成，返回结果
   │
   ▼
11. 前端实时显示任务进度 (WebSocket)
```

### 5.2 状态机设计

#### VM 状态机

```
                    ┌──────────┐
                    │ Pending  │ ◀─── 创建请求
                    └────┬─────┘
                         │
               ┌─────────┴─────────┐
               │                   │
               ▼                   ▼
         ┌──────────┐        ┌──────────┐
         │ Creating │        │  Failed  │
         └────┬─────┘        └──────────┘
              │
              ▼
         ┌──────────┐
         │  Online  │ ◀─── 容器启动成功
         └────┬─────┘
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│ Expired  │ │ Offline  │ │ Deleted  │
└──────────┘ └──────────┘ └──────────┘
```

#### Task 状态机

```
                    ┌──────────┐
                    │ Pending  │ ◀─── 创建请求
                    └────┬─────┘
                         │
                         ▼
                    ┌──────────┐
                    │ Running  │ ◀─── Agent 开始执行
                    └────┬─────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Paused   │     │ Completed│     │  Failed  │
  └────┬─────┘     └──────────┘     └──────────┘
       │
       ▼
  ┌──────────┐
  │ Cancelled│
  └──────────┘
```

---

## 6. 认证与授权

### 6.1 Runner 注册认证

```
1. 用户在 MonkeyCode 后端获取安装命令
   GET /api/v1/users/hosts/install-command
   │
   ▼
2. 后端生成 TOKEN (Redis 存储，15分钟有效)
   │
   ▼
3. 用户在 Linux 服务器执行安装命令
   bash -c "$(curl ...?token=xxx)"
   │
   ▼
4. Runner 启动时携带 TOKEN 连接 TaskFlow
   gRPC Register(token=TOKEN)
   │
   ▼
5. TaskFlow 验证 TOKEN 并绑定 Runner 到用户
```

### 6.2 API 请求认证

- MonkeyCode 后端 → TaskFlow: 使用内部 API，可选 Admin Token 验证
- WebSocket 连接: 通过 URL 参数传递 token 或 session_id

---

## 7. 开发计划

### 7.1 阶段划分

| 阶段 | 内容 | 周期 |
|------|------|------|
| **阶段 1** | 基础框架 | Week 1-2 |
| **阶段 2** | 宿主机和虚拟机管理 | Week 3-4 |
| **阶段 3** | 任务管理 | Week 5-6 |
| **阶段 4** | 文件管理和端口转发 | Week 7 |
| **阶段 5** | 集成和测试 | Week 8 |

### 7.2 详细任务

#### 阶段 1: 基础框架

| 任务 | 优先级 | 预估时间 |
|------|--------|---------|
| 创建 TaskFlow 项目结构 | P0 | 0.5 天 |
| 实现 HTTP Server (Echo) | P0 | 1 天 |
| 实现 gRPC Server | P0 | 1 天 |
| Redis 连接和存储封装 | P0 | 1 天 |
| 创建 Runner 项目结构 | P0 | 0.5 天 |
| Runner gRPC Client | P0 | 1 天 |
| Runner 注册和心跳 | P0 | 1 天 |
| 单元测试 | P1 | 1 天 |

#### 阶段 2: 宿主机和虚拟机管理

| 任务 | 优先级 | 预估时间 |
|------|--------|---------|
| TaskFlow Host API | P0 | 1 天 |
| TaskFlow VM API | P0 | 2 天 |
| Runner 调度器 | P0 | 1 天 |
| Runner Docker Manager | P0 | 2 天 |
| PTY 终端实现 | P0 | 2 天 |
| WebSocket 终端代理 | P0 | 1 天 |
| 集成测试 | P1 | 1 天 |

#### 阶段 3: 任务管理

| 任务 | 优先级 | 预估时间 |
|------|--------|---------|
| TaskFlow Task API | P0 | 2 天 |
| 任务状态机 | P0 | 1 天 |
| OpenCode Agent 集成 | P0 | 2 天 |
| 任务执行引擎 | P0 | 2 天 |
| 进度上报机制 | P0 | 1 天 |
| 文件操作 API | P1 | 1 天 |
| 集成测试 | P1 | 1 天 |

#### 阶段 4: 文件管理和端口转发

| 任务 | 优先级 | 预估时间 |
|------|--------|---------|
| 文件上传/下载 (WebSocket) | P1 | 2 天 |
| 文件操作 (CRUD) | P1 | 1 天 |
| 端口转发实现 | P1 | 2 天 |
| 集成测试 | P1 | 1 天 |

#### 阶段 5: 集成和测试

| 任务 | 优先级 | 预估时间 |
|------|--------|---------|
| MonkeyCode 后端集成 | P0 | 2 天 |
| 端到端测试 | P0 | 2 天 |
| 性能优化 | P1 | 1 天 |
| 文档编写 | P2 | 1 天 |
| 部署脚本 | P2 | 1 天 |

### 7.3 里程碑验收标准

| 里程碑 | 验收标准 |
|--------|---------|
| **M1: 基础框架完成** | Runner 能成功注册到 TaskFlow，心跳正常 |
| **M2: VM 管理完成** | 能创建/删除 Docker 容器，终端连接正常 |
| **M3: 任务管理完成** | 能执行 OpenCode 任务，进度上报正常 |
| **M4: 全功能完成** | 所有 API 实现完成，文件操作和端口转发正常 |
| **M5: 集成完成** | 与 MonkeyCode 后端集成成功，端到端流程正常 |

---

## 8. 风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| OpenCode CLI 兼容性问题 | 高 | 提前测试 OpenCode CLI，准备备选方案 |
| Docker 网络配置复杂 | 中 | 使用简化网络模式，逐步增加复杂度 |
| gRPC 双向流稳定性 | 中 | 实现自动重连机制，心跳检测 |
| Redis 单点故障 | 中 | 支持 Redis Sentinel 或 Cluster |

---

## 9. 附录

### 9.1 参考文档

- [MonkeyCode GitHub](https://github.com/chaitin/MonkeyCode)
- [OpenCode CLI](https://github.com/opencode-ai/opencode)
- [Docker SDK for Go](https://docs.docker.com/engine/api/sdk/)
- [gRPC Go Quick Start](https://grpc.io/docs/languages/go/quickstart/)

### 9.2 术语表

| 术语 | 说明 |
|------|------|
| TaskFlow | 任务编排服务，接收后端请求，调度 Runner 执行 |
| Runner | 执行代理，部署在 Linux 服务器，管理 Docker 容器 |
| VM | 虚拟机，实际是 Docker 容器，提供隔离的开发环境 |
| Task | AI 编码任务，由 OpenCode Agent 执行 |
