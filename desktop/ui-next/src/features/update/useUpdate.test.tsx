import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetUpdateGate } from "@/lib/ipc/update";
import { checkUpdateNow, resetUpdateForTest, useUpdate } from "./useUpdate";

// 闸门是模块级单例(自动检查与设置页手动检查共用一笔账),用例之间必须清账,
// 否则第一个用例查过之后,后面的都会被 30 分钟闸门挡掉
beforeEach(() => {
  resetUpdateGate();
  act(() => resetUpdateForTest());
});
afterEach(() => {
  act(() => resetUpdateForTest());
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

function stubShell({ failInstall }: { failInstall?: string } = {}) {
  const calls: string[] = [];
  let installFailed = false;
  let updateAvailable = true;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "update_check") {
          return Promise.resolve({ available: updateAvailable, current: "1.0", latest: updateAvailable ? "1.1" : undefined });
        }
        if (cmd === "update_install" && failInstall && !installFailed) {
          installFailed = true;
          return Promise.reject(new Error(failInstall));
        }
        if (cmd === "update_install") return new Promise(() => {}); // 成功路径:壳重启,promise 永不返回
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  return {
    calls,
    setUpdateAvailable: (available: boolean) => {
      updateAvailable = available;
    },
  };
}

describe("useUpdate(H5)", () => {
  it("安装失败:复位忙态并外显失败文案;可重试", async () => {
    stubShell({ failInstall: "下载超时" });
    const { result } = renderHook(() => ({ settings: useUpdate(), sidebar: useUpdate() }));
    await waitFor(() => expect(result.current.settings.update?.available).toBe(true));

    await act(async () => {
      result.current.settings.install();
      await Promise.resolve();
    });
    expect(result.current.settings.installing).toBe(false); // 失败复位
    expect(result.current.settings.error).toBe("下载超时");
    expect(result.current.sidebar.error).toBe("下载超时");

    // 任一入口重试都会同步清掉上一次的错误
    act(() => result.current.sidebar.install());
    expect(result.current.settings.error).toBeNull();
    expect(result.current.sidebar.installing).toBe(true);
  });

  it("后续检查确认无更新时清除历史安装错误", async () => {
    const shell = stubShell({ failInstall: "下载超时" });
    const { result } = renderHook(() => useUpdate());
    await waitFor(() => expect(result.current.update?.available).toBe(true));

    await act(async () => {
      result.current.install();
      await Promise.resolve();
    });
    expect(result.current.error).toBe("下载超时");

    shell.setUpdateAvailable(false);
    await act(async () => {
      await checkUpdateNow();
    });
    expect(result.current.update?.available).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("安装成功路径:壳自行重启,忙态不回收", async () => {
    stubShell();
    const { result } = renderHook(() => ({ settings: useUpdate(), sidebar: useUpdate() }));
    await waitFor(() => expect(result.current.settings.update?.available).toBe(true));
    act(() => result.current.settings.install());
    await act(() => Promise.resolve());
    expect(result.current.settings.installing).toBe(true);
    expect(result.current.sidebar.installing).toBe(true);
    expect(result.current.sidebar.error).toBeNull();
  });
});
