# MonkeyAI Backend

MonkeyAI 的统一 Go 后端，同时承接管理后台和 AI Work Agent 的请求。首期使用一个服务进程，两类调用方复用同一套业务逻辑和数据模型。

## 技术选型

| 领域 | 选型 |
| --- | --- |
| 语言 | Go 1.27 |
| HTTP | 标准库 `net/http` + `chi/v5` |
| API | REST、JSON、OpenAPI 3.1；模型流式响应透传上游 SSE |
| 数据库 | PostgreSQL、`pgx/v5`、`sqlc` |
| 数据迁移 | `golang-migrate/v4` 与显式 SQL |
| 配置 | 标准库 `os`、`flag`、`strconv` |
| 日志 | 标准库 `log/slog` |
| 性能分析 | 标准库 `net/http/pprof`，独立本机监听 |
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
│   ├── apikey/                # Agent 调用密钥
│   ├── agentconfig/           # Agent 资源目录与专家依赖解析
│   ├── resource/              # 文件、标签、资源所有权和访问授权
│   ├── model/                 # 模型配置与调用入口
│   ├── proxy/                 # 模型协议代理与调用计费
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

每个业务目录都是一个可独立分配给 AI 的工作单元，包含对应业务逻辑、HTTP handler、数据访问和测试。例如管理端创建模型与 Work Agent 获取模型都在 `model` 目录内实现。OpenAPI 契约按调用方集中维护为 `api/admin.yaml` 和 `api/agent.yaml`。

