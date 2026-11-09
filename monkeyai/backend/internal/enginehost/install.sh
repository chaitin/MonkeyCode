#!/bin/sh
set -eu
umask 077
fail() { printf '%s\n' "$1" >&2; exit 1; }
[ "$#" -eq 8 ] || fail '请从后台重新复制完整安装命令'
[ "$(uname -s)" = Linux ] || fail '仅支持 Linux 宿主'
[ "$(id -u)" -eq 0 ] || fail '请使用 sudo 执行安装命令'
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) fail '仅支持 amd64 / arm64' ;; esac
[ "$arch" = "$4" ] || fail '宿主架构与后台选择不一致，请重新生成命令'
case "$1" in http://*|https://*) ;; *) fail '后台地址必须使用 HTTP 或 HTTPS' ;; esac
case "$3" in ''|[.-]*|*[!a-zA-Z0-9._-]*) fail '发行版本无效' ;; esac
for digest in "$5" "$6"; do
 case "$digest" in ''|*[!a-f0-9]*) fail '校验摘要无效' ;; esac
 [ "${#digest}" -eq 64 ] || fail '校验摘要长度无效'
done
for tool in curl sha256sum mktemp systemctl systemd-run sed; do command -v "$tool" >/dev/null 2>&1 || fail "缺少工具: $tool"; done
[ -d /run/systemd/system ] || fail '宿主需要运行 systemd'
work=
unit=
submitted=false
journal_pid=
cleanup() {
 if [ -n "$journal_pid" ]; then kill "$journal_pid" 2>/dev/null || :; wait "$journal_pid" 2>/dev/null || :; fi
 [ -n "$work" ] && [ -d "$work" ] || return 0
 rm -f "$work/owner"
 if [ -f "$work/result" ]; then rm -rf "$work"; return 0; fi
 if [ "$submitted" = true ]; then
  state=$(systemctl show "$unit" --property=ActiveState 2>/dev/null) || return 0
  case "$state" in *ActiveState=active*|*ActiveState=activating*|*ActiveState=deactivating*|*ActiveState=reloading*) return 0 ;; esac
 fi
 rm -rf "$work"
}
trap cleanup EXIT
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
printf '下载并校验 installer / engine %s（%s）…\n' "$3" "$arch"
curl -k --proto '=http,https' --tlsv1.2 --fail --progress-bar --show-error --retry 3 --connect-timeout 15 --max-time 900 "$1/api/host/v1/releases/$3/$4/$8" -o "$work/installer"
printf '%s  %s\n' "$5" "$work/installer" | sha256sum -c - >/dev/null || fail '安装器校验失败'
chmod 700 "$work/installer"
case "$8" in
 installer) set -- "$work/installer" monkeyai-engine install --insecure --server "$1" --enrollment "$2" --release "$3" --architecture "$4" --manifest-sha256 "$6" --data-dir "$7" ;;
 monkeyai-engine) [ -n "$2" ] || fail '首次安装请从后台添加宿主并复制接入命令'; [ -n "$7" ] || set -- "$1" "$2" "$3" "$4" "$5" "$6" /var/lib/monkeyai-engine/data "$8"; set -- "$work/installer" install --insecure --server "$1" --enrollment "$2" --release "$3" --architecture "$4" --manifest-sha256 "$6" --data-dir "$7" ;;
 *) fail '安装器名称无效' ;;
esac
# 完成回执避免依赖旧 systemd 保留已结束的任务状态。
unit=monkeyai-engine-install-${work##*.}.service
printf '%s' "$$" > "$work/owner"
{
 printf '#!/bin/sh\nexec'
 for arg do
  escaped=$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")
  printf " '%s'" "$escaped"
 done
 printf '\n'
} > "$work/command.sh"
chmod 700 "$work/command.sh"
cat > "$work/run.sh" <<'RUN'
#!/bin/sh
set -u
work=${0%/*}
cleanup() {
 owner=$(cat "$work/owner" 2>/dev/null || :)
 if [ -z "$owner" ] || ! kill -0 "$owner" 2>/dev/null; then rm -rf "$work"; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
printf 'started' > "$work/started"
/bin/sh "$work/command.sh"
status=$?
printf '%s' "$status" > "$work/result.tmp"
mv "$work/result.tmp" "$work/result"
exit "$status"
RUN
chmod 700 "$work/run.sh"
printf '启动独立安装任务：%s\n' "$unit"
submitted=true
tty_started=false
if [ -t 0 ] && [ -t 1 ] && systemd-run -t --help >/dev/null 2>&1; then
 tty_started=true
 systemd-run --unit="$unit" -t /bin/sh "$work/run.sh" || :
 if [ ! -f "$work/started" ] && [ ! -f "$work/result" ]; then
  load=$(systemctl show "$unit" --property=LoadState 2>/dev/null || :)
  case "$load" in
   *LoadState=not-found*)
    if [ ! -f "$work/started" ] && [ ! -f "$work/result" ]; then
     tty_started=false
     printf '终端任务未启动，改用非交互安装。\n'
    fi
    ;;
  esac
 fi
fi
if [ "$tty_started" = false ]; then
 if ! systemd-run --unit="$unit" /bin/sh "$work/run.sh"; then
  if [ ! -f "$work/started" ] && [ ! -f "$work/result" ]; then
   submitted=false
   fail '无法启动 systemd 安装任务'
  fi
 fi
 if command -v journalctl >/dev/null 2>&1; then
  journalctl --unit="$unit" --follow --no-pager -n 100 &
  journal_pid=$!
 fi
fi
 while :; do
  if [ -f "$work/result" ]; then
   status=$(cat "$work/result")
   active=inactive sub=dead code=1 result=exit-code
   [ "$status" != 0 ] || result=success
  else
   state=$(systemctl show "$unit" --property=LoadState --property=ActiveState --property=SubState --property=Result --property=ExecMainCode --property=ExecMainStatus) || fail '无法查询 systemd 安装任务，请使用 journalctl 检查'
   load= active= sub= result= code= status=
   while IFS='=' read -r key value; do
    case "$key" in
     LoadState) load=$value ;; ActiveState) active=$value ;; SubState) sub=$value ;;
     Result) result=$value ;; ExecMainCode) code=$value ;; ExecMainStatus) status=$value ;;
    esac
   done <<STATE
$state
STATE
   if [ "$load" = not-found ]; then
    [ ! -f "$work/result" ] || continue
    fail 'systemd 安装任务不存在'
   fi
   if [ "$active:$sub:$result:$code" = inactive:dead:success:0 ]; then sleep 1; continue; fi
  fi
  case "$active:$sub" in
   active:exited|failed:*|inactive:dead)
    if [ -z "$journal_pid" ] && command -v journalctl >/dev/null 2>&1; then journalctl --unit="$unit" --no-pager -n 100 || :; fi
    systemctl stop "$unit" >/dev/null 2>&1 || :
    systemctl reset-failed "$unit" >/dev/null 2>&1 || :
    submitted=false
    if [ "$result" = success ] && [ "$code" = 1 ] && [ "$status" = 0 ]; then exit 0; fi
    case "$status" in ''|*[!0-9]*) status=1 ;; esac
    if [ "$code" = 2 ] || [ "$code" = 3 ]; then status=$((128 + status)); fi
    [ "$status" -ge 1 ] && [ "$status" -le 255 ] || status=1
    printf '安装任务未成功：%s（%s/%s）\n' "$unit" "$result" "$status" >&2
    exit "$status"
    ;;
  esac
  sleep 1
 done
