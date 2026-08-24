import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TitleBar } from "./TitleBar";

afterEach(() => vi.unstubAllGlobals());

function stubShell(ua: string) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const shell = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (cmd === "plugin:window|is_maximized") return Promise.resolve(false);
        if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(false);
        return Promise.resolve(null);
      },
    },
    event: {
      listen: () => Promise.resolve(() => {}),
    },
  };
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = shell;
  vi.stubGlobal("navigator", { ...window.navigator, userAgent: ua });
  return {
    calls,
    done: () => {
      delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    },
  };
}

describe("自绘窗框条(Windows / Linux)", () => {
  it("三键齐全,点击各发对应窗口命令;关闭键有独立可达名", async () => {
    const { calls, done } = stubShell("Windows NT 10.0");
    render(<TitleBar />);
    await userEvent.click(screen.getByRole("button", { name: "最小化" }));
    await userEvent.click(screen.getByRole("button", { name: "最大化" }));
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    const cmds = calls.map((c) => c.cmd);
    expect(cmds).toContain("plugin:window|minimize");
    expect(cmds).toContain("plugin:window|toggle_maximize");
    expect(cmds).toContain("plugin:window|close");
    done();
  });

  it("拖拽热区:条与中间空白自带属性,按钮一个都不带(Tauri 不继承判定)", () => {
    const { done } = stubShell("Windows NT 10.0");
    const { container } = render(<TitleBar />);
    const bar = container.querySelector("[data-window-titlebar]");
    expect(bar?.hasAttribute("data-tauri-drag-region")).toBe(true);
    // 条本身 + 图标与三键之间那段空白(列宽分段已撤,见下条)
    expect(container.querySelectorAll("[data-tauri-drag-region]").length).toBe(2);
    for (const btn of container.querySelectorAll("button")) {
      expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
    }
    done();
  });

  it("不放品牌:品牌的法定位置只有侧栏头,两处都摆会变成上下两个 header", () => {
    const { done } = stubShell("Windows NT 10.0");
    render(<TitleBar />);
    expect(screen.queryByText("MonkeyCode")).toBeNull();
    expect(screen.queryByText("work")).toBeNull();
    done();
  });

  // 2026-08-08 定案:光删掉品牌文字不够——条按 rail/side/main 复刻列色时,
  // base-200 色块紧贴着下面又一个 base-200 侧栏头,那才是「两个 header」的
  // 成因。窗框必须与内容断色:整条单色、无底边线。
  it("不承列色、不带底边线:整条单色,才不会冒充成第二个 header", () => {
    const { done } = stubShell("Windows NT 10.0");
    const { container } = render(<TitleBar />);
    const bar = container.querySelector("[data-window-titlebar]") as HTMLElement;
    expect(bar.className).toContain("bg-base-300");
    expect(bar.className).not.toContain("border-b");
    // 列宽令牌一个都不许出现:品牌标记 2026-08-09 挪去 rail 角落格后,
    // 本条不再需要与任何列对齐,回归纯 chrome
    expect(container.innerHTML).not.toMatch(/bg-base-200|bg-base-100/);
    expect(container.innerHTML).not.toMatch(/w-rail|w-side/);
    done();
  });

  // 2026-08-09:品牌标记挪去 rail 角落格(那格在 Windows/Linux 上本来就空着,
  // 存在的唯一理由是 mac 要放红绿灯)。本条从此只剩拖拽区 + caption 三键。
  it("条内不放品牌标记:除三键外只有拖拽区(标记归 rail 角落格)", () => {
    const { done } = stubShell("Windows NT 10.0");
    const { container } = render(<TitleBar />);
    expect(container.querySelector("img")).toBeNull();
    // 三个 caption 键,没有第四个按钮
    expect(container.querySelectorAll("button")).toHaveLength(3);
    done();
  });

  it("条右键 = 系统菜单(无边框窗口丢掉的原生右键菜单补回来)", () => {
    const { calls, done } = stubShell("Windows NT 10.0");
    const { container } = render(<TitleBar />);
    fireEvent.contextMenu(container.querySelector("[data-window-titlebar]")!);
    expect(calls.map((c) => c.cmd)).toContain("window_system_menu");
    done();
  });

  it("Linux 同样自绘本条(壳一并走 CSD),但系统菜单是 Windows 专有", () => {
    const { calls, done } = stubShell("X11; Linux x86_64");
    const { container } = render(<TitleBar />);
    expect(container.querySelector("[data-window-titlebar]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    // GTK 侧无对等 API:右键不发命令
    fireEvent.contextMenu(container.querySelector("[data-window-titlebar]")!);
    expect(calls.map((c) => c.cmd)).not.toContain("window_system_menu");
    done();
  });
});

