# 2026-10-16 远程执行互通修复与验证

服务端修改基线：`522557cee23b7b44dd9932a12ee93743721f96af`。实现后已 rebase 到 `origin/main` 的 `b16b28fea`，无冲突；rebase 后再次通过 make check、真实数据库 relay/endpoint/migrations 竞态回归及 App + RustFS 集成。依据为同日更新的 `REMOTE-RUNTIME-BACKEND-FIXES.md` 五组剩余问题。用户提供的客户端测试基线为 `4eb858b1`；本工作区未提供对应源码、共享访问/文件向量或实际 runtime 发行物。本记录中的集成测试使用本仓 HTTP/yamux 执行端夹具，不能替代真实客户端及 Mac/Windows UI 验收。

## 修复范围

- 代理默认允许 `app://monkeyai` 与部署 origin，开发来源及端口通过 `MONKEYAI_RUNTIME_DESKTOP_ORIGINS` 显式配置；未知来源仍拒绝。消费 `monkeyai.token.<ticket>`，仅转发和回选 `monkeyai.v1`，业务 URL/Host 使用 `device.internal`。
- 补齐会话、配置、交互、资源写入、MCP 和 PUT/HEAD 上传的路径/权限矩阵，资源写入同时检查两项权限。CORS 保留上传会话及 MCP 状态头，正文/资源写入响应头等待分别为 150/225 秒。
- 租约请求使用完整 authorization 严格解码，逐项核对数据库身份、版本和 scopes；响应绑定 nonce、递增序号、boot 和 epoch。require_fresh 不允许故障宽限，已知失效返回签名撤销。断言和租约时间显式输出 UTC Z。
- 移除旧二进制控制分支和旧 Signed 对象编码。内部 HTTP 通过 net/http 处理，反向流并发上限 16，请求头/完整请求/事件写入期限分别为 5/10/5 秒。每 15 秒主动 Ping，收到 Pong 才更新存活观测；写入和回应均有期限。事件流结束回收对应 epoch。
- DELETE 在同一数据库事务内按 registration_version 检查 If-Match，过期请求 412，同一次删除幂等；恢复再次推进登记代次。HTTP 和 NDJSON 撤销均使用统一签名字符串，身份/boot/epoch/connection/access_version 为顶层字段。握手错误仅包含 type/code。
- 独立 fg1 不用缺省为零的 ticket_version 拒绝新文件授权；保留完整 access_version/scopes/grant/epoch 校验。路径仅解码一次，允许字面百分号，拒绝编码分隔符和遍历。token/载荷上限分别为 12/8 KiB，文件签发偏差与发现统一为 5 秒，数据库故障与已知拒绝区分。
- 多页快照按完整筛选结果和冻结路由视图计算内容摘要，再分页；101 条跨页读取、页间变更识别、空目录和筛选外记录隔离已验证。协议版本上限固定 65535，首次省略 scopes 时只授予已批准业务权限。
- 使用 sqlc 工具重新生成登记恢复查询；修复权限版本 down SQL 在目标表已删除时的重复回滚。

## 实际执行的验证

使用本次创建的隔离 PostgreSQL 18.6 和 RustFS 容器，未连接 115 或业务数据库。

| 检查 | 结果与限制 |
| --- | --- |
| OpenAPI / Compose YAML | 解析及 OpenAPI 内部引用通过；没有新增公开控制接口 |
| `make check` | 全量普通 Go 测试、go vet、schema/sqlc 一致性通过；该命令不配置数据库，数据库结果单独记录 |
| relay / endpoint / migrations，配置真实 PostgreSQL | 模块测试通过；没有依靠缺少 DSN 跳过中转、设备及迁移用例 |
| relay / endpoint / migrations，`-race` | 通过；95 秒空闲测试已另行执行，不重复长时间等待 |
| identity，配置真实 PostgreSQL，`-race` | 通过；设备码测试夹具按数据库时间对齐宿主时钟，生产设备码逻辑不变 |
| `TestRuntimeRelayApplication`，真实 PostgreSQL + RustFS | 真实 App 路由、绑定、目录、鉴权、条件删除及撤销后补传通过 |
| `TestDirectoryFullSnapshotAcrossPages` | 101 条分两页保持相同完整版本；页间最后在线资料变化产生新版本；空目录和筛选外资料记录不会造成混合视图 |
| `TestHTTPDataReattachStatus` | 数据通道断开后独立附着，控制 epoch 不变，status 重新返回 data_online=true |
| `TestDefaultTicketBusinessScopes` / `TestProtocolVersionBoundary` | 缺省票据只含业务权限，协议版本上限及嵌套身份严格字段通过 |
| `TestDesktopProxyOriginsRoutesAndCORS` | 安装版/显式 localhost Origin、子协议、业务 Host、完整读取路由、双权限资源写入、上传会话头及 CORS 通过 |
| `TestCompleteLeaseBindingAndFreshFailure` | 完整 HTTP 租约、重复序号拒绝、权限代次不匹配的签名撤销、require_fresh 数据库故障 503 通过 |
| `TestRelayLeaseGraceAndHardCutoff` | 既有访问在 90 秒核验故障时 grace；require_fresh 拒绝；181 秒硬截止关闭访问 |
| `TestHTTPControlIdleBeyond90Seconds` | 实际等待 95 秒后仍在线，data_online=true；事件流终止回收路由 |
| `TestControlBlackholeClosesRoute` | 接收 Ping 但不回 Pong 的黑洞在限定时间内回收 |
| `TestReverseHTTPBudgetAndReadDeadline` | 控制反向流超额拒绝，慢请求读取期限回收后其他控制请求可继续 |
| `TestSlowEventConsumerClosesOnlyEpoch` | 不读取事件的消费者触发写入期限并结束该 epoch |
| `TestTwoControllersRevocationKeepsOtherObserver` | 单个控制端退出，另一 ACP 观察者与整个执行端保持有效；检查 NDJSON 签名撤销结构 |
| `TestConditionalDeleteAndRestoreGeneration` | 迟到删除 412、重复删除幂等、恢复推进代次、恢复前版本不能撤销新登记 |
| `TestIndependentFG1PathsNarrowingAndDatabaseFailure` | 普通/中文空格/百分号文件 Range/HEAD、路径替换拒绝、收窄后的新授权、12 KiB token/8 KiB 载荷边界和数据库故障 503 |

本轮还保留固定证明签名向量、公钥轮换和统一访问签名信封的本仓回归。未取得客户端共享向量，因此不声称两仓同组向量验收通过。

## 尚需客户端环境完成

- 用 `4eb858b1` 实际 runtime 完成 bind/publish/attach，并读取真实原有会话与配置。
- 实际 Desktop Origin 下完成 ACP initialize/session/list、新建/发送/审批及上传 UI。
- 实际客户端的共享签名向量、Windows UI、休眠恢复和完整任务流程。
- 以上跨仓验证通过后，再按发布流程部署 115。当前代码推送与本仓测试不表示生产已部署或双机 UI 已验收。
