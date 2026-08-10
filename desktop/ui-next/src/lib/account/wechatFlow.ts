// 微信扫码登录的轮询状态机(纯逻辑层,poll/时钟可注入,视图只消费快照)。
//
// 协议(壳侧 baizhi/wechat.rs):baizhi_wechat_start 取二维码 → 顺序长轮询
// baizhi_wechat_poll(壳一次最长挂 ~40s,拿到结果立即续)。单次结果:
//   waiting  待扫码(继续轮询)
//   scanned  已扫码待手机确认(继续轮询)
//   canceled 手机上点了取消——二维码仍有效,回「待扫」继续轮询
//   expired  二维码过期(终态;UI 在码上覆「重新获取」)
//   ok       确认成功,壳已完成回调、会话已建立(终态;UI 刷新登录态)
//
// 并发语义:begin() 以代号(generation)作废旧循环——模式切换/重新获取/
// 卸载后,旧循环迟到的轮询结果一律丢弃,不会倒灌快照。
import type { WechatPollStatus } from "@/lib/ipc/account";

export type { WechatPollStatus };

export type WechatPhase = "idle" | "loading" | "waiting" | "scanned" | "expired" | "ok" | "error";

export interface WechatSnapshot {
  phase: WechatPhase;
  /** 二维码 data URL;loading/获取失败时为空串 */
  qr: string;
  /** phase === "error" 时的失败信息(start/poll 抛错,壳的中文 Err 原样) */
  error: string;
}

export const WECHAT_IDLE: WechatSnapshot = { phase: "idle", qr: "", error: "" };

/** 纯转移表:一次轮询结果 → 下一相位与是否终态。未知状态(将来协议新增)
 *  按 error 收——静默当 waiting 会让用户对着永不推进的码干等。 */
export function pollTransition(status: WechatPollStatus): { phase: WechatPhase; done: boolean } {
  switch (status) {
    case "waiting":
      return { phase: "waiting", done: false };
    case "scanned":
      return { phase: "scanned", done: false };
    case "canceled":
      return { phase: "waiting", done: false }; // 取消不作废二维码,回待扫
    case "expired":
      return { phase: "expired", done: true };
    case "ok":
      return { phase: "ok", done: true };
    default:
      return { phase: "error", done: true };
  }
}

export interface WechatFlowDeps {
  /** 发起扫码会话(baizhiWechatStart) */
  start: () => Promise<{ qr: string }>;
  /** 长轮询一次(baizhiWechatPoll) */
  poll: () => Promise<{ status: WechatPollStatus }>;
  /** 快照回调(React 侧直接 setState) */
  onChange: (snap: WechatSnapshot) => void;
  /** 时钟注入(默认 setTimeout);测试传立即 resolve 的假时钟 */
  sleep?: (ms: number) => Promise<void>;
  /** 续询前的喘息毫秒数。壳侧长轮询自带 ~40s 节流,这里只防壳即时返回时
   *  打转(默认 300) */
  gapMs?: number;
}

export interface WechatFlow {
  /** 发起(或重新发起)扫码会话;再次调用作废进行中的循环 */
  begin: () => Promise<void>;
  /** 作废进行中的循环(组件卸载/切走 tab);之后不再有 onChange */
  dispose: () => void;
  snapshot: () => WechatSnapshot;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createWechatFlow(deps: WechatFlowDeps): WechatFlow {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gapMs = deps.gapMs ?? 300;
  let gen = 0;
  let snap: WechatSnapshot = WECHAT_IDLE;

  /** 只有仍是当前代的循环才允许推进快照;返回是否仍存活。 */
  const set = (g: number, next: Partial<WechatSnapshot>): boolean => {
    if (g !== gen) return false;
    snap = { ...snap, ...next };
    deps.onChange(snap);
    return true;
  };

  const begin = async (): Promise<void> => {
    const g = ++gen;
    set(g, { phase: "loading", qr: "", error: "" });
    let qr: string;
    try {
      qr = (await deps.start())?.qr ?? "";
      if (!qr) throw new Error("二维码数据为空");
    } catch (e) {
      set(g, { phase: "error", error: errMsg(e) });
      return;
    }
    if (!set(g, { phase: "waiting", qr })) return;
    for (;;) {
      let status: WechatPollStatus;
      try {
        status = (await deps.poll())?.status as WechatPollStatus;
      } catch (e) {
        set(g, { phase: "error", error: errMsg(e) });
        return;
      }
      const t = pollTransition(status);
      if (!set(g, { phase: t.phase })) return;
      if (t.done) return;
      await sleep(gapMs);
      if (g !== gen) return;
    }
  };

  return {
    begin,
    dispose: () => {
      gen++;
    },
    snapshot: () => snap,
  };
}
