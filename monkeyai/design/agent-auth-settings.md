# MonkeyAI Agent 登录、用户与 Settings 方案

## 1. 客户端注册

首期只注册两个公开客户端。公开客户端无法安全保存 `client_secret`，所以只暴露 `client_id`，并强制使用 PKCE S256。

| 客户端 | `client_id` | 默认应用回调地址 |
| --- | --- | --- |
| 桌面端 | `monkeyai-desktop` | `monkeyai-desktop://oauth/callback` |
| 移动端 | `monkeyai-mobile` | `monkeyai-mobile://oauth/callback` |

客户端注册信息是代码中的小型静态白名单，不建立 `oauth_clients` 表。服务端校验 `client_id`，但不要求客户端传入的 `redirect_uri` 与默认应用回调地址完全一致；本次授权使用客户端传入的非空回调地址，并在换取 token 时校验它与授权请求中保存的地址一致。

## 2. Agent 登录流程

1. 客户端生成随机 `state` 和 PKCE `code_verifier`，计算 `code_challenge = BASE64URL(SHA256(code_verifier))`。
2. 客户端用系统浏览器打开 `GET /oauth/authorize`，传入 `response_type=code`、`client_id`、非空 `redirect_uri`、`state`、`code_challenge` 和 `code_challenge_method=S256`。
3. 服务端校验客户端白名单后创建 10 分钟有效的授权请求，并跳转到管理端 `/client-login` 页面。
4. 页面调用服务端检查客户端用户的浏览器会话。已有会话时直接继续；未登录时展示管理员在后台启用的密码、邮箱验证码和 OAuth/OIDC 登录方式，并按注册开关展示邮箱注册入口。
5. 上游 OAuth 回调只回到 MonkeyAI 服务端。服务端绑定或创建用户，建立 HttpOnly 浏览器会话，再返回 `/client-login`。
6. 页面申请 2 分钟有效、仅能使用一次的授权码，并打开对应的桌面或移动应用地址；页面保留手动“打开应用”按钮。
7. 客户端向 `POST /oauth/token` 提交授权码和原始 `code_verifier`。服务端校验 PKCE 后返回 1 小时有效的 access token 和 30 天有效的 refresh token。
8. refresh token 每次刷新都会轮换，旧 token 立即撤销。`POST /oauth/revoke` 可撤销当前令牌组。

OAuth 元数据位于 `GET /.well-known/oauth-authorization-server`，客户端清单位于 `GET /api/auth/v1/clients`。

浏览器会话使用主机 Cookie。管理页面和 API 统一使用 `MONKEYAI_PUBLIC_URL` 作为对外访问地址；前后端分别开发时，将它设置为 Vite 页面地址，由开发代理转发服务端请求。

## 3. 管理员登录与首次启动

管理后台同时支持密码和管理员启用的 OAuth/OIDC 登录。密码使用 `users.email + password_hash` 校验，并以带随机 Salt 的 PBKDF2-HMAC-SHA256 保存；OAuth/OIDC 登录页动态列出当前启用的连接。两种方式成功后都会建立 HttpOnly 浏览器会话。

管理后台的 OAuth/OIDC 回调只允许关联到已存在、启用状态且 `role = 'admin'` 的用户。首次使用某个第三方身份时，可以按上游返回的邮箱绑定同邮箱管理员；不会通过 OAuth 自动创建管理员，也不会把普通用户提升为管理员。普通用户或停用用户完成上游认证后仍会被管理后台拒绝。

管理员同时可以登录客户端，使用已启用的密码、邮箱验证码或 OAuth/OIDC 登录方式。普通用户提升为管理员后，继续复用原用户身份和第三方绑定完成客户端登录、授权码交换及令牌刷新。

空数据库首次启动时必须使用以下环境变量创建第一个管理员：

```bash
export MONKEYAI_INITIAL_ADMIN_NAME='MonkeyAI Admin'
export MONKEYAI_INITIAL_ADMIN_EMAIL='admin@example.com'
export MONKEYAI_INITIAL_ADMIN_PASSWORD='至少十二个字符的初始密码'
```

用户表为空且未配置首次管理员凭据时，服务拒绝启动，避免产生无法管理的实例。服务只在用户表为空时创建管理员，后续启动不会重置已有密码。初始化成功后应移除密码环境变量。

## 4. OAuth 配置

管理员登录后，在 Settings 页面配置管理后台和客户端用户共用的 OAuth 连接。配置保存在 `settings.authentication.value.oauth_connections`，支持 GitHub、Google、Microsoft、GitLab 和自定义 OIDC；只有启用的连接会显示在登录页。自定义 OIDC 默认通过 `issuer_url/.well-known/openid-configuration` 发现端点，也允许数据中显式提供 `authorization_url`、`token_url`、`userinfo_url` 和 `scopes`。

关闭自助注册时，只有邮箱已由管理员预置的用户能够绑定 OAuth 身份；开启注册后才会自动创建新用户。OAuth 用户不会被自动提升为管理员。

## 5. 用户与管理会话

