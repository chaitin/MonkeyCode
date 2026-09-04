# MonkeyAI Backend

MonkeyAI 的统一 Go 后端，同时承接管理后台和 AI Work Agent 的请求。首期使用一个服务进程，两类调用方复用同一套业务逻辑和数据模型。

## 技术选型

| 领域 | 选型 |
| --- | --- |
| 语言 | Go 1.27 |
| HTTP | 标准库 `net/http` + `chi/v5` |
| API | REST、JSON、OpenAPI 3.1；实时单向推送使用 SSE |
| 数据库 | PostgreSQL、`pgx/v5`、`sqlc` |
| 数据迁移 | `golang-migrate/v4` 与显式 SQL |
| 配置 | 标准库 `os`、`flag`、`strconv` |
| 日志 | 标准库 `log/slog` |
| 鉴权 | 服务端 Session、可撤销 Opaque Token、Argon2id |
| 积分 | `shopspring/decimal` |
| 后台作业 | `context`、`time` 与 PostgreSQL 作业表 |
| 测试 | 标准库 `testing`、`httptest`，数据库集成测试按需使用 Testcontainers |

首期不引入 DI 容器、ORM、Redis、消息队列、ClickHouse 和独立向量数据库。知识检索优先使用 PostgreSQL 全文检索与 `pgvector`；双向实时通信确有需要时再引入 WebSocket。

## 目录结构

```text
backend/
├── api/                       # OpenAPI 等接口契约
├── cmd/
│   └── server/                # 唯一服务进程入口 main.go
├── docs/
│   └── adr/                   # 架构决策
├── internal/
│   ├── app/                   # 唯一集成点：启动、组装和生命周期
│   ├── httpapi/               # 公共路由、中间件和响应协议
│   ├── identity/              # 登录、用户、角色和分组
│   ├── resource/              # 文件、标签、资源所有权和访问授权
│   ├── model/                 # 模型配置与调用入口
│   ├── knowledge/             # 知识库与检索
│   ├── skill/                 # 技能包
│   ├── rule/                  # Agent 规则
│   ├── mcp/                   # MCP 服务与工具
│   ├── expert/                # 专家预设与资源组合
│   ├── session/               # 会话及模型、工具调用事实
│   ├── billing/               # 定价、额度、账户和流水
│   ├── audit/                 # 管理审计
│   ├── stats/                 # 实时状态和统计查询
│   ├── setting/               # 全局设置
│   ├── config/                # 配置加载
│   └── database/              # 数据库连接和事务基础能力
├── migrations/                # PostgreSQL 迁移
├── CONTEXT.md                 # 统一领域语言
└── go.mod
```

每个业务目录都是一个可独立分配给 AI 的工作单元，同时包含该业务的 Admin API、Agent API、业务逻辑、数据访问和测试。例如管理端创建模型与 Work Agent 获取模型都在 `model` 目录内实现，不需要同时修改两个集中式 API 目录。

HTTP 路由按调用方使用两个稳定前缀：管理后台使用 `/api/admin/v1`，工作 Agent 使用 `/api/agent/v1`。业务包分别向两个子路由注册 handler，共享业务服务但不共享请求 DTO；`/healthz` 和 `/readyz` 位于 API 前缀之外，供部署平台探测。

## 包内组织

业务包先保持平铺，按职责拆文件：

```text
internal/model/
├── model.go                   # 业务对象
├── service.go                 # 业务逻辑
├── repository.go              # 数据访问接口
├── postgres.go                # PostgreSQL 实现
├── admin.go                   # 管理后台接口
├── agent.go                   # Work Agent 接口
├── query.sql                  # sqlc 查询
└── service_test.go            # 就地测试
```

只有单个包已经过大且出现稳定子领域时才增加子目录，不预先创建 `domain/application/adapter` 等层级。

## AI 并行开发边界

一个业务任务默认只修改以下区域：

