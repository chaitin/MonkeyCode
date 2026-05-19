#!/bin/sh
set -eu

ARCH="${ARCH:-amd64}"
DOCKER_VERSION="${DOCKER_VERSION:-29.4.3}"
DOCKER_COMPOSE_VERSION="${DOCKER_COMPOSE_VERSION:-v5.1.3}"
PROJECT_TPL_URL="${PROJECT_TPL_URL:-https://baizhiyun.oss-cn-hangzhou.aliyuncs.com/codingmatrix/project-tpl/codingmatrix-project-tpl.master.zip}"
OUT_DIR="${OUT_DIR:-dist/offline}"
PACKAGE_NAME="monkeycode-offline-linux-$ARCH"
PACKAGE_DIR="$OUT_DIR/$PACKAGE_NAME"
PACKAGE_TGZ="${PACKAGE_TGZ:-false}"
GOCACHE="${GOCACHE:-/root/.cache/go-build}"
GOMODCACHE="${GOMODCACHE:-/go/pkg/mod}"
REPO_COMMIT="${REPO_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
IMAGE_TAG="${IMAGE_TAG:-$(git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
BACKEND_IMAGE="${BACKEND_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/backend:$IMAGE_TAG}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-ghcr.1ms.run/chaitin/monkeycode-frontend:$IMAGE_TAG}"
INGRESS_IMAGE="${INGRESS_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/ingress:$IMAGE_TAG}"
TASKFLOW_IMAGE="${TASKFLOW_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/taskflow:d6d33f3}"
PREVIEW_IMAGE="${PREVIEW_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/preview-relay:2502c9d}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/postgres:17.4-alpine3.21}"
REDIS_IMAGE="${REDIS_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/redis:8.0-alpine3.21}"
CLICKHOUSE_IMAGE="${CLICKHOUSE_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/clickhouse-server:26.3.9}"
RUSTFS_IMAGE="${RUSTFS_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:1.0.0-beta.2}"
ORCHESTRATOR_IMAGE="${ORCHESTRATOR_IMAGE:-chaitin-registry.cn-hangzhou.cr.aliyuncs.com/monkeycode/codingmatrix-orchestrator:alpha-latest}"
DEVBOX_IMAGE="${DEVBOX_IMAGE:-ghcr.io/chaitin/monkeycode-runner/devbox:latest}"
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
curl -fL "https://github.com/docker/compose/releases/download/$DOCKER_COMPOSE_VERSION/docker-compose-linux-x86_64" -o "$OUT_DIR/docker-compose-linux-x86_64"
curl -fL "https://github.com/docker/compose/releases/download/$DOCKER_COMPOSE_VERSION/docker-compose-linux-aarch64" -o "$OUT_DIR/docker-compose-linux-aarch64"

build_docker_bundle() {
  arch="$1"
  docker_arch="$2"
  compose_arch="$3"
  output="$4"
  tmp="$OUT_DIR/docker-bundle-$arch"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  tar -zxf "$OUT_DIR/docker-$docker_arch.tgz" -C "$tmp"
  cp "$OUT_DIR/docker-compose-linux-$compose_arch" "$tmp/docker-compose"
  tar -C "$tmp" -czf "$output" .
}

build_docker_bundle "$CENTER_DOCKER_ARCH" "$CENTER_DOCKER_ARCH" "$CENTER_DOCKER_ARCH" "$PACKAGE_DIR/docker.tgz"
build_docker_bundle "x86_64" "x86_64" "x86_64" "$PACKAGE_DIR/static/installer/x86_64/docker.tgz"
build_docker_bundle "aarch64" "aarch64" "aarch64" "$PACKAGE_DIR/static/installer/aarch64/docker.tgz"

cp installation/center/install.sh "$PACKAGE_DIR/install.sh"
chmod +x "$PACKAGE_DIR/install.sh"
cp installation/center/.env.example "$PACKAGE_DIR/.env.example"
set_env_value() {
  key="$1"
  value="$2"
  tmp="$PACKAGE_DIR/.env.example.tmp"
  if grep -q "^$key=" "$PACKAGE_DIR/.env.example"; then
    sed "s#^$key=.*#$key=$value#" "$PACKAGE_DIR/.env.example" > "$tmp"
  else
    cp "$PACKAGE_DIR/.env.example" "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$PACKAGE_DIR/.env.example"
}

