// 用户自定义主题:从一个种子色**生成整套调色板**,再允许逐项覆盖。
//
// 为什么先生成:上一版只覆盖 primary/base-100 两项、base-content 取纯黑白、
// 其余留给基础主题——中性色全无色相、secondary/accent 还是旧主题的颜色,跟
// 新主色不搭(用户报障「太丑,还不如官方随机生成的」)。对照 daisyUI 内置
// 主题就能看出差在哪,它们的中性色**是带主色相的**:
//   valentine  base-100 oklch(97% 0.014 343) / base-content oklch(52% 0.223 3)
//   dracula    base-100 oklch(28.8% 0.022 277) / secondary 比 primary 少 45 度
//   nord       整套压在 H≈250 附近,靠彩度高低拉开层次
// 共同规律:同一色相家族 + 感知亮度阶梯 + 彩度按角色分档。照这个规律生成,
// 随手一个随机色相也不会难看。
//
// 与官方 theme-generator(https://daisyui.com/theme-generator/)的对齐:
// 官方给 9 个角色色各一个拾色器、圆角分 box/field/selector 三档、尺寸分
// field/selector 两档,外加 depth/noise 开关与边框宽度——这些这里都有。
// 差别只在**起点**:官方从零手调 20 个色,这里先由种子生成一套自洽配色,
// 覆盖是可选的精修。content 色自动算这一条与官方一致。
//
// 纯函数、不碰 DOM/localStorage:落地与注入在 lib/theme.ts,单测可直接导入。
import { contrastRatio, hexToOklch, normalizeHex, oklchCss, oklchToHex, type Oklch } from "./oklch";

/** 自定义主题在 mc.theme 里的取值(非 daisyUI 主题名,不进 THEMES 清单)。 */
export const CUSTOM_THEME = "mc-custom";

/** 承载生成变量的属性:与 data-theme 同挂一个元素,叠加生效。 */
export const CUSTOM_ATTR = "data-mc-custom";

/** 注入的 <style> 元素 id(首帧脚本与运行时共用,避免重复插入)。 */
export const CUSTOM_STYLE_ID = "mc-custom-theme";

/** 可逐项覆盖的角色。base-200/300 与各 *-content 不在其列:它们由 base-100
 * 与所属角色**推**出来,单独放开会立刻配出对比度不足的组合。 */
export const COLOR_ROLES = ["base-100", "primary", "secondary", "accent", "neutral", "info", "success", "warning", "error"] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export interface CustomTheme {
  /** 明暗:决定亮度阶梯的方向,也是兜底 data-theme 的取值 */
  mode: "light" | "dark";
  /** 种子色(#rrggbb):整套配色的色相与彩度都由它推 */
  seed: string;
  /** 逐项覆盖(#rrggbb);缺省即用生成值 */
  overrides: Partial<Record<ColorRole, string>>;
  /** --radius-box / --radius-field / --radius-selector,单位 rem */
  radiusBox: number;
  radiusField: number;
  radiusSelector: number;
  /** --size-field / --size-selector,单位 rem(daisyUI 的控件尺寸基数) */
  sizeField: number;
  sizeSelector: number;
  /** --border,单位 px */
  border: number;
  /** --depth / --noise:daisyUI 的立体感与噪点质感(0/1) */
  depth: boolean;
  noise: boolean;
}

export const RADIUS_RANGE = { min: 0, max: 2, step: 0.125 } as const;
export const BORDER_RANGE = { min: 0, max: 4, step: 1 } as const;
/** 内置主题一律 0.25rem;官方生成器给 xs..xl 五档,量程照它取 */
export const SIZE_RANGE = { min: 0.1875, max: 0.3125, step: 0.03125 } as const;

