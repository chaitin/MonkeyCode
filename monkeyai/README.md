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

Agent 按资源类型读取 `/api/v1/settings`、`/api/v1/models`、`/api/v1/rules`、`/api/v1/skills`、`/api/v1/experts`、`/api/v1/connectors`，每个接口独立提供 SHA-256 版本与 ETag/304。模型代理信息随模型列表返回，整体 `/api/v1/config` 已移除。通过专家清单和 `/api/v1/resources/resolve` 获取最终依赖；专家授权只委托其固定系统规则和技能，模型及连接仍单独检查授权。接口详见两份 OpenAPI。

资源管理列表支持 `q`、`ownership_type`、`cursor` 和 `limit`（1—200），管理页面及关联选择器会读取全部分页。模板图标限 1 MiB 的 PNG/JPEG，由后端验证尺寸并经授权接口读取。

工具下发声明 `capabilities: [catalog, invoke]`，包含工具目录、积分配置和 `mcp_gateway`（代理 URL、`streamable_http` 传输及 `mcp:invoke` 调用密钥要求）。远程工具经服务端代理调用，上游凭证留在后端；Desktop/OhMyAgent 本地加载器独立接入。对象采用不可变 key，旧包与失败上传遗留对象保留，不在写事务中删除，以免破坏备份或正在下载的资源；清理时必须确认无数据库引用且超过备份保留窗口。

备份应同时保留 PostgreSQL 快照与该快照引用的 RustFS 对象。恢复时先恢复对象和数据库，再用资源摘要验证技能下载。完整部署启动前不要清空 RustFS 数据卷。

本地前端联调可设置 `MONKEYAI_DEV_BACKEND_URL` 指向单独的测试后端，避免占用现有实例端口。


## 计费管理

计费后台使用 `/api/admin/v1/billing/*`。管理员可以设置分组/个人周期额度、独立保存价格和计费方式、查看账户余额与冻结额、调整当期积分，并查询流水、退款和待处理交易。组织授权分组与单一计费归属分组分开维护。

