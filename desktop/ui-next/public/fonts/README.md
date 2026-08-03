# UI Webfont 资产(手工入库,不走 vite 管线)

内核 `//go:embed uidist` 嵌入后在 `/fonts/` 下静态提供;`ui/index.html` 以
`<link href="/fonts/fonts.css">` 引用。vite 构建配置了 `emptyOutDir: false`,
不会清掉本目录。

| 字体 | 版本/来源 | 许可 | 用途 |
| --- | --- | --- | --- |
| HarmonyOS Sans SC v2.400 | npm `harmonyos-sans-sc-webfont-splitted@1.1.0`(官方字体经 cn-font-split 按 unicode-range 切片) | 华为 HarmonyOS Sans 字体许可(允许免费商用与再分发) | 中英文正文/标题/常规 UI,字重 400/500/600/700 |
| JetBrains Mono | npm `@fontsource/jetbrains-mono@5.2.8` latin 子集 | SIL OFL 1.1 | 代码/路径/密钥/数字,字重 400/500/600/700;中文回退 HarmonyOS Sans SC |

切片文件名带内容哈希,服务端对 `.woff2` 发永久缓存头,`fonts.css` 短缓存。
浏览器按 unicode-range 只拉取实际用到的切片(全量 332 片,典型页面 ~30 片)。

更新方式:`npm pack` 上述包,替换对应 `*.woff2` 并重拼 `fonts.css`
(JetBrains Mono 的 4 条 @font-face 手写在 fonts.css 头部)。
