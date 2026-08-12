# desktop 构建与打包。
#
# 引擎 sidecar 源码缺省取仓库根的 agent/ submodule(git submodule update --init agent);
# 要用别处的 ohmyagent 检出时可覆盖:
#   export OHMYAGENT_SRC=/path/to/ohmyagent
#
# macOS 打包(在 Mac 上执行):
#   make macos          # universal .app/.dmg,引擎 sidecar 打进包
# 前置:Go 1.25+、Node 22、Rust 且已加双架构 target:
#   rustup target add aarch64-apple-darwin x86_64-apple-darwin
#
# Windows 打包(在 Windows 上执行,Git Bash/MSYS;无 Windows 机器时走
# CI: .github/workflows/desktop-windows.yml):
#   make windows        # NSIS 安装包,引擎 sidecar 打进包
#
# Linux 打包(在 Linux 上执行):
#   make linux          # deb + rpm + AppImage,引擎 sidecar 打进包
# 前置:webkit2gtk-4.1/gtk3 开发包;AppImage 首次打包会联网取 linuxdeploy。
#
# 打包配置文件一律叫 bundle.<平台>.conf.json,**不能**叫
# tauri.<平台>.conf.json:后者是 Tauri 的平台自动合并约定
# (tauri-utils/src/config/parse.rs),它会被无条件并进该平台上的每次
# cargo build/check,把只属于打包的 active/externalBin/resources 拖进
# 普通开发构建——实测 `cargo check` 会直接报
# "resource path binaries/ohmyagent-<triple> doesn't exist"。
# 打包配置只经 --config 显式传入,由 check-bundle-configs 守住命名。

# 缺省 = agent/ submodule;未初始化时下方守卫会给出可执行的报错
OHMYAGENT_SRC ?= $(abspath $(CURDIR)/../agent)
# 写入 Agent 的 --version/system/ready，始终对应实际参与构建的 checkout。
AGENT_VERSION ?= $(shell git -C "$(OHMYAGENT_SRC)" rev-parse --short HEAD 2>/dev/null)
BIN_DIR     := binaries
SIDECAR_ARM := $(BIN_DIR)/ohmyagent-aarch64-apple-darwin
SIDECAR_X64 := $(BIN_DIR)/ohmyagent-x86_64-apple-darwin
SIDECAR_UNI := $(BIN_DIR)/ohmyagent-universal-apple-darwin
SIDECAR_WIN := $(BIN_DIR)/ohmyagent-x86_64-pc-windows-msvc.exe
SIDECAR_LIN := $(BIN_DIR)/ohmyagent-x86_64-unknown-linux-gnu
# Windows 包附带的 WSL 引擎(bundle.resources 单文件映射保留 basename,
# 名字即安装根落地名,与壳 find_ohmyagent_linux 的查找约定一致)
SIDECAR_WIN_WSL := $(BIN_DIR)/ohmyagent-linux
TAURI       := npx --yes @tauri-apps/cli@^2
# 版本注入的符号路径必须是**全限定**的:`-X main.Version=` 里 package main
# 根本没有 Version 变量,Go 链接器对不存在的符号**静默忽略**,于是引擎一路
# 退回 buildinfo.Version 的缺省值 "dev",设置·关于里显示的就是 dev
# (2026-08-09 用户报障)。改错这里不会有任何构建报错,check_bundle_configs.py
# 已加守卫对表 agent 源码里真实的变量位置。
AGENT_VERSION_SYM := github.com/chaitin/ohmyagent/internal/buildinfo.Version
GOFLAGS     := -trimpath -ldflags "-s -w -X $(AGENT_VERSION_SYM)=$(AGENT_VERSION)"
GOFLAGS_WIN := -trimpath -ldflags "-s -w -H=windowsgui -X $(AGENT_VERSION_SYM)=$(AGENT_VERSION)"

.PHONY: dev run macos macos-release set-release-version windows windows-release linux linux-release check-signing check-macos check-windows check-linux check-bundle-configs check-ohmy-src engine-universal engine-windows engine-linux browser-extension icons clean

