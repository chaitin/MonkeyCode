# MonkeyAI Agent 登录、用户与 Settings 方案

## 1. 客户端注册

首期只注册两个公开客户端。公开客户端无法安全保存 `client_secret`，所以只暴露 `client_id`，并强制使用 PKCE S256。

| 客户端 | `client_id` | 应用回调地址 |
| --- | --- | --- |
| 桌面端 | `monkeyai-desktop` | `monkeyai-desktop://oauth/callback` |
| 移动端 | `monkeyai-mobile` | `monkeyai-mobile://oauth/callback` |

客户端注册信息是代码中的小型静态白名单，不建立 `oauth_clients` 表。`monkeyai-desktop` 是公开的客户端标识，`monkeyai-desktop://oauth/callback` 才是操作系统注册的应用地址。

## 2. Agent 登录流程

1. 客户端生成随机 `state` 和 PKCE `code_verifier`，计算 `code_challenge = BASE64URL(SHA256(code_verifier))`。
2. 客户端用系统浏览器打开 `GET /oauth/authorize`，传入 `response_type=code`、`client_id`、固定 `redirect_uri`、`state`、`code_challenge` 和 `code_challenge_method=S256`。
3. 服务端校验客户端白名单后创建 10 分钟有效的授权请求，并跳转到管理端 `/client-login` 页面。
4. 页面调用服务端检查客户端用户的浏览器会话。已有会话时直接继续；未登录时展示管理员在后台启用的 OAuth/OIDC 登录方式。
5. 上游 OAuth 回调只回到 MonkeyAI 服务端。服务端绑定或创建用户，建立 HttpOnly 浏览器会话，再返回 `/client-login`。
6. 页面申请 2 分钟有效、仅能使用一次的授权码，并打开对应的桌面或移动应用地址；页面保留手动“打开应用”按钮。
7. 客户端向 `POST /oauth/token` 提交授权码和原始 `code_verifier`。服务端校验 PKCE 后返回 1 小时有效的 access token 和 30 天有效的 refresh token。
8. refresh token 每次刷新都会轮换，旧 token 立即撤销。`POST /oauth/revoke` 可撤销当前令牌组。

OAuth 元数据位于 `GET /.well-known/oauth-authorization-server`，客户端清单位于 `GET /api/auth/v1/clients`。

首期浏览器会话使用主机 Cookie，因此 `MONKEYAI_PUBLIC_URL` 与 `MONKEYAI_ADMIN_URL` 必须使用相同协议和主机名；开发环境可以使用不同端口。

## 3. 管理员登录与首次启动

管理后台不使用 OAuth。管理员通过 `users.email + password_hash` 登录，密码使用带随机 Salt 的 PBKDF2-HMAC-SHA256 保存，成功后建立 HttpOnly 浏览器会话。浏览器会话记录认证方式，管理接口只接受密码认证产生的管理员会话；OAuth 不会绑定管理员账号。

空数据库首次启动时必须使用以下环境变量创建第一个管理员：

```bash
export MONKEYAI_INITIAL_ADMIN_NAME='MonkeyAI Admin'
export MONKEYAI_INITIAL_ADMIN_EMAIL='admin@example.com'
export MONKEYAI_INITIAL_ADMIN_PASSWORD='至少十二个字符的初始密码'
```

用户表为空且未配置首次管理员凭据时，服务拒绝启动，避免产生无法管理的实例。服务只在用户表为空时创建管理员，后续启动不会重置已有密码。初始化成功后应移除密码环境变量。

## 4. 客户端用户 OAuth 配置

管理员登录后，在 Settings 页面配置客户端用户可用的 OAuth 连接。配置保存在 `settings.authentication.value.oauth_connections`，支持 GitHub、Google、Microsoft、GitLab 和自定义 OIDC。自定义 OIDC 默认通过 `issuer_url/.well-known/openid-configuration` 发现端点，也允许数据中显式提供 `authorization_url`、`token_url`、`userinfo_url` 和 `scopes`。

关闭自助注册时，只有邮箱已由管理员预置的用户能够绑定 OAuth 身份；开启注册后才会自动创建新用户。OAuth 用户不会被自动提升为管理员。

## 5. 用户与管理会话

- 管理端会话使用随机 HttpOnly Cookie；HTTPS 环境自动添加 `Secure`，默认有效期 7 天。
- 管理接口统一要求 `admin` 角色和密码认证会话；Agent 接口统一要求有效 Bearer access token。
- 管理员可查看用户、调整角色、启用或停用用户。服务端禁止管理员停用自己或移除自己的管理员角色。
- 用户停用后，已有浏览器会话和 Agent token 即使尚未过期也无法继续使用。
- OAuth access token、refresh token、授权码和浏览器会话只在数据库保存 SHA-256 摘要，不保存原文。

## 6. Settings 与 Agent Config

管理接口：

- `GET /api/admin/v1/settings`
- `GET /api/admin/v1/settings/{key}`
- `PUT /api/admin/v1/settings/{key}`

配置域为 `branding`、`authentication`、`email`、`billing`。管理端读取时不返回 `client_secret`、SMTP 密码和远程计费密钥；提交空密钥会保留数据库中的旧值。

Agent 接口：

- `GET /api/agent/v1/config`：获取当前完整配置快照。
- `GET /api/agent/v1/config/events`：订阅 SSE 实时更新。

SSE 建连后发送 `ready`，后续设置变更发送 `config` 事件，事件包含变更域和最新完整快照，每 20 秒发送心跳。在线多实例之间使用 PostgreSQL `LISTEN/NOTIFY` 广播，不持久化事件。系统不建立 `config_changes` 表，不支持 `Last-Event-ID` 补偿；Agent 断线重连后应先重新调用 Config 接口获取基线，再继续订阅。

下发给 Agent 的配置会移除所有管理密钥。

## 7. 数据表

新增表：

- `browser_sessions`
- `oauth_authorization_requests`
- `oauth_login_states`
- `oauth_authorization_codes`
- `oauth_tokens`

不新增 `oauth_clients` 和 `config_changes`。
