// sRGB(hex)↔ OKLCH 双向转换(Björn Ottosson 的 Oklab,daisyUI 主题里的色值
// 就是这套坐标)。为什么必须换到 OKLCH 而不是在 hex/HSL 上凑:
// - 生成配色要做「同亮度换色相」「压低彩度当中性色」这类操作,HSL 的 L 不是
//   感知亮度,同 L 不同色相亮度能差一倍(黄 vs 蓝),配出来必然有一档发灰;
// - OKLCH 的 L 是感知均匀的,固定 L 转 H 得到的一组颜色看上去才是「同一深浅
//   的一家人」——daisyUI 内置主题清一色 oklch() 正是这个道理。
//
// 纯函数、无依赖,可单测(往返精度有测试钉着)。

export interface Oklch {
  /** 感知亮度 0..1 */
  l: number;
  /** 彩度 0..~0.4 */
  c: number;
  /** 色相角 0..360 */
  h: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** sRGB 传输函数(gamma)与其逆。 */
const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** #rgb → #rrggbb;大小写归一。非法值返回 null。 */
export function normalizeHex(hex: string): string | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.toLowerCase();
  return h.length === 7 ? h : `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
}

export function hexToOklch(hex: string): Oklch | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const r = toLinear(Number.parseInt(h.slice(1, 3), 16) / 255);
  const g = toLinear(Number.parseInt(h.slice(3, 5), 16) / 255);
  const b = toLinear(Number.parseInt(h.slice(5, 7), 16) / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.hypot(A, B);
  // 无彩色(纯黑/白/灰)的色相无意义,atan2 会给 0;归一到 0 由调用方决定怎么用
  const hue = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h: hue };
}

export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);

  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;

  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;

  // 超出 sRGB 色域的直接截断:OKLCH 能表达的比屏幕能显示的多,不截会溢出成怪色
  const hex = (v: number): string =>
    Math.round(clamp01(fromLinear(v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** WCAG 相对亮度。注意**不能**拿 OKLCH 的 l 当它用:l 是感知亮度,
 * 相对亮度是物理量,两者的曲线不同——判"该配黑字还是白字"必须用后者。 */
export function relativeLuminance({ l, c, h }: Oklch): number {
  const hex = oklchToHex({ l, c, h });
  const ch = (i: number) => toLinear(Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

/** WCAG 对比度(1..21)。 */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 输出 CSS 的 oklch();百分号写法与 daisyUI 内置主题一致,便于对读。 */
export function oklchCss({ l, c, h }: Oklch): string {
  const n = (v: number, d: number) => Number(v.toFixed(d));
  return `oklch(${n(l * 100, 2)}% ${n(c, 3)} ${n(((h % 360) + 360) % 360, 1)})`;
}
