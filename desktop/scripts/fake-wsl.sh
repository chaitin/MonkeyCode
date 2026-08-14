#!/usr/bin/env bash
# 假 wsl.exe:在无 Windows 的开发机上冒烟壳的 WSL 代码路径。
# 用法:MC_WSL_EXE=$(pwd)/scripts/fake-wsl.sh MC_OHMYAGENT_LINUX_BIN=<本机引擎二进制>\
#       且 config.json 写 "kernel_env": "wsl:Ubuntu-22.04",启动 desktop。
# 输出契约与 wsl.rs::parse_prepare_output 对表;FAKE_WSL_NETWORKING=mirrored
# 可冒烟浏览器 MCP 不降级的分支。开发工具,不随包分发。
set -u

# wsl -l -q:发行版列表(FAKE_WSL_UTF16=1 时输出 BOM + UTF-16LE + CRLF,
# 模拟老版 wsl.exe,验证壳的双解码)
if [ "${1:-}" = "-l" ]; then
  if [ -n "${FAKE_WSL_UTF16:-}" ]; then
    printf '\xff\xfe'
    printf 'Ubuntu-22.04\r\ndocker-desktop\r\n' | iconv -f UTF-8 -t UTF-16LE
  else
    printf 'Ubuntu-22.04\ndocker-desktop\n'
  fi
  exit 0
fi

distro=""
if [ "${1:-}" = "-d" ]; then distro="${2:-}"; shift 2; fi
# "broken" 发行版恒失败:冒烟 prepare 失败的外显路径(e2e_wsl_prepare_failure_surfaces)
if [ "$distro" = "broken" ]; then
  echo "fake-wsl: 发行版 broken 不可用" >&2
  exit 1
fi
[ "${1:-}" = "--exec" ] || { echo "fake-wsl: 仅支持 --exec 形态,得到: $*" >&2; exit 1; }
shift

case "${1:-}" in
  /bin/sh)
    # 壳的两种 /bin/sh -c 探测形态按脚本内容区分(开发机没有 wslpath/wslinfo)
    script="${3:-}"
    case "$script" in
      *wslpath*)
        # prepare($1=/bin/sh $2=-c $3=脚本 $4=sh $5..=路径):
        # HOME、登录 shell、网络模式各一行,再逐路径恒等回显(本机翻译即恒等)。
        # 登录 shell 可切 zsh，覆盖 shell-specific 环境采集路径。
        shift 4
        printf '%s\n' "${HOME:-/root}" "${FAKE_WSL_SHELL:-/bin/bash}" "${FAKE_WSL_NETWORKING:-nat}"
        for p in "$@"; do printf '%s\n' "$p"; done
        ;;
      *wslinfo*)
        # networking_mode 独立探测(mcp.json 物化时)
        printf '%s\n' "${FAKE_WSL_NETWORKING:-nat}"
        ;;
      *"pwd -P"*)
        # ensure_guest_dir(workdir 判定/创建 + canonical 化):本机恒等,真执行
        exec "$@"
        ;;
      *"__MONKEYCODE_ENV_BEGIN__"*)
        # baseline 环境采集：marker + env -0 保持原始字节输出。
        exec "$@"
        ;;
      *"OHMYAGENT_CONFIG_DIR"*)
        # 干净的 WSL 引擎启动器:本机直接执行同一固定脚本。
        exec "$@"
        ;;
      *)
        echo "fake-wsl: 未知 /bin/sh -c 脚本: $script" >&2
        exit 1
        ;;
    esac
    ;;
  pkill)
    exec "$@"
    ;;
  *)
    # serve 调用(<登录shell> -l -c 'cd "$1" && exec "$2" --stdio' mc-engine <dir> <bin>):
    # 登录 shell 本机真实存在,直接执行,stdin/stdout 透传
    exec "$@"
    ;;
esac
