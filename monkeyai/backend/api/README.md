# API

OpenAPI 源文件按调用方分为 `admin.yaml` 和 `agent.yaml`。管理后台接口统一维护在 `admin.yaml`，工作 Agent 接口统一维护在 `agent.yaml`，不再按业务模块拆分或生成合并文档。

每个接口必须声明请求体、成功与错误响应、响应 JSON Schema，并为字段补充类型、约束和说明；不能只记录状态码和响应描述。契约字段以实际 HTTP DTO 为准，密钥等不返回的敏感字段需要明确说明。

## Agent 资源读取

Agent 使用 OAuth access token 按资源类型读取，整体 `GET /api/v1/config` 已移除，不提供兼容聚合入口。

| 方法与路径 | 响应字段 |
| --- | --- |
| `GET /api/v1/settings` | `version`、脱敏 `settings` |
| `GET /api/v1/models` | `version`、`models`、`model_gateway` |
| `GET /api/v1/rules` | `version`、`rules` |
| `GET /api/v1/skills` | `version`、`skills` |
| `GET /api/v1/experts` | `version`、`experts` |
| `GET /api/v1/connectors` | `version`、`connectors` |

各接口返回独立的 `ETag` 和 `Cache-Control: private, no-cache`；携带该接口上次的 `If-None-Match`，可见内容未变时返回 `304`。`version` 是实际下发内容的 SHA-256 摘要，空资源列表为 `[]`。客户端按服务端、用户和接口隔离缓存，收到 `200` 后替换该类资源，不能继续使用响应中已移除的授权项。旧的全局 `schema_version`、`updated_at` 不再下发。

设置与模型由各自业务服务读取。规则、技能、连接器仅加载自身目录及必要授权；专家目录会检查规则、技能、模型和连接器依赖，因此依赖变化仍可更新专家版本。某类资源读取失败返回错误，只影响依赖它的请求。

模型列表中的 `model_gateway.base_url` 为代理 `/v1` 地址，`authentication` 固定为 `api_key`。专家清单、资源 resolve、技能包下载以及连接器工具和认证接口沿用原路径与权限规则。

模型列表每项的 `id` 为平台内部模型 UUID，`model` 为数据库 `models.model_id` 中配置的真实上游模型名称。调用模型代理时，请求体的 `model` 参数使用列表项的 `id`，由代理定位配置、检查权限并转换为上游模型名称。

## 用户模型与分享

