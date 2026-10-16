# 远程执行协议 v1 联调契约

状态：2026-10-16 修复五组剩余互通问题；本仓数据库和 HTTP/yamux 集成验证记录见[互通验证记录](remote-runtime-interop-validation.md)。实际客户端提交 `4eb858b1` 与 Mac/Windows UI 联合验收仍需对应客户端环境。支持 Desktop 托管和独立 runtime，服务端默认开启，可通过 `MONKEYAI_RUNTIME_RELAY=false` 关闭；设备侧发布仍须本机显式启用。设计与实施状态见[后端实现方案](remote-runtime-backend-plan.md)。

## 1. 发现与认证

`/.well-known/oauth-authorization-server` 在配置启用中转后发布 `monkeyai_runtime`，包含稳定 `server_id`、WebSocket `bridge_url`、`files_origin`、Ed25519 `access_signing_keys`、`runtime_api: [1]`、`tunnel_versions: [1]` 和已实现能力位。`access_signing_keys` 的每项固定为 `{ "kid": "...", "algorithm": "Ed25519", "public_key": "<无填充 base64url>" }`；服务端轮换配置可以兼容旧 JWK 输入，但对外只发布此形状。

公网与内网的公开地址、文件 origin 均支持 HTTP/HTTPS 根地址。HTTP 发布 `ws://`，HTTPS 发布 `wss://`；客户端使用返回的 `bridge_url`，不强制改写协议。

OAuth 新权限必须通过浏览器明确批准。启用远程中转时，新的 Desktop 授权请求若省略 scope，服务端默认申请 `device:bind device:publish device:connect session:report`；旧 token 不会自动扩权，刷新后仍保持原 scope。发布使用 `device:bind device:publish`，身份恢复使用 `device:bind`，会话补传使用 `session:report`。控制端另申请 `device:connect`、业务权限和需要的 `device:manage`。token 响应增加稳定 `grant_id` 和空格分隔的 `scope`。

GET 设备列表添加 `X-MAI-Runtime-API: 1` 或使用已获 `device:connect` 的授权获取平铺 `items/total/page/page_size/version`。目录要求 `device:connect`，支持 `capability=execute`、page 和 page_size。没有新增权限的旧 token 不能进入新接口。

DELETE 远程登记要求 `If-Match` 中的 registration_version；同一事务在用户锁下核对当前版本，过期返回 412/device_registration_changed。同一次撤销重复提交保持幂等；恢复远程访问再次推进 registration_version，恢复前的删除不能撤销新登记。

## 2. 文本握手

`GET /api/v1/endpoint-bridge?channel_kind=control&tunnel_version=1` 用 OAuth Bearer 升级 WebSocket。原生可无 Origin；非空 Origin 必须精确匹配受信任公开 origin。JSON 为 UTF-8、snake_case，最多 64 KiB，拒绝重复键、错误大小写和未知字段。

控制 hello：

```json
{
  "type": "hello",
  "tunnel_version": 1,
  "channel_kind": "control",
  "machine_id": "00000000-0000-4000-8000-000000000001",
  "execution_public_key": "base64url-ed25519-public-key",
  "boot_id": "00000000-0000-4000-8000-000000000002",
  "display_name": "办公电脑",
  "platform": "macos",
  "arch": "arm64",
  "deployment_mode": "desktop_managed",
  "intent": "publish",
  "protocols": {"acp": [1], "runtime_api": [1]}
}
```

`intent=bind_identity` 只建立授权族与设备绑定，不发布业务，不更改远程访问状态和活动授权。恢复已撤销的访问必须以本机明确操作设置一次 `restore_revoked: true`，不能保存为自动重连选项。

challenge 包含 `type=challenge`、server_id、owner_user_id、challenge_id、nonce、ttl_ms=60000、server_time、grant_id、registration_version。挑战只在本次 WebSocket 使用一次，签发端以单调期限校验。hello 已包含 channel_kind/tunnel_version，challenge 不重复携带。

proof 的消息形状为 `{"type":"proof","challenge_id":"...","signature":"base64url-signature"}`。Ed25519 输入为固定数组：`["monkeyai.endpoint.proof.v1", [tunnel_version, channel_kind, intent, machine_id, execution_public_key, boot_id, display_name, platform, arch, deployment_mode, lease_epoch, restore_revoked, protocols.acp, protocols.runtime_api], [server_id, owner_user_id, challenge_id, nonce, ttl_ms, server_time, grant_id, registration_version]]`。

lease_epoch 缺省为 0，restore_revoked 缺省为 false，协议数组非空、升序、无重复，每组至多 8 项，元素为 1–65535。固定数组顺序与 [protocol.go](../backend/internal/relay/protocol.go) 一致；时间采用 UTC RFC3339Nano，字符串采用 encoding/json 转义。

