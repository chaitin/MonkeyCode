# 远程终端服务端实现与验收记录

日期：2026-10-20。实施依据：[服务端契约原文](remote-terminal-backend.md)，客户端契约基线 `160e8f98`。实现基于 MonkeyCode `5b5c3d91`，分支 `feat-remote-terminal`；本文件所在提交即实现提交，可用 `git log -1 -- monkeyai/design/remote-terminal-implementation.md` 获取。当前未部署，真实客户端验收未完成，默认不声明终端可用。

原文按交付时内容保存，其中 `REMOTE-*`、`BUILDING.md` 和 `apps/*` 等链接及路径属于客户端仓库。本仓基础协议见 [remote-runtime-protocol.md](remote-runtime-protocol.md)。

## 实现对应

| 契约 | 实现 |
| --- | --- |
| 发现布尔能力、分阶段开启 | `MONKEYAI_RUNTIME_TERMINAL_WS` 默认 false；与 `/proxy/terminal` 同一开关；保留既有发现字段；发现响应 no-store |
| GET、Upgrade、子协议、query | 独立终端握手校验；业务子协议必须恰好一个 `monkeyai.terminal.v1`；Bearer 与 token 子协议可同时提供但必须一致；重复凭据、额外协议、未知/重复/非法查询、歧义路径均拒绝 |
| 来源与身份 | 沿用安装版 `app://monkeyai`、公开 origin 和显式 Desktop 来源白名单；无 Origin 仍校验 ticket、账号、设备、授权族及 `session:control`；不接受 OAuth 替代 ticket |
| 数据通道路由 | `/terminal` 及规范化的 `?reattach=1` 独占数据 yamux 流；数据离线不回退 control；Host 固定 `device.internal` |
| 上下游凭据 | 清除 Authorization、Cookie、所有外部 `X-MonkeyAI-*`/`X-MAI-*` 及转发身份头，唯一注入既有签名访问断言；不转发 token 子协议；断言载荷最多 8 KiB、总编码最多 16 KiB |
| 上游 Upgrade | 在向客户端发出 101 前校验 Accept、Connection、Upgrade、精确业务子协议和无压缩扩展；不向 runtime 请求压缩；移除 Set-Cookie，响应 no-store；非 101 状态、正文和内容类型透传 |
| 统一数据预算 | 每个实际数据隧道实例一份预算，文件、预览、上传、MCP SSE 和终端均在开流前预留；常规数据 15、其中终端 8；额外候选 1；更换数据通道时创建新预算 |
| 候选转移 | 保留类别和一次性释放句柄；常规流释放后先提升候选；同时满足两个常规上限才转入；停止原定时器并立刻释放候选槽；候选失败不关闭旧流；不解析 attach 或终端身份 |
| 期限与开流取消 | 从请求进入起累计 8 秒的终端握手期限，成功响应后撤除；候选从预算预留起累计 5 秒，转常规后撤除；OpenStream worker 有独立上限，迟到流关闭前保留预算引用 |
| 关闭与背压 | 32 KiB 拷贝缓冲、256 KiB yamux 默认逐流窗口、1 MiB 外层消息限制；Upgrade 任一方向结束即退出；关闭前设置即时流期限，处理 yamux 半关闭，取消不遗留观察流 |
| 续票与撤销 | 沿用连接期限更新、access_version、实时租约、控制事件与 180 秒硬截止；正常续票不重建 socket；旧权限租约撤销仅关闭对应版本，并保持序号防重放 |
| 中转重启 | Shutdown 关闭访问和隧道，不发送表示设备授权被撤销的签名事件；runtime 可按网络故障重新连接；不发送终端 close、session/cancel 或进程终止请求 |
| 诊断 | 日志包含请求关联、账号/设备、boot/epoch、连接、授权版本、通道、候选请求、握手耗时、结束原因和剩余预算；不记录凭据或终端正文；独立诊断监听器提供 `/debug/relay` 指标 |

服务端保持 ACP 字节透明；四项 `_monkeyai/terminal/*` 方法不需要服务端方法白名单变更，不拼接 `_meta.terminal`，不新增表、ticket 类型、scope、PTY 实现或输入仲裁。终端 32 KiB 消息、16 KiB 数据块、ACK、业务心跳、控制权和 PTY 缓存边界由 runtime 校验。

## 配置与发布

默认配置：