set_env_value POSTGRES_IMAGE "$POSTGRES_IMAGE"
set_env_value REDIS_IMAGE "$REDIS_IMAGE"
set_env_value CLICKHOUSE_IMAGE "$CLICKHOUSE_IMAGE"
set_env_value RUSTFS_IMAGE "$RUSTFS_IMAGE"
set_env_value INGRESS_IMAGE "$INGRESS_IMAGE"
set_env_value TASKFLOW_IMAGE "$TASKFLOW_IMAGE"
set_env_value PREVIEW_IMAGE "$PREVIEW_IMAGE"
set_env_value FRONTEND_IMAGE "$FRONTEND_IMAGE"
set_env_value BACKEND_IMAGE "$BACKEND_IMAGE"
set_env_value INIT_TEAM_IMAGE "$DEVBOX_IMAGE"

cp docker-compose.yml "$PACKAGE_DIR/docker-compose.yml"

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
  -t "$BACKEND_IMAGE" \
  .
docker build \
  -f build/Dockerfile.ingress \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  --build-arg http_proxy="$HTTP_PROXY" \
  --build-arg https_proxy="$HTTPS_PROXY" \
  --build-arg no_proxy="$NO_PROXY" \
  -t "$INGRESS_IMAGE" \
  .
docker build \
  -f ../frontend/docker/Dockerfile \
  --build-arg HTTP_PROXY="$HTTP_PROXY" \
  --build-arg HTTPS_PROXY="$HTTPS_PROXY" \
  --build-arg NO_PROXY="$NO_PROXY" \
  --build-arg http_proxy="$HTTP_PROXY" \
  --build-arg https_proxy="$HTTPS_PROXY" \
  --build-arg no_proxy="$NO_PROXY" \
  -t "$FRONTEND_IMAGE" \
  ../frontend/docker

docker pull "$TASKFLOW_IMAGE"
docker pull "$PREVIEW_IMAGE"
docker pull "$POSTGRES_IMAGE"
docker pull "$REDIS_IMAGE"
docker pull "$CLICKHOUSE_IMAGE"
docker pull "$RUSTFS_IMAGE"
docker pull "$ORCHESTRATOR_IMAGE"
docker pull "$DEVBOX_IMAGE"

docker save "$BACKEND_IMAGE" | gzip > "$PACKAGE_DIR/images/backend.tar.gz"
docker save "$FRONTEND_IMAGE" | gzip > "$PACKAGE_DIR/images/frontend.tar.gz"
docker save "$INGRESS_IMAGE" | gzip > "$PACKAGE_DIR/images/ingress.tar.gz"
docker save "$TASKFLOW_IMAGE" | gzip > "$PACKAGE_DIR/images/taskflow.tar.gz"
docker save "$PREVIEW_IMAGE" | gzip > "$PACKAGE_DIR/images/preview.tar.gz"
docker save "$POSTGRES_IMAGE" | gzip > "$PACKAGE_DIR/images/postgres.tar.gz"
docker save "$REDIS_IMAGE" | gzip > "$PACKAGE_DIR/images/redis.tar.gz"
docker save "$CLICKHOUSE_IMAGE" | gzip > "$PACKAGE_DIR/images/clickhouse.tar.gz"
docker save "$RUSTFS_IMAGE" | gzip > "$PACKAGE_DIR/images/rustfs.tar.gz"

build_host_bundle() {
  arch="$1"
  tmp="$OUT_DIR/host-$arch"
  rm -rf "$tmp"
  mkdir -p "$tmp/images"
  cp installation/runner/docker-compose.yml "$tmp/docker-compose.yml"
  printf 'ORCHESTRATOR_IMAGE=%s\n' "$ORCHESTRATOR_IMAGE" > "$tmp/.env"
  docker save "$ORCHESTRATOR_IMAGE" | gzip > "$tmp/images/orchestrator.tar.gz"
  docker save "$DEVBOX_IMAGE" | gzip > "$tmp/images/devbox.tar.gz"
  tar -C "$tmp" -czf "$PACKAGE_DIR/static/installer/$arch/host.tgz" .
}

build_host_bundle x86_64
build_host_bundle aarch64

scripts/check-offline-package.sh "$PACKAGE_DIR"
if [ "$PACKAGE_TGZ" = "true" ]; then
  tar -C "$OUT_DIR" -czf "$OUT_DIR/$PACKAGE_NAME.tgz" "$PACKAGE_NAME"
  echo "$OUT_DIR/$PACKAGE_NAME.tgz"
else
  echo "$PACKAGE_DIR"
fi
