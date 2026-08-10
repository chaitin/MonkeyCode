import { afterEach, describe, expect, it, vi } from "vitest";

import { inDesktopShell, invoke, listen, listenAsync } from "./ipc";

afterEach(() => vi.unstubAllGlobals());

function stubShell() {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  vi.stubGlobal("window", {
    __TAURI__: {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          return Promise.resolve(`ok:${cmd}`);
        },
      },
      event: {
        listen: (name: string, cb: (e: { payload: unknown }) => void) => {
          listeners.set(name, cb);
          return Promise.resolve(() => listeners.delete(name));
        },
      },
    },
  });
  return { calls, listeners };
}

describe("IPC 原语", () => {
  it("非壳环境:invoke reject、listen 为 no-op、探测为 false", async () => {
    vi.stubGlobal("window", {});
    expect(inDesktopShell()).toBe(false);
    await expect(invoke("host_info")).rejects.toThrow("非桌面壳环境");
    expect(listen("engine-status", () => {})).toBeTypeOf("function");
    expect(await listenAsync("engine-status", () => {})).toBeTypeOf("function");
  });

  it("壳内:invoke 透传命令与 camelCase 参数", async () => {
    const { calls } = stubShell();
    await expect(invoke<string>("session_open", { sessionId: "s1" })).resolves.toBe("ok:session_open");
    expect(calls).toEqual([{ cmd: "session_open", args: { sessionId: "s1" } }]);
  });

  it("listenAsync 注册完成后事件立即可达(监听先于命令的铁律依赖这一点)", async () => {
    const { listeners } = stubShell();
    const got: unknown[] = [];
    const off = await listenAsync("frames:s1", (p) => got.push(p));
    // 注册已生效:此刻壳若同步 emit,不会丢
    listeners.get("frames:s1")?.({ payload: [{ type: "task-started" }] });
    expect(got).toEqual([[{ type: "task-started" }]]);
    off();
    expect(listeners.has("frames:s1")).toBe(false);
  });

  it("listen 的同步退订经 promise 链兜底", async () => {
    const { listeners } = stubShell();
    const off = listen("engine-status", () => {});
    off(); // 注册 promise 尚未 resolve 时调用也不该炸
    await Promise.resolve();
    await Promise.resolve();
    expect(listeners.has("engine-status")).toBe(false);
  });
});
