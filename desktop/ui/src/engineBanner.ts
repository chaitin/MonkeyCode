// 引擎生命周期横幅的视图推导(契约 6)。
//
// 纯函数与渲染分离的理由同 sessionNotice.ts:五个状态 × "是否自动重试"的
// 组合是**产品语义**,不是样式细节——用户凭这条横幅判断"要不要自己动手",
// 说错一次就是白等或白点。放在这里可被单测钉住,组件只管画。

import type { EngineStatus } from "./types";

export interface EngineBannerView {
  /** 主文案 */
  text: string;
  /** 单行诊断补充(日志尾行 / 启动错误);空串表示没有 */
  detail: string;
  /** 是否给出"重启引擎"按钮 */
  canRestart: boolean;
  /** 壳正在自己拉引擎:按钮禁用,避免用户在退避窗口里连点 */
  busy: boolean;
}

/** 崩溃自动重试上限,与壳侧 driver::ENGINE_MAX_RETRY 对表。 */
export const ENGINE_MAX_RETRY = 5;

/** 日志尾部只取最后一行放进横幅(完整内容进 title 悬浮)。 */
export function logTailLine(tail: string): string {
  return tail.trim().split("\n").pop() ?? "";
}

/**
 * 状态 → 横幅。返回 null 表示不显示横幅。
 *
 * ready/stopped 都不显示:stopped 只在冷启动前与重启中途出现,而重启的两条
 * 路径(手动、自动)都会走到 starting,拿 stopped 报警只会闪一下红。
 */
export function engineBannerView(s: EngineStatus | null): EngineBannerView | null {
  if (!s) return null;
  switch (s.phase) {
    case "ready":
    case "stopped":
      return null;
    case "starting":
      // attempt=0 是冷启动:那会儿主窗口还没建出来,UI 看不到;能看到的
      // starting 一定是崩溃后的自愈,要让用户知道"不用管,壳在处理"
      return s.attempt === 0
        ? null
        : {
            text: `引擎正在自动重启(第 ${s.attempt}/${ENGINE_MAX_RETRY} 次)…`,
            detail: "",
            canRestart: false,
            busy: true,
          };
    case "crashed":
      return s.retry_in_ms === null
        ? {
            // 熔断:自动恢复已放弃,必须把球交回用户,否则就是无声卡死
            text: `${s.detail} — 连续 ${s.attempt} 次自动重启均失败,请检查模型配置或引擎日志`,
            detail: logTailLine(s.log_tail),
            canRestart: true,
            busy: false,
          }
        : {
            text: `${s.detail},${Math.round(s.retry_in_ms / 1000)} 秒后自动重启(第 ${s.attempt}/${ENGINE_MAX_RETRY} 次)`,
            detail: logTailLine(s.log_tail),
            // 退避期间也允许手动立刻重启:不想等的用户不该被壳的节奏绑住
            canRestart: true,
            busy: false,
          };
    case "failed":
      return {
        text: "引擎启动失败",
        detail: s.error,
        canRestart: true,
        busy: false,
      };
  }
}
