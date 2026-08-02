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

// ==================== 侧栏引擎卡(面板底部,克隆更新卡形态) ====================

export interface EngineCardView {
  /** 一行主文案(11.5px × ~214px 可用宽,必须短) */
  text: string;
  /** 悬浮 title 的完整诊断(错误全文 + 日志尾);空串表示没有 */
  detail: string;
  canRestart: boolean;
  /** 壳正在自己拉引擎:点位闪烁,不给重启按钮 */
  busy: boolean;
}

/**
 * 状态 → 侧栏引擎卡。返回 null 表示不显示(ready/stopped)。
 *
 * 与顶部横幅(engineBannerView)的分工:横幅打断注意力,只报崩溃/熔断/
 * 自愈进度;卡是常驻低干扰入口,额外补上横幅刻意留白的冷启动期——
 * "窗口开了引擎还没就绪"在 WSL 预热/慢盘上长达 15-30 秒,没有它用户
 * 只能对着灰点干等。coldStartVisible 由组件侧计时供给(starting/attempt=0
 * 持续超过宽限期才置真),快速启动不闪卡。
 */
export function engineCardView(s: EngineStatus | null, coldStartVisible: boolean): EngineCardView | null {
  if (!s) return null;
  switch (s.phase) {
    case "ready":
    case "stopped":
      return null;
    case "starting":
      if (s.attempt === 0 && !coldStartVisible) return null;
      return {
        text: s.attempt === 0 ? "引擎启动中…" : `引擎自动重启中(${s.attempt}/${ENGINE_MAX_RETRY})`,
        detail: "",
        canRestart: false,
        busy: true,
      };
    case "crashed":
      return {
        text: s.retry_in_ms === null ? "引擎已崩溃,自动重启失败" : `引擎已崩溃,自动重启中(${s.attempt}/${ENGINE_MAX_RETRY})`,
        detail: [s.detail, s.log_tail.trim()].filter(Boolean).join("\n"),
        canRestart: true,
        busy: false,
      };
    case "failed":
      return { text: "引擎启动失败", detail: s.error, canRestart: true, busy: false };
  }
}

// ==================== rail 状态点 ====================

export interface RailDotView {
  color: string;
  /** boxShadow 的光晕色;null 不发光 */
  glow: string | null;
  pulse: boolean;
  title: string;
}

/**
 * rail 底部状态点:引擎相位优先,引擎 ready 后才轮到会话连接状态说话。
 * 此前点只绑会话 WS(connected),引擎崩了/没起来它一样是"普通的灰",
 * 与"引擎好好的、只是没开会话"不可区分——排查时最误导的就是这种。
 */
export function railDotView(engine: EngineStatus | null, connected: boolean, sessionStatus: string): RailDotView {
  switch (engine?.phase) {
    case "crashed":
    case "failed":
      return { color: "var(--err)", glow: "var(--errBg)", pulse: false, title: "引擎异常,详见下方状态卡" };
    case "starting":
      return { color: "var(--notice)", glow: null, pulse: true, title: "引擎启动中…" };
    default:
      // ready / stopped / 快照未到:沿用会话连接语义
      return connected
        ? { color: "var(--ok)", glow: "var(--okBg)", pulse: false, title: sessionStatus }
        : { color: "var(--t6)", glow: null, pulse: false, title: sessionStatus };
  }
}

/** 引擎相位变化 → UI 该做什么(重连/复位忙态)。 */
export interface EngineTransition {
  /** 下一轮的"引擎曾经不可用"记忆 */
  wasDown: boolean;
  /** 引擎重新就绪且此前掉过:重拉模型/会话并重开当前会话 */
  reconnect: boolean;
  /** 重启按钮的忙态可以解除了(终态:就绪或失败) */
  clearRestarting: boolean;
}

/**
 * 引擎重启后壳内会话表是全新的,UI 手里的句柄已失效——早期靠整页刷新复位,
 * 现在改为"Ready 即重连",这套记忆语义就成了唯一的触发依据,单独钉住:
 *
 * - **不能只在收到 starting/crashed 时记 down**:页面可能恰好在退避窗口里
 *   加载(自动重启途中切回窗口、上一次刷新落在崩溃里),快照与事件必须走
 *   同一条判定,否则引擎回来时不重连,UI 攥着失效句柄发不出消息。
 * - **stopped 既不记 down 也不清 down**:它只在冷启动前与重启中途出现,
 *   记它会让每次冷启动都白跑一轮重连,清它会抹掉退避窗口里已记下的 down。
 * - **ready 清 down**:重连已经做过,下一次 ready 不该重复跑。
 */
export function engineTransition(wasDown: boolean, phase: EngineStatus["phase"]): EngineTransition {
  const ready = phase === "ready";
  return {
    wasDown: ready ? false : phase === "stopped" ? wasDown : true,
    reconnect: ready && wasDown,
    // 失败也要解除忙态:否则按钮永远停在"重启中…",反把失败横幅遮住
    clearRestarting: ready || phase === "failed",
  };
}