跨语言验证使用 [proof.json](../backend/internal/relay/testdata/proof.json)，包含公钥、完整 hello/challenge、固定数组待签字节和签名。更新客户端 Schema 与向量时必须同步两仓，服务端不自动猜测旧对象格式。

ready 包含 server_id、machine_id、registration_version、grant_version、bound=true。bind_identity 不带 lease_epoch 和 public_addresses；publish/data 带非零 lease_epoch 和可信 `public_addresses`。客户端先持久保存登记结果，再发送 `{"type":"ready_ack","registration_version":1,"lease_epoch":1}`；服务端不再要求 ack.grant_version。

只认证确认不含 lease_epoch，确认后关闭连接；发布确认后进入二进制 yamux。数据库已经提交但 ready 丢失时，下次以相同设备和公钥重新证明，不新建目标。

数据 WebSocket 使用 `channel_kind=data`，hello 与控制通道使用相同严格字段，`intent=attach`、携带执行公钥、设备资料、协议声明和非零 lease_epoch。它只能附着当前活动授权、boot 和 epoch。

## 3. 二进制隧道

执行端使用 yamux Client，控制面使用 yamux Server；锁定依赖 `github.com/hashicorp/yamux v0.1.2`。控制与数据各一条 WebSocket/TCP，WebSocket 使用二进制字节流，消息边界不表示 HTTP 或 yamux 边界。

每条 stream 直接承载 HTTP/1.1，无额外类型字节或长度头。控制面打开业务 stream；runtime 在控制通道上打开内部 HTTP 请求，Host 为 `relay.internal`。数据通道不接受反向 stream。

内部 HTTP 并发上限为 16（含事件流），请求头读取 5 秒、完整请求读取 10 秒、事件写入 5 秒；慢消费者不能占用设备锁。NDJSON 首条 ready，每 15 秒发送 heartbeat。事件发送不能证明对端存活：服务端每 15 秒主动 yamux Ping，仅收到 Pong 后更新在线观测，Ping 写入和回应各有 10 秒上限。控制或事件流终止回收同 epoch 数据通道及观察流，数据故障独立重建。

业务流预算控制 64、数据 16。HTTP 流逐次验证和打开，不跨请求复用身份上下文。业务 Host 和 URL Host 均为 `device.internal`，HTTP 采用 32 KiB 流式拷贝。

## 4. ticket 与业务请求

`POST /api/v1/endpoints/{machine_id}/connections` 使用控制端 OAuth，请求例如：

```json
{"scopes":["session:read","session:control","files:read","files:write"],"supported_protocols":{"acp":[1],"runtime_api":[1]}}
```

创建和续期均实时核验；续期加 connection_id，可省略 scopes 和 supported_protocols。显式权限只能收窄，续期不能改变协议。默认 15 分钟、每设备 8 份有效授权，ticket 为 32 字节随机值，服务端只存摘要。

普通代理使用 `Authorization: Bearer <ticket>`。WebSocket 使用 `monkeyai.v1` 和 `monkeyai.token.<ticket>`；中转消费票据子协议，只转发并回选 `monkeyai.v1`。允许安装版 `app://monkeyai` 和部署 origin；开发地址及端口通过 `MONKEYAI_RUNTIME_DESKTOP_ORIGINS` 显式配置，未知来源拒绝。

代理白名单：ACP GET 使用 session:read；POST `/read/session` 使用 session:read，`/read/config` 使用 resources:manage，`/read/interaction` 使用 session:control，`/write/resource` 同时要求 resources:manage/session:read；MCP POST/GET/DELETE 使用 files:read；上传 PUT/HEAD 使用 files:write；文件 GET/HEAD 使用 files:read 和精确文件授权。正文读取等待响应头 150 秒，资源写入 225 秒，其余 30 秒；取消、授权和流预算仍生效。CORS 允许 Upload-Session-ID 等上传头并暴露上传、MCP、Range/ETag 响应头。禁止本机宿主管理和能力注册，清除外部凭据与自报身份头。

访问断言通过 `X-MonkeyAI-Access` 传递，值为 `base64url(payload).base64url(signature)`。payload 是 UTF-8 JSON，签名输入为 `ASCII("monkeyai.access.signed.v1." + payload_b64)`。type 为 `monkeyai.access.assertion.v1`，并包含 issuer、audience、kid 和 authorization。

