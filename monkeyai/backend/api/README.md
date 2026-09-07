# API

OpenAPI 源文件按调用方分为 `admin.yaml` 和 `agent.yaml`。管理后台接口统一维护在 `admin.yaml`，工作 Agent 接口统一维护在 `agent.yaml`，不再按业务模块拆分或生成合并文档。

每个接口必须声明请求体、成功与错误响应、响应 JSON Schema，并为字段补充类型、约束和说明；不能只记录状态码和响应描述。契约字段以实际 HTTP DTO 为准，密钥等不返回的敏感字段需要明确说明。

## 用户模型与分享

以下接口均使用 Agent OAuth access token：`Authorization: Bearer <access_token>`，完整契约见 `agent.yaml`。模型代理调用仍使用独立的调用密钥。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/v1/users?q=<用户名或邮箱>&limit=20` | 查找有效接收用户，返回 `users: [{id, name, email}]` |
| `GET /api/v1/models` | 获取可用模型，结构与 `/api/v1/config` 的 `models` 一致 |
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

Agent 配置和模型列表新增 `ownership_type`（固定为 `system` / `user`）及 `owner_user_id`。`ownership_type` 仅表示资源归属，分享不会改变它；自己的模型和别人分享的模型均为 `user`，通过 `owner_user_id` 与当前用户 ID 的比较区分。管理员在用户侧创建的个人模型同样为 `user`。自己的用户模型返回 `shared_users: [{id, name, email}]`，未分享时为 `[]`；收到分享的用户模型返回 `creator: {id, name, email}`，不展示其他接收人。系统模型不返回这两个字段。分享范围或创建者展示信息变化会影响配置 ETag；撤销、删除后的新配置请求和代理调用会重新检查权限。

可用列表仅下发启用的模型。上游地址和密钥不会下发给分享接收方；所有模型密钥都不在 API 响应中返回。管理员在 Agent 侧也需要得到分享才能使用他人的个人模型。
