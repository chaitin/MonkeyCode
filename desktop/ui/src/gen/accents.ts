// 本文件由 desktop/scripts/gen_accent_tokens.py 生成,勿手改。
// 主题色的色相取自移动端 ACCENTS(mobile/src/theme.tsx),色值与
// ui/src/styles.css 的生成块同源;改主题色请改脚本后重新生成。

/** 主题色:key 落到根节点 data-accent(默认色缺省不写属性),label 给设置页,
 *  swatch 是该色的 --acc(浅色档),用于色板圆点。 */
export const ACCENTS = [
  { key: "green", label: "清新绿", swatch: "#16b364" },
  { key: "blue", label: "天空蓝", swatch: "#0f9ef5" },
  { key: "purple", label: "葡萄紫", swatch: "#b277e5" },
  { key: "orange", label: "蜜橘橙", swatch: "#e27502" },
] as const;

export type AccentKey = (typeof ACCENTS)[number]["key"];
export const DEFAULT_ACCENT: AccentKey = "green";