authorization 包含 server_id、owner_user_id、machine_id、connection_id、client_grant_id、grant_version、access_version、lease_epoch 和按 ASCII 升序排列的 scopes。runtime 验签并匹配当前设备、epoch 后，必须再取得本 connection 有效租约，才能建立 owner-client AccessContext。具体 ACP/MCP 方法仍在 runtime 按 scopes 校验，缺 Origin、initialize role 或内部头不能提升成本机身份。

## 5. 访问租约

runtime 通过 `POST /_control/access-lease` 发送 `type=access_lease_request`、authorization、nonce、lease_seq、boot_id 和 require_fresh。响应为 `{signed}` 或 `{revocation}`；signed 使用统一信封，payload type 为 `monkeyai.access.lease.v1`，包含 authorization、nonce、lease_seq、boot_id、ttl_ms、ticket_remaining_ms、auth_age_ms、server_time 和 verification_state。

控制端在已认证 yamux 控制通道内使用 HTTP/1.1 请求 `POST /_control/access-lease`、`GET /_control/events` 和 `GET /_control/status`，Host 固定为 `relay.internal`。事件使用 application/x-ndjson，每行一个 JSON；首条为 ready，后续为 heartbeat、refresh、revocation。服务端不再在业务 HTTP 前写入 0x02。

授权存储故障只延续已有且验证通过的访问，硬截止为原 ticket 到期与最后权威核验成功后 180 秒中的较早者。失败查询、缓存命中或短续租不推进最后成功时间；新代理连接、ticket 签发/轮换及新文件授权仍要求实时核验。

已知失效返回 `{revocation: "<统一签名字符串>"}`。撤销 payload 的 server_id、owner_user_id、machine_id、boot_id、lease_epoch 位于顶层；连接撤销另带 connection_id、access_version，不放在 authorization 中。NDJSON 使用相同信封。单个控制端退出只关闭自身观察流，执行端和其他控制端继续在线。

完整 authorization 与认证路由、数据库记录逐项匹配；require_fresh=true 遇到基础设施错误返回 503/authorization_state_unavailable。仅既有访问普通续租允许 grace。租约序号在同 epoch 内严格递增，重复或迟到请求拒绝；断言 expires_at 和租约 server_time 均显式 UTC Z。

## 6. 文件与时间

远程 FileGrant 使用 `fg1.<payload>.<signature>`。payload 是无填充 base64url 的规范 JSON，签名输入为 `monkeyai.file-grant.v1\n` 加 payload JSON；字段顺序为 type、version、key_id、authorization、session_id、path、purpose、issued_at、expires_at。`authorization` 完整绑定 server、owner、machine、connection、client grant、grant/access/lease 版本和 scopes。issued_at/expires_at 使用 Unix 毫秒安全整数，有效期不超过五分钟。

载荷字段为 type=monkeyai.file-grant.v1、version=1、key_id、authorization、session_id、path、purpose=resource/download、issued_at、expires_at。v1 只授予精确文件 GET/HEAD，不授予目录通配或写权限。

独立入口：`{files_origin}/endpoints/{machine}/files/{grant}/{path}`，v1 只允许精确文件的 GET/HEAD，服务端验证完整 authorization、当前连接、grant/access/lease 版本、files:read、时间和路径。不用 ticket 替代文件范围。请求路径只解码一次，允许字面百分号，拒绝编码分隔符、反斜杠和遍历路径。token 上限 12 KiB、解码载荷上限 8 KiB；独立 fg1 不参与 ticket_version 比较，仍受 access_version、完整 scopes、grant/epoch、文件期限和票据当前期限限制。

runtime 从可信的匹配 nonce 控制响应计算授时；最大参考年龄 120 秒、不确定度 5 秒，文件签发最多领先控制面 5 秒。客户端实现及休眠恢复仍需跨仓验收。无法取得可靠授时时不能签发远程文件 URL；本机 HMAC 链接保持原语义。

共享文件域一律交付下载，设置 attachment、sandbox、nosniff 和 no-referrer，不执行多个不可信 HTML。Desktop 自定义产物 origin 的资源读取和五分钟续签保持页面状态，仍需客户端联调。

HTTP 预览配置 `MONKEYAI_RUNTIME_PREVIEW_ORIGIN_TEMPLATE=https://{artifact}.preview.example.net`。配置生效后发布 `preview_origin_template`、`artifact_preview=true` 和 `preview_storage_policy=opaque_no_storage`。模板只允许独立 HTTPS 泛域名根地址，不能包含端口、路径或登录/文件根域。

产物标签取 SHA-256(`server_id/user_id/machine_id/session_id/artifact_id`) 的前 16 字节小写十六进制，代入模板。FileGrant 额外带 `artifact_id` 和 `preview_origin`（字段编码顺序见 file.go），scope 必须为 directory。访问地址为 `{preview_origin}/preview/{machine_id}/{grant}/{产物目录内路径}`，域名、产物、签名和路径同时匹配才能读取。相对资源沿同一授权路径加载。

