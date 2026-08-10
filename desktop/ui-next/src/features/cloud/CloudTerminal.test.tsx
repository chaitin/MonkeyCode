// 终端组件冒烟:stub xterm,验证挂载、terminal_id 复用、连接参数。
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// xterm 触真 DOM 渲染层,jsdom 撑不住:类桩只记录调用
const openSpy = vi.fn();
const disposeSpy = vi.fn();
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 24;
    cols = 80;
    options = {};
    open = openSpy;
    loadAddon = vi.fn();
    write = vi.fn();
    focus = vi.fn();
    dispose = disposeSpy;
    onData = vi.fn(() => ({ dispose: vi.fn() }));
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

import { CloudTerminal } from "./CloudTerminal";

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("CloudTerminal", () => {
  it("挂载 xterm;复用已有 terminal 会话开管道;卸载释放", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          calls.push({ cmd, args });
          if (cmd === "mc_terminal_list") return Promise.resolve({ terminals: [{ id: "term-1" }] });
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    const { unmount } = render(<CloudTerminal vmId="vm-1" />);
    expect(openSpy).toHaveBeenCalledTimes(1); // xterm 已挂到宿主节点
    await waitFor(() => {
      const open = calls.find((c) => c.cmd === "cloud_ws_open");
      expect(open?.args).toMatchObject({ kind: "terminal", id: "vm-1", params: { terminal_id: "term-1" } });
    });
    unmount();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("连接失败:状态覆盖层外显原因", async () => {
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          if (cmd === "mc_terminal_list") return Promise.resolve({ terminals: [] });
          if (cmd === "cloud_ws_open") return Promise.reject(new Error("会话缺失"));
          return Promise.resolve(null);
        },
      },
      event: { listen: () => Promise.resolve(() => {}) },
    };
    const { findByRole } = render(<CloudTerminal vmId="vm-1" />);
    const status = await findByRole("status");
    await waitFor(() => expect(status.textContent).toContain("会话缺失"));
  });
});
