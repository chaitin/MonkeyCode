# MonkeyAI

## Docker Compose 启动

复制环境变量示例并至少修改数据库密码和初始管理员密码：

```bash
cp .env.example .env
docker compose up --build
```

启动后访问 <http://localhost:8080>。Compose 会等待 PostgreSQL 就绪、执行数据库迁移，然后依次启动 Backend 和 Admin。

初始管理员只会在用户表为空时创建。首次启动成功后，可从 `.env` 中移除 `MONKEYAI_INITIAL_ADMIN_EMAIL` 和 `MONKEYAI_INITIAL_ADMIN_PASSWORD`，服务不会重置已有账号或密码。

若修改 `MONKEYAI_ADMIN_PORT`，还需将 `MONKEYAI_PUBLIC_URL` 和 `MONKEYAI_ADMIN_URL` 改为浏览器实际访问的地址。生产环境应使用同一域名下的 HTTPS 地址。

## 构建和推送镜像

Makefile 默认构建 `linux/amd64` 镜像，使用当前 Git 短提交号作为标签，并沿用 MonkeyCode 的镜像仓库：

```bash
make image
make push
```

也可以只处理单个服务：

```bash
make image-admin
make image-backend
make image-migrate
make push-admin
make push-backend
make push-migrate
```

发布指定标签或多架构镜像时覆盖对应变量：

```bash
make push TAG=v1.0.0
make push PLATFORM=linux/amd64,linux/arm64
make push REGISTRY=registry.example.com/team
```

运行 `make images` 可在构建前查看最终镜像名称。执行 push 前需先通过 `docker login` 登录目标仓库。

需要用 Compose 验证已推送的镜像时，可传入完整镜像名并跳过本地构建：

```bash
ADMIN_IMAGE=registry.example.com/team/monkeyai-admin:v1.0.0 \
BACKEND_IMAGE=registry.example.com/team/monkeyai-backend:v1.0.0 \
MIGRATE_IMAGE=registry.example.com/team/monkeyai-migrate:v1.0.0 \
docker compose up --no-build
```

迁移 SQL 已打包在 Migrate 镜像中。远程部署无需同步 `backend/migrations` 目录，但必须为 `MIGRATE_IMAGE` 指定与 Backend 相同发布版本的已推送镜像。

停止服务：

```bash
docker compose down
```

PostgreSQL 数据保存在 `./data/postgres`，执行 `docker compose down` 不会删除该目录。如需清空数据库，请先停止服务，再手动删除 `./data/postgres`；该操作不可恢复。

## 资源管理与 RustFS

技能、规则、专家和 MCP 连接使用 PostgreSQL 持久化；技能 ZIP 和连接模板图标字节保存在私有 RustFS Bucket。后台和工作 Agent 均经后端鉴权下载，不直接接触对象存储凭据；技能包在返回前校验大小与 SHA-256，发现损坏时拒绝下发。技能编辑会重建 ZIP 并计算 SHA-256，保留包内附件。

首次重新部署按以下顺序操作：

1. 使用新数据库/数据目录，按 `.env.example` 设置数据库、管理员和 RustFS 凭据。已有数据需要保留时，先完成备份，另建部署目录。
2. 在部署目录准备 RustFS 挂载目录：`sudo mkdir -p ./data/rustfs ./data/rustfs-logs`，再执行 `sudo chown -R 10001:10001 ./data/rustfs ./data/rustfs-logs`。已有目录也需确保目录及其内容可由该用户读写；后续常规启动无需重复调整权限。
3. 构建镜像：`docker compose build`。
4. 执行 `docker compose up -d`。PostgreSQL 健康且 migrate 成功、RustFS 健康后启动后端，后端在启动流程中检查并按需创建私有资源 Bucket，然后提供 HTTP 服务并启动管理页。初始化限时 1 分钟，失败时后端退出，由 Compose 重启重试；重复启动不会删除已有对象。

Compose 默认使用 `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` 供后端初始化和读写资源。可通过 `MONKEYAI_S3_ACCESS_KEY` / `MONKEYAI_S3_SECRET_KEY` 覆盖为独立应用凭据，需具备资源 Bucket 的 `s3:ListBucket`、`s3:GetBucketLocation` 和其中对象的 `s3:GetObject`、`s3:PutObject`、`s3:DeleteObject` 权限；Bucket 不存在时还需 `s3:CreateBucket` 权限。

RustFS 镜像固定为 `chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:v1.0.0-rc.5`。数据位于 `./data/rustfs`，日志位于 `./data/rustfs-logs`，RustFS 容器以非 root 用户 `10001:10001` 运行，挂载目录权限在部署前准备，不使用独立权限初始化容器。S3 API 默认仅在 Compose 网络开放，控制台只绑定宿主机回环地址。

`/healthz` 表示进程存活；`/readyz` 检查数据库和 Bucket（S3 检查超时 3 秒，缓存 5 秒）。Nginx 允许 21 MiB 请求体，技能文件限 20 MiB，解包限 50 MiB/500 个条目，拒绝路径穿越、重复项、链接及不合法的 `SKILL.md`。

MCP 默认访问公网 HTTP(S) 目标；访问内网服务时用 `MONKEYAI_MCP_ALLOWED_CIDRS` 明确配置允许网段。连接使用真实 MCP 初始化和分页工具发现，拒绝自动重定向。新发现工具默认禁用。OAuth 固定回调为 `${MONKEYAI_PUBLIC_URL}/oauth/connectors/callback`，需要登记到上游 OAuth 应用。

同一 Provider 可以创建多个 Connector，独立认证的目录按用户凭证隔离。已有实例的模板连接参数不能直接更换；新的地址或 OAuth 应用创建新模板并建立新连接。集中 Header/Token 只保存在后端；个人连接的敏感值不通过管理列表返回。

Agent 继续使用 `/api/v1/config` 和 ETag，增加 `schema_version=2`、`rules`、`skills`、`experts`、`connectors`。通过专家清单和 `/api/v1/resources/resolve` 获取最终依赖；专家授权只委托其固定系统规则和技能，模型及连接仍单独检查授权。接口详见两份 OpenAPI。

资源管理列表支持 `q`、`ownership_type`、`cursor` 和 `limit`（1—200），管理页面及关联选择器会读取全部分页。模板图标限 1 MiB 的 PNG/JPEG，由后端验证尺寸并经授权接口读取。

当前工具下发声明 `capabilities: [catalog]`，包含工具目录与积分配置。本次不实现 MCP 生产调用网关、实际计费扣减或 Desktop/OhMyAgent 本地加载器；不下发不存在的执行地址。对象采用不可变 key，旧包与失败上传遗留对象保留，不在写事务中删除，以免破坏备份或正在下载的资源；清理时必须确认无数据库引用且超过备份保留窗口。

备份应同时保留 PostgreSQL 快照与该快照引用的 RustFS 对象。恢复时先恢复对象和数据库，再用资源摘要验证技能下载。完整部署启动前不要清空 RustFS 数据卷。

本地前端联调可设置 `MONKEYAI_DEV_BACKEND_URL` 指向单独的测试后端，避免占用现有实例端口。