# ---------- 开发 ----------

dev:
	cargo build

run: dev
	./target/debug/monkeycode-desktop

# ---------- macOS 打包(universal .app/.dmg,引擎 sidecar)----------

macos: check-macos check-bundle-configs engine-universal browser-extension icons/icon.icns
	$(TAURI) build --target universal-apple-darwin --config bundle.macos.conf.json $(EXTRA_TAURI_CONFIG)
	@echo ""
	@echo "打包完成,分发产物:"
	@ls -lh target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null || true
	@echo "(.app 在 target/universal-apple-darwin/release/bundle/macos/)"
	@echo "提示: 包未签名,同事首次打开需 右键→打开;提示已损坏时执行"
	@echo "      xattr -cr /Applications/MonkeyCode.app"

# 发布构建:在 macos 基础上叠加 createUpdaterArtifacts(需 TAURI_SIGNING_PRIVATE_KEY
# 签名),并汇集 updater 产物(带版本文件名的 .app.tar.gz + latest.json)到
# bundle/updater/,供人工上传 OSS。
macos-release: EXTRA_TAURI_CONFIG += --config tauri.release.conf.json

macos-release:
	$(MAKE) check-signing
	$(MAKE) set-release-version
	$(MAKE) macos EXTRA_TAURI_CONFIG="$(EXTRA_TAURI_CONFIG)"
	python3 scripts/gen-latest-json.py

# 发布版本只接受当前提交上的 vYYMMDDNN tag；由统一脚本同步 Tauri、Cargo
# manifest 及 lockfile。普通 macos 构建不修改版本文件。
set-release-version:
	@tag="$$(git describe --tags --exact-match \
		--match 'v[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' HEAD 2>/dev/null)"; \
		[ -n "$$tag" ] || { echo "错误: 发布构建要求当前提交带 vYYMMDDNN tag"; exit 1; }; \
		python3 scripts/set_release_version.py "$$tag"

check-signing:
	@[ -n "$$TAURI_SIGNING_PRIVATE_KEY" ] || \
		{ echo "错误: 发布构建需要 TAURI_SIGNING_PRIVATE_KEY(updater 产物签名私钥)"; exit 1; }

check-macos:
	@[ "$$(uname -s)" = "Darwin" ] || { echo "错误: macOS 打包需在 Mac 上执行"; exit 1; }
	@rustup target list --installed | grep -q aarch64-apple-darwin || \
		{ echo "错误: 缺少 rust target,先执行: rustup target add aarch64-apple-darwin x86_64-apple-darwin"; exit 1; }
	@rustup target list --installed | grep -q x86_64-apple-darwin || \
		{ echo "错误: 缺少 rust target,先执行: rustup target add x86_64-apple-darwin"; exit 1; }

check-ohmy-src:
	@[ -n "$(OHMYAGENT_SRC)" ] && [ -d "$(OHMYAGENT_SRC)/cmd/ohmyagent" ] || \
		{ echo "错误: 引擎源码不存在($(OHMYAGENT_SRC))。初始化 submodule:"; \
		  echo "  git submodule update --init agent"; \
		  echo "或指向别处检出: export OHMYAGENT_SRC=/path/to/ohmyagent"; exit 1; }
	@[ -n "$(AGENT_VERSION)" ] || \
		{ echo "错误: 无法读取引擎提交哈希($(OHMYAGENT_SRC))"; exit 1; }
	@[ -d "$(CURDIR)/../plugins/skills" ] || \
		{ echo "错误: 内置技能库不存在(bundle.resources 引用它,打包会失败)。初始化 submodule:"; \
		  echo "  git submodule update --init plugins"; exit 1; }

