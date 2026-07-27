// 全局下载管理(downloads.ts)单测:mock 壳 IPC(假 __TAURI__),覆盖
// 进度事件驱动、完成/失败终态、取消路径与"先注册监听再发命令"的顺序。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listeners = new Map<string, (e: { payload: unknown }) => void>();
let resolveDl: (() => void) | null = null;
let rejectDl: ((e: Error) => void) | null = null;
let dlArgs: Record<string, unknown> | null = null;
let cancelled: string[] = [];
let listenAtInvoke = false; // 发命令时进度监听是否已注册(顺序守卫)

beforeEach(() => {
  listeners.clear();
  resolveDl = null;
  rejectDl = null;
  dlArgs = null;
  cancelled = [];
  listenAtInvoke = false;
  vi.useFakeTimers();
  (globalThis as Record<string, unknown>).window = {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          if (cmd === "mc_file_download") {
            dlArgs = args ?? null;
            listenAtInvoke = listeners.has(`dl-progress:${args?.dlId as string}`);
            return new Promise<null>((resolve, reject) => {
              resolveDl = () => resolve(null);
              rejectDl = reject;
            });
          }
          if (cmd === "mc_file_download_cancel") {
            cancelled.push(args?.dlId as string);
            return Promise.resolve(null);
          }
          return Promise.reject(new Error("unexpected cmd " + cmd));
        },
      },
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => {
          listeners.set(name, cb);
          return Promise.resolve(() => listeners.delete(name));
        },
      },
    },
  };
});

afterEach(async () => {
  const { resetDownloadsForTest } = await import("./downloads");
  resetDownloadsForTest();
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).window;
});

async function start() {
  const dl = await import("./downloads");
  const p = dl.startDownload({ vmId: "vm-1", vmPath: "/workspace/a.txt", filename: "a.txt", dest: "/tmp/a.txt" });
  await vi.advanceTimersByTimeAsync(0); // 让监听注册与 invoke 落定
  return { dl, p };
}

function pushProgress(id: string, written: number, total: number | null) {
  listeners.get(`dl-progress:${id}`)?.({ payload: { written, total } });
}

describe("全局下载管理", () => {
  it("登记 → 进度事件更新 → 完成转 done,超时自动消退", async () => {
    const { dl, p } = await start();
    let items = dl.getDownloads();
    expect(items.length).toBe(1);
    expect(items[0].status).toBe("running");
    expect(listenAtInvoke).toBe(true); // 监听必须先于命令注册,否则首帧进度丢失
    expect(dlArgs?.path).toBe("/workspace/a.txt");

    pushProgress(items[0].id, 1024, 4096);
    items = dl.getDownloads();
    expect(items[0].written).toBe(1024);
    expect(items[0].total).toBe(4096);

    resolveDl!();
    await p;
    items = dl.getDownloads();
    expect(items[0].status).toBe("done");
    await vi.advanceTimersByTimeAsync(9000); // 完成 8s 后自动消退
    expect(dl.getDownloads().length).toBe(0);
  });

  it("失败转 error 驻留(带原因);目录 zip 无 total 保持 null", async () => {
    const { dl, p } = await start();
    const id = dl.getDownloads()[0].id;
    pushProgress(id, 2048, null);
    expect(dl.getDownloads()[0].total).toBe(null);

    rejectDl!(new Error("下载中断: 网络错误"));
    await p;
    const it = dl.getDownloads()[0];
    expect(it.status).toBe("error");
    expect(it.error).toContain("网络错误");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dl.getDownloads().length).toBe(1); // 失败不自动消退
  });

  it("取消:发 cancel 命令;壳收束(reject 已取消)后条目移除,不算失败", async () => {
    const { dl, p } = await start();
    const id = dl.getDownloads()[0].id;
    dl.cancelDownload(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toEqual([id]);

    rejectDl!(new Error("下载已取消"));
    await p;
    expect(dl.getDownloads().length).toBe(0);
  });
});
