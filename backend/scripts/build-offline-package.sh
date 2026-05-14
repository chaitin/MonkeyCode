#!/bin/sh
set -eu

ARCH="${ARCH:-amd64}"
DOCKER_VERSION="${DOCKER_VERSION:-29.0.4}"
PROJECT_TPL_URL="${PROJECT_TPL_URL:-https://baizhiyun.oss-cn-hangzhou.aliyuncs.com/codingmatrix/project-tpl/codingmatrix-project-tpl.master.zip}"
OUT_DIR="${OUT_DIR:-dist/offline}"
PACKAGE_NAME="monkeycode-offline-linux-$ARCH"
PACKAGE_DIR="$OUT_DIR/$PACKAGE_NAME"
GOCACHE="${GOCACHE:-/root/.cache/go-build}"
GOMODCACHE="${GOMODCACHE:-/go/pkg/mod}"
REPO_COMMIT="${REPO_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
HTTP_PROXY="${HTTP_PROXY:-${http_proxy:-}}"
HTTPS_PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
NO_PROXY="${NO_PROXY:-${no_proxy:-}}"
export HTTP_PROXY HTTPS_PROXY NO_PROXY
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" no_proxy="$NO_PROXY"

case "$ARCH" in
  amd64)
    CENTER_GOARCH="amd64"
    CENTER_DOCKER_ARCH="x86_64"
    ;;
  arm64)
    CENTER_GOARCH="arm64"
    CENTER_DOCKER_ARCH="aarch64"
    ;;
  *)
    echo "unsupported ARCH=$ARCH"
    exit 1
    ;;
esac

mkdir -p "$OUT_DIR"
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/images" "$PACKAGE_DIR/static/installer/x86_64" "$PACKAGE_DIR/static/installer/aarch64"

CGO_ENABLED=0 GOOS=linux GOARCH="$CENTER_GOARCH" go build -o "$PACKAGE_DIR/installer" ./cmd/installer
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o "$PACKAGE_DIR/static/installer/x86_64/installer" ./cmd/installer
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o "$PACKAGE_DIR/static/installer/aarch64/installer" ./cmd/installer

curl -fL "https://download.docker.com/linux/static/stable/x86_64/docker-$DOCKER_VERSION.tgz" -o "$OUT_DIR/docker-x86_64.tgz"
curl -fL "https://download.docker.com/linux/static/stable/aarch64/docker-$DOCKER_VERSION.tgz" -o "$OUT_DIR/docker-aarch64.tgz"
cp "$OUT_DIR/docker-$CENTER_DOCKER_ARCH.tgz" "$PACKAGE_DIR/docker.tgz"
cp "$OUT_DIR/docker-x86_64.tgz" "$PACKAGE_DIR/static/installer/x86_64/docker.tgz"
cp "$OUT_DIR/docker-aarch64.tgz" "$PACKAGE_DIR/static/installer/aarch64/docker.tgz"

cp Installation/center/install.sh "$PACKAGE_DIR/install.sh"
chmod +x "$PACKAGE_DIR/install.sh"
cp Installation/center/.env.example "$PACKAGE_DIR/.env.example"
sed \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/postgres:17.4-alpine3.21#monkeycode-offline/postgres:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/redis:8.0-alpine3.21#monkeycode-offline/redis:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/clickhouse-server:26.3.9#monkeycode-offline/clickhouse:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:1.0.0-beta.2#monkeycode-offline/rustfs:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/ingress:[^[:space:]]*#monkeycode-offline/ingress:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/taskflow:fc0daba#monkeycode-offline/taskflow:local#g' \
  -e 's#ghcr.1ms.run/chaitin/monkeycode-frontend:[^[:space:]]*#monkeycode-offline/frontend:local#g' \
  -e 's#chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/backend:[^[:space:]]*#monkeycode-offline/backend:local#g' \
  docker-compose.yml > "$PACKAGE_DIR/docker-compose.yml"

