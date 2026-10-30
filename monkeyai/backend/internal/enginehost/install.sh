#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 7 ] || fail '请从后台重新复制完整安装命令'
[ "$(uname -s)" = Linux ] || fail '仅支持 Linux 宿主'
[ "$(id -u)" -eq 0 ] || fail '请使用 sudo 执行安装命令'
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) fail '仅支持 amd64 / arm64' ;; esac
[ "$arch" = "$4" ] || fail '宿主架构与后台选择不一致，请重新生成命令'
case "$1" in https://*) ;; *) fail '后台地址必须使用 HTTPS' ;; esac
case "$3" in ''|[.-]*|*[!a-zA-Z0-9._-]*) fail '发行版本无效' ;; esac
for digest in "$5" "$6"; do
 case "$digest" in ''|*[!a-f0-9]*) fail '校验摘要无效' ;; esac
 [ "${#digest}" -eq 64 ] || fail '校验摘要长度无效'
done
for tool in curl sha256sum mktemp systemctl; do command -v "$tool" >/dev/null 2>&1 || fail "缺少工具: $tool"; done
[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'
work=
trap '[ -z "$work" ] || rm -rf "$work"' EXIT
probe=/bin/true
[ -f "$probe" ] || probe=/usr/bin/true
for root in /var/tmp /opt/monkeyai-engine/tmp; do
 [ ! -L "$root" ] || continue
 mkdir -p "$root" 2>/dev/null || continue
 candidate=$(mktemp -d "$root/monkeyai-engine.XXXXXX") || continue
 if cp "$probe" "$candidate/true" && chmod 700 "$candidate/true" && "$candidate/true" 2>/dev/null; then
  work=$candidate
  break
 fi
 rm -rf "$candidate"
done
[ -n "$work" ] || fail '找不到允许执行的私有临时目录'
trap 'exit 1' HUP INT TERM
printf '下载并校验 monkeyai-engine %s（%s）…\n' "$3" "$arch"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 3 --connect-timeout 15 --max-time 900 "$1/api/host/v1/releases/$3/$4/monkeyai-engine" -o "$work/monkeyai-engine"
printf '%s  %s\n' "$5" "$work/monkeyai-engine" | sha256sum -c - >/dev/null || fail '安装器校验失败'
chmod 700 "$work/monkeyai-engine"
"$work/monkeyai-engine" install --server "$1" --enrollment "$2" --release "$3" --architecture "$4" --manifest-sha256 "$6" --data-dir "$7"
