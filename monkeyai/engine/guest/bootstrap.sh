#!/bin/sh
set -eu

case " $(cat /proc/cmdline) " in
  *" monkeyai.guest=1 "*) ;;
  *) echo '缺少平台虚拟机启动标识' >&2; exit 1 ;;
esac

for path in /workspace /home/monkey /var/lib/monkeyai /var/lib/monkeyai/state; do
  test ! -L "$path"
  if test -e /var/lib/monkeyai/.initialized; then
    test -d "$path"
  else
    mkdir -p "$path"
  fi
done
if test ! -e /var/lib/monkeyai/.initialized; then
  chown 1000:1000 /workspace /home/monkey /var/lib/monkeyai/state
  chown 0:0 /var/lib/monkeyai
  chmod 755 /var/lib/monkeyai
  chmod 700 /var/lib/monkeyai/state
  touch /var/lib/monkeyai/.initialized
  sync
fi

test -d /var/lib/monkeyai/state
exec /opt/monkeyai/monkeyai-guest
