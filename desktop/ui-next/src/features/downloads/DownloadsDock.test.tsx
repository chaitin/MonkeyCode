import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetDownloadsForTest, startDownload } from "@/lib/ipc/downloads";
import { DownloadsDock } from "./DownloadsDock";

interface Op {
  op: string;
  name: string;
  args?: Record<string, unknown>;
}

let ops: Op[];
let emitProgress: (dlId: string, p: unknown) => void;
let resolveDownload: () => void;
let rejectDownload: (e: Error) => void;

beforeEach(() => {
  resetDownloadsForTest();
  ops = [];
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  emitProgress = (dlId, p) => listeners.get(`dl-progress:${dlId}`)?.({ payload: p });
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (name: string, args?: Record<string, unknown>) => {
        ops.push({ op: "invoke", name, args });
        if (name === "mc_file_download") {
          return new Promise<unknown>((res, rej) => {
            resolveDownload = () => res({ ok: true, bytes: 1 });
            rejectDownload = rej;
          });
        }
        return Promise.resolve(null);
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        ops.push({ op: "listen", name });
        listeners.set(name, cb);
        return Promise.resolve(() => listeners.delete(name));
      },
    },
  };
});

afterEach(() => {
  resetDownloadsForTest();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("全局下载条", () => {
  it("铁律:进度监听先于 mc_file_download;进度帧驱动百分比;完成给定位入口", async () => {
    render(<DownloadsDock />);
    let done: Promise<void>;
    await act(async () => {
      done = startDownload({ vmId: "vm1", path: "/out/a.zip", filename: "a.zip", dest: "/home/u/a.zip" });
      await Promise.resolve();
    });
    const listenAt = ops.findIndex((o) => o.op === "listen" && o.name.startsWith("dl-progress:"));
    const invokeAt = ops.findIndex((o) => o.op === "invoke" && o.name === "mc_file_download");
    expect(listenAt).toBeGreaterThanOrEqual(0);
    expect(listenAt).toBeLessThan(invokeAt);

    const dlId = (ops[invokeAt]?.args as { dlId: string }).dlId;
    act(() => emitProgress(dlId, { written: 50, total: 100 }));
    expect((screen.getByRole("progressbar", { name: "下载进度" }) as HTMLProgressElement).value).toBe(50);

    await act(async () => {
      resolveDownload();
      await done!;
    });
    await userEvent.click(screen.getByText("在文件管理器中显示"));
    expect(ops.some((o) => o.name === "plugin:opener|reveal_item_in_dir")).toBe(true);
  });

  it("取消:发 cancel 命令且随后 reject 不降级为失败", async () => {
    render(<DownloadsDock />);
    let done: Promise<void>;
    await act(async () => {
      done = startDownload({ vmId: "vm1", path: "/o/b.txt", filename: "b.txt", dest: "/d/b.txt" });
      await Promise.resolve();
    });
    await userEvent.click(screen.getByRole("button", { name: "取消下载" }));
    expect(ops.some((o) => o.name === "mc_file_download_cancel")).toBe(true);
    await act(async () => {
      rejectDownload(new Error("canceled"));
      await done!;
    });
    expect(screen.getByText("已取消")).toBeTruthy();
    expect(screen.queryByText(/下载失败/)).toBeNull();
  });

  it("失败:外显壳侧原因;可关闭", async () => {
    render(<DownloadsDock />);
    let done: Promise<void>;
    await act(async () => {
      done = startDownload({ vmId: "vm1", path: "/o/c.txt", filename: "c.txt", dest: "/d/c.txt" });
      await Promise.resolve();
    });
    await act(async () => {
      rejectDownload(new Error("磁盘已满"));
      await done!;
    });
    expect(screen.getByText("下载失败:磁盘已满")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("c.txt")).toBeNull();
  });
});
