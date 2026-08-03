#!/usr/bin/env python3
"""汇集 updater 发布物:重命名为带版本文件名 + 生成对应平台的更新清单。

用法: gen-latest-json.py [macos|windows|linux]   (缺省 macos)

三条更新通道各自独立,清单由对应平台的发布构建产出,互不协调:
  macos   → latest.json          (darwin 双架构,universal .app.tar.gz)
  windows → latest-windows.json  (windows-x86_64,NSIS setup exe)
  linux   → latest-linux.json    (linux-x86_64,**只有 AppImage**)

Linux 只发 AppImage:updater 在 Linux 是把新包原地覆盖当前 AppImage 文件
(tauri-plugin-updater 的 install_appimage),deb/rpm 装出来的是 /usr/bin 下
的普通可执行文件,覆盖不了也不该覆盖——那两种由包管理器负责升级,壳侧对
非 AppImage 运行直接不提示更新(main.rs updater_supported)。

产物集中在 bundle 目录下的 updater/,人工上传 OSS(public/desktop/):
先传包,再覆盖清单,顺序保证客户端不会拉到不存在的包。
"""

import json
import pathlib
import shutil
import sys
from datetime import datetime, timezone

# Windows 的 Python 默认 locale 编码(cp1252):文件读写与 stdout/stderr 的
# 中文都会炸,进程内所有文本 IO 统一钉死 UTF-8
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL_BASE = "https://release.monkeycode-ai.com/public/desktop/"

# 显式 UTF-8:Windows 的 Python 默认用 locale 编码(cp1252),读含中文的文件会炸
version = json.loads((ROOT / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
short = version.removesuffix(".0.0")  # 26071401.0.0 → 26071401

platform = sys.argv[1] if len(sys.argv) > 1 else "macos"

if platform == "macos":
    bundle = ROOT / "target/universal-apple-darwin/release/bundle"
    src = bundle / "macos/MonkeyCode.app.tar.gz"
    name = f"MonkeyCode_{short}_universal.app.tar.gz"
    manifest_name = "latest.json"
    # universal 包同时服务两种架构,两个 target key 指向同一 URL
    targets = ["darwin-aarch64", "darwin-x86_64"]
elif platform == "windows":
    bundle = ROOT / "target/release/bundle"
    src = bundle / f"nsis/MonkeyCode_{version}_x64-setup.exe"
    name = f"MonkeyCode_{short}_x64-setup.exe"
    manifest_name = "latest-windows.json"
    targets = ["windows-x86_64"]
elif platform == "linux":
    bundle = ROOT / "target/release/bundle"
    # AppImage 文件名用 Tauri 的 x86_64 命名(非 deb 的 amd64)
    src = bundle / f"appimage/MonkeyCode_{version}_amd64.AppImage"
    name = f"MonkeyCode_{short}_amd64.AppImage"
    manifest_name = "latest-linux.json"
    targets = ["linux-x86_64"]
else:
    sys.exit(f"未知平台: {platform}(可选 macos/windows/linux)")

sig = pathlib.Path(str(src) + ".sig")
if not src.exists() or not sig.exists():
    sys.exit(
        f"缺少 updater 产物: {src}(.sig)\n"
        "需要带签名的发布构建(--config tauri.release.conf.json,"
        "设置 TAURI_SIGNING_PRIVATE_KEY)"
    )

out = bundle / "updater"
out.mkdir(exist_ok=True)
shutil.copy2(src, out / name)

entry = {"signature": sig.read_text(encoding="utf-8"), "url": URL_BASE + name}
manifest = {
    "version": version,
    "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {t: entry for t in targets},
}
(out / manifest_name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"updater 产物就绪: {out / name} + {manifest_name}(版本 {version})")
