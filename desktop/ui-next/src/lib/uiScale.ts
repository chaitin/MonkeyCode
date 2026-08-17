// 界面整体缩放(WebView 页面 zoom,VS Code/Discord 同款机制):文字、图标、
// 控件、栏宽、终端按**同一比例**几何缩放——用户定案 2026-08-16「所有组件
// 跟着变,否则不协调」,故不走根字号 rem 方案(它缩不到 px 图标与列宽)。
//
// 「点即生效」偏好(与主题/语言同通道,不进保存条):localStorage 持久,
// 启动时 main.tsx 应用一次;模块顶层不碰 localStorage(node 单测可导入)。
// 壳内走 Tauri setZoom(WebView2 ZoomFactor / WKWebView pageZoom / webkitgtk
// zoom_level,需 core:webview:allow-set-webview-zoom 权限);浏览器模式退化
// 为根节点 CSS zoom(开发预览够用)。

const KEY = "mc.uiScale";

/** 可选档位(1 = 100%)。参照 Chrome 缩放阶梯的相邻档,四档够用不乱。 */
export const UI_SCALES = [0.9, 1, 1.1, 1.25] as const;
export type UiScale = (typeof UI_SCALES)[number];

export function readUiScale(): UiScale {
  try {
    const v = Number(localStorage.getItem(KEY));
    return UI_SCALES.find((s) => s === v) ?? 1;
  } catch {
    return 1;
  }
}

type ZoomHost = {
  __TAURI__?: { webview?: { getCurrentWebview?: () => { setZoom?: (factor: number) => Promise<void> } } };
};

export function applyUiScale(scale: UiScale): void {
  const wv = (window as unknown as ZoomHost).__TAURI__?.webview?.getCurrentWebview?.();
  if (wv?.setZoom) {
    // 失败(权限缺失等)不外显:缩放是增强,不值得阻断或打扰启动
    wv.setZoom(scale).catch(() => {});
    return;
  }
  if (scale === 1) document.documentElement.style.removeProperty("zoom");
  else document.documentElement.style.setProperty("zoom", String(scale));
}

export function setUiScale(scale: UiScale): void {
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {
    // 存储不可写:本次会话仍生效,不值得外显
  }
  applyUiScale(scale);
}