# 双架构编译引擎 sidecar。universal 打包会按架构各编译一遍,每遍的
# tauri_build 都要求存在 <name>-<本架构 triple> 文件,最终 bundle 阶段
# 再合成/取 universal——三个命名全部备齐,覆盖每个阶段的查找路径。
# externalBin 声明在 bundle.<平台>.conf.json(只经 --config 显式传入),既不能
# 上移到基础配置、也不能用 tauri.<平台>.conf.json 这个会被自动合并的名字:
# 两者都会让 tauri_build 在编译期解析 sidecar,普通 cargo check/build 就得先
# 编出 binaries/ohmyagent-<triple>(见文件头说明)。
# "任何包都带引擎"由 check-bundle-configs 强制,缺二进制打包直接失败。
engine-universal: check-ohmy-src
	mkdir -p $(BIN_DIR)
	cd $(OHMYAGENT_SRC) && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build $(GOFLAGS) -o $(abspath $(SIDECAR_ARM)) ./cmd/ohmyagent
	cd $(OHMYAGENT_SRC) && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build $(GOFLAGS) -o $(abspath $(SIDECAR_X64)) ./cmd/ohmyagent
	lipo -create -output $(SIDECAR_UNI) $(SIDECAR_ARM) $(SIDECAR_X64)

# ---------- Windows 打包(NSIS 安装包,引擎 sidecar)----------