mkdir -p "$PACKAGE_DIR/static"
if [ -d static ]; then
  cp -R static/. "$PACKAGE_DIR/static/"
fi
curl -fL "$PROJECT_TPL_URL" -o "$PACKAGE_DIR/static/project-tpl.zip"

docker build \
  -f build/Dockerfile \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  --build-arg http_proxy="$HTTP_PROXY" \
  --build-arg https_proxy="$HTTPS_PROXY" \
  --build-arg no_proxy="$NO_PROXY" \
  --build-arg GOCACHE="$GOCACHE" \
  --build-arg GOMODCACHE="$GOMODCACHE" \
  --build-arg REPO_COMMIT="$REPO_COMMIT" \
  --build-arg BUILD_TARGET=server \
  -t monkeycode-offline/backend:local \
  .
docker build \
  -f build/Dockerfile.ingress \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  --build-arg http_proxy="$HTTP_PROXY" \
  --build-arg https_proxy="$HTTPS_PROXY" \
  --build-arg no_proxy="$NO_PROXY" \
  -t monkeycode-offline/ingress:local \
  .
docker build \
  -f ../frontend/docker/Dockerfile \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  --build-arg http_proxy="$HTTP_PROXY" \
  --build-arg https_proxy="$HTTPS_PROXY" \
  --build-arg no_proxy="$NO_PROXY" \
  -t monkeycode-offline/frontend:local \
  ../frontend/docker

docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/taskflow:fc0daba
docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/postgres:17.4-alpine3.21
docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/redis:8.0-alpine3.21
docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/clickhouse-server:26.3.9
docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:1.0.0-beta.2
docker pull chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/codingmatrix-orchestrator:alpha-latest
docker tag chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/taskflow:fc0daba monkeycode-offline/taskflow:local
docker tag chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/postgres:17.4-alpine3.21 monkeycode-offline/postgres:local
docker tag chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/redis:8.0-alpine3.21 monkeycode-offline/redis:local
docker tag chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/clickhouse-server:26.3.9 monkeycode-offline/clickhouse:local
docker tag chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:1.0.0-beta.2 monkeycode-offline/rustfs:local

docker save monkeycode-offline/backend:local | gzip > "$PACKAGE_DIR/images/backend.tar.gz"
docker save monkeycode-offline/frontend:local | gzip > "$PACKAGE_DIR/images/frontend.tar.gz"
docker save monkeycode-offline/ingress:local | gzip > "$PACKAGE_DIR/images/ingress.tar.gz"
docker save monkeycode-offline/taskflow:local | gzip > "$PACKAGE_DIR/images/taskflow.tar.gz"
docker save monkeycode-offline/postgres:local | gzip > "$PACKAGE_DIR/images/postgres.tar.gz"
docker save monkeycode-offline/redis:local | gzip > "$PACKAGE_DIR/images/redis.tar.gz"
docker save monkeycode-offline/clickhouse:local | gzip > "$PACKAGE_DIR/images/clickhouse.tar.gz"
docker save monkeycode-offline/rustfs:local | gzip > "$PACKAGE_DIR/images/rustfs.tar.gz"

build_host_bundle() {
  arch="$1"
  tmp="$OUT_DIR/host-$arch"
  rm -rf "$tmp"
  mkdir -p "$tmp/images"
  cp Installation/runner/docker-compose.yml "$tmp/docker-compose.yml"
  docker save chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/codingmatrix-orchestrator:alpha-latest | gzip > "$tmp/images/orchestrator.tar.gz"
  tar -C "$tmp" -czf "$PACKAGE_DIR/static/installer/$arch/host.tgz" .
}

build_host_bundle x86_64
build_host_bundle aarch64

scripts/check-offline-package.sh "$PACKAGE_DIR"
tar -C "$OUT_DIR" -czf "$OUT_DIR/$PACKAGE_NAME.tgz" "$PACKAGE_NAME"
echo "$OUT_DIR/monkeycode-offline-linux-$ARCH.tgz"
