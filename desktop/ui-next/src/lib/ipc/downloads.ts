// 全局下载(云端 VM 文件落本地):模块级 store + useSyncExternalStore 订阅。
// 契约:dlId 由 UI 生成;必须先挂 dl-progress:{dlId} 监听再 invoke
// mc_file_download(首帧 written=0 带 total,壳同步就发);取消走
// mc_file_download_cancel;完成后可在文件管理器中定位(plugin:opener)。
import { useSyncExternalStore } from "react";

import { invoke, listenAsync } from "./ipc";

export type DownloadState = "running" | "done" | "error" | "canceled";

export interface DownloadItem {
  dlId: string;
  filename: string;
  dest: string;
  written: number;
  total: number | null;
  state: DownloadState;
  /** 失败原因(壳的 Err 中文文案,直接外显) */
  error?: string;
}

let items: DownloadItem[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

function patch(dlId: string, up: Partial<DownloadItem>) {
  items = items.map((d) => (d.dlId === dlId ? { ...d, ...up } : d));
  notify();
}

export function getDownloads(): DownloadItem[] {
  return items;
}

export function useDownloads(): DownloadItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getDownloads,
    getDownloads,
  );
}

export function dismissDownload(dlId: string): void {
  items = items.filter((d) => d.dlId !== dlId);
  notify();
}

/** 完成/取消的卡片自灭延时(旧 UI downloads.ts::DONE_DISMISS_MS 同值)。
 *  **只有失败驻留**——失败要用户看见原因并自己决定何时关掉。
 *  不设期限的话右下角就是一摞永久钉住的 288px 卡片,盖住 composer 右端
 *  (上下文用量环/发送键那一带)还拦点击,只能一张张手点关掉;这与同一份
 *  App.tsx 给后台会话 toast 设 8s 时写的理由一字不差(LAYOUT §1 把两者
 *  一起归进「角落瞬态」层)。 */
const DONE_DISMISS_MS = 8000;

function autoDismiss(dlId: string): void {
  setTimeout(() => dismissDownload(dlId), DONE_DISMISS_MS);
}

export function cancelDownload(dlId: string): void {
  // 「已取消」态本身要显示(commit 190743be:取消不降级为失败),但同样自灭
  patch(dlId, { state: "canceled" });
  autoDismiss(dlId);
  void invoke("mc_file_download_cancel", { dlId }).catch(() => {});
}

export async function startDownload(args: {
  vmId: string;
  path: string;
  filename: string;
  dest: string;
}): Promise<void> {
  const dlId = crypto.randomUUID();
  items = [...items, { dlId, filename: args.filename, dest: args.dest, written: 0, total: null, state: "running" }];
  notify();
  // 铁律:先挂进度监听再发命令(首帧同步到达)
  const off = await listenAsync<{ written: number; total: number | null }>(`dl-progress:${dlId}`, (p) => {
    patch(dlId, { written: p.written, total: p.total ?? null });
  });
  try {
    await invoke<{ ok: boolean; bytes: number }>("mc_file_download", { dlId, ...args });
    patch(dlId, { state: "done" });
    autoDismiss(dlId);
  } catch (e) {
    // 用户主动取消的不降级为 error(取消已置态)
    const current = items.find((d) => d.dlId === dlId);
    if (current?.state === "running") {
      patch(dlId, { state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    off();
  }
}

/** 在文件管理器中定位产物。opener 插件的命令签名是
 * `reveal_item_in_dir(paths: Vec<PathBuf>)`——参数名必须是 paths 数组,
 * 传 {path} 会反序列化失败且无声(旧 UI 踩过);失败留 console 便于诊断,
 * 路径本身就在下载卡上,用户仍可自寻。 */
export function revealDownload(item: DownloadItem): void {
  void invoke("plugin:opener|reveal_item_in_dir", { paths: [item.dest] }).catch((e: unknown) => {
    console.warn("[downloads] 文件管理器定位失败:", e);
  });
}

/** 仅测试用:清空 store。 */
export function resetDownloadsForTest(): void {
  items = [];
  notify();
}
