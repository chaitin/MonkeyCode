// 更新检查的节流闸门。
//
// 触发时机是"用户把窗口切到前台",这个信号很密集——alt-tab 回来、点一下任务栏、
// 从桌宠唤起都算,连点几次就是几次网络请求。所以所有静默检查都从这道闸门过:
// 30 分钟内只放行一次,谁先到谁走。
//
// 手动检查(设置页按钮/托盘菜单)不受闸门限制——用户明确要查就得查——但会
// record() 记一笔账,免得刚查完切个窗口又查一遍。
//
// 时钟从参数注进来:测试要拨表,而 Date.now 不可控。

/** 两次静默检查之间的最小间隔 */
export const UPDATE_MIN_INTERVAL_MS = 30 * 60_000;

export interface UpdateGate {
  /** 该查就返回 true 并记账;距上次检查不足间隔则返回 false(调用方直接跳过) */
  tryTake(): boolean;
  /** 记一次"检查已经发生"(手动检查用),让紧随其后的自动触发让路 */
  record(): void;
}

export function createUpdateGate(
  now: () => number = () => Date.now(),
  minIntervalMs: number = UPDATE_MIN_INTERVAL_MS,
): UpdateGate {
  // 用 null 而非 0/-Infinity 表示"从未查过":单调时钟或系统时间被改到 1970
  // 之前时,数值哨兵会算出负的间隔而误判,null 没有这个歧义。
  let last: number | null = null;
  return {
    tryTake() {
      const t = now();
      // 系统时间被往回调(用户改时钟/NTP 纠偏)会让 t - last 变成负数,
      // 那就当作"隔了很久",放行并重新记账,不然会闸死到时间追上为止。
      if (last !== null && t >= last && t - last < minIntervalMs) return false;
      last = t;
      return true;
    },
    record() {
      last = now();
    },
  };
}

/** 全局闸门:主窗口只有一个,前台检查与手动检查共用同一笔账。 */
export const updateGate = createUpdateGate();
