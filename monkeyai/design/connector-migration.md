# Connector 迁移与接入

本次迁移为 `000012_mcp_connector_credentials`。后端、管理前端与 Agent 契约须同时切换；生产数据库尚未在本任务中执行迁移。

## 升级步骤

1. 备份数据库及其引用的对象存储数据，暂停旧版本写入和 OAuth 回调。
2. 在当前旧数据库执行只读预检查：`psql "$MONKEYAI_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/connectorcheck.sql`。报告输出专家、原 Provider、合法候选和 `ready / missing_connector / ambiguous_connector`，不会改表。
3. 只有一个候选时自动迁移。零候选时先修复连接配置/启停及资源授权；多候选时提供明确映射，不能选择用户无权使用的个人连接。映射格式如下，所有 ID 均为真实 UUID：

```json
{"专家 ID":{"原 Provider ID":"选择的 Connector ID"}}
```

4. 将映射作为 PostgreSQL 会话设置 `monkeyai.connector_mappings` 传入执行迁移的连接。使用 migrate CLI 时可以把下列脚本保存在部署环境执行，`CONNECTOR_MAPPINGS_FILE` 指向 JSON 文件；没有歧义可以直接沿用原 migrate 命令。

```python
import json, os, subprocess
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

parts = urlsplit(os.environ["MONKEYAI_DATABASE_URL"])
with open(os.environ["CONNECTOR_MAPPINGS_FILE"]) as file:
    mapping = json.dumps(json.load(file), separators=(",", ":"))
query = dict(parse_qsl(parts.query))
query["options"] = (query.get("options", "") + " -c monkeyai.connector_mappings=" + mapping).strip()
dsn = urlunsplit(parts._replace(query=urlencode(query)))
subprocess.run(["migrate", "-path", "migrations", "-database", dsn, "up"], check=True)
```

5. 迁移成功后再启动新后端及管理前端，更新 Agent 的认证、解析和网关接入。已进行中的旧授权事务结束为失败，用户重新发起授权。
6. 核对连接/凭证/工具历史 ID、专家映射、停用状态、集中凭证、个人凭证目录和计费记录。先在备份副本完成演练，再切换正式环境。

迁移在单个事务内检查映射和转换。映射不全会输出候选及原因并回滚。migrate 可能已经记录 dirty 版本；只有确认事务回滚、仍为旧结构后，才将迁移版本恢复到执行前版本并重试，不能直接强制标记新版本成功。

## 数据处理

保留现有连接、凭证、工具 ID 和历史引用；保留实例 URL/OAuth 配置，复制旧图标引用并继承 Provider 的停用状态。工具和凭证按具体 ID 隔离，同名凭证可以并存。原独立凭证命名为“原有凭证”，测试状态初始化为 unknown。旧无效/撤销认证不会迁移成有效认证，认证方式不匹配的秘密会清除。

部分唯一索引只限制每个连接一份未撤销的集中凭证。工具增加 `(credential_id, connector_id)` 外键校验，防止跨连接引用。共享图标不立即删除；后续清理仍检查全部连接引用和备份窗口。

## 回滚

`down` 主动拒绝有损回滚。新版本产生多凭证后不能恢复旧单凭证唯一约束；需要恢复完整数据库和对象存储备份，或先另行制定不会丢凭证的数据归并方案。

## 验证范围

本地使用独立 PostgreSQL schema 与专用 RustFS Bucket 验证全量迁移、旧数据多候选阻断、显式映射、禁用/图标/ID 保留、重复凭证、新旧 API、用户共享撤权、OAuth 与 Header 认证、工具隔离、会话选择和跨凭证幂等。真实第三方应用的回调登记和 Scopes 需要在部署环境完成。

Desktop/OhMyAgent 的 MCP 加载器不在本仓库实现范围内。后端已提供完整目录、resolve、认证和凭证网关契约，消费端必须保存 resolve 返回的绑定，不能继续调用旧隐式网关。

## 凭证地址与回包接入

全局 API Key 无需绑定连接或凭证；现有有效且具备 `mcp:invoke` 的 Key 可继续使用。集中和独立认证改用 `/mcp/connectors/{id}/credentials/{credential_id}`，免认证使用 `/mcp/connectors/{id}`。客户端使用目录或 resolve 返回的 `mcp_gateway.url`，不自行猜测凭证。集中认证原连接级地址也必须切换至返回的凭证地址。

不同凭证的工具通过地址隔离，MCP 工具名称直接使用上游名称。单连接测试与工具查看的 REST 路径不变。

所有公开资源响应的 `owner_user_id`、`owner_name` 替换为 `user: {id, name, email}`，前端和 Agent 按 `user.id` 判断归属。数据库原归属字段不改名，权限仍由服务端验证。凭证元数据同样将 `user_id` 替换为 `user` 对象，集中凭证返回 `null`；Connector、凭证和专家解析不再返回 `tools_path`，客户端直接消费 `tools`。