```dotenv
MONKEYAI_RUNTIME_RELAY=true
MONKEYAI_RUNTIME_TERMINAL_WS=false
# 仅列实际开发来源，精确包含端口；安装版和公开 origin 已默认允许。
MONKEYAI_RUNTIME_DESKTOP_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

`MONKEYAI_PUBLIC_URL`、签名身份目录和文件 origin 沿用既有配置。Compose 已透传终端开关。HTTP 使用 WS，HTTPS 使用 WSS，不跨协议重试。

先部署关闭终端能力的实现；在隔离环境开启后，用真实客户端完成契约第 11 节及 11.1、11.2。全部可能承接数据通道的节点支持且验收通过后，统一设置 `MONKEYAI_RUNTIME_TERMINAL_WS=true` 并重启服务。发现中的增量应为：

```json
{"terminal_ws":true}
```

本仓中转当前仍采用单后端进程路由；多节点部署需先满足既有设备完整身份路由约束，不能仅通过统一能力配置实现跨节点寻址。没有新增负载均衡或路由基础设施。

实际线上来源白名单、发现响应、镜像版本和客户端版本必须随部署另行归档；本记录没有将示例地址当作部署证据。

既有 Nginx 设备代理规则已允许双向 HTTP/1.1 Upgrade，关闭请求/响应缓冲，读写空闲上限 30 分钟，超过 45 秒业务心跳失联窗口；子协议默认透传，代理路径关闭访问日志。额外网关同样需保持这些设置。发现由服务端返回 no-store；101 不缓存。

## 自动验证

环境：macOS arm64、Go 1.27.1；本次单独初始化 PostgreSQL 17 临时实例，仅监听 127.0.0.1:55439。RustFS `v1.0.0-rc.5` 使用独立临时容器和内存卷，Nginx `1.28-alpine` 使用独立临时容器。均不连接业务数据库、目标主机或现有对象存储。

| 检查 | 状态 | 证据与范围 |
| --- | --- | --- |
| 终端握手和路径单元测试 | 通过 | 同源双凭据、重复/缺失业务协议、重复凭据、非法 Origin、query 编码、路径分隔符/遍历、上游 Accept/协议/压缩拒绝 |
| 预算状态机竞态测试 | 通过 | 100 个并发准入只获得 8 个终端名额；五秒候选超时；同时满足两项配额才提升；幂等释放、迟到拨号不能复活已释放预算及旧预算隔离；虚拟时间下提升后超过原期限仍存活 |
| 迟到 OpenStream | 通过 | 实际 net.Pipe + yamux 阻塞开流，取消立即返回；迟到流关闭后才释放预算和 worker 槽 |
| 真实数据库与 HTTP/yamux 终端代理 | 通过 | 执行端夹具反向取得 require_fresh 租约；只走数据通道；过滤凭据与身份头；精确子协议；文本字节透明；上游 text/plain 错误保留 |
| 满额代理回归 | 通过 | 8 条终端 WS + 7 条实际保持的长 SSE，核实 15 条 yamux 流；普通/重复候选 429；第 16 条候选无附着五秒回收；新 socket 保持连接连续替换四次；最终全部指标归零 |
| 续票与撤销代理回归 | 通过 | 建连票据期限缩至两秒，续期后跨过旧期限和八秒握手期限仍可使用；收窄关闭已有终端，旧票据无宽限；grant/设备撤销、control/events/data 丢失、Shutdown 均回收 |
| 只读与故障准入 | 通过 | session:read 无法连接终端；OAuth/错误设备不能代替票据；数据库不可用时新候选返回 authorization_state_unavailable 且不分配流 |
| 全仓库竞态回归（含数据库/RustFS/Nginx） | 通过 | `go test -race ./... -count=1 -timeout=300s`，全部包通过；relay 168 秒，覆盖原有 95 秒控制空闲回归；Nginx 真容器验证终端业务子协议及双向字节流 |
| go vet、sqlc、OpenAPI/Compose 检查 | 通过 | `make check`（普通全量测试、go vet、schema/sqlc diff）；两个 OpenAPI 的 YAML 无重复键、内部引用完整；Compose YAML 可解析；迁移序号不冲突且 up/down 成对 |
| 应用接入与最后修改回归 | 通过 | 实际 App 发现接口保留 issuer/runtime_relay 并发布布尔 terminal_ws，响应 no-store；诊断指标只挂诊断监听器；签名 8 KiB 边界；针对性竞态回归及 go vet 再次通过 |

本次变基至 `origin/main` 的 `641efbe5a`，合并主干日志改造：保留服务端生成的 `X-Request-ID`、错误诊断和取消分类；终端流收尾事件沿用 DEBUG 级别，配额及指标使用日志组通过安全过滤。变基后 `make check` 和隔离 PostgreSQL 下的终端竞态回归通过，另验证终端响应不采用客户端或 runtime 伪造的请求关联 ID，以及日志过滤后仍保留终端路由和配额。此前全仓库真实依赖回归保留为上表的原始记录，本次未重复 RustFS/Nginx 全量集成。

首次配置数据库的全量测试因缺少 `MONKEYAI_S3_ENDPOINT`，四个 App 集成用例失败；随后补齐隔离 RustFS 环境并运行完整回归。该环境准备失败与最终验证结果分别记录，不计作通过。

可重复的核心命令（先设置隔离数据库与对象存储的测试环境变量）：

```sh
cd monkeyai/backend
go test -race ./internal/relay -run 'Test(Terminal|DataBudget|Candidate|CanceledOpen|DataOverload)' -count=1
go test -race ./... -count=1 -timeout=300s
make check
```

全量集成测试需要设置 `MONKEYAI_TEST_DATABASE_URL`、`MONKEYAI_S3_ENDPOINT`、`MONKEYAI_S3_ACCESS_KEY`、`MONKEYAI_S3_SECRET_KEY`、`MONKEYAI_S3_BUCKET`、`MONKEYAI_S3_REGION` 和 `MONKEYAI_S3_FORCE_PATH_STYLE=true`；Nginx 用例另设 `MONKEYAI_TEST_NGINX_IMAGE`。不设这些变量时部分用例会跳过，不能据此声称相应验收通过。

诊断端口默认 `127.0.0.1:6060`，`GET /debug/relay` 返回普通数据流、普通终端流、候选流、429、候选超时/提升、开流失败、撤销关闭及两个方向的累计字节；字节统计包含 yamux 内 HTTP 握手。此接口仅挂在已有诊断监听器，不公开到业务 API。需要逐流诊断时设置 `MONKEYAI_LOG_LEVEL=debug`；流收尾日志还记录每个流所属预算的剩余计数，跨新旧数据通道的进程指标可能同时包含两个实例。

## 真实 runtime 验收矩阵

以下状态均为**未测**：本工作区没有客户端 `160e8f98` 的源码/可执行探针、已授权的隔离执行设备、测试会话和 Mac/Windows/Win7 双机环境。上述夹具实现只验证中转与授权，不实现 PTY、终端帧校验、viewGeneration 或 xterm，因此不替代下列验收。

| 原文场景 | 需要补充的真实验证 |
| --- | --- |
| 能力开关与发现恢复 | 缺失/false/true、撤回/恢复、files_origin 改变后 initialize 和可信文件来源刷新；已有 shell 保留 |
| 正常使用与多端 | initialize/get/open/attach/input/resize/close；命令与文件落在目标原工作目录；claim 后旧端写入被拒 |
| 普通重连、只读、身份与来源 | 窗口隐藏/关闭/断网、不同账号/grant、observe 只读拒绝、安装与开发 GUI 实际 Origin |
| 通道隔离、续票、权限收窄与撤销 | 目标 shell 保留，原 runtimeInstanceId/terminalId 恢复；控制/data 独立故障，正常换票不重建；撤销不发送 close |
| 授权核验故障 | 30/90/180 秒实际故障；新流拒绝，已有终端不超过最后成功核验后 180 秒或当前已确认票据期限 |
| 慢观察者与输出 | 停止消费/ACK 有界断开；其他观察者不受影响；中文、emoji、分块 UTF-8、Vim/top 显示和尺寸 |
| runtime 与中转重启 | runtime 重启生成新实例且不自动建替代 shell；仅中转重启保留原 shell 并重建隧道；旧 epoch 不污染新数据通道 |
| 资源与满额 11.1 | 两个终端各四个真实附着+七条慢流；错误 viewId、view_expired、旧代次、不发 attach、丢确认、延迟回调及连续替换至少三次；收窄后重新授权再占满 15 条 |
| 校准负载 11.2 | 同设备 64 MiB 上传/下载+SSE+PTY；记录空载/负载 P95、内存、goroutine、连接数；100 Mbps、RTT 50±5 ms 下对照 +200 ms/150 ms 基线 |
| 双机平台 | Mac 控制现代 Windows、Windows 控制 Mac、Win7 作为目标/控制端约定场景；实际 PTY 后端与默认 shell |
| 现成客户端探针 12.2 | 使用隔离 empty/slotRevision=0 会话，临时 ticket 配置 stdin 输入 integration.ts；核对 marker 文件存在、旧控制者文件不存在；临时凭据测试后删除 |

客户端团队使用原文 12.2 的 `terminal-client.integration.ts` 对接；服务端不提供生产故障注入入口。所有真实用例记录服务端提交、客户端版本、配置、执行平台、步骤、通过/失败/未测及配额/收尾证据。

## 回滚

先在所有中转节点设置 `MONKEYAI_RUNTIME_TERMINAL_WS=false` 并重启；发现同步撤回能力，拒绝新终端，已有观察流随本节点结束关闭，不向目标发送终端 close 或设备撤销事件。之后可回退应用镜像；本次无数据库迁移。原 shell 的保留由仍在运行的目标 runtime 生命周期保证。
