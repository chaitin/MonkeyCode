// 与 Tauri 壳的 IPC 原语。三条铁律:
//
// 1. invoke 的命令名必须以**字面量字符串**出现在调用点——契约守卫
//    scripts/check_command_contract.py 按正则 `\binvoke(<...>)?\(\s*"cmd"` 扫描
//    UI 源码与 ACL 对表;放进变量/常量表它就扫不到,缺权限的症状是"按钮点了
//    没反应"而 CI 全绿。
// 2. 「监听先于命令」:壳会在命令处理中**同步** emit(会话回放首帧、WS 管道
//    首帧),Tauri 事件不排队,监听未注册即丢——凡命令会触发事件的场景必须
//    `await listenAsync(...)` 之后再 invoke;需要 id 的通道由 UI 先生成 id
//    (WS pipe 用 crypto.randomUUID、下载 dlId)再带给命令。
// 3. 非壳环境(浏览器/node 测试)可导入:invoke reject、listen 为 no-op,
//    降级值由上层各域 API 决定;模块顶层不碰 window 之外的宿主对象。
//
// 壳经 withGlobalTauri 注入 window.__TAURI__,不引 @tauri-apps/api npm 包。

interface TauriEvent {
  payload: unknown;
}

interface TauriGlobal {
  core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: { listen: (name: string, cb: (e: TauriEvent) => void) => Promise<() => void> };
}

export function tauri(): TauriGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__;
}

/** 是否运行在桌面壳内(浏览器模式各域 API 据此降级)。 */
export function inDesktopShell(): boolean {
  return !!tauri()?.core?.invoke;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = tauri()?.core;
  if (!core) return Promise.reject(new Error("非桌面壳环境"));
  return core.invoke(cmd, args) as Promise<T>;
}

/** 解绑失败一律吞掉:Tauri 注入脚本对"解绑已不存在的监听"会抛
 *  `listeners[eventId].handlerId` 取空(StrictMode 双挂载/HMR 换模块的
 *  时序都会撞上,注册与解绑各是一次异步 IPC,句柄可能已被内核侧回收)。
 *  监听已经不在了,解绑撞空是无害终态——不兜底的话它顺着被 void 丢弃的
 *  promise 链变成 unhandledrejection,被 index.html 的全局陷阱画成
 *  「启动异常」糊用户一脸(2026-08-12 报障,3 条对应 tauri://drag-* 三监听)。 */
function safeOff(off: () => unknown): void {
  try {
    void Promise.resolve(off()).catch(() => {});
  } catch {
    // 同步抛也是同一类"已解绑"信号
  }
}

/** 订阅壳事件;非壳环境返回 no-op 退订。退订函数同步可用(经 promise 链兜底)。 */
export function listen<T>(name: string, cb: (payload: T) => void): () => void {
  const event = tauri()?.event;
  if (!event) return () => {};
  const pending = event.listen(name, (e) => cb(e.payload as T));
  return () => {
    void pending.then((off) => safeOff(off)).catch(() => {});
  };
}

/** 注册完成后才 resolve 的订阅:配合铁律 2,「命令会同步触发事件」的场景
 *  必须 `const off = await listenAsync(...)` 之后再 invoke。 */
export async function listenAsync<T>(name: string, cb: (payload: T) => void): Promise<() => void> {
  const event = tauri()?.event;
  if (!event) return () => {};
  const off = await event.listen(name, (e) => cb(e.payload as T));
  return () => safeOff(off);
}