windows: check-windows check-bundle-configs engine-windows browser-extension
	$(TAURI) build --config bundle.windows.conf.json $(EXTRA_TAURI_CONFIG)
	@echo ""
	@echo "打包完成,分发产物:"
	@ls -lh target/release/bundle/nsis/*.exe 2>/dev/null || true

# 发布构建:在 windows 基础上叠加 createUpdaterArtifacts(需 TAURI_SIGNING_PRIVATE_KEY
# 签名),并汇集 updater 产物(带版本文件名的 setup.exe + latest-windows.json)到
# bundle/updater/,供人工上传 OSS。
windows-release: EXTRA_TAURI_CONFIG := --config tauri.release.conf.json

# 结构与 macos-release 一致:set-release-version 必须在 windows 打包**之前**
# 跑完(曾漏掉,本地出包会把占位版本 26071401 烙进安装包名、updater 文件名
# 和 latest-windows.json)。用 $(MAKE) 串行而非并列先决条件——并列先决在
# make -j 下无顺序保证。
windows-release:
	$(MAKE) check-signing
	$(MAKE) set-release-version
	$(MAKE) windows EXTRA_TAURI_CONFIG="$(EXTRA_TAURI_CONFIG)"
	python3 scripts/gen-latest-json.py windows

check-windows:
	@[ "$$OS" = "Windows_NT" ] || { echo "错误: Windows 打包需在 Windows 上执行(无 Windows 机器时用 CI: desktop-windows.yml)"; exit 1; }

# 每个能独立打包的配置都必须带引擎 sidecar。externalBin 不能上移到基础
# 配置(tauri_build 编译期就解析宿主 triple,会让普通 cargo check 强依赖
# 二进制),所以这条不变量由脚本在打包前强制。CI 亦跑。
check-bundle-configs:
	python3 scripts/check_bundle_configs.py

# Windows 引擎 sidecar(x64;tauri bundle 按 <name>-<triple>.exe 查找,
# 安装后落地为应用同目录的 ohmyagent.exe,与壳的 find_ohmyagent 查找顺序吻合)。
# 同时交叉编译 WSL 运行环境用的 Linux 引擎(经 bundle.resources 落安装根,
# guest 经 /mnt/c 直接执行;用 GOFLAGS 而非 GOFLAGS_WIN——Linux 目标没有
# windowsgui 链接标记)。
engine-windows: check-ohmy-src
	mkdir -p $(BIN_DIR)
	cd $(OHMYAGENT_SRC) && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build $(GOFLAGS_WIN) -o $(abspath $(SIDECAR_WIN)) ./cmd/ohmyagent
	python3 scripts/check-pe-subsystem.py $(SIDECAR_WIN) gui
	cd $(OHMYAGENT_SRC) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(GOFLAGS) -o $(abspath $(SIDECAR_WIN_WSL)) ./cmd/ohmyagent

# ---------- Linux 打包(deb + rpm + AppImage,引擎 sidecar)----------

linux: check-linux check-bundle-configs engine-linux browser-extension
	$(TAURI) build --config bundle.linux.conf.json $(EXTRA_TAURI_CONFIG)
	@echo ""
	@echo "打包完成,分发产物:"
	@ls -lh target/release/bundle/deb/*.deb target/release/bundle/rpm/*.rpm \
		target/release/bundle/appimage/*.AppImage 2>/dev/null || true

# 发布构建:只有 AppImage 能自更新(updater 在 Linux 是原地替换 AppImage
# 文件,见 tauri-plugin-updater install_appimage);deb/rpm 由包管理器负责,
# 壳侧对非 AppImage 运行不提示更新(main.rs updater_supported)。
linux-release: EXTRA_TAURI_CONFIG := --config tauri.release.conf.json

linux-release:
	$(MAKE) check-signing
	$(MAKE) set-release-version
	$(MAKE) linux EXTRA_TAURI_CONFIG="$(EXTRA_TAURI_CONFIG)"
	python3 scripts/gen-latest-json.py linux

# AppImage 的 bundler 会把构建机的 xdg-open 复制进包(供应用内开链接),缺了
# 会在 release 编译跑完三分钟之后才报 "xdg-open binary not found" —— 前置查掉。
#
# deb/rpm 依赖声明有意不对称(实测所得):deb 的 bundler 会自动补
# libwebkit2gtk-4.1-0 / libgtk-3-0 / libayatana-appindicator3-1,再写显式
# depends 会让 control 里出现重复项、且 appindicator 同时落进 Depends 与
# Recommends;所以 deb 只留 gstreamer 到 recommends(mp3 提示音,缺了只是没声),
# rpm 侧未观察到自动补包级依赖,保留显式 depends。
#
# "缺了只是没声"只对 deb/rpm 成立(全程系统库,自洽)。AppImage 不同:
# linuxdeploy 会连带捆入 GStreamer *核心库*,若插件不成套跟上
# (bundleMediaFramework=true),运行时是"捆芯 + 找不到任何插件"——桌宠页
# new Audio 触发 WebKit 媒体后端初始化,appsink 缺失直接崩掉该页
# WebProcess,整页空白,桌宠隐身(装了系统 gstreamer 也没用:bundled 核心
# 不认系统插件)。捆插件需要构建机装 gstreamer1.0-plugins-base/-good
# 与 patchelf——前置查掉,别在 release 编译几分钟后才失败。
check-linux:
	@[ "$$(uname -s)" = "Linux" ] || { echo "错误: Linux 打包需在 Linux 上执行"; exit 1; }
	@command -v xdg-open >/dev/null || \
		{ echo "错误: AppImage 打包需要 xdg-open(安装 xdg-utils)"; exit 1; }
	@command -v patchelf >/dev/null || \
		{ echo "错误: AppImage 捆绑 GStreamer 需要 patchelf"; exit 1; }
	@ls /usr/lib/*/gstreamer-1.0/libgstautodetect.so >/dev/null 2>&1 || \
		{ echo "错误: 构建机缺 GStreamer 插件(安装 gstreamer1.0-plugins-base gstreamer1.0-plugins-good)"; exit 1; }

# Linux 引擎 sidecar(x64;CGO 关掉,避免把构建机的 glibc 版本写进依赖)。
engine-linux: check-ohmy-src
	mkdir -p $(BIN_DIR)
	cd $(OHMYAGENT_SRC) && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build $(GOFLAGS) -o $(abspath $(SIDECAR_LIN)) ./cmd/ohmyagent

# 浏览器扩展:随包分发(tauri bundle.resources 引用 ../browser-extension/dist,
# 缺失会打包失败)。
browser-extension:
	cd ../browser-extension && npm ci && npm run build

# 图标产物已入库,仅源图(icons/source.png,1024²)更新时重新生成。
# 注意:tauri icon 无平台过滤参数,会连带产出 ios/android(生成后清理);
# 且其输出包含 icon.png 本身——源图必须与输出分离,否则会被覆盖。
icons/icon.icns: icons/source.png
	$(TAURI) icon icons/source.png
	rm -rf icons/android icons/ios

icons: icons/icon.icns

clean:
	rm -rf $(BIN_DIR) target