HTTP 路由按调用方使用两个稳定前缀：管理后台使用 `/api/admin/v1`，工作 Agent 使用 `/api/v1`；模型协议代理为兼容现有客户端保留 `/v1`。业务包分别向对应路由注册 handler，共享业务服务但不共享请求 DTO；`/healthz` 和 `/readyz` 位于 API 前缀之外，供部署平台探测。

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
├── sqlc/                      # sqlc 生成的查询、参数和结果类型
└── service_test.go            # 就地测试
```

只有单个包已经过大且出现稳定子领域时才增加子目录，不预先创建 `domain/application/adapter` 等层级。

## AI 并行开发边界

一个业务任务默认只修改以下区域：

```text
internal/<feature>/**
migrations/<唯一版本>_<feature>_*.sql
```

- API 契约按调用方集中维护在 `api/admin.yaml` 和 `api/agent.yaml`，由集成任务统一修改和校验。
- SQL、sqlc 生成结果和测试留在对应业务目录，避免集中式 `repository`、`generated` 和 `test` 目录成为冲突热点。
- `go.mod`、`go.sum`、`internal/app`、`internal/httpapi`、`api/admin.yaml` 和 `api/agent.yaml` 是共享集成点，由单独的集成任务串行修改。
- 新业务包自行暴露路由注册入口，`app` 显式组装；禁止通过 `init` 隐式注册来规避集成步骤。
- 跨业务依赖的接口定义在使用方，接口保持最小；不得为了共享一个结构体就把业务类型移动到公共包。
- 并行任务不修改其他业务目录。确实需要跨目录变更时，拆成独立前置任务或交给集成任务。

## 依赖规则

- `cmd/server` 只负责启动和退出，依赖组装集中在 `app`。
- `httpapi` 只保存所有业务共用的路由、中间件和响应协议，具体处理器留在业务目录。
- Admin API 与 Agent API 只共享业务服务，不共享请求 DTO。
- 跨包调用通过使用方定义的小接口完成，禁止循环依赖。
- `proxy` 保留客户端兼容的 `/v1` 模型协议入口，通过自身定义的 `Resolver` 和 `UsageRecorder` 接口调用模型与会话能力。
- `database` 只提供连接与事务，具体 SQL 留在拥有该数据的业务包中。
- 后台定时作业先随 server 生命周期运行；只有出现独立扩缩容需求时再增加 worker。

## 工程约定

- API 契约按调用方维护两份 OpenAPI 源文档，并由集成任务统一校验。
- 路由使用 `chi/v5` 组织版本、调用方和中间件，处理器保持标准 `http.Handler` 接口。
- HTTP DTO 不直接充当业务对象。
- 测试与对应 Go 源码放在同一目录；暂不创建独立测试树。
- 迁移文件使用 `migrate create -ext sql -dir migrations -seq <feature>_<action>` 生成，采用默认六位递增序号。合并前必须检查序号未被其他分支占用；如有冲突，重新生成序号。已经发布的迁移不可改写。
- 不创建 `pkg`、`utils` 或 `common`；出现明确复用对象后再决定归属。

## Go 编码原则

- 以 Go 1.27 为最低语言版本；新特性能让归属更清晰、样板更少时优先使用，不为兼容旧版本保留冗余写法。
- 操作明确属于某个类型且需要额外类型参数时，优先使用泛型方法，而不是退回包级泛型辅助函数。
- 使用非指针匿名嵌入且字段唯一可访问时，结构体字面量直接初始化提升字段。
- 目标函数类型足以推断泛型实参时省略显式实例化，只有歧义或类型本身承载业务含义时才写出实参。
- 标准库已经覆盖需求时直接使用标准库，例如 `slices`、`maps`、`cmp`、`errors`、`net/http`、`encoding/json`、`log/slog`、`context` 和 `time`。
- 构造函数只接收必需依赖；可选配置统一使用返回接收者的链式 `WithXxx` 方法，不使用函数式 Option。
- 不创建只是转调、类型转换或重复标准库能力的小函数，也不为此引入工具函数库。
- 短函数如果封装了明确业务规则仍应保留；判断标准是有没有独立业务语义，而不是代码行数。
- 手写 Go 文件使用简短的连续小写名称，优先通过包边界消除冗长命名；下划线保留给 `_test.go`、GOOS/GOARCH 构建后缀及生成工具要求的文件名。

## 本地启动

启动前提供 PostgreSQL 连接地址，以及 `MONKEYAI_S3_ENDPOINT`、`MONKEYAI_S3_ACCESS_KEY` 和 `MONKEYAI_S3_SECRET_KEY`。服务在启动流程中检查并按需创建资源 Bucket，初始化限时 1 分钟，失败则退出；凭据需具备 Bucket 访问权限及首次建桶所需的 `s3:CreateBucket` 权限（详见上层 README）：

```bash
export MONKEYAI_DATABASE_URL='postgres://monkeyai:password@127.0.0.1:5432/monkeyai?sslmode=disable'
go run ./cmd/server
```

可选环境变量为 `MONKEYAI_HTTP_ADDR`、`MONKEYAI_PPROF_ADDR`、`MONKEYAI_SHUTDOWN_TIMEOUT`、`MONKEYAI_LOG_LEVEL`、`MONKEYAI_PUBLIC_URL` 和 `MONKEYAI_ADMIN_URL`，对应命令行参数可通过 `go run ./cmd/server -h` 查看。`MONKEYAI_PUBLIC_URL` 是上游 OAuth 回调和 OAuth 元数据使用的服务地址，`MONKEYAI_ADMIN_URL` 是登录完成后返回的页面地址；两者必须使用相同协议和主机名，开发环境可以使用不同端口，正式环境应使用 HTTPS。

空数据库首次启动时，必须通过 `MONKEYAI_INITIAL_ADMIN_EMAIL` 和 `MONKEYAI_INITIAL_ADMIN_PASSWORD` 创建管理员账号，可选 `MONKEYAI_INITIAL_ADMIN_NAME` 设置显示名称。密码至少 12 个字符；未配置时服务会拒绝启动，避免产生无法管理的实例。服务只在用户表为空时创建账号，不会在后续启动时重置密码。创建完成后应移除密码环境变量。完整登录流程见 [`../design/agent-auth-settings.md`](../design/agent-auth-settings.md)。

服务提供 `/healthz` 存活检查和 `/readyz` 数据库及 RustFS Bucket 就绪检查。pprof 默认单独监听 `127.0.0.1:6060`，入口为 `/debug/pprof/`，不对业务端口暴露。

## 资源功能验证

`go test ./...` 和 `go vet ./...` 运行常规检查。真实 PostgreSQL / RustFS 集成验证需要：

```bash
export MONKEYAI_TEST_DATABASE_URL='postgres://测试账号:测试密码@127.0.0.1:5432/测试库?sslmode=disable'
export MONKEYAI_S3_ENDPOINT='http://127.0.0.1:9000'
export MONKEYAI_S3_ACCESS_KEY='测试访问密钥'
export MONKEYAI_S3_SECRET_KEY='测试访问密钥密码'
go test ./... -count=1
```

集成测试创建独立随机 schema，测试结束后删除该 schema，不重置其他 schema；必须使用测试数据库和测试 Bucket。测试包括版本 1 的 up/down/up、版本 2 的计费升级、版本 3 的旧系统分组升级与授权和额度保留、虚拟团队根节点及分组操作、Cookie 管理员身份与 Agent Bearer 身份、权限差异、独立资源目录 ETag、技能字节上传/重建/下载、专家委托、撤权、真实 MCP HTTP 协议、用户目录隔离及本地 OAuth state/PKCE 回调防重放。测试可能留下不可变技能对象，仅位于测试 Bucket。

业务标识统一由后端生成：新建 MCP 连接模板时可省略 `identifier`，更新时省略或留空会保留原标识；保存 `authentication` 设置时，新 OAuth 连接省略 `id`，后端生成并通过保存响应返回，前端后续编辑和删除使用返回的 `id`。额度调整幂等键等提交前需要持有的标识，通过管理员接口 `POST /api/admin/v1/identifiers` 批量申请（请求 `{"count":1}`，响应 `{"ids":["UUID"]}`，单次 1～1000 个）；同一次调整失败重试时复用原标识，调整内容变化或成功后重新申请。知识库演示页面也使用此接口分配标识。

各业务服务显式注册到 `internal/app`。`resource.CRUD` 接收各业务包的 sqlc Repository 和字段白名单，业务约束及关系事务由 `rule`、`skill`、`expert`、`mcp` 提供。Agent 按设置、模型、规则、技能、专家和连接器分别读取，各接口独立计算版本与 ETag。规则、技能、专家和连接器目录分别在 PostgreSQL Repeatable Read 视图中读取；某类资源读取失败只影响依赖它的请求，不返回伪造的空目录。

## SQL 查询与代码生成

生产查询维护在各业务包的 `query.sql` 中，使用 sqlc v1.30.0 生成 pgx/v5 的类型化调用。MCP 的 Provider 和 Connector CRUD 分别维护在 `provider.sql`、`connector.sql`，生成各自的 Repository。业务代码通过 `sqlc.New(pool)` 或 `sqlc.New(tx)` 使用查询；需要快照的读取继续使用 `database.Reader(ctx, pool)`。

```bash
make generate     # 从迁移提取结构，重新生成全部查询代码
make sqlc-check   # 检查结构与迁移一致，并检查生成结果没有漂移
make check        # 生成结果检查、全量测试、go vet
```

默认命令使用固定版本的 `go run`，不修改服务的运行时依赖。已安装同版本 sqlc 时，可设置 `SQLC=sqlc`。修改查询或迁移后运行 `make generate`，将 SQL 源文件、`schema/schema.sql` 和生成的 Go 文件一起提交；不要手工修改生成结果。

`migrations` 是结构定义的唯一来源。`tools/sqlcschema` 按迁移顺序提取持久表、类型、域和序列的 DDL，跳过数据搬迁及临时表，避免 sqlc 对迁移中 `jsonb_each` 临时表推断的限制。`schema/schema.sql` 仅供代码生成，部署仍执行完整迁移。

可空参数使用 `sqlc.narg`，数组显式声明 PostgreSQL 类型。通用资源的固定 CRUD 查询通过 JSON 参数区分未传字段与显式 `null`，保留数据库默认值、字段白名单及事务内版本校验。生产代码不拼接或执行 SQL 字符串；迁移脚本和集成测试中的建库、数据准备及独立数据库断言不经过业务查询层。
