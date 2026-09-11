# Connector 初始化与接入

当前数据库已收敛到 `000001_initial_create_schema`，直接创建连接、多凭证与专家连接关系。原 `000012` 增量转换及 Provider 映射预检查已移除。后端、管理前端与 Agent 契约须使用同一发布版本。

## 部署步骤

1. 为本次重新部署准备全新的 PostgreSQL 数据库或数据目录。旧库如需保留数据，应先另行设计并演练数据迁移，不能直接执行本初始化版本或强制改版本号。
2. 执行初始化迁移，确认 `version=1, dirty=false`，再次执行返回 `no change`。具体命令见 [数据库迁移说明](../backend/migrations/README.md)。
3. 启动同版本后端及管理前端，配置连接、资源授权与专家依赖，由用户创建凭证或发起 OAuth 授权。
4. 更新 Agent 的目录、resolve、认证和凭证网关接入，验证凭证隔离、共享撤权和工具调用。

`down` 会删除全部业务数据，仅用于可丢弃测试库的重建验证。此轮未操作现有部署数据库。

## 数据约束与验证

同一用户在同一连接下可持有多份同名凭证；部分唯一索引限制每个连接最多一份未撤销的集中凭证。工具通过 `(credential_id, connector_id)` 外键避免跨连接引用。专家直接关联 Connector，不再创建 Provider 或依赖映射。

本地集成测试覆盖完整初始化与回滚、重复凭证、集中凭证唯一性、跨连接工具外键、新 API、用户共享撤权、OAuth 与 Header 认证、工具隔离、会话选择和跨凭证幂等。真实第三方应用的回调登记和 Scopes 需要在部署环境完成。

Desktop/OhMyAgent 的 MCP 加载器不在本仓库实现范围内。后端已提供目录、resolve、认证和凭证网关契约，消费端必须保存 resolve 返回的绑定。

## 凭证地址与回包接入

全局 API Key 无需绑定连接或凭证；现有有效且具备 `mcp:invoke` 的 Key 可继续使用。集中和独立认证改用 `/mcp/connectors/{id}/credentials/{credential_id}`，免认证使用 `/mcp/connectors/{id}`。客户端使用目录或 resolve 返回的 `mcp_gateway.url`，不自行猜测凭证。集中认证原连接级地址也必须切换至返回的凭证地址。

不同凭证的工具通过地址隔离，MCP 工具名称直接使用上游名称。单连接测试与工具查看的 REST 路径不变。

所有公开资源响应的 `owner_user_id`、`owner_name` 替换为 `user: {id, name, email}`，前端和 Agent 按 `user.id` 判断归属。数据库原归属字段不改名，权限仍由服务端验证。凭证元数据同样将 `user_id` 替换为 `user` 对象，集中凭证返回 `null`；Connector、凭证和专家解析不再返回 `tools_path`，客户端直接消费 `tools`。