export const DEFAULT_CUSTOM: CustomTheme = {
  mode: "light",
  seed: "#16a34a",
  overrides: {},
  radiusBox: 1,
  radiusField: 0.5,
  radiusSelector: 1,
  sizeField: 0.25,
  sizeSelector: 0.25,
  border: 1,
  depth: false,
  noise: false,
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const rotate = (h: number, deg: number): number => (((h + deg) % 360) + 360) % 360;

/** 各角色的亮度/彩度配方。数值是对着内置主题量出来的档位,不是随手取的:
 * 改这里等于改"生成的主题长什么样"。 */
const RECIPE = {
  light: {
    base100: { l: 0.98, cMul: 0.08, cMax: 0.012 },
    step200: -0.03,
    step300: -0.08,
    baseContent: { l: 0.28, cMul: 0.35, cMax: 0.06 },
    neutral: { l: 0.32, cMul: 0.12, cMax: 0.025 },
    /** 主色亮度收进这个窗口:太亮的种子色当按钮底会看不清字,太暗则闷 */
    brand: { min: 0.55, max: 0.76 },
    semantic: 0.7,
  },
  dark: {
    base100: { l: 0.24, cMul: 0.12, cMax: 0.022 },
    step200: 0.04,
    step300: 0.09,
    baseContent: { l: 0.93, cMul: 0.12, cMax: 0.022 },
    neutral: { l: 0.4, cMul: 0.14, cMax: 0.03 },
    brand: { min: 0.62, max: 0.82 },
    semantic: 0.74,
  },
} as const;

/** 语义色固定色相:它们要先是"红黄绿蓝"才谈得上配色,不能跟着种子转,
 * 否则错误提示会变成一坨跟主色同色的东西。 */
const SEMANTIC_HUE = { info: 225, success: 155, warning: 80, error: 26 } as const;

/** 压在某个颜色上的前景色:同色相的极深/极浅两端(不用纯黑纯白——纯色
 * 前景压在带色相的底上会显得脏,内置主题也都取同家族的两端)。
 *
 * 深浅二选一**实算 WCAG 对比度**,不设亮度阈值:阈值写多少都是拍的,而且
 * 拿 OKLCH 的 l 去卡还会错——l 是感知亮度、对比度算的是相对亮度,两条曲线
 * 不同。对着内置主题验过:7 套里 6 套在 primary 亮度 59%~85% 时都用**深色**
 * 前景(nord 甚至 L=59.4 就用 L=11.9),只有 valentine 在 L=65 用了白字——
 * 而那一档白字实测只有 2.9:1,连 AA 都不到。既然真值可算,就不猜。 */
function contentOn({ l, c, h }: Oklch): Oklch {
  const dark: Oklch = { l: 0.16, c: Math.min(c * 0.3, 0.05), h };
  const light: Oklch = { l: 0.98, c: Math.min(c * 0.1, 0.02), h };
  const bg: Oklch = { l, c, h };
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}

/** 9 个可覆盖角色的最终色(生成值经覆盖后)。 */
function roleColors(c: CustomTheme): Record<ColorRole, Oklch> {
  const seedRaw = hexToOklch(c.seed) ?? hexToOklch(DEFAULT_CUSTOM.seed)!;
  const r = RECIPE[c.mode];
  // 种子彩度太低(用户挑了灰)时给个下限,否则整套主题灰成一片没有性格
  const chroma = Math.max(seedRaw.c, 0.06);
  const seed: Oklch = { ...seedRaw, c: chroma };
  const brandL = clamp(seed.l, r.brand.min, r.brand.max);
  const sem = (hue: number, ch: number): Oklch => ({ l: r.semantic, c: ch, h: hue });

  const generated: Record<ColorRole, Oklch> = {
    "base-100": { l: r.base100.l, c: Math.min(chroma * r.base100.cMul, r.base100.cMax), h: seed.h },
    primary: { l: brandL, c: chroma, h: seed.h },
    // −55°/+115°:内置主题里 secondary 普遍是主色相的近邻(dracula 差 45、
    // valentine 差 50),accent 拉开到另一侧做点缀
    secondary: { l: brandL, c: chroma * 0.95, h: rotate(seed.h, -55) },
    accent: { l: clamp(brandL + 0.04, 0, 1), c: chroma * 0.85, h: rotate(seed.h, 115) },
    neutral: { l: r.neutral.l, c: Math.min(chroma * r.neutral.cMul, r.neutral.cMax), h: seed.h },
    info: sem(SEMANTIC_HUE.info, 0.13),
    success: sem(SEMANTIC_HUE.success, 0.14),
    warning: sem(SEMANTIC_HUE.warning, 0.15),
    error: sem(SEMANTIC_HUE.error, 0.18),
  };

  for (const role of COLOR_ROLES) {
    const hex = c.overrides[role];
    const parsed = hex ? hexToOklch(hex) : null;
    if (parsed) generated[role] = parsed;
  }
  return generated;
}

/** 角色色 → daisyUI 的 20 个颜色变量(补上 base-200/300、base-content 与各
 * *-content——它们由前者推出,不单独放开)。 */
export function paletteVars(c: CustomTheme): Record<string, string> {
  const roles = roleColors(c);
  const r = RECIPE[c.mode];
  const b = roles["base-100"];
  // 面色阶从**最终的** base-100 起步:用户换了底色,200/300 必须跟着走,
  // 否则底色变了、卡片和边线还停在原处
  const surface = (step: number): Oklch => ({ l: clamp(b.l + step, 0, 1), c: b.c, h: b.h });
  const baseContent: Oklch = { l: r.baseContent.l, c: Math.min(b.c * 3, r.baseContent.cMax), h: b.h };

  const out: Record<string, string> = {
    "--color-base-100": oklchCss(b),
    "--color-base-200": oklchCss(surface(r.step200)),
    "--color-base-300": oklchCss(surface(r.step300)),
    "--color-base-content": oklchCss(baseContent),
  };
  for (const role of COLOR_ROLES) {
    if (role === "base-100") continue;
    out[`--color-${role}`] = oklchCss(roles[role]);
    out[`--color-${role}-content`] = oklchCss(contentOn(roles[role]));
  }
  return out;
}

/** 某个角色当前的生效色(hex),供设置页的拾色器显示。 */
export function roleHex(c: CustomTheme, role: ColorRole): string {
  return oklchToHex(roleColors(c)[role]);
}

/** 覆盖变量表(唯一真值源:注入用的 CSS 与设置页预览的内联 style 都从这里出)。 */
export function customThemeVars(c: CustomTheme): Record<string, string> {
  const rem = (v: number, range: { min: number; max: number }) => `${clamp(v, range.min, range.max)}rem`;
  return {
    // 跟着明暗走,否则深色主题下会冒出一条白色原生滚动条
    "color-scheme": c.mode,
    ...paletteVars(c),
    "--radius-box": rem(c.radiusBox, RADIUS_RANGE),
    "--radius-field": rem(c.radiusField, RADIUS_RANGE),
    "--radius-selector": rem(c.radiusSelector, RADIUS_RANGE),
    "--size-field": rem(c.sizeField, SIZE_RANGE),
    "--size-selector": rem(c.sizeSelector, SIZE_RANGE),
    "--border": `${clamp(c.border, BORDER_RANGE.min, BORDER_RANGE.max)}px`,
    "--depth": c.depth ? "1" : "0",
    "--noise": c.noise ? "1" : "0",
  };
}

/** 生成注入用的 CSS 文本(单条规则,已压紧;调用方原样塞进 <style>)。 */
export function customThemeCss(c: CustomTheme): string {
  const body = Object.entries(customThemeVars(c))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `[${CUSTOM_ATTR}]{${body}}`;
}

/** 随机种子色:随机的是**色相**,亮度/彩度锁在好看的窗口里——这正是官方
 * randomize 出来的东西总不难看的原因(乱掷 RGB 必然出泥色)。 */
export function randomSeed(rand: () => number = Math.random): string {
  return oklchToHex({ l: 0.62, c: 0.15 + rand() * 0.09, h: rand() * 360 });
}

/** 几何档位:[selector, field, box, border, depth, noise]。
 * 这张表是把 35 套内置主题的实际取值去重得来的(全量只有 16 种组合),
 * 随机时**整组抽**而不是逐档乱掷——三档圆角之间有搭配关系,独立随机很容易
 * 配出「2rem 的卡片配 0 圆角的按钮」这种不搭的组合。同理 --size-* 不进随机:
 * 35 套主题清一色 0.25rem,它是尺寸基数不是风格旋钮。 */
const GEOMETRY: readonly (readonly [number, number, number, number, 0 | 1, 0 | 1])[] = [
  [1, 0.5, 1, 1, 0, 0],
  [1, 0.5, 1, 1, 1, 0],
  [1, 2, 1, 1, 0, 0],
  [0, 0, 0, 1, 0, 0],
  [0, 0.25, 0.25, 1, 0, 0],
  [0.5, 0.25, 0.5, 1, 1, 0],
  [2, 0.5, 1, 2, 1, 1],
  [2, 0.5, 1, 2, 1, 0],
  [2, 0.25, 0.5, 1, 1, 0],
  [2, 0.25, 0.5, 1, 0, 0],
  [1, 2, 1, 2, 1, 0],
  [1, 2, 1, 2, 0, 0],
  [1, 1, 1, 1, 1, 0],
  [1, 0.25, 0.5, 1, 0, 0],
  [0.25, 0.25, 0.5, 1, 0, 0],
  [0.25, 0.25, 0.25, 1, 0, 0],
];

/** 随机一整套主题:配色 + 几何一起换,逐项覆盖清空(不清的话用户会以为
 * 随机没生效——覆盖压在生成值上面)。**明暗不随机**:那是用户的使用偏好
 * (跟环境光/系统设置走),不是可以替他决定的风格。 */
export function randomTheme(current: CustomTheme, rand: () => number = Math.random): CustomTheme {
  const g = GEOMETRY[Math.floor(rand() * GEOMETRY.length)] ?? GEOMETRY[0]!;
  const [radiusSelector, radiusField, radiusBox, border, depth, noise] = g;
  return {
    ...current,
    seed: randomSeed(rand),
    overrides: {},
    radiusSelector,
    radiusField,
    radiusBox,
    border,
    depth: depth === 1,
    noise: noise === 1,
  };
}

const num = (v: unknown, fallback: number, range: { min: number; max: number }): number =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, range.min, range.max) : fallback;

