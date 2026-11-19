# internal/relay/

> L2 | 父级：[MonkeyAI 后端上下文](../../CONTEXT.md)

relay 为运行端发布控制和数据通道，按设备和连接代次向桌面代理请求。控制就绪或收到有效 Pong 后，路由有 45 秒的存活窗口。路由关闭时，用 `relay.route.closed` 的 `machine_id`、`boot_id`、`lease_epoch`、`reason` 和 `last_seen_age_ms` 对照执行端日志。EOF 只能说明本端观察到连接关闭。

## 实现

- `service.go` 注册 HTTP 入口，维护路由与服务生命周期，按通道配置 yamux，按代次记录首次关闭并释放访问。
- `bridge.go` 校验设备身份与握手证明，发布控制路由，按当前代次附着数据通道。
- `lease.go` 签发与续验访问租约，推送撤销及控制事件。每 15 秒探测，允许两次 Ping 同时等待应答，按最近有效 Pong 判定失联。
- `directory.go` 组合授权设备与存活路由，生成分页设备目录及运行状态。
- `connection.go` 校验业务权限，签发、轮换连接票据并更新访问版本。
- `proxy.go` 检查来源、路由与票据，向运行端转发 ACP、HTTP 和终端流量。
- `stream.go` 打开代理流，约束取消后的资源回收，复制和计量双向流量。
- `budget.go` 分配数据与终端流名额，记录占用与释放。
- `terminal.go` 验证终端 WebSocket 升级和响应，协调终端连接接管。
- `file.go` 校验独立文件授权并转发读写请求。
- `preview.go` 为产物分配隔离来源，校验预览地址和凭据后转发内容。
- `identity.go` 读取或持久化服务端身份和签名材料。
- `signing.go` 加载和校验密钥，生成及验证签名信封。
- `protocol.go` 定义隧道握手、签名输入和协议版本校验。
- `query.sql` 定义设备连接、票据轮换、撤销及清理查询。
- `sqlc/` 保存由 SQL 生成的访问层。`testdata/` 保存跨端设备证明向量。

## 回归

- `fixture_test.go` 以隔离 PostgreSQL schema、真实 WebSocket 与 yamux 构造设备和桌面连接。
- `heartbeat_test.go` 验证原路由在漏回一次 Pong、Pong 迟到或开流 ACK 迟到后恢复。另测过期路由回收和旧代次隔离。
- `control_test.go` 验证持续失联、反向控制流限额、事件写超时与同代次数据重连。
- `cleanup_test.go` 验证并发回收只记一次关闭原因，超时可识别。设备与桌面共用授权时，整条路由只发一次撤销通知。
- `relay_test.go` 验证票据、授权、文件和代理，覆盖租约宽限、代次切换与通道隔离。
- `interop_test.go` 验证桌面来源、票据权限、长连接空闲、签名租约与独立撤销。
- `audit_test.go` 验证控制握手保存的客户端地址。
- `browser_test.go` 为浏览器验收提供隔离产物预览环境。
- `budget_test.go` 验证数据流和终端名额在接管、超时和并发释放时的计数。
- `directory_test.go` 验证分页设备快照的一致性。
- `identity_test.go` 验证服务端身份跨进程持久化及密钥加载失败时的行为。
- `logging_test.go` 验证日志过滤后仍包含代理预算与传输计数。
- `nginx_test.go` 验证 Nginx 转发设备与桌面连接。
- `origin_test.go` 验证 HTTP 来源与公网、内网接入规则。
- `preview_test.go` 验证产物预览绑定来源与授权，隔离浏览器环境。
- `previewtls_test.go` 验证预览域名经 Nginx 与 TLS 接入。
- `protocol_test.go` 核对协议版本及跨端证明向量。
- `signing_test.go` 验证签名信封、长度边界与密钥用途隔离。
- `stream_test.go` 验证取消开流后，迟到的流和名额均能回收。
- `terminal_test.go` 验证终端升级请求与运行端响应。
- `terminalbudget_test.go` 验证数据通道满载时的终端接管和授权复核。
- `terminallifecycle_test.go` 验证票据续期、撤销和隧道中断时的终端生命周期。

[PROTOCOL]: 变更时更新此头部，然后检查 guidelines.md