```text
internal/<feature>/**
api/<feature>/**
migrations/<唯一版本>_<feature>_*.sql
```

- API 契约按业务能力拆成片段，每个目录分别保存 `admin.yaml` 和 `agent.yaml`，避免多人修改单个 OpenAPI 文件。
- SQL、sqlc 生成结果和测试留在对应业务目录，避免集中式 `repository`、`generated` 和 `test` 目录成为冲突热点。
- `go.mod`、`go.sum`、`internal/app`、`internal/httpapi` 和公共 API Schema 是共享集成点，由单独的集成任务串行修改。
- 新业务包自行暴露路由注册入口，`app` 显式组装；禁止通过 `init` 隐式注册来规避集成步骤。
- 跨业务依赖的接口定义在使用方，接口保持最小；不得为了共享一个结构体就把业务类型移动到公共包。
- 并行任务不修改其他业务目录。确实需要跨目录变更时，拆成独立前置任务或交给集成任务。

## 依赖规则

- `cmd/server` 只负责启动和退出，依赖组装集中在 `app`。
- `httpapi` 只保存所有业务共用的路由、中间件和响应协议，具体处理器留在业务目录。
- Admin API 与 Agent API 只共享业务服务，不共享请求 DTO。
- 跨包调用通过使用方定义的小接口完成，禁止循环依赖。
- `database` 只提供连接与事务，具体 SQL 留在拥有该数据的业务包中。
- 后台定时作业先随 server 生命周期运行；只有出现独立扩缩容需求时再增加 worker。

## 工程约定

- API 契约按业务目录拆分，并在构建时合并校验；合并产物不得手工修改。
- 路由使用 `chi/v5` 组织版本、调用方和中间件，处理器保持标准 `http.Handler` 接口。
- HTTP DTO 不直接充当业务对象。
- 测试与对应 Go 源码放在同一目录；暂不创建独立测试树。
- 迁移文件使用唯一 UTC 毫秒时间戳 `<YYYYMMDDHHMMSSmmm>_<feature>_<action>.{up,down}.sql` 命名，创建后先检查版本未被其他并行任务占用；已经发布的迁移不可改写。
- 不创建 `pkg`、`utils` 或 `common`；出现明确复用对象后再决定归属。

## Go 编码原则

- 以 Go 1.27 为最低语言版本；新特性能让归属更清晰、样板更少时优先使用，不为兼容旧版本保留冗余写法。
- 操作明确属于某个类型且需要额外类型参数时，优先使用泛型方法，而不是退回包级泛型辅助函数。
- 使用非指针匿名嵌入且字段唯一可访问时，结构体字面量直接初始化提升字段。
- 目标函数类型足以推断泛型实参时省略显式实例化，只有歧义或类型本身承载业务含义时才写出实参。
- 标准库已经覆盖需求时直接使用标准库，例如 `slices`、`maps`、`cmp`、`errors`、`net/http`、`encoding/json`、`log/slog`、`context` 和 `time`。
- 不创建只是转调、类型转换或重复标准库能力的小函数，也不为此引入工具函数库。
- 短函数如果封装了明确业务规则仍应保留；判断标准是有没有独立业务语义，而不是代码行数。
- 手写 Go 文件使用简短的连续小写名称，优先通过包边界消除冗长命名；下划线保留给 `_test.go`、GOOS/GOARCH 构建后缀及生成工具要求的文件名。

## 本地启动

启动前提供 PostgreSQL 连接地址：

```bash
export MONKEYAI_DATABASE_URL='postgres://monkeyai:password@127.0.0.1:5432/monkeyai?sslmode=disable'
go run ./cmd/server
```

可选环境变量为 `MONKEYAI_HTTP_ADDR`、`MONKEYAI_SHUTDOWN_TIMEOUT` 和 `MONKEYAI_LOG_LEVEL`，对应命令行参数可通过 `go run ./cmd/server -h` 查看。服务提供 `/healthz` 存活检查和 `/readyz` 数据库就绪检查。
