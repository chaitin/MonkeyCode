#!/bin/sh
set -eu

ROOT="${1:?package dir required}"

required="
install.sh
installer
docker.tgz
docker-compose.yml
.env.example
manifest.json
images/backend.tar.gz
images/frontend.tar.gz
images/taskflow.tar.gz
images/preview.tar.gz
images/ingress.tar.gz
images/postgres.tar.gz
images/redis.tar.gz
images/clickhouse.tar.gz
images/rustfs.tar.gz
static/project-tpl.zip
static/firefactory-offline_1.0.0+g741818d_amd64.tgz
static/installer/x86_64/installer
static/installer/x86_64/docker.tgz
static/installer/x86_64/host.tgz
static/installer/aarch64/installer
static/installer/aarch64/docker.tgz
static/installer/aarch64/host.tgz
"

for file in $required; do
  if [ ! -f "$ROOT/$file" ]; then
    echo "missing $file"
    exit 1
  fi
done

python3 -m json.tool "$ROOT/manifest.json" >/dev/null

for file in static/installer/x86_64/host.tgz static/installer/aarch64/host.tgz; do
  if ! grep -q "\"path\":\"$file\"" "$ROOT/manifest.json" && ! grep -q "\"path\": \"$file\"" "$ROOT/manifest.json"; then
    echo "manifest missing $file"
    exit 1
  fi
done
