# MonkeyAI 后端 AI 并行开发约束

## 工作单元

- 每个 AI 默认只负责一个业务能力目录，例如 `internal/model` 或 `internal/skill`。
- 业务代码、Admin API、Agent API、SQL、sqlc 生成结果和测试都保存在对应业务目录。
- OpenAPI 源文件放在 `api/<feature>`，迁移使用 `migrate create -ext sql -dir migrations -seq <feature>_<action>` 生成默认六位序号，名称必须包含 feature。

## 共享集成点

- `go.mod`、`go.sum`、`internal/app`、`internal/httpapi`、公共 API Schema 和构建配置只能由当前集成任务修改。
- 业务任务如需新增依赖，只记录依赖及原因，由集成任务统一更新依赖文件。
- 业务包暴露显式路由注册入口，由集成任务接入 `app`；禁止使用 `init` 或全局注册表自动发现模块。
- 不得手工修改合并后的 OpenAPI、sqlc 或其他生成产物；源文件合并后由集成任务统一生成和校验。

## 跨业务协作

- 接口定义在使用方，只暴露当前用例需要的方法。
- 不直接修改其他业务目录，也不把业务类型移动到 `common`、`shared` 或 `utils`。
- 必须跨业务修改时，拆成前置任务和集成任务，避免多个 AI 同时写同一文件。

## 验证

- 业务任务先运行 `go test ./internal/<feature>/...`。
- 集成任务运行 `go test ./...`、`go vet ./...` 和 API、迁移冲突检查。

## Go API 设计

- 构造函数只接收必需依赖；可选配置统一使用返回接收者的链式 `WithXxx` 方法。
- 不定义 `Option func(...)` 类型，也不使用可变参数函数式 Option。

## Go 文件命名

- 手写 Go 文件使用简短的连续小写名称，例如 `admin.go`、`agent.go`、`postgres.go`。
- 优先借助业务包边界缩短文件名，不在文件名中重复包名。
- 下划线保留给 `_test.go`、GOOS/GOARCH 构建后缀，以及 sqlc 等生成工具规定的文件名。
