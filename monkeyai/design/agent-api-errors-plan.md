# 服务端 Web 与错误处理统一

状态：实现、相关模块测试、完整非数据库单元检查、关键并发检查及工程校验通过。仅服务端，无新增数据库结构或客户端实现。

## 公共 Web 层

`internal/web` 复用现有 Chi，提供 Go 1.27 泛型方法 `Get[O]`、`Post[I,O]`、`Handle[O]`、`Bind[I,O]`。输入、输出可由 Handler 推断，接口返回 `(T, error)`，不引入反射注册、全局发现或泛型错误类型。框架处理输入大小、JSON 对象/未知字段/尾随数据、序列化与错误输出。

API Key Agent 的创建、列表、删除和轮换已迁移，保留原状态、JSON 成功字段、204 空响应、缓存头及密钥只返回一次的行为。其他既有路由保持注册方式，其错误出口接入同一运行时；不进行整库机械迁移。

`web.Error` 收敛公共错误契约，保留 Status、Code、受控 Message、References 和原始错误链。`BadRequest(code)`/`Internal(code)` 支持仅传错误码；`WithCause` 与 Unwrap 支持 errors.Is/As。resource.Error 作为兼容别名，不维护两套类型。

业务不需要传语言或调用独立翻译包；词表和协商逻辑放在 `web/internal/i18n`，通过 Go internal 规则限制访问。回包渲染按稳定 code 和具体文案翻译，未收录的内部错误使用安全兜底。235 项原有错误码加 api_key_name_required，共 236 项代码词条；保留 751 项具体文案/模板。

## 编号与日志

- HTTP 入口按 W3C Trace Context 接续或创建 OTel server span。
- 默认 Provider 不采样、无导出器，仍产生有效 Trace ID；可通过 WithTracerProvider 注入宿主配置，不新增遥测后端或部署要求。
- 错误文案末尾追加 `[trace_id: <Trace ID>]`，直接使用当前 OTel Trace ID；原始错误对象不追加编号，不持久化。不存在有效 span 时不追加编号，不将本地请求编号伪装成 Trace ID。
- 日志记录 trace_id、span_id 和既有 request_id；继续保留 X-Request-ID。客户端只展示 message 也能通过截图/复制提供链路编号。
- 默认 WARN 下每个 HTTP 错误有一条 http.response.error 摘要；5xx 使用 ERROR。HTTP 200 内的受控协议错误同样有摘要，Expected 或已有底层诊断不抑制它。
- 原有底层诊断与回包摘要职责分开，未知内部原因不进入新摘要。类型化 Web Handler 的补充诊断排除原始 error_message，保留安全分类信息；既有业务诊断策略保持原样。
- 设备消息通过 protocol.response.error 逐条记录，携带响应/请求编号；不能用连接级去重，也不延迟到断开。

## 协议与数据边界

普通资源、认证、设备、设计资源、模型、设置、审计、计费、统计和服务网关统一使用 Web 错误渲染；默认 404/405 以及响应未提交时的 panic500 也接入。OAuth 保留 error/error_description；MCP 保留 JSON-RPC 数值码、data.code、请求 ID、references 及 HTTP 状态；设备错误帧保留结构。

上游透明代理内容、用户内容、机器状态及只含 code 的协议帧不改写。框架不缓冲或扫描 SSE/WebSocket/上游正文；只含 code 的本机设备拒绝帧通过日志关联。

不新增 reason，也不增加持久化诊断字段。授权回调当次响应提供具体错误和编号，授权轮询与历史 last_error 继续使用原数据结构。schema、迁移、SQL 及 sqlc 生成结果相对 origin/main 无差异。

## 验证

- 完整非数据库 `go test -p 1 ./...`、`go vet ./...` 通过；不将跳过的数据库集成测试计为通过。
- Web、私有 i18n、日志、API Key、设备和 MCP 的 race 检查通过。
- 新增测试覆盖：默认 WARN 下错误摘要与编号关联、未采样 Trace Context 接续/本地 span、预期错误/已有诊断不吞摘要、HTTP200协议错误、泛型输入边界、原始错误链、逐帧日志、透明内容不改写及业务成功响应兼容。
- 既有设备 HTTP/帧、设计资源两种信封、OAuth、模型、设置、审计、MCP、404/405/500 及词条/出口覆盖守卫通过。
- make sqlc-check、OpenAPI YAML/797与949个本地引用、差异格式及零数据库变更检查通过。
- 已知原主线数据库全量 TestResourceIntegration 在“新工具必须默认禁用”断言处失败，本次不改工具启停逻辑。

PR：https://github.com/chaitin/MonkeyCode/pull/1489
