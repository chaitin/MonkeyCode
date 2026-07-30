// 全局下载管理:状态挂在应用层(模块单例 + useSyncExternalStore),不随
// 文件抽屉销毁——关抽屉/切页面后下载继续跑,进度与结果经右下角下载条
// (downloadsBar.tsx)外显。壳侧按 dl-progress:{id} 事件上报进度,取消经
// mc_file_download_cancel 置旗、由壳收束并清残件。
import { useSyncExternalStore } from "react";
import { mcFileDownload, mcFileDownloadCancel } from "./cloudapi";
import { listenAsync } from "./ipc";

export interface DownloadItem {
  id: string;
  filename: string;
  /** 本地保存路径(完成后展示 + 文件管理器定位) */
  dest: string;
  written: number;
  /** Content-Length 总量;目录 zip 等流式响应拿不到时为 null(降级为字节计数) */
  total: number | null;
  status: "running" | "done" | "error";
  error?: string;
}

/** 完成条目自动消退时长(失败驻留,等用户看过原因手动关) */
const DONE_DISMISS_MS = 8000;

let items: DownloadItem[] = [];
const subs = new Set<() => void>();

function emit() {
  subs.forEach((f) => f());
}

function patch(id: string, p: Partial<DownloadItem>) {
  items = items.map((it) => (it.id === id ? { ...it, ...p } : it));
  emit();
}

export function dismissDownload(id: string) {
  items = items.filter((it) => it.id !== id);
  emit();
}

/** 取消进行中的下载:只发指令,条目的移除等壳侧收束(命令 reject)后统一做 */
export function cancelDownload(id: string) {
  void mcFileDownloadCancel(id).catch(() => {});
}

/** 发起下载并登记到全局列表。调用方(文件抽屉)不需要等它完成——
 * 进度/结果全部经下载条外显,这里不 reject。 */
export async function startDownload(opts: {
  vmId: string;
  /** VM 内绝对路径(如 /workspace/dir/name.txt) */
  vmPath: string;
  filename: string;
  dest: string;
}): Promise<void> {
  const id = crypto.randomUUID();
  items = [...items, { id, filename: opts.filename, dest: opts.dest, written: 0, total: null, status: "running" }];
  emit();
  // 进度监听先注册再发命令(与云端 WS 管道同款顺序):壳的首帧进度事件
  // 在命令处理中就会发出,后注册必丢
  let un: (() => void) | null = null;
  try {
    un = await listenAsync(`dl-progress:${id}`, (p) => {
      const d = p as { written?: number; total?: number | null } | null;
      patch(id, { written: d?.written ?? 0, total: d?.total ?? null });
    });
  } catch {
    /* 非壳环境:下面的 invoke 也会失败并走 error 分支 */
  }
  try {
    await mcFileDownload(id, opts.vmId, opts.vmPath, opts.filename, opts.dest);
    patch(id, { status: "done" });
    setTimeout(() => dismissDownload(id), DONE_DISMISS_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 用户主动取消不算失败,条目直接消失
    if (msg.includes("已取消")) dismissDownload(id);
    else patch(id, { status: "error", error: msg });
  } finally {
    un?.();
  }
}

/** 当前下载列表快照(测试与非 React 调用方用;视图走 useDownloads) */
export const getDownloads = () => items;
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** 下载列表(React 视图订阅口) */
export function useDownloads(): DownloadItem[] {
  return useSyncExternalStore(subscribe, getDownloads);
}

/** 测试用:清空列表(模块单例跨用例串状态) */
export function resetDownloadsForTest() {
  items = [];
  emit();
}
