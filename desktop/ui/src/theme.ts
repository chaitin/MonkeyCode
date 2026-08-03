// 主题偏好。配色由 daisyUI 内置 light/dark 主题提供(styles.css 里 @plugin
// "daisyui" 声明),这里只做「读偏好 → 落根节点 data-theme 属性」。
// 偏好存 localStorage(mc.* 与侧栏/抽屉等本机 UI 状态同一命名空间),不进
// config.json:它是本机显示偏好,不该触发保存后的内核重启。

const THEME_KEY = "mc.theme";

export type Theme = "light" | "dark";

/** 只认已知值:缺失/脏数据/存储不可读一律回落浅色(当前设计基线)。 */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

// 始终显式落值("light" | "dark"):daisyUI 按 data-theme 取值选主题,显式
// 写掉 --prefersdark 的系统偏好协商,首帧脚本(index.html)与这里语义一致。
const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
};

/** 写盘并立即生效;写盘失败仍应用本次主题,避免点击无反馈。 */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // WebView 存储不可写时只丢失持久化,不影响本次会话的观感。
  }
  applyTheme(theme);
}

/** 启动即调用(render 之前):首帧就带上深浅偏好,不闪一帧浅色。 */
export function applyStoredTheme(): void {
  applyTheme(readTheme());
}
