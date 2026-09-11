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

设置与模型由各自业务服务读取。规则、技能、连接器仅加载自身目录及必要授权；专家目录会检查规则、技能和连接器依赖，因此依赖变化仍可更新专家版本。某类资源读取失败返回错误，只影响依赖它的请求。

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

资源和用户各限 1—100 项，重复项会去重。当前允许 `type=model`、`type=skill`、`type=connector`、`type=expert`；其他资源通过显式注册 `resource.Shareable` 接入。任一资源非本人所有或任一接收用户无效时整批回滚。分享仅授予使用权限，接收方不能修改、删除或转分享。个人模型的积分倍率由服务端管理，创建时为 `1`。

Agent 模型列表包含 `ownership_type`（固定为 `system` / `user`）及 `user: {id, name, email}`。`ownership_type` 仅表示资源归属，分享不会改变它；自己的模型和别人分享的模型均为 `user`，通过 `user.id` 与当前用户 ID 的比较区分。管理员在用户侧创建的个人模型同样为 `user`。自己的用户模型返回 `shared_users: [{id, name, email}]`，未分享时为 `[]`；收到分享的用户模型返回 `creator: {id, name, email}`，不展示其他接收人。系统模型不返回这两个字段。分享范围或创建者展示信息变化会影响模型目录 ETag；撤销、删除后的新列表请求和代理调用会重新检查权限。

个人规则通过 `POST /api/v1/rules` 创建，`GET/PUT/DELETE /api/v1/rules/{id}` 仅供创建者维护，修改和删除需要 `If-Match`。个人规则仅创建者可用，分享和撤销接口遇到 `type=rule` 时整批返回 `400`；目录和详情不返回 `shared_users`，详情的 `grants` 固定为 `[]`。历史分享授权不再参与目录、资源解析或个人专家依赖校验，删除规则时一并清理。系统规则的授权与强制范围保持原有语义。

技能、规则、工具（Connector）和专家的管理详情及授权接口中，每条 `grants` 保留 `user_id`，并返回只读的 `user: {id, name, email}`；分组、全员授权或已删除用户的 `user` 为 `null`。停用用户仍保留展示信息，便于撤销授权。

个人技能、Connector 和专家的所有者目录及管理详情返回 `shared_users: [{id, name, email}]`，未共享时为 `[]`，排除已删除用户。接收方和系统资源目录不返回此字段；用户名或邮箱变化会更新所有者目录的 ETag。个人 Connector 共享后，接收方可发现和调用工具；独立认证仍使用接收方自己的凭证，不复制所有者凭证，也不开放连接的管理权限。无认证连接可直接使用；撤销后目录、图标、工具读取、认证和网关请求立即重新检查权限。

个人专家通过 `POST /api/v1/experts` 创建，`GET/PUT/DELETE /api/v1/experts/{id}` 仅供所有者维护，修改和删除需要 `If-Match`。创建需要 `name`、`prompt`，编辑只要求 `name`；省略其他字段保留原值。个人专家可引用自己可用的规则、技能和连接；分享不自动扩散依赖授权，引用创建者个人规则的专家在分享给他人后标记不可用；接收方没有系统规则或技能使用权限时清单同样标记不可用，且不能经专家路径下载未授权技能。系统专家保留固定系统规则、技能的委托读取语义。管理员可查看、治理删除个人专家，不能编辑、复制或调整其启用状态和共享范围。

系统和个人专家均不绑定模型，创建、编辑、详情和清单不再声明或返回 `default_model_id`；客户端应在会话层独立选择模型。模型的启停、删除和授权变化不影响专家可用性或资源清单版本。

可用列表仅下发启用的模型。上游地址和密钥不会下发给分享接收方；所有模型密钥都不在 API 响应中返回。管理员在 Agent 侧也需要得到分享才能使用他人的个人模型。

## 操作审计

`GET /api/admin/v1/audits` 仅管理员可访问，支持 `actor`、`ip`、`params`、`category`、`result`、`since`、`until`、`page` 和 `page_size`，返回 `{items, total, page, page_size}`。时间范围左闭右开，默认每页 20 条，最多 500 条。相同时间的记录按 ID 倒序稳定分页。

审计覆盖通过管理员鉴权的后台写请求，以及管理员密码登录和浏览器退出。OAuth 跳转及回调、Agent 日常请求和模型代理流量不在本次 HTTP 管理审计范围内；已有独立业务审计继续保留。未认证登录尝试的用户 ID 为空，认证成功后保存真实用户快照。