- 首次升级先执行 `000002_billing_create_transactions` 增量迁移；保留历史账户和流水。已有交易后 down 迁移主动拒绝，回滚应关闭新调用扣费并保留交易恢复能力。
- 默认关闭实际扣费，仅记录调用。检查价格、额度和模型上限后，在费用设置中开启。旧计费设置写接口返回冲突提示，统一通过计费接口写入。
- 模型需要配置有效的 `context_window_tokens` 和 `max_output_tokens`。代理以管理员确认的模型上下文上界预留、强制输出限制，使用真实 usage 结算；目前仅支持单结果同步调用，不支持 `n > 1`、`best_of > 1` 或后台异步生成。上下文上界错误、缺失用量或实际费用超出预留都会转待核查，不能按估值扣款。
- 模型调用沿用 `/v1/chat/completions`、`/v1/responses`、`/v1/messages`；MCP 使用 `POST /mcp/connectors/{id}`，密钥作用域为 `mcp:invoke`。集中认证工具成功收费；独立认证、免认证和明确失败不收费。入口采用无状态 Streamable HTTP，支持握手、通知、工具列表和调用，返回 JSON；上游 JSON/SSE 均可解析。OAuth 调用前自动刷新，每次上游会话结束后清理。详见 [MCP 接入说明](backend/api/README.md#mcp-代理)。
- 返回的 `X-Billing-Transaction-ID` 关联真实交易；可选 `Idempotency-Key` 重复请求返回原交易 ID 和 409，禁止再次执行；`X-Session-ID` 可选，提供时验证所属用户。
- 周期采用上海时区；每分钟准备最多 100 个账户，读取或调用时兜底开户。额度变更不重发当期余额；周期切换在当前周期结束时生效。未消费余额不结转，跨周期调用仍结算到原账户。
- 待结算交易按原交易 ID 自动重试，最多退避一小时；执行中断 30 分钟后转核查，不自动重放上游。管理端可填写证据和用量处理未知结果，已结算本地扣款通过关联冲正全额退款。流水禁止更新或删除。

### 百智云钱包

应用使用 `opensdk v1.14.2`。在后台「计费设置」选择「远程计费（百智云）」，填写服务 URL（`base_url`）和对应的应用 ID（1–999），上传客户端证书 `app.crt`、客户端私钥 `app.key` 和服务端 CA 证书 `ca.crt`，再点击「保存连接配置」。三份文件均为 PEM 格式，私钥须为 PKCS#8 ECDSA 格式，每份最多 64 KiB。保存时检查证书有效期、CA 用途和证书与私钥的匹配关系，不发起真实扣款。保存连接后，再保存计费方式并启用实际扣费。

地址须为 HTTPS 服务根地址，支持私有化域名、IP 和端口，不支持路径前缀、查询参数、片段或用户名密码。公有云生产填写 `https://baizhi.cloud`，测试填写 `https://baizhiyun.vip`，后端自动映射对应开放平台和钱包地址。私有化填写统一网关地址，用户接口 `/api/v1/user` 与钱包接口 `/api/v1/billing/...` 均通过该地址访问。

连接配置保存在数据库 `settings.billing.wallet`，保存后无需重启，其他实例在下次使用时读取最新配置。更新时未上传的文件保留原值；证书和私钥不通过管理/Agent 查询接口回显，审计仅记录脱敏信息。数据库及备份应按包含凭据的数据管理。SDK 初始化使用仅当前进程用户可访问的临时文件，加载到内存后删除。

部署配置支持 `BAIZHIYUN_BASE_URL`、`BAIZHIYUN_APP_ID`、`MONKEYAI_WALLET_CERT_DIR`；未填写 URL 时仍兼容 `BAIZHIYUN_ENV=dev/prod`，目录包含上述三个文件；后台保存的配置优先。存在未完成远程交易时禁止切换服务 URL 或应用 ID，同一应用允许更新证书。证书配置成功仅表示本地校验通过，真实钱包连接和账户权限仍需联调确认。

升级时迁移 `000008` 自动将已有环境配置和交易快照转换为对应 URL。已有自定义 URL 配置或交易记录时禁止回退该迁移，避免旧版本把交易发送到错误的服务。

容器部署时通过单独 Compose override 或现有部署系统向后端传入上述变量，将真实证书目录只读挂载到 `MONKEYAI_WALLET_CERT_DIR`。证书和私钥不进入镜像。新增私有 SDK 依赖，构建机需要私有模块读取权限；Docker 构建支持 BuildKit 的 `netrc` secret（`--secret id=netrc,src=<已有认证文件>`），不得将凭据写入 Dockerfile 或构建参数。

本地周期额度与百智云钱包余额独立管理。绑定用户时查询开放平台验证身份；远程预扣、确认和重试复用数据库中同一 BizID。SDK 的金额单位为 quota，100 quota = 1 积分；预留向上取整，结算每调用汇总后四舍五入到 0.01 积分。未提供钱包历史余额时页面不伪造扣后余额。

远程真实联调尚需核实零金额确认、失败释放、重复确认、按 BizID 查询和退款/对账渠道。预扣结果不确定保留冻结，只有有证据的状态才能进入下一步；远程已结算退款不能仅增加本地余额。当前已覆盖 SDK 接口替身的确认失败及幂等恢复，不能代替真实钱包环境验收。

### 验证

```bash
cd backend
go test ./...
go vet ./...
# 事务及端到端测试：配置可丢弃的 PostgreSQL 和 RustFS
MONKEYAI_TEST_DATABASE_URL='<测试库连接串>' MONKEYAI_S3_ENDPOINT='<测试 RustFS 地址>' \
MONKEYAI_S3_BUCKET='<测试 Bucket>' MONKEYAI_S3_ACCESS_KEY='<测试访问键>' \
MONKEYAI_S3_SECRET_KEY='<测试密钥>' go test ./... -count=1
cd ../admin
npm test
npm run lint
npm run build
```

数据库测试使用随机 schema 并清理。完整方案、实施状态和验收记录见 [计费实施方案](design/billing-implementation-plan.md)。
