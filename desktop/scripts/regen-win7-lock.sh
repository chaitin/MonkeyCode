#!/usr/bin/env bash
# 重新生成 Cargo.lock.win7 —— Cargo.toml 改依赖后必跑(desktop-win7.yml 用它 + --locked 构建)。
#
# 为什么不能直接 `cargo update` / 复制主 Cargo.lock:
#   1) 主 Cargo.lock 是 lockfile v4(cargo>=1.78 写),cargo 1.77.2 根本读不了 —— win7 锁必须 v3。
#   2) 无 MSRV 感知的 1.77.2 解析器会挑最新依赖,拉进 edition2024 crate(rust>=1.85)。
#      只要它被"下载+解析"就报 `feature edition2024 is required` 而整个构建挂 —— 哪怕它压根不参与编译。
#
# 关键区分(踩过的坑):
#   - **target 门控**的 edition2024 crate(security-framework=macOS、wit-bindgen<-wasip2=wasm)在
#     windows 目标上被 cargo 直接剪掉、不下载 —— 无害,留着即可(老锁一直带着它俩)。
#   - **feature 门控但 target 满足**的可选子树会照常被下载解析 —— 这正是 reqwest 的 http3/quinn:
#     我们没开 http3、quinn 永不编译,但它 cfg(not(wasm32)) 在 windows 上成立 ⇒ cargo 仍下载其
#     manifest。quinn-proto>=0.11.15 是 edition2024 ⇒ 直接把 win7 构建打挂。
#   故:把 quinn 可选子树钉在 edition<=2021 的最高版本(quinn 0.11.9 / quinn-proto 0.11.14,
#   连带 rand 0.9 / getrandom 0.3),让整棵树对 1.77.2 可解析。若 reqwest 抬高了 quinn 的下限
#   (下方 --precise 报"didn't match"),按 `cargo +1.77.2 tree` 找到当时最高的 edition<=2021
#   quinn/quinn-proto 组合更新这两行即可。
#
# 幂等:改依赖后重跑本脚本,提交产物 Cargo.lock.win7。产物只应比老锁"多"出新依赖子树,
# tauri 栈版本一字不变。

set -euo pipefail
cd "$(dirname "$0")/.."   # -> desktop/

TOOLCHAIN=1.77.2
LOCK=Cargo.lock
WIN7=Cargo.lock.win7

command -v rustup >/dev/null || { echo "需要 rustup(装 $TOOLCHAIN 工具链)"; exit 1; }
rustup toolchain list | grep -q "^$TOOLCHAIN" || rustup toolchain install "$TOOLCHAIN"

# 主 Cargo.lock(v4,给 macOS/Win10 通道用)不能被本次改动污染 —— 用完必还原
BACKUP_MAIN=""
if [ -f "$LOCK" ]; then BACKUP_MAIN=$(mktemp); cp "$LOCK" "$BACKUP_MAIN"; fi
restore_main() { [ -n "$BACKUP_MAIN" ] && cp "$BACKUP_MAIN" "$LOCK" && rm -f "$BACKUP_MAIN"; }
trap restore_main EXIT

# 1) 以现有 win7 锁为种子,保住 tauri 栈那批降级 pin(tempfile/uuid/... 早已为 1.77.2 钉低)
cp "$WIN7" "$LOCK"

# 2) 增量解析:只补 Cargo.toml 新增依赖、保留其余 pin,产出仍是 v3。
#    必须用"仅解析"的命令(update/--precise),它只读 index 摘要、不解析 crate manifest,
#    故不会撞 edition2024;绝不能用 metadata/build/fetch/tree(会下载+解析所有 manifest 而挂)。
#    拿 serde 当"钉自己"的锚点触发一次全图 reconcile。
SERDE_VER=$(awk '/^name = "serde"$/{f=1} f&&/^version/{gsub(/[",]/,"");print $3;exit}' "$LOCK")
cargo "+$TOOLCHAIN" update -p serde --precise "$SERDE_VER" >/dev/null

# 3) 压回 reqwest 的 http3/quinn 可选子树到 edition<=2021(见顶部说明)
cargo "+$TOOLCHAIN" update -p quinn        --precise 0.11.9  >/dev/null
cargo "+$TOOLCHAIN" update -p quinn-proto  --precise 0.11.14 >/dev/null

# 4) 硬校验 —— 宁可脚本响亮失败,也不产出个能过 --locked 却在真机构建阶段挂的锁
head -3 "$LOCK" | grep -qx 'version = 3' || { echo "FAIL: 锁不是 v3(cargo 1.77.2 读不了)"; exit 1; }

# getrandom 0.4.x = edition2024,且经 quinn(非 target 门控)会被 windows 构建下载 ⇒ 必须为零
if grep -qE '"getrandom 0\.4' "$LOCK"; then
  echo "FAIL: 锁里仍有 getrandom 0.4.x(edition2024)——quinn 子树没压干净,见脚本顶部说明"; exit 1
fi

# 兜底:枚举锁里所有 crate,凡本地缓存能查到 edition=2024 且不属于已知 target 门控白名单的，报警
REG=$(ls -d "$HOME"/.cargo/registry/src/*/ 2>/dev/null | head -1 || true)
if [ -n "$REG" ]; then
  WHITELIST='security-framework wit-bindgen'   # 仅 macOS / wasm 目标可达，windows 构建剪掉，无害
  awk '/^\[\[package\]\]/{n="";v=""} /^name = /{gsub(/[",]/,"");n=$3} /^version = /{gsub(/[",]/,"");v=$3; if(n)print n" "v}' "$LOCK" \
  | while read -r n v; do
      d="$REG/$n-$v"; [ -d "$d" ] || continue
      [ "$(grep -m1 '^edition = ' "$d/Cargo.toml" 2>/dev/null | tr -d '" ' | sed 's/edition=//')" = "2024" ] || continue
      echo " $WHITELIST " | grep -q " $n " && continue
      echo "WARN: edition2024 且非白名单:$n $v —— 确认它在 windows 目标上不可达,否则需压版"
    done
fi

# 5) 落盘
cp "$LOCK" "$WIN7"
echo "OK: 已重新生成 $WIN7 (v3)。git diff 应只增不改,tauri 栈版本不动。"
