// 本地终端 IPC(壳侧 term.rs):UI 生成 id → **先 listenAsync 两个事件通道
// 再 term_open**(ipc.ts 铁律 2「监听先于命令」:shell 提示符在 open 返回后
// 立即到,监听未注册即丢,表现为终端首屏空白)。数据两个方向都是 base64
// (输入 UTF-8 → b64encode;输出分片 → termBytes 还原字节喂 xterm)。
import { invoke, listenAsync } from "./ipc";

export function termOpen(id: string, cwd: string | undefined, cols: number, rows: number): Promise<void> {
  return invoke<void>("term_open", { id, cwd, cols, rows });
}

/** data = base64(输入字节)。 */
export function termWrite(id: string, data: string): Promise<void> {
  return invoke<void>("term_write", { id, data });
}

export function termResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("term_resize", { id, cols, rows });
}

export function termClose(id: string): Promise<void> {
  return invoke<void>("term_close", { id });
}

/** 前台进程名(tab 标题跟随命令;Windows/取不到时 null)。 */
export function termTitle(id: string): Promise<string | null> {
  return invoke<string | null>("term_title", { id });
}

/** 输出分片(base64)订阅;resolve 后监听已注册,才允许 term_open。 */
export function onTermData(id: string, cb: (b64: string) => void): Promise<() => void> {
  return listenAsync<string>(`term-data:${id}`, cb);
}

/** shell 退出/PTY 关闭。 */
export function onTermExit(id: string, cb: () => void): Promise<() => void> {
  return listenAsync<unknown>(`term-exit:${id}`, () => cb());
}
