import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { inDesktopShell, isMacShell } from "./host";
import { openTextContextMenu } from "./contextMenu";
import { invoke } from "./ipc";
import { applyStoredTheme } from "./theme";
import "./styles.css";

// 主题偏好在首帧前落到根节点:深色下不会先闪一帧浅色底
applyStoredTheme();

// 平台也落到根节点:mac 壳的原生红绿灯直接盖在 UI 左上角(Overlay 标题栏),
// 最左栏要为它让出宽度。具体宽度是布局的事,写在 styles.css 的 .mc-nav-rail;
// 这里只声明"我是谁"。判定不成立时按非 mac 走,即维持原样、不会崩。
if (isMacShell()) document.documentElement.dataset.platform = "mac";

// 桌面壳内屏蔽 WebView 默认右键菜单:原生菜单固定带"检查元素/重新加载"等
// 浏览器项且平台 API 裁不掉单项,壳内一律拦截,文本复制/粘贴走自绘菜单
// (contextMenu.ts)。浏览器模式不干预。
// 壳判定放进处理器而非注册时:不依赖 __TAURI__ 注入与模块求值的先后
window.addEventListener("contextmenu", (e) => {
  if (!inDesktopShell()) return;
  e.preventDefault();
  openTextContextMenu(e);
});

// devtools 排障入口改走快捷键(F12 / Ctrl|Cmd+Shift+I):右键不再暴露
// "检查元素",能力本身保留(Cargo devtools feature 未动,线上排障还靠它)
window.addEventListener("keydown", (e) => {
  if (!inDesktopShell()) return;
  if (e.key !== "F12" && !((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyI")) return;
  e.preventDefault();
  void invoke("open_devtools").catch(() => {});
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
