# MonkeyCode 自建 OTA 服务端（expo-updates，非 EAS）

零依赖 Node 服务，把 `expo export` 的 `dist/` 按 Expo Updates 协议 v1 下发。
只更新 JS bundle + assets；原生改动（加原生模块 / 升 SDK / 改权限图标）仍需重新出整包。

## 一、发布一次 OTA 更新

```bash
cd mobile-expo
npx expo export --platform android --platform ios   # 产出 dist/
node ota-server/server.js                           # 默认 :4747，读 ../dist
```

服务端口/目录可配：`OTA_PORT=4747 OTA_DIST=/abs/dist node ota-server/server.js`

## 二、客户端 URL 怎么填（app.json → expo.updates.url）

| 场景 | URL | 说明 |
|---|---|---|
| USB 真机本地联调 | `http://127.0.0.1:4747/manifest` | 配合 `adb reverse tcp:4747 tcp:4747`（走 USB，免同网段） |
| 同 Wi-Fi 真机/模拟器 | `http://<Mac-LAN-IP>:4747/manifest` | 例如 `http://10.10.2.152:4747` |
| 生产 | `https://你的域名/manifest` | **必须 HTTPS**；http 在 release 下会被 Android 拦截（已临时加 usesCleartextTraffic 仅供 demo） |

改了 url 必须 `npx expo prebuild -p android -p ios` 重新把它写进原生（AndroidManifest / Expo.plist），再出包。

## 二点五、检查更新的逻辑（原生优先，对用户不暴露"热更新"）

客户端「检查更新」是一条统一、按优先级的流程：
1. 先查**有没有更新的原生版本** —— `GET /app-version/<platform>.json`（`ios.json` / `android.json`，返回 `{ version, url }`）。客户端用 path 而非 query,所以**可直接当静态文件托管在 OSS/CDN**(每个平台一个 JSON)。本地 server 从 `ota-server/native-release.json` 生成这两个响应;放 OSS 时就上传两个静态文件。若 `version` > 已装的 `Constants.nativeAppVersion` → 提示"发现新版本 vX，去更新" → 打开下载/商店链接（**OTA 推不动原生，必须装新包**）。
2. 原生已是最新 → 再查 **OTA**，有就提示"是否立即更新" → 下载并重启。
3. 都没有 → "已是最新"。

> 对用户只有「版本 / 新版本」一个概念；"热更新/OTA/hash" 是实现细节，不出现在界面上。
> 应用版本一律取 `Constants.nativeAppVersion`（原生安装包版本），不要用 `Constants.expoConfig?.version`（那是 OTA manifest 的，会随热更新变/缺）。

## 三、runtimeVersion（指纹）

`app.json` 用 `runtimeVersion.policy = fingerprint`：构建时算指纹，原生变了指纹自动变，
旧包不会误收新 JS。`.fingerprintignore` 已排除 prebuild 生成的 `android/ios`，保证可复现。
本服务把客户端请求头里的 runtimeVersion 原样回填进 manifest —— **导出的 JS 必须和装机二进制同一份代码**。

```bash
npx expo-updates fingerprint:generate --platform android   # 看当前指纹
```

## 四、协议自测（不依赖装机）

```bash
RTV=$(npx expo-updates fingerprint:generate --platform android | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).hash)")
curl -s -H "expo-platform: android" -H "expo-runtime-version: $RTV" http://127.0.0.1:4747/manifest
```

返回 `multipart/mixed`，内含 `manifest` 部分（launchAsset + assets，URL 指向 `/assets?p=…`）。

## 五、首次必须整包

OTA 只能下发给「已内置 expo-updates 且指向本服务器」的包。当前线上包收不到，第一版要走整包；
之后纯 JS 改动就 `expo export` → 重启/进前台自动拉取，或「我的 → 检查更新」手动拉。

## 生产 TODO
- 换 HTTPS 域名（去掉 demo 的 cleartext）。
- 开代码签名：`npx expo-updates codesigning:generate / configure`，防服务器被攻破推恶意 JS。
- 按导出真实指纹做多版本路由（本 demo 为单版本回填）。
