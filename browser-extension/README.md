# MonkeyCode 浏览器助手(MV3 扩展)

MonkeyCode 桌面应用的浏览器侧桥接:**带鉴权的 chrome.debugger 哑代理 + 标签页授权 UI**。
一切浏览器语义(快照、ref、坐标点击、键序列)在 Go 侧实现,扩展只负责:

- 经 WebSocket(`ws://127.0.0.1:<port>/ext`)连接内核并配对鉴权;
- 透传 CDP 命令与事件(`chrome.debugger`);
- 让用户显式授权"哪些标签页交给 agent 操作"(popup)。

协议唯一权威定义:`agent/internal/browser/protocol.go`,`src/protocol.ts` 只是它的 TS 镜像。

## 开发构建

```bash
npm install
npm run build     # tsc --noEmit + vite 多入口构建,产物在 dist/
npm test          # vitest 纯函数单测
```

加载到浏览器:打开 `chrome://extensions`(Edge 为 `edge://extensions`)→ 开启"开发者模式" →
"加载已解压的扩展程序" → 选择本目录的 `dist/`。

改代码后重新 `npm run build`,再在扩展管理页点击刷新。

## 配对步骤

1. 启动 MonkeyCode 桌面应用(内置扩展桥);
2. 在 mc-desktop 设置页获取一次性**配对码**;
3. 点扩展图标 → "去设置页配对"(或右键扩展图标 → 选项);
4. 填入配对码(连字符、大小写不敏感),端口留空即自动扫描 7440-7449,点击"连接并配对";
5. 配对成功后扩展持有长期 token,后续自动重连;在 popup 中把标签页"交给 agent 操作"即可开始。

解除授权:options 页"解除配对"(清除本地 token),或在 mc-desktop 侧吊销(扩展会在下次连接时自动转为未配对)。

## dev-key 说明

`manifest.json` 的 `key` 字段内置了开发公钥,用于**钉死扩展 ID**(load unpacked 时 ID 不再随目录路径变化),
内核据此校验来源。当前 dev 扩展 ID:

```
bhmoekbeakkmhaakojecgmnaomcepboa
```

- 私钥 `dev-key.pem` 仅存开发者本机(已被 `.gitignore` 忽略),**严禁提交**;
- 重新生成一对密钥(会改变扩展 ID,需同步内核配置):

```bash
openssl genrsa -out dev-key.pem 2048
# 提取公钥 base64,填入 manifest.json 的 key 字段
openssl rsa -in dev-key.pem -pubout -outform DER | base64 -w0
# 由公钥推导扩展 ID(SHA256 前 16 字节,0-9a-f 映射为 a-p)
openssl rsa -in dev-key.pem -pubout -outform DER | sha256sum | head -c 32 | tr '0-9a-f' 'a-p'
```

图标(`src/icons/icon{16,48,128}.png`)由 MonkeyCode 源图 `mc-desktop/icons/source.png`
缩放而来,已入库。更新方式:用 ImageMagick(`convert source.png -resize 128x128 icon128.png`)
或任意等比缩放工具重新生成三个尺寸。

## 已知限制

- **调试提示条**:attach 后浏览器顶部会显示"MonkeyCode 浏览器助手 已开始调试此浏览器",这是 Chrome 对
  `chrome.debugger` 的强制提示,无法隐藏;用户点提示条上的"取消"会剥离调试器(扩展会上报 `detached`,
  受控资格保留,内核可重新 attach);
- **DevTools 冲突**:同一标签页打开开发者工具会占用调试器,操作将返回 `debugger_conflict`,需关闭该页 DevTools;
- **受限页面**:`chrome://`、扩展页、商店页等无法 attach(`restricted_url`);
- **仅 Chromium 系**:依赖 MV3 `chrome.debugger`,Firefox 不支持;
- 受控集合存于 `storage.session`:浏览器整体重启后授权清空,需重新在 popup 交接标签页。
