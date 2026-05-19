#!/bin/sh
set -eu

ROOT="${1:?package dir required}"

required="
install.sh
installer
docker.tgz
docker-compose.yml
.env.example
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