已有事务内业务审计继续与变更原子提交，并通过服务端生成的 `request_id` 关联请求；完成时补齐脱敏参数和 HTTP 结果。没有事务审计或事务已回滚时补录请求事件，批量操作保留每个目标的事件。后置补录失败会记录带请求 ID 的服务日志，不改变已返回的业务结果；此机制不能保证数据库不可用或进程在业务提交后崩溃时仍保存补录事件。

请求参数采用字段白名单，密码、密钥、凭证、Header、OAuth Token、URL、内容正文及未知配置默认脱敏。JSON 捕获最多 64 KiB，超限、无效 JSON 和上传文件仅记录省略标记；失败原因只保存标准 HTTP 状态说明。来源 IP 取实际连接地址，不信任任意转发头；部署在反向代理后时显示代理地址。历史记录中未采集的 IP、请求 ID 等字段展示为空。


## 资源所有者

模型、规则、技能、Connector 和专家的公开回包统一使用 `user: {id, name, email}`，移除 `owner_user_id` 和 `owner_name`。系统资源的 user 表示创建者，个人资源表示所有者。客户端使用 `ownership_type` 和 `user.id` 判断归属；姓名或邮箱变化会更新资源目录版本。数据库归属外键继续用于服务端权限校验。

凭证响应（含 `credentials` 和管理端工具上下文）也使用 `user: {id, name, email}`，不再返回 `user_id`。这里是凭证所属的平台用户，不是 Connector 所有者或上游 OAuth 账户；集中凭证返回 `user: null`。Connector、凭证和专家解析均移除 `tools_path`，直接读取返回的 `tools`；单独查看工具或测试仍可请求下述 REST 接口。

## MCP 代理

API Key 通过全局 `POST /api/v1/api-keys` 创建，负责认证调用用户及 `mcp:invoke` scope；代理地址指定连接和凭证，服务端据此校验用户的实际访问权限。所有 MCP 代理地址以 `/mcp` 为前缀：

| 认证模式 | 代理地址 |
| --- | --- |
| 免认证 | `/mcp/connectors/{id}` |
| 集中认证 | `/mcp/connectors/{id}/credentials/{credential_id}` |
| 独立认证 | `/mcp/connectors/{id}/credentials/{credential_id}` |

集中和独立认证的每份凭证都有独立地址；认证连接省略凭证 ID 时返回 `400 credential_selection_required`。集中凭证仅供有该连接使用权的用户调用，独立凭证还必须属于调用用户。免认证仍需平台 API Key 和连接使用权。请求 `/mcp` 返回 404。

`GET /api/v1/connectors`、专家清单和资源 resolve 提供工具及 `mcp_gateway`。独立连接的每份 `credentials` 各自提供网关，resolve 选定后返回到连接对象；集中连接返回当前集中凭证的 ID 和地址。需要重新认证的凭证不下发可调用网关。示例：

```json
{
  "url": "https://monkeyai.example/mcp/connectors/<connector_id>/credentials/<credential_id>",
  "transport": "streamable_http",
  "authentication": "api_key",
  "required_scope": "mcp:invoke"
}
```

创建调用密钥使用登录后的 MonkeyAI OAuth access token，无需传入连接、凭证或工具绑定：

```http
POST /api/v1/api-keys
Authorization: Bearer <MonkeyAI access_token>
Content-Type: application/json

{
  "name": "Agent 调用",
  "scopes": ["mcp:invoke"],
  "expires_in_days": 90
}
```

返回 201，`api_key` 原文仅本次返回。同一个 Key 可以访问当前用户有权使用的多个凭证地址，更换凭证只需切换地址。`GET /api/v1/api-keys` 返回元数据；`POST /api/v1/api-keys/{keyID}/rotate` 返回同名、同 scope 的新密钥并撤销旧密钥。需要同时调用模型时，scopes 增加 `model:invoke`。

每次请求校验密钥、用户状态、连接使用权、地址对应凭证的归属及有效性。撤销资源分享、凭证或密钥会阻止后续请求。凭证撤销后，即使同一连接创建了新凭证，旧地址仍失效；不会自动切换凭证。更新或重新授权保留同一个凭证 ID，更新后需同步工具目录。上游地址、Header 和 OAuth Token 留在服务端，进入 MonkeyAI 的 API Key 不转发给上游。

