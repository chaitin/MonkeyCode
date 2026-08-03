// 下载 store 的壳契约:定位命令的载荷形状(opener 插件要 paths 数组,
// {path} 会反序列化失败且无声——H2 审计钉住),失败不吞、留 console。
import { afterEach, describe, expect, it, vi } from "vitest";

import { revealDownload, type DownloadItem } from "./downloads";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item: DownloadItem = {
  dlId: "d1",
  filename: "a.zip",
  dest: "/home/u/下载/a.zip",
  written: 0,
  total: null,
  state: "done",
};

describe("revealDownload", () => {
  it("载荷形状:reveal_item_in_dir 必须收 {paths: [dest]}(数组,不是 {path})", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    vi.stubGlobal("window", {
      __TAURI__: {
        core: {
          invoke: (cmd: string, args?: Record<string, unknown>) => {
            calls.push({ cmd, args });
            return Promise.resolve(null);
          },
        },
      },
    });
    revealDownload(item);
    await Promise.resolve();
    expect(calls).toEqual([{ cmd: "plugin:opener|reveal_item_in_dir", args: { paths: ["/home/u/下载/a.zip"] } }]);
  });

  it("失败可见:invoke 被拒不再静默,console.warn 留痕", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: () => Promise.reject(new Error("插件缺权限")) } },
    });
    revealDownload(item);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith("[downloads] 文件管理器定位失败:", expect.any(Error));
  });
});
