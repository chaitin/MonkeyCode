import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetUpdateGate } from "@/lib/ipc/update";
import { useUpdate } from "./useUpdate";

// 闸门是模块级单例(自动检查与设置页手动检查共用一笔账),用例之间必须清账,
// 否则第一个用例查过之后,后面的都会被 30 分钟闸门挡掉
beforeEach(resetUpdateGate);
afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

function stubShell({ failInstall }: { failInstall?: string } = {}) {
  const calls: string[] = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        calls.push(cmd);
        if (cmd === "update_check") return Promise.resolve({ available: true, current: "1.0", latest: "1.1" });
        if (cmd === "update_install" && failInstall) return Promise.reject(new Error(failInstall));
        if (cmd === "update_install") return new Promise(() => {}); // 成功路径:壳重启,promise 永不返回
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  return { calls };
}

describe("useUpdate(H5)", () => {
  it("安装失败:复位忙态并外显失败文案;可重试", async () => {
    stubShell({ failInstall: "下载超时" });
    const { result } = renderHook(() => useUpdate());
    await waitFor(() => expect(result.current.update?.available).toBe(true));

    act(() => result.current.install());
    expect(result.current.installing).toBe(true);
    await waitFor(() => expect(result.current.installing).toBe(false)); // 失败复位
    expect(result.current.error).toBe("下载超时");

    // 重试清掉上一次的错误
    act(() => result.current.install());
    expect(result.current.error).toBeNull();
    expect(result.current.installing).toBe(true);
  });

  it("安装成功路径:壳自行重启,忙态不回收", async () => {
    stubShell();
    const { result } = renderHook(() => useUpdate());
    await waitFor(() => expect(result.current.update?.available).toBe(true));
    act(() => result.current.install());
    await act(() => Promise.resolve());
    expect(result.current.installing).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