客户端按返回的网关地址注册 Streamable HTTP MCP Server，可为多个地址复用同一个 Key。握手示例：

```http
POST /mcp/connectors/<connector_id>/credentials/<credential_id>
Authorization: Bearer <调用密钥>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"agent","version":"1"}}}
```

随后发送无 ID 的 `notifications/initialized`，再使用 `tools/list` 和 `tools/call`。后续请求携带协商得到的 `MCP-Protocol-Version`。`tools/list` 仅返回地址对应凭证下当前启用的工具，`tools/call.params.name` 使用该列表返回的上游原始工具名。不同凭证可拥有同名工具，由 URL 区分；客户端自行管理多个 MCP Server 的命名空间。列表不接受非空分页游标；调用参数和有效结果保留原始数值精度、`_meta` 和 `structuredContent`。

专家工具允许/排除列表用于生成专家资源清单，由 Agent 按清单挂载工具。代理校验用户的连接和凭证访问权及实时工具启停状态；请求中没有专家身份上下文，专家清单的过滤不构成代理授权边界。

用户自定义 MCP（`ownership_type: user`）成功执行连接测试后，发现的工具自动启用，可直接从 Agent 目录和 MCP 代理读取及调用。系统 MCP 的新工具仍需管理员启用；重复发现保留其启停与积分配置。

入口为无状态 Streamable HTTP：POST 返回 JSON，通知返回空的 202，GET/DELETE 返回 405；不产生下游 `Mcp-Session-Id`，不提供主动推送、resources、prompts 或 sampling/elicitation。上游支持 HTTP POST 的 JSON/SSE 响应，每次调用独立握手并在结束后发送 DELETE 清理上游会话；不支持旧版 GET SSE 传输、跨调用上游会话状态或本地 stdio 进程。非空 Origin 必须与 `MONKEYAI_PUBLIC_URL` 同源。

工具调用可携带 `X-Session-ID` 关联本人工作会话，或 `Idempotency-Key` 避免重复执行；重复请求返回 409 和原 `X-Billing-Transaction-ID`。集中认证仅成功调用收费，独立认证和免认证只记录调用。JSON-RPC 错误或 `isError=true` 释放预留；超时、断流、无效结果保持未知状态供核查，不自动重放。上游 JSON/SSE 响应限制为 4 MiB，请求体限制为 1 MiB。

协议错误使用 JSON-RPC 数字错误码；权限、额度等业务错误保留 HTTP 状态，并在 `error.data.code` 中提供业务错误码。上游内部错误详情不直接返回，使用 `X-Billing-Transaction-ID` 查询交易。生产 Nginx 和本地 Vite 已将 `/mcp` 前缀的全部请求转发到后端。

## MCP OAuth 回调

OAuth MCP 创建、详情和管理列表响应提供 `callback_url`，格式为 `{MONKEYAI_PUBLIC_URL}/oauth/connectors/{id}/callback`，其中 `id` 为 Connector 实例 ID。非 OAuth 连接返回空字符串。创建后将此完整地址登记到第三方 OAuth 应用；每个 Connector 使用自己的地址。

`POST /api/admin/v1/connectors/{id}/oauth/authorizations`（集中认证）或 `POST /api/v1/connectors/{id}/oauth/authorizations`（独立认证）请求体为 `{"name":"凭证名称"}`，生成带 state 和 PKCE 的授权 URL，`redirect_uri` 与 `callback_url` 一致。浏览器回调无需登录凭据，服务端核验路径 id、state、事务有效期、发起人权限和配置版本，单次消费后交换 Token，并按集中或独立认证上下文保存。成功页面提示返回 MonkeyAI，发起端通过授权事务状态接口查询结果。

原有 OAuth 应用需将统一的 `/oauth/connectors/callback` 更新为各 MCP 的专属地址，再重新发起授权。


## Connector 多凭证

独立认证连接目录返回当前用户的 `credentials`，每份包含名称、认证状态、测试状态、工具目录和以 `/mcp` 开头的专属凭证网关。连接本身不合并目录，也不返回隐式网关。凭证不包含上游账户身份，名称由用户填写，不获取 `sub` 或 UserInfo。

