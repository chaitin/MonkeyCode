// 主题偏好。配色值全在 styles.css(:root / [data-theme="dark"] / 生成的
// [data-accent="…"] 块),这里只做「读偏好 → 落根节点属性」,组件与令牌零改动。
// 偏好存 localStorage(mc.* 与侧栏/抽屉等本机 UI 状态同一命名空间),不进
// config.json:它是本机显示偏好,不该触发保存后的内核重启。
//
// 两维正交:data-theme 管深浅,data-accent 管主题色,四个色板由
// scripts/gen_accent_tokens.py 生成(见 gen/accents.ts)。默认色不写属性——
// 它就是 :root/深色块本身,与 theme 的 "" 缺省同一姿势。

import { ACCENTS, DEFAULT_ACCENT, type AccentKey } from "./gen/accents";

const THEME_KEY = "mc.theme";
const ACCENT_KEY = "mc.accent";

export type Theme = "light" | "dark";
export type { AccentKey };

/** 只认已知值:缺失/脏数据/存储不可读一律回落浅色(当前设计基线)。 */
export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

// 切换方式与 styles.css 注释一致:dataset.theme = "dark" | ""
const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "";
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

/** 只认生成的色板 key:改过 slug、存了脏数据、存储不可读一律回落默认色。 */
export function readAccent(): AccentKey {
  try {
    const raw = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.some((a) => a.key === raw) ? (raw as AccentKey) : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

// 默认色不写属性:样板令牌就在 :root/深色块里,写了反而多一层无谓覆盖
const applyAccent = (accent: AccentKey): void => {
  document.documentElement.dataset.accent = accent === DEFAULT_ACCENT ? "" : accent;
};

/** 写盘并立即生效;写盘失败仍应用本次主题色,避免点击无反馈。 */
export function setAccent(accent: AccentKey): void {
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // 同 setTheme:存储不可写时只丢失持久化,不影响本次会话的观感。
  }
  applyAccent(accent);
}

/** 启动即调用(render 之前):首帧就带上深浅**与**主题色两维偏好,
 *  不闪一帧浅色/默认绿。两维一起落,免得漏掉一维要再加一个启动钩子。 */
export function applyStoredTheme(): void {
  applyTheme(readTheme());
  applyAccent(readAccent());
}
