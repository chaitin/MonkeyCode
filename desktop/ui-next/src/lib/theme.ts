// 主题偏好:daisyUI 内置 35 主题全量可选,根节点 data-theme 选主题。
// localStorage 键 mc.theme 与旧工程同名(旧值 "dark" 天然合法,无缝继承);
// mc.themeBg 缓存当前主题的 base-100 色值,index.html 首帧脚本用它防闪
// (35 套主题不可能像 light/dark 那样把底色写死进 <style>)。
// 模块顶层不碰 localStorage、只用 getItem/setItem(node 单测可导入)。
// 自定义主题(派生式)的规则与 CSS 生成在 lib/customTheme.ts,这里只管落地。
import {
  customThemeCss,
  parseCustomTheme,
  CUSTOM_ATTR,
  CUSTOM_STYLE_ID,
  CUSTOM_THEME,
  type CustomTheme,
} from "./customTheme";

export { CUSTOM_THEME, type CustomTheme } from "./customTheme";

const THEME_KEY = "mc.theme";
const THEME_BG_KEY = "mc.themeBg";
/** 自定义主题的配置(JSON)与渲染产物(CSS 文本)。
 * CSS 要单独缓存,不能让首帧脚本按配置现算:派生规则(可读前景色的亮度
 * 交点、base-200/300 的掺色比例)在 lib/customTheme.ts,inline 脚本里再抄
 * 一份就是两个真值源,改一处忘一处必然静默漂色。 */
const CUSTOM_KEY = "mc.themeCustom";
const CUSTOM_CSS_KEY = "mc.themeCustomCss";

/** 与 styles/app.css 的主题声明一致(@plugin daisyui 的 themes 列表 +
 *  @plugin "daisyui/theme" 自定义块的 name;有测试对表)。品牌两套在前。 */
export const THEMES = [
  "monkeycode", "monkeycode-dark",
  "light", "dark", "abyss", "acid", "aqua", "autumn", "black", "bumblebee",
  "business", "caramellatte", "cmyk", "coffee", "corporate", "cupcake",
  "cyberpunk", "dim", "dracula", "emerald", "fantasy", "forest", "garden",
  "halloween", "lemonade", "lofi", "luxury", "night", "nord", "pastel",
  "retro", "silk", "sunset", "synthwave", "valentine", "winter", "wireframe",
] as const;

/** daisyUI 内置 + 品牌两套(THEMES 与 app.css 对表,有测试盯着)。 */
export type BuiltinTheme = (typeof THEMES)[number];
/** 加上用户自定义那一档。CUSTOM_THEME **不进** THEMES:它不是 daisyUI 主题名,
 * app.css 里也没有对应声明,混进去会当场打挂对表测试。 */
export type Theme = BuiltinTheme | typeof CUSTOM_THEME;

function isBuiltin(value: string | null): value is BuiltinTheme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/** 读自定义主题配置;没配过/脏到解析不了返回 null。 */
export function readCustomTheme(): CustomTheme | null {
  try {
    return parseCustomTheme(localStorage.getItem(CUSTOM_KEY));
  } catch {
    return null;
  }
}

/** 只认清单内的值:缺失/脏数据/存储不可读一律回落浅色。
 * 自定义那一档还要求配置确实存在——否则选中它会得到一套没有任何覆盖的
 * 基础主题,用户看到的是"选了没反应"。 */
export function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === CUSTOM_THEME) return readCustomTheme() ? CUSTOM_THEME : "monkeycode";
    return isBuiltin(raw) ? raw : "monkeycode";
  } catch {
    return "monkeycode";
  }
}

// 落属性后缓存该主题的 base-100(供下次启动的首帧防闪)。取不到(样式未载入/
// node 测试)就跳过——防闪缓存是增强项,不能反过来挡主题切换。
/** 维护注入的 <style>:css 为 null 即移除。首帧脚本可能已经插过同 id 的
 * 元素(防闪),这里复用它而不是再插一个,免得两份规则打架。 */
function applyCustomStyle(css: string | null): void {
  const existing = document.getElementById(CUSTOM_STYLE_ID);
  if (css === null) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.createElement("style");
  el.id = CUSTOM_STYLE_ID;
  el.textContent = css;
  if (!existing) document.head.appendChild(el);
}

const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  const custom = theme === CUSTOM_THEME ? readCustomTheme() : null;
  if (custom) {
    // 20 个颜色变量全部由本模块生成,data-theme 落 light/dark 只是给
    // --size-field / --depth / --noise 这些非颜色变量兜个底(daisyUI 的
    // 组件仍会读它们);覆盖块挂 CUSTOM_ATTR 叠加在上面——无层规则,
    // 压得住 @layer base 里的主题声明
    applyCustomStyle(customThemeCss(custom));
    root.dataset.theme = custom.mode;
    root.setAttribute(CUSTOM_ATTR, "");
  } else {
    applyCustomStyle(null);
    root.removeAttribute(CUSTOM_ATTR);
    root.dataset.theme = theme;
  }
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-base-100").trim();
    if (bg) localStorage.setItem(THEME_BG_KEY, bg);
  } catch {
    // 无 CSS 引擎或存储不可写:跳过缓存
  }
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

/** 保存自定义主题并立即切过去(外观设置是「切换立即生效」口径,不设保存钮)。
 * 同时把渲染好的 CSS 落盘供首帧脚本用——只存配置的话,首帧会拿基础主题的
 * 整套变量渲染:底色对了(mc.themeBg 兜着)、主色圆角全不对,比不做防闪更显眼。 */
export function setCustomTheme(cfg: CustomTheme): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(cfg));
    localStorage.setItem(CUSTOM_CSS_KEY, customThemeCss(cfg));
    localStorage.setItem(THEME_KEY, CUSTOM_THEME);
  } catch {
    // 存储不可写:只丢持久化,本次会话仍要换肤
  }
  applyTheme(CUSTOM_THEME);
}

/** 启动即调用(render 之前):首帧兜底与 index.html 脚本互为冗余,
 *  并把脏值(卸载过的主题名)矫正回清单内。 */
export function applyStoredTheme(): void {
  applyTheme(readTheme());
}
