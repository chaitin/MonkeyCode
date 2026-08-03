import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResizeEdges } from "./ResizeEdges";

afterEach(() => vi.unstubAllGlobals());

function stubShell(ua: string, maximized = false) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "plugin:window|is_maximized") return Promise.resolve(maximized);
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  vi.stubGlobal("navigator", { ...window.navigator, userAgent: ua });
  return { calls, done: () => delete (window as unknown as { __TAURI__?: unknown }).__TAURI__ };
}

describe("Linux 无边框窗口的边缘拉伸热区", () => {
  it("八向齐全,按下各发对应方向的 start_resize_dragging", () => {
    const { calls, done } = stubShell("X11; Linux x86_64");
    const { container } = render(<ResizeEdges />);
    const zones = [...container.querySelectorAll<HTMLElement>("[data-resize-edges] > div")];
    expect(zones).toHaveLength(8);
    for (const z of zones) fireEvent.mouseDown(z, { button: 0 });
    const dirs = calls
      .filter((c) => c.cmd === "plugin:window|start_resize_dragging")
      .map((c) => c.args?.value);
    expect(new Set(dirs)).toEqual(
      new Set(["North", "South", "East", "West", "NorthEast", "NorthWest", "SouthEast", "SouthWest"]),
    );
    done();
  });

  it("只认主键:右键按下不触发拉伸(否则会吃掉右键菜单)", () => {
    const { calls, done } = stubShell("X11; Linux x86_64");
    const { container } = render(<ResizeEdges />);
    fireEvent.mouseDown(container.querySelector("[data-resize-edges] > div")!, { button: 2 });
    expect(calls.map((c) => c.cmd)).not.toContain("plugin:window|start_resize_dragging");
    done();
  });

  // 只有 Linux 需要:Windows 的无边框 resize 由 tao 在 WM_NCHITTEST 里做,
  // mac 走 Overlay 保留原生窗体边——多画一层只会白挡住内容
  it.each([
    ["Windows NT 10.0", "Windows"],
    ["Macintosh; Intel Mac OS X 10_15_7", "mac"],
  ])("%s 不渲染热区", (ua) => {
    const { done } = stubShell(ua);
    const { container } = render(<ResizeEdges />);
    expect(container.querySelector("[data-resize-edges]")).toBeNull();
    done();
  });

  it("浏览器模式不渲染", () => {
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    const { container } = render(<ResizeEdges />);
    expect(container.querySelector("[data-resize-edges]")).toBeNull();
  });

  // 热区贴着屏幕边,最大化后那几像素正是用户去够任务栏/顶栏的必经之路
  it("最大化后撤掉热区,不误触", async () => {
    const { done } = stubShell("X11; Linux x86_64", true);
    const { container } = render(<ResizeEdges />);
    await act(async () => {}); // 冲掉 is_maximized 的那一拍
    expect(container.querySelector("[data-resize-edges]")).toBeNull();
    done();
  });
});