HTTP 模式使用 `sandbox allow-scripts` 且不允许 allow-same-origin，明确禁止 localStorage、Cookie、IndexedDB、ServiceWorker、表单、外部网络和嵌套应用。控制面删除执行端 CSP/Cookie 等冲突头，不允许重定向；预览域不能进入登录或普通 API。此模式不承诺持久存储，Desktop 自定义预览 origin 的既有存储行为保持独立。

Nginx 提供专用泛域名 TLS server，证书和私钥由部署方只读挂载；内置 HTTP-01 单域名 ACME 不申请泛域名证书。可用外部 TLS 网关终止证书并转发 `/preview/`，保持 Host、关闭凭据路径日志；不得把其他登录路径转发到预览域。

## 7. 独立设备授权

申请：`POST /oauth/device/authorization`，表单 client_id=monkeyai-runtime、machine_id、公钥、display_name、platform、arch、scope。允许 scope 仅 device:bind/device:publish/session:report，默认三项；控制其他设备、账号管理及资源写入均不放行。设备码 32 字节随机值仅存 hash，短码 HMAC 索引；有效期 600 秒，初始轮询 5 秒。

用户打开 `/device` 输入短码，或访问 verification_uri_complete。查询使用 `/api/auth/v1/client-requests/device?purpose=device&user_code=...`，SSO 使用 purpose=device 和独立 device_request_id 返回同一申请。确认页展示设备、公钥指纹、账号、权限和有效期，不回传 device_code。

`POST /api/auth/v1/device/decision` 带 request_id、decision=approve/deny、approved_scopes 和可选 restore_revoked，使用浏览器 Cookie、请求绑定 CSRF 和来源校验。权限只能收窄；已撤销设备必须再次明确勾选恢复，公钥冲突不允许覆盖。并发答案只接受一次。

`POST /oauth/token` 使用 `grant_type=urn:ietf:params:oauth:grant-type:device_code`、client_id 和 device_code。pending/slow_down/access_denied/expired_token 遵循 RFC8628；过快轮询每次增加 5 秒间隔。兑换事务只成功一次，响应丢失重新授权，不重复返回秘密。

成功增加 server_id、machine_id、grant_id 和批准 scope。专用授权冻结申请机器/公钥，证明前没有 Principal.machineId，不能上报宿主或管理密钥；刷新必须使用 monkeyai-runtime，保持 grant 和绑定。

独立发布 hello 使用 deployment_mode=standalone。原托管进程停止并释放在线租约后，同公钥、同 machine 的新独立授权可接管；旧 Desktop 用户授权保留，原会话不复制。同机重新授权替换旧专用执行授权，并撤销其调用密钥。活跃不同 boot 仍优先，不能自动抢占。

独立调用密钥带 machine_id/runtime_grant_id。创建要求当前活动独立执行授权，列表、轮换和删除限定该授权族；网关逐次检查授权与活动设备绑定。退出、移除独立登记或替换授权会使密钥立即不可用，并同步或周期保存撤销标记；托管关闭远程不影响 Desktop 调用密钥。

## 8. 本人会话目录

`GET /api/v1/sessions?machine_id=&page=&page_size=` 与 `GET /api/v1/sessions/{id}` 要求 session:read，owner 始终来自认证；不接受自报其他 owner。只展示已经验证宿主的非占位、未删除、未清除摘要。关闭 session_reporting 时拒绝目录并发布 session_index=false；stats 策略不返回标题，full 才返回标题。

摘要含 machine_id、state_seq、host_revision、started_at、last_active_at、reported_at、device_status、stale。状态不代替目标会话；离线或实时摘要超过三分钟、boot/epoch 不匹配时 stale=true。

PUT 会话可附 `runtime: {boot_id,lease_epoch}` 更新实时摘要，必须匹配当前认证宿主和活动租约；它不改变 state_seq 的业务快照 hash。历史补传省略 runtime，不依赖隧道，也不能制造新的实时在线摘要。

## 9. 当前发布条件

后端代码和独立 runtime 替身测试不能替代真实 Desktop：开启功能前必须完成 Mac/Win 旧会话互访、操作去重恢复、审批首答、文件和产物预览、代理与慢流、休眠、控制端退出与目标退出的联合验收。

单节点限制保持；公钥集合支持切换私钥前预发布和保留旧公钥，实际轮换重叠期、生产容量与原生代理矩阵仍需部署证据。独立设备授权、会话目录和可选 HTTP 预览已实现，发现能力按上报策略及部署配置动态发布。
