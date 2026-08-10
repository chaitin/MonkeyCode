// 应用更新域:静默检查(窗口焦点驱动 + 30 分钟闸门)与安装。
// update_install 成功后壳会自行 app.restart();失败上抛给调用方外显。
import { inDesktopShell, invoke } from "./ipc";

export interface UpdateInfo {
  available: boolean;
  current: string;
  latest?: string;
}

export function updateCheck(): Promise<UpdateInfo | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<UpdateInfo>("update_check").catch(() => null);
}

/** 安装更新。成功后壳自行 app.restart(),promise 不会正常返回;
 *  失败必须上抛——调用方复位忙态并外显文案,吞掉就是按钮永远"更新中…"。 */
export function updateInstall(): Promise<void> {
  return invoke<void>("update_install");
}

/** 30 分钟闸门:焦点每次触发,但静默检查最多半小时一次。纯函数可测。 */
export const UPDATE_GATE_MS = 30 * 60_000;

export function shouldCheckUpdate(now: number, lastAt: number | null, gateMs = UPDATE_GATE_MS): boolean {
  if (lastAt === null) return true;
  // 系统时间被往回调(用户改钟/NTP 纠偏)会让差值变负,当作「隔了很久」放行,
  // 否则会一直闸死到时间追上为止(旧 UI updateGate 同款守卫)
  if (now < lastAt) return true;
  return now - lastAt >= gateMs;
}

/** 全局闸门:主窗口只有一个,**自动检查与手动检查共用同一笔账**。
 *  设置页手动查完 record 一笔,紧接着切窗口回来的前台触发就不再重复查
 *  (旧 UI updateGate 的语义;ui-next 首版把账记在 hook 实例里,两条路
 *  各记各的)。 */
let lastCheckAt: number | null = null;

/** 该查就返回 true 并记账;在闸门内返回 false(调用方直接跳过)。 */
export function takeUpdateCheck(now: number = Date.now()): boolean {
  if (!shouldCheckUpdate(now, lastCheckAt)) return false;
  lastCheckAt = now;
  return true;
}

/** 记一次「检查已经发生」(手动检查用),让紧随其后的自动触发让路。 */
export function recordUpdateCheck(now: number = Date.now()): void {
  lastCheckAt = now;
}

/** 仅测试用:清掉全局账,避免用例之间互相影响。 */
export function resetUpdateGate(): void {
  lastCheckAt = null;
}
