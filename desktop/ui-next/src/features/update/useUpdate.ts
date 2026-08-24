// 应用更新状态:**模块级单实例 store** + useSyncExternalStore 订阅。
// 挂载检查一次 + 窗口回焦静默复查 + 4 小时兜底,三个触发点共用全局闸门
// (lib/ipc/update)。安装成功后壳自行重启(promise 不返回,busy 不回收);
// 失败复位忙态并把错误文案交给视图外显——吞掉就是按钮永远转圈。
//
// 为什么必须是模块级而不是各持一份 useState(LAYOUT §3「更新状态 = 侧栏底部条
// + 设置·关于」是**同一条信息的两个法定位置**,两处必须同源):
// 此前侧栏走本 hook、关于页自己另存一份 useState,而两条路又共用 update.ts 的
// 模块级 lastCheckAt 闸门。后果是①侧栏已在提示「有新版本」时切到关于页,那里
// 仍显示普通「检查更新」钮(关于页挂载只拉 hostInfo,从不查更新,found 恒 false);
// ②反过来在关于页查到新版本但没装,退出设置后侧栏底部条依旧不显示,而这次检查
// 还把接下来 30 分钟内的回焦复查一起闸掉了——那笔账记了,结果却只留在已卸载的
// 组件里。
import { useEffect, useSyncExternalStore } from "react";

import { recordUpdateCheck, takeUpdateCheck, updateCheck, updateInstall, type UpdateInfo } from "@/lib/ipc/update";

/** 兜底复查间隔:窗口一直开着、从没失去过焦点(挂着跑长任务正是如此)就
 *  永远等不到前台事件,只靠 focus 触发等于不查。被闸门挡掉只是顺延到下一
 *  次 tick,不会重复请求。 */
const FALLBACK_MS = 4 * 3600_000;

interface UpdateState {
  update: UpdateInfo | null;
  installing: boolean;
  /** 上次安装失败的原因;null = 没失败过/重试中 */
  error: string | null;
}

let current: UpdateState = { update: null, installing: false, error: null };
const listeners = new Set<() => void>();

function publishState(next: Partial<UpdateState>): void {
  current = { ...current, ...next };
  for (const cb of listeners) cb();
}

function publish(info: UpdateInfo | null): void {
  // null = 检查失败/浏览器模式(update.ts 收口),不覆盖已知结果
  if (!info) return;
  // 已确认没有更新时，上次安装失败已不再可重试，不能继续残留为当前状态。
  publishState(info.available ? { update: info } : { update: info, error: null });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = (): UpdateState => current;

/** 只读订阅(关于页):不起轮询,只跟随共享真值。 */
export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useUpdateInfo(): UpdateInfo | null {
  return useUpdateState().update;
}

/** 手动检查(关于页按钮):**不过闸门**——用户明确要查就得查——但记一笔账,
 *  紧接着切个窗口回来不该再自动查一遍(旧 UI updateGate.record 同款)。
 *  结果并入共享 store,侧栏底部条随之出现。 */
export async function checkUpdateNow(): Promise<UpdateInfo | null> {
  recordUpdateCheck();
  const info = await updateCheck();
  publish(info);
  return info;
}

/** 静默检查(自动触发点):过闸门,被挡就跳过。 */
function checkGated(): void {
  if (!takeUpdateCheck()) return;
  void updateCheck().then(publish);
}

export function clearUpdateError(): void {
  if (current.error !== null) publishState({ error: null });
}

/** 两个更新入口共用同一个安装动作和忙态，避免设置页开始下载后侧栏仍可重复点击。 */
export function installUpdateNow(): void {
  if (current.installing) return;
  publishState({ installing: true, error: null });
  void updateInstall().catch((e) => {
    // 失败:复位忙态并外显;成功后壳自行重启,不会走到这里
    publishState({ installing: false, error: e instanceof Error ? e.message : String(e) });
  });
}

export function useUpdate(): {
  update: UpdateInfo | null;
  installing: boolean;
  /** 上次安装失败的原因;null = 没失败过/重试中 */
  error: string | null;
  install: () => void;
} {
  const { update, installing, error } = useUpdateState();

  useEffect(() => {
    checkGated();
    window.addEventListener("focus", checkGated);
    const timer = window.setInterval(checkGated, FALLBACK_MS);
    return () => {
      window.removeEventListener("focus", checkGated);
      window.clearInterval(timer);
    };
  }, []);

  return {
    update,
    installing,
    error,
    install: installUpdateNow,
  };
}

/** 仅测试用:清空模块级 store(跨用例会串)。 */
export function resetUpdateForTest(): void {
  current = { update: null, installing: false, error: null };
  for (const cb of listeners) cb();
}
