import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserExtStatus } from "@/lib/ipc/config";
import { BrowserSection } from "./BrowserSection";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 壳桩:browser_status 逐次取 queue 头(轮询推进用),repair/其余走 extra。 */
function stubShell(queue: Array<BrowserExtStatus | Error>, extra?: Record<string, () => unknown>) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  let i = 0;
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (extra && cmd in extra) return Promise.resolve(extra[cmd]!());
        if (cmd === "browser_status") {
          const v = queue[Math.min(i++, queue.length - 1)]!;
          return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
        }
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
  return { calls };
}

const unpaired: BrowserExtStatus = { enabled: true, paired: false, connected: false, pairing_code: "8H3K5P2Q", addr: "127.0.0.1:7788" };

describe("BrowserSection", () => {
  it("未配对:出配对码(4-4 分组)与本地地址,复制写剪贴板并回显「已复制」", async () => {
    stubShell([unpaired]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<BrowserSection />);
    expect(await screen.findByText("尚未配对")).toBeDefined();
    expect(screen.getByText("8H3K-5P2Q")).toBeDefined();
    expect(screen.getByText("本地连接地址:127.0.0.1:7788")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "复制" }));
    expect(writeText).toHaveBeenCalledWith("8H3K5P2Q");
    expect(await screen.findByRole("button", { name: "已复制" })).toBeDefined();
  });

  it("已连接:报浏览器名与版本,不出配对码", async () => {
    stubShell([{ enabled: true, paired: true, connected: true, browser_name: "Chrome", browser_version: "142" }]);
    render(<BrowserSection />);
    expect(await screen.findByText("已连接 · Chrome 142")).toBeDefined();
    expect(screen.queryByText("一次性配对码")).toBeNull();
  });

  it("已配对未连接:出「重新配对」,点击走 browser_repair 并换新码", async () => {
    const { calls } = stubShell([{ enabled: true, paired: true, connected: false }], {
      browser_repair: () => ({ ...unpaired, pairing_code: "AAAABBBB" }),
    });
    render(<BrowserSection />);
    await userEvent.click(await screen.findByRole("button", { name: "重新配对" }));
    expect(calls.some((c) => c.cmd === "browser_repair")).toBe(true);
    expect(await screen.findByText("AAAA-BBBB")).toBeDefined();
  });

  it("功能未启用:带壳给的原因;状态命令失败:报读取失败", async () => {
    stubShell([{ enabled: false, paired: false, connected: false, error: "端口被占用" }]);
    const { unmount } = render(<BrowserSection />);
    expect(await screen.findByText("浏览器功能未启用:端口被占用")).toBeDefined();
    unmount();

    stubShell([new Error("桥未就绪")]);
    render(<BrowserSection />);
    expect(await screen.findByText("状态读取失败:桥未就绪")).toBeDefined();
  });

  it("「打开扩展目录」走 open_extension_dir,回显定位路径", async () => {
    const { calls } = stubShell([unpaired], { open_extension_dir: () => "/Apps/MonkeyCode/ext" });
    render(<BrowserSection />);
    await userEvent.click(await screen.findByRole("button", { name: "打开扩展目录" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "open_extension_dir")).toBe(true));
    expect(await screen.findByText("已在文件管理器中定位:/Apps/MonkeyCode/ext")).toBeDefined();
  });
});