- 管理端会话使用随机 HttpOnly Cookie；HTTPS 环境自动添加 `Secure`，默认有效期 7 天。
- 管理接口统一要求当前会话用户为启用状态的 `admin` 角色，密码和 OAuth 会话均可；Agent 接口统一要求有效 Bearer access token。
- 管理员可查看用户、调整角色、启用或停用用户。服务端禁止管理员停用自己或移除自己的管理员角色。
- 用户停用后，已有浏览器会话和 Agent token 即使尚未过期也无法继续使用。
- OAuth access token、refresh token、授权码和浏览器会话只在数据库保存 SHA-256 摘要，不保存原文。

## 6. Settings、Agent Config 与调用密钥

管理接口：

- `GET /api/admin/v1/settings`
- `GET /api/admin/v1/settings/{key}`
- `PUT /api/admin/v1/settings/{key}`

配置域为 `branding`、`authentication`、`email`、`billing`。管理端读取时不返回 `client_secret`、SMTP 密码和远程计费密钥；提交空密钥会保留数据库中的旧值。

Agent 接口：

- `GET /api/v1/settings`：获取脱敏全局设置。
- `GET /api/v1/models`：获取可用模型和模型代理地址。
- `GET /api/v1/rules`、`/skills`、`/experts`、`/connectors`：分别获取当前用户可用的对应资源目录。
- `GET /api/v1/api-keys`：列出当前用户的调用密钥元数据。
- `POST /api/v1/api-keys`：创建调用密钥，原文只在响应中返回一次。
- `POST /api/v1/api-keys/{keyID}/rotate`：轮换调用密钥。
- `DELETE /api/v1/api-keys/{keyID}`：撤销调用密钥。

上述接口各自生成稳定 SHA-256 `version`，支持独立 `ETag`、`If-None-Match` 和 `304`；不再提供整体 `/api/v1/config`。Agent 在启动、登录和网络恢复时按需拉取，并按用户及接口隔离缓存。系统暂不提供 SSE 配置通知。

OAuth access token 用于 Agent API；模型代理只接受具有 `model:invoke` 权限的调用密钥。后续 MCP 代理使用 `mcp:invoke`。调用密钥只保存 SHA-256 摘要，用户被停用、密钥过期或被撤销后立即失效。下发给 Agent 的配置不会包含任何上游供应商密钥。

## 7. 数据表

新增表：

- `browser_sessions`
- `oauth_authorization_requests`
- `oauth_login_states`
- `oauth_authorization_codes`
- `oauth_tokens`
- `api_keys`

不新增 `oauth_clients` 和 `config_changes`。


## 8. 邮箱认证与 SMTP

管理端与客户端通过 `GET /api/auth/v1/methods` 获取公开开关。`password_enabled` 默认开启，`email_code_enabled`、`registration_enabled` 默认关闭；开关在服务端认证入口再次校验。管理员入口仅接受启用状态的管理员，客户端登录入口接受启用状态的普通用户和管理员。

| 接口 | 用途 |
| --- | --- |
| `POST /api/admin/v1/settings/email/test` | 管理员使用已保存 SMTP 配置向 `recipient` 发送测试邮件 |
| `POST /api/auth/v1/login` | 普通用户和管理员的客户端密码登录；管理后台使用 `/admin/login` |
| `POST /api/auth/v1/email/code` | 提交 `email` 与 `purpose`（`login`、`register`、`reset`）发送验证码 |
| `POST /api/auth/v1/email/login` | 普通用户和管理员的客户端验证码登录；管理后台使用 `/admin/email/login` |
| `POST /api/auth/v1/email/register` | 通过注册验证码提交邮箱、姓名和至少 12 字符密码，仅创建普通用户 |
| `POST /api/auth/v1/email/reset-password` | 通过重置验证码设置至少 12 字符的新密码 |

注册需要开放注册并至少开启一种邮箱登录方式；找回密码需要开启密码登录。验证码登录不会自动注册，用户需使用注册入口。密码重置成功后撤销该用户的浏览器会话、OAuth 令牌和未使用授权码，并使已有登录验证码失效。

SMTP 配置包含 `sender_name`、`sender_email`、`smtp_host`、`smtp_port`、`smtp_username`、`smtp_password`、`smtp_encryption`（`starttls`、`tls`、`none`）。测试邮件和认证邮件共用实时读取的已保存配置。TLS 校验服务器证书，STARTTLS 失败不会降级；单次发送最多等待 15 秒，并响应请求取消。仅在 SMTP 接受 DATA 后显示发送成功；这表示服务器接收投递，不保证已进入收件箱。

验证码使用安全随机六位数字，10 分钟有效，仅保存绑定邮箱和用途的摘要。数据库事务保证单次消费，最多允许 5 次错误尝试。按连接来源 IP（不信任转发头）和规范化邮箱限制发送：每邮箱每分钟 1 次、每小时 10 次，每 IP 每小时 30 次。SMTP 失败也占用发送额度，防止重试绕过限制。不存在、停用或不符合用途的账号返回统一提示。验证码与限流记录保存在 PostgreSQL，支持多实例；每次发送清理过期记录。

上线前运行 `000006_identity_email_auth` 迁移。
