// 原生预览遮挡信号:设计预览是 Tauri 原生子 webview,永远画在**所有 DOM
// 之上**——z-index 对它无效。任何要盖住工作台的 DOM 浮层(命令式菜单、
// DetailModal 族、待办详情、设置模态)都必须让预览先藏起来,否则浮层被
// 预览截断(2026-08-30 用户报障「header 下拉框在 preview 之下」)。
//
// 这里是唯一的遮挡计数:浮层方 acquire/release,预览所有者
// (DesignPreviewWorkbench 经 ChatView 的 obscured)订阅读数。previewShow/
// previewHide 的**执行权始终只在 workbench 一处**——此前设置/待办详情在
// App 里直呼 show/hide,关闭时的无条件 previewShow 会把 workbench 明确
// 藏起的预览(如子会话浮层在场)重新拉回最上层,典型的多写者竞态。
import { useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/** 声明「我正盖着工作台」;返回释放函数(幂等,可安全多次调用)。
 *  典型用法:`useEffect(() => acquireNativeObscure(), [])`。 */
export function acquireNativeObscure(): () => void {
  count += 1;
  if (count === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count -= 1;
    if (count === 0) notify();
  };
}

export function nativeObscured(): boolean {
  return count > 0;
}

export function subscribeNativeObscure(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React 绑定:任意浮层在场时为 true。 */
export function useNativeObscured(): boolean {
  return useSyncExternalStore(subscribeNativeObscure, nativeObscured, nativeObscured);
}
