# MonkeyCode 浏览器助手(Manifest V3 扩展)

MonkeyCode 桌面应用的浏览器侧桥接组件,定位为**带鉴权的 `chrome.debugger` 代理与标签页授权界面**。
所有浏览器语义(页面快照、元素引用、坐标点击、键序列等)均在内核侧(`desktop/src/browser/`)实现,扩展仅承担三项职责:

- 通过 WebSocket(`ws://127.0.0.1:<port>/ext`)连接内核,完成配对与鉴权;
- 透传 CDP 命令与事件(基于 `chrome.debugger`);
- 提供 popup 界面,由用户显式授权哪些标签页可交由 agent 操作。

桥接协议的唯一权威定义位于 `desktop/src/browser/protocol.rs`,`src/protocol.ts` 为其 TypeScript 镜像;
修改协议时应先修改内核侧定义,再同步本镜像。

## 开发与构建

```bash
npm install
npm run build     # tsc --noEmit 类型检查 + vite 多入口构建,产物输出至 dist/
npm run dev       # watch 模式增量构建
npm test          # vitest 纯函数单元测试
```

加载到浏览器:打开 `chrome://extensions`(Edge 为 `edge://extensions`),开启"开发者模式",
点击"加载已解压的扩展程序",选择本目录下的 `dist/`。

修改代码后重新执行 `npm run build`,并在扩展管理页点击刷新以重新加载。

## 配对流程

1. 启动 MonkeyCode 桌面应用(内置扩展桥);
2. 在桌面应用设置页的"浏览器扩展"卡片中获取一次性**配对码**;
3. 点击扩展图标,选择"去设置页配对"(或右键扩展图标选择"选项");
4. 输入配对码(连字符与大小写不敏感);端口留空时自动扫描 7440-7449,点击"连接并配对";
5. 配对成功后扩展持有长期 token 并自动重连;此后在 popup 中将标签页"交给 agent 操作"即可开始使用。

解除配对:在 options 页点击"解除配对"(清除本地 token),或在桌面应用侧吊销授权
(扩展将在下次连接时自动回到未配对状态)。

## 开发密钥与扩展 ID

`manifest.json` 的 `key` 字段内置了开发公钥,用于固定扩展 ID(load unpacked 时 ID 不再随目录路径变化);
内核在配对时记录该 ID,作为后续 token 重连的纵深防御校验。当前开发扩展 ID:

```
bhmoekbeakkmhaakojecgmnaomcepboa
```

- 私钥 `dev-key.pem` 仅保存在开发者本机(已被 `.gitignore` 忽略),**严禁提交至仓库**;
- 如需重新生成密钥对(将改变扩展 ID,需同步更新内核配置):

```bash
openssl genrsa -out dev-key.pem 2048
# 提取公钥 base64,填入 manifest.json 的 key 字段
openssl rsa -in dev-key.pem -pubout -outform DER | base64 -w0
# 由公钥推导扩展 ID(SHA-256 摘要前 16 字节,0-9a-f 映射为 a-p)
openssl rsa -in dev-key.pem -pubout -outform DER | sha256sum | head -c 32 | tr '0-9a-f' 'a-p'
```

## 图标

`src/icons/icon{16,48,128}.png` 由 MonkeyCode 源图 `desktop/icons/source.png` 等比缩放生成,已随仓库入库。
如需更新,使用 ImageMagick(`convert source.png -resize 128x128 icon128.png`)或任意等比缩放工具
重新生成三个尺寸即可。

## 已知限制

- **调试提示条**:attach 后浏览器顶部会显示"MonkeyCode 浏览器助手 已开始调试此浏览器"。
  这是 Chrome 对 `chrome.debugger` 的强制提示,无法隐藏;用户点击提示条上的"取消"会剥离调试器
  (扩展会上报 `detached` 事件,受控资格保留,内核可重新 attach);
- **DevTools 冲突**:同一标签页打开开发者工具会占用调试器,此时操作返回 `debugger_conflict`,
  需先关闭该页面的 DevTools;
- **受限页面**:`chrome://`、扩展页面、应用商店页面等无法 attach(返回 `restricted_url`);
- **仅支持 Chromium 系浏览器**:依赖 MV3 `chrome.debugger` API,Firefox 不支持;
- **授权不跨浏览器重启**:受控集合存储于 `storage.session`,浏览器整体重启后授权清空,
  需重新在 popup 中交接标签页。
