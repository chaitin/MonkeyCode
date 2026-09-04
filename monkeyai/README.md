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
make push-admin
make push-backend
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
docker compose up --no-build
```

停止服务：

```bash
docker compose down
```

如需同时删除 PostgreSQL 数据卷（数据不可恢复）：

```bash
docker compose down --volumes
```