以下接口均使用 Agent OAuth access token：`Authorization: Bearer <access_token>`，完整契约见 `agent.yaml`。模型代理调用仍使用独立的调用密钥。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/v1/users?q=<用户名或邮箱>&limit=20` | 查找有效接收用户，返回 `users: [{id, name, email}]` |
| `GET /api/v1/models` | 获取可用模型及代理信息，支持独立 ETag |
| `POST /api/v1/models` | 创建个人模型，所有者取当前登录用户 |
| `GET /api/v1/models/{modelID}` | 读取自己的模型配置用于编辑，不返回密钥原文 |
| `PUT /api/v1/models/{modelID}` | 更新自己的模型，省略或留空 `api_key` 保留原密钥 |
| `DELETE /api/v1/models/{modelID}` | 删除自己的模型并清除分享授权 |
| `POST /api/v1/resources/shares` | 将一批自有资源追加分享给一批用户 |
| `DELETE /api/v1/resources/shares` | 撤销指定资源与用户之间的分享 |

创建个人模型的请求示例：

```json
{
  "model_id": "upstream-model-name",
  "display_name": "我的模型",
  "protocol": "openai_chat_completions",
  "base_url": "https://provider.example.com/v1",
  "api_key": "上游密钥",
  "advanced_config": {
    "context_window_tokens": 128000,
    "max_output_tokens": 8192,
    "supports_vision": true
  }
}
```

分享和撤销使用同一请求结构，成功返回 `204`：

```json
{
  "resources": [
    {"type": "model", "id": "11111111-1111-4111-8111-111111111111"},
    {"type": "model", "id": "22222222-2222-4222-8222-222222222222"}
  ],
  "user_ids": ["33333333-3333-4333-8333-333333333333"]
}
```

资源和用户各限 1—100 项，重复项会去重。本期仅允许 `type=model`；后续资源通过显式注册 `resource.Shareable` 接入。任一资源非本人所有或任一接收用户无效时整批回滚。分享仅授予使用权限，接收方不能修改、删除或转分享。个人模型的积分倍率由服务端管理，创建时为 `1`。

Agent 模型列表包含 `ownership_type`（固定为 `system` / `user`）及 `owner_user_id`。`ownership_type` 仅表示资源归属，分享不会改变它；自己的模型和别人分享的模型均为 `user`，通过 `owner_user_id` 与当前用户 ID 的比较区分。管理员在用户侧创建的个人模型同样为 `user`。自己的用户模型返回 `shared_users: [{id, name, email}]`，未分享时为 `[]`；收到分享的用户模型返回 `creator: {id, name, email}`，不展示其他接收人。系统模型不返回这两个字段。分享范围或创建者展示信息变化会影响模型目录 ETag；撤销、删除后的新列表请求和代理调用会重新检查权限。

可用列表仅下发启用的模型。上游地址和密钥不会下发给分享接收方；所有模型密钥都不在 API 响应中返回。管理员在 Agent 侧也需要得到分享才能使用他人的个人模型。

## 操作审计

`GET /api/admin/v1/audits` 仅管理员可访问，支持 `actor`、`ip`、`params`、`category`、`result`、`since`、`until`、`page` 和 `page_size`，返回 `{items, total, page, page_size}`。时间范围左闭右开，默认每页 20 条，最多 500 条。相同时间的记录按 ID 倒序稳定分页。

审计覆盖通过管理员鉴权的后台写请求，以及管理员密码登录和浏览器退出。OAuth 跳转及回调、Agent 日常请求和模型代理流量不在本次 HTTP 管理审计范围内；已有独立业务审计继续保留。未认证登录尝试的用户 ID 为空，认证成功后保存真实用户快照。

已有事务内业务审计继续与变更原子提交，并通过服务端生成的 `request_id` 关联请求；完成时补齐脱敏参数和 HTTP 结果。没有事务审计或事务已回滚时补录请求事件，批量操作保留每个目标的事件。后置补录失败会记录带请求 ID 的服务日志，不改变已返回的业务结果；此机制不能保证数据库不可用或进程在业务提交后崩溃时仍保存补录事件。

请求参数采用字段白名单，密码、密钥、凭证、Header、OAuth Token、URL、内容正文及未知配置默认脱敏。JSON 捕获最多 64 KiB，超限、无效 JSON 和上传文件仅记录省略标记；失败原因只保存标准 HTTP 状态说明。来源 IP 取实际连接地址，不信任任意转发头；部署在反向代理后时显示代理地址。历史记录中未采集的 IP、请求 ID 等字段展示为空。


## MCP 代理

`GET /api/v1/connectors` 以及专家清单、资源 resolve 的连接对象包含 `capabilities: [catalog, invoke]` 和 `mcp_gateway`：

```json
{
  "url": "https://monkeyai.example/mcp/connectors/<connector-id>",
  "transport": "streamable_http",
  "authentication": "api_key",
  "required_scope": "mcp:invoke"
}
```

客户端将每个连接注册为独立的 HTTP MCP Server，使用 `Authorization: Bearer <调用密钥>`；密钥须有 `mcp:invoke` 权限。目录使用 OAuth access token 读取，代理使用调用密钥。连接若为 `authorization_required`，需先通过现有连接认证接口完成 Header/OAuth 认证。配置中不包含上游地址、Header 或 OAuth Token。访问令牌已过期但仍有刷新令牌的 OAuth 连接继续下发目录，由代理自动刷新；缺少刷新能力时要求重新授权。

握手示例：

```http
POST /mcp/connectors/<connector-id>
Authorization: Bearer <调用密钥>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"agent","version":"1"}}}
```

随后发送无 ID 的 `notifications/initialized`，再使用 `tools/list` 和 `tools/call`。后续请求携带协商得到的 `MCP-Protocol-Version`。工具名称区分大小写，列表只返回当前用户可调用的启用工具；不接受非空分页游标。调用参数与有效工具结果保留原始数值精度、`_meta` 和 `structuredContent`。

入口为无状态 Streamable HTTP：POST 返回 JSON，通知返回空的 202，GET/DELETE 返回 405；不产生下游 `Mcp-Session-Id`，不提供主动推送、resources、prompts 或 sampling/elicitation。上游支持 HTTP POST 的 JSON/SSE 响应，每次调用独立握手并在结束后发送 DELETE 清理上游会话；不支持旧版 GET SSE 传输、跨调用上游会话状态或本地 stdio 进程。非空 Origin 必须与 `MONKEYAI_PUBLIC_URL` 同源。

工具调用可携带 `X-Session-ID` 关联本人工作会话，或 `Idempotency-Key` 避免重复执行；重复请求返回 409 和原 `X-Billing-Transaction-ID`。集中认证仅成功调用收费，独立认证和免认证只记录调用。JSON-RPC 错误或 `isError=true` 释放预留；超时、断流、无效结果保持未知状态供核查，不自动重放。上游 JSON/SSE 响应限制为 4 MiB，请求体限制为 1 MiB。

协议错误使用 JSON-RPC 数字错误码；权限、额度等业务错误保留 HTTP 状态，并在 `error.data.code` 中提供业务错误码。上游内部错误详情不直接返回，使用 `X-Billing-Transaction-ID` 查询交易。生产 Nginx 和本地 Vite 已将 `/mcp` 转发到后端。

## MCP OAuth 回调

OAuth MCP 创建、详情和管理列表响应提供 `callback_url`，格式为 `{MONKEYAI_PUBLIC_URL}/oauth/connectors/{id}/callback`，其中 `id` 为 Connector 实例 ID。非 OAuth 连接返回空字符串。创建后将此完整地址登记到第三方 OAuth 应用；同一模板下的不同 MCP 实例也使用各自的地址。

`POST /api/admin/v1/connectors/{id}/oauth/authorizations`（集中认证）或 `POST /api/v1/connectors/{id}/oauth/authorizations`（独立认证）生成带 state 和 PKCE 的授权 URL，`redirect_uri` 与 `callback_url` 一致。浏览器回调无需登录凭据，服务端核验路径 id、state、事务有效期、发起人权限和配置版本，单次消费后交换 Token，并按集中或独立认证上下文保存。成功页面提示返回 MonkeyAI，发起端通过授权事务状态接口查询结果。

原有 OAuth 应用需将统一的 `/oauth/connectors/callback` 更新为各 MCP 的专属地址，再重新发起授权。
