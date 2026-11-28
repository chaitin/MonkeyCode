# internal/endpoint/

> L2 | 父级：[项目地图](../../../../guidelines.md)

endpoint 保存用户的设备登记，提供设备目录和消息桥接。执行设备通过 relay 发布控制通道时，relay 从本模块读取设备公钥、授权版本和租约代次。查询无记录时返回 `device_not_found`。其他查询错误原样返回，只有读到设备记录才解析其协议字段。

## 实现

- `admin.go` 按管理员可见的成员范围查询设备列表和概况。
- `connection.go` 读写设备消息，限制待发送队列，定时探活并复核凭据。
- `execution.go` 读取执行状态，在设备登记、发布与撤销的事务内更新版本并核验授权。
- `handler.go` 暴露 Agent 设备目录、变更和 WebSocket 接入入口。
- `names.go` 合并设备别名、独立运行端名称与登记名称，确定目录展示名。
- `observe.go` 汇报桥接连接、队列、流量及凭据检查计数。
- `postgres.go` 读写设备登记与分页目录，提交设备变更并协调执行授权撤销。
- `protocol.go` 校验桥接消息和设备 hello 的字段、标识及边界。
- `query.sql` 定义设备登记、状态查询、版本更新及管理端统计所用的 SQL。
- `register.go` 解析并校验设备自注册请求，按用户限制登记频率。
- `service.go` 维护每用户设备状态，广播目录、路由设备消息并排空连接。
- `sqlc/` 保存根据 SQL 生成的查询入口和行类型。

## 回归

- `admin_test.go` 核对管理员设备清单的筛选、可见范围和统计。
- `connection_test.go` 检查并发队列边界、连接替换、消息路由和用户状态回收。
- `contract_test.go` 对照 Agent OpenAPI 文档检查设备入口。
- `endpoint_test.go` 提供隔离的 PostgreSQL 与 WebSocket 夹具，验证路由、连接替换、凭据撤销和登记审计。
- `execution_test.go` 覆盖连接池及事务读取失败、绑定、发布、并发登记、接管和撤销恢复。
- `i18n_test.go` 核对设备错误码使用的共享翻译。
- `lifecycle_test.go` 检查来源、凭据轮换、存储故障、超时、探活及消息上限。
- `names_test.go` 检查独立运行端设备的显示名称。
- `protocol_test.go` 验证消息和 hello 的校验、响应序列化、连接错误和回滚日志。
- `proxy_test.go` 加载生产 app.conf，将设备请求指向测试后端，验证 WebSocket 升级后能收到设备目录。
- `register_test.go` 检查设备注册参数、平台、频率限制和登记数量。
- `unlimited_test.go` 验证执行设备登记不设数量上限。

[PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
