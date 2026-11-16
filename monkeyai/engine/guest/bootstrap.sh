#!/bin/sh
set -eu

case " $(cat /proc/cmdline) " in
  *" monkeyai.guest=1 "*) ;;
  *) echo '缺少平台虚拟机启动标识' >&2; exit 1 ;;
esac

mkdir -p /mnt/monkeyai-data
mountpoint -q /mnt/monkeyai-data || mount -t ext4 -o rw,nodev,nosuid /dev/vdb /mnt/monkeyai-data
for name in workspace home runtime; do
  test ! -L "/mnt/monkeyai-data/$name"
  mkdir -p "/mnt/monkeyai-data/$name"
done
mkdir -p /workspace /home/monkey /var/lib/monkeyai
mountpoint -q /workspace || mount --bind /mnt/monkeyai-data/workspace /workspace
mountpoint -q /home/monkey || mount --bind /mnt/monkeyai-data/home /home/monkey
mountpoint -q /var/lib/monkeyai || mount --bind /mnt/monkeyai-data/runtime /var/lib/monkeyai

if test ! -e /mnt/monkeyai-data/.initialized; then
  mkdir -p /var/lib/monkeyai/state
  chown 1000:1000 /workspace /home/monkey /var/lib/monkeyai /var/lib/monkeyai/state
  chmod 700 /var/lib/monkeyai/state
  touch /mnt/monkeyai-data/.initialized
  sync
fi

test -d /var/lib/monkeyai/state
exec /opt/monkeyai/monkeyai-guest