/** localStorage 里的脏数据一律矫正回合法值;完全解析不了才返回 null。 */
export function parseCustomTheme(raw: string | null): CustomTheme | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Partial<Record<keyof CustomTheme, unknown>>;
  const overrides: Partial<Record<ColorRole, string>> = {};
  if (o.overrides && typeof o.overrides === "object") {
    const src = o.overrides as Record<string, unknown>;
    for (const role of COLOR_ROLES) {
      const hex = typeof src[role] === "string" ? normalizeHex(src[role] as string) : null;
      if (hex) overrides[role] = hex;
    }
  }
  return {
    mode: o.mode === "dark" ? "dark" : "light",
    seed: (typeof o.seed === "string" ? normalizeHex(o.seed) : null) ?? DEFAULT_CUSTOM.seed,
    overrides,
    radiusBox: num(o.radiusBox, DEFAULT_CUSTOM.radiusBox, RADIUS_RANGE),
    radiusField: num(o.radiusField, DEFAULT_CUSTOM.radiusField, RADIUS_RANGE),
    radiusSelector: num(o.radiusSelector, DEFAULT_CUSTOM.radiusSelector, RADIUS_RANGE),
    sizeField: num(o.sizeField, DEFAULT_CUSTOM.sizeField, SIZE_RANGE),
    sizeSelector: num(o.sizeSelector, DEFAULT_CUSTOM.sizeSelector, SIZE_RANGE),
    border: num(o.border, DEFAULT_CUSTOM.border, BORDER_RANGE),
    depth: o.depth === true,
    noise: o.noise === true,
  };
}