- 添加 Header：`POST /api/v1/connectors/{id}/credentials`，提交 `name` 和 `http_headers`，返回 `201` 和凭证 ETag。保存后单独 `POST .../credentials/{credential_id}/test`；失败保留已保存凭证。
- 改名/替换：`PATCH .../credentials/{credential_id}`，携带凭证 `If-Match`。未提交 Header 时保留原值，提交时整组替换并失效原目录。Header 值只写不读。
- 重新授权：`POST .../credentials/{credential_id}/oauth/authorizations`，携带凭证 `If-Match`；只替换此 ID。添加 OAuth 每次成功产生新 ID，不按用户或 Token 去重。
- 查询授权：`GET /api/v1/connector-authorizations/{id}`，状态为 `pending/processing/succeeded/failed/expired`；成功返回 `credential_id`，随后测试并同步工具目录。只有发起人可以查询。
- 撤销：`DELETE .../credentials/{credential_id}`，携带凭证 `If-Match`；后续调用及旧回调不能恢复该凭证。自动刷新不改变人工 revision。

集中凭证使用同样的管理端路径 `/api/admin/v1`，每个连接最多一份未撤销凭证。管理员从 `/connectors/{id}/tool-contexts` 选择系统连接的具体工具上下文，不能代用户编辑独立凭证或发起测试。

专家使用 `connectors: [{connector_id, required, tool_allowlist, tool_denylist}]` 直接声明依赖。解析请求示例：

```json
{
  "expert_id": "专家 UUID",
  "connector_ids": ["额外连接 UUID"],
  "connector_bindings": {"独立连接 UUID": "凭证 UUID"}
}
```

`connector_bindings` 只为已选连接指定凭证。未绑定时恰好一份可用凭证才自动选择；零份返回认证问题，多份返回 `credential_selection_required`。显式绑定失效时拒绝，不替换其他凭证。调用端为会话保存返回的 `credential_id`，使用响应中的 `mcp_gateway.url` 和全局调用密钥注册 MCP Server；重新授权后同步目录。一次会话对同一 Connector 绑定一份凭证。

旧单数 `/credential` 和 Provider 路由已删除。独立认证使用无凭证的连接级工具/测试接口返回 `400 credential_selection_required`。版本竞争沿用 `412 revision_conflict`，缺少 If-Match 返回 `428`。幂等摘要包含实际凭证 ID，同键用于其他凭证返回冲突。部署顺序见 [迁移说明](../../design/connector-migration.md)。

## 单个连接的测试与工具查看

资源卡片菜单使用登录 access token，不需要创建代理调用密钥。这些 REST 路径保留连接和凭证 ID：

| 操作 | 独立认证 | 免认证 | 集中认证 |
| --- | --- | --- | --- |
| 测试连接 | `POST /api/v1/connectors/{id}/credentials/{credential_id}/test` | `POST /api/v1/connectors/{id}/test` | 管理员 `POST /api/admin/v1/connectors/{id}/test` |
| 查看工具 | `GET /api/v1/connectors/{id}/credentials/{credential_id}/tools` | `GET /api/v1/connectors/{id}/tools` | `GET /api/v1/connectors/{id}/tools` |

独立认证有多份凭证时，界面先明确选中一份。团队/个人分区表示资源归属，路径根据 `authorization_mode` 选择。集中认证不向普通用户开放测试操作，界面应隐藏或禁用该菜单。

测试执行上游握手及工具发现，成功返回：

```json
{"credential_id":"选中凭证 UUID","connection_status":"connected","tool_count":2}
```

免认证的 `credential_id` 为空字符串。上游测试失败返回 502 和脱敏错误，凭证仍保留，最近测试状态记录为 error。查看工具仅读取已发现目录，返回 `{"items":[...]}`；每项包含 `id`、上游 `name`、`description`、`input_schema`、`enabled` 和 `credits_per_call`。

MCP Inspector 等标准 MCP 客户端单独调试时，复用全局创建的 `mcp:invoke` API Key，选择 Streamable HTTP，地址填写选中凭证的 `mcp_gateway.url`，Header 配置为 `Authorization: Bearer <api_key>`。更换凭证时切换地址，Key 可以继续使用。按上面的握手流程连接后，`tools/list` 仅返回该地址下可用的工具，`tools/call` 使用列表返回的工具名称。`ping` 仅检查网关是否响应，`tools/list` 读取已发现目录；验证上游可达性和刷新目录仍使用 REST `/test`。
