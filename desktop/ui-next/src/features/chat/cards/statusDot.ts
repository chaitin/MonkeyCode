// 会话流里的状态点(工具卡行首/工具组摘要头/发现行)统一出处——原先
// ToolCard.statusTone、LogList 组头、FindingsCard 各写一份同构的三分支。
//
// 配色降调(用户报障 2026-08-06「status 图标太亮」):daisyUI 的 .status-*
// 直上全强度语义色,而主题里的语义色可以非常刺眼——valentine 一类的
// --color-success 是 oklch(84% 0.143 164.978),高亮度高饱和的荧光薄荷,
// 8px 的点落在浅底上就是一颗小灯泡。掺 base-content 归一(oklab):浅色
// 主题压成墨色、深色主题提成粉彩,对比度由 base-content 兜底——与 md.css
// 里 hljs 语义色配方同源,那边头注记的正是同一个坑。
//
// bg-none / shadow-none 关掉 .status 的 --depth 立体感:35 套内置主题里 13 套
// 是 --depth:1,会给点加一层白高光(radial-gradient)加同色投影(box-shadow),
// 亮度雪上加霜;8px 的点不需要立体感,只需要能分辨。
//
// 掺入比例统一 75%,两轮实测校准出来的(用户 2026-08-06 两次报障):100%
// (daisyUI 原样)太亮、55% 太暗——掺得越多越靠 base-content,浅色主题下就
// 越发墨。四档同比例,不给每个语义色单独调数:点只有 8px,色相已经够分辨,
// 再按色相微调比例只会让这里变成一组解释不清的魔法数。
//
// ⚠️ 类名必须整串写成字面量:Tailwind 4 靠扫源码文本生成工具类,拼接出来的
// bg-[...] 扫不到,会静默丢样式。
const BASE = "status bg-none shadow-none";
const OK = `${BASE} bg-[color-mix(in_oklab,var(--color-success)_75%,var(--color-base-content))]`;
const FAIL = `${BASE} bg-[color-mix(in_oklab,var(--color-error)_75%,var(--color-base-content))]`;
const WARN = `${BASE} bg-[color-mix(in_oklab,var(--color-warning)_75%,var(--color-base-content))]`;
const RUN = `${BASE} bg-[color-mix(in_oklab,var(--color-primary)_75%,var(--color-base-content))] animate-pulse`;
const IDLE = `${BASE} bg-base-content/35`;

export type DotTone = "ok" | "fail" | "warn" | "run" | "idle";

/** 状态点完整 className(含 .status 形状)。 */
export function statusDot(tone: DotTone): string {
  switch (tone) {
    case "fail":
      return FAIL;
    case "warn":
      return WARN;
    case "run":
      return RUN;
    case "idle":
      return IDLE;
    default:
      return OK;
  }
}
