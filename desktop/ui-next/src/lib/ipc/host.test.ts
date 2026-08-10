import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPlatformAttr,
  hostInfo,
  hostPlatform,
  isCustomChromeShell,
  isLinuxShell,
  isMacShell,
  isWindowsShell,
  setWindowTitle,
} from "./host";

afterEach(() => vi.unstubAllGlobals());

function stubShell(
  ua: string,
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> = () => Promise.resolve(null),
) {
  vi.stubGlobal("window", { __TAURI__: { core: { invoke } } });
  vi.stubGlobal("navigator", { userAgent: ua });
}

describe("平台探测", () => {
  it("浏览器模式:无 __TAURI__ 即 browser,不看 UA", () => {
    vi.stubGlobal("window", {});
    expect(hostPlatform()).toBe("browser");
    expect(isMacShell()).toBe(false);
    expect(isWindowsShell()).toBe(false);
  });

  it("壳内按 UA 分平台", () => {
    stubShell("Macintosh; Intel Mac OS X 10_15_7");
    expect(hostPlatform()).toBe("mac");
    stubShell("Windows NT 10.0; Win64");
    expect(hostPlatform()).toBe("windows");
    stubShell("X11; Linux x86_64");
    expect(hostPlatform()).toBe("linux");
  });

  // 自绘窗框条的唯一判据(LAYOUT §1)。mac 走 Overlay 由 rail 角落承窗控、
  // 浏览器无窗体,两者都不画;Windows/Linux 壳都走 decorations(false)。
  it("isCustomChromeShell = Windows | Linux,mac 与浏览器为假", () => {
    vi.stubGlobal("window", {});
    expect(isCustomChromeShell()).toBe(false);
    stubShell("Macintosh; Intel Mac OS X 10_15_7");
    expect(isCustomChromeShell()).toBe(false);
    stubShell("Windows NT 10.0; Win64");
    expect(isCustomChromeShell()).toBe(true);
    stubShell("X11; Linux x86_64");
    expect(isCustomChromeShell()).toBe(true);
    expect(isLinuxShell()).toBe(true);
  });

  // --chrome-h 按这个属性取值(app.css),落错就是所有固定覆盖层一起错位
  it("applyPlatformAttr 把平台落到根节点 data-platform", () => {
    const root = { dataset: {} as Record<string, string> };
    vi.stubGlobal("document", { documentElement: root });
    stubShell("Windows NT 10.0; Win64");
    applyPlatformAttr();
    expect(root.dataset.platform).toBe("windows");
    stubShell("X11; Linux x86_64");
    applyPlatformAttr();
    expect(root.dataset.platform).toBe("linux");
    stubShell("Macintosh; Intel Mac OS X 10_15_7");
    applyPlatformAttr();
    expect(root.dataset.platform).toBe("mac");
  });
});

describe("setWindowTitle", () => {
  // 线上契约:壳侧这条命令由 Tauri 的 `setter!(set_title, &str)` 宏生成,
  // 形参名恒为 value。传 { title } 会被反序列化成「command argument
  // missing: value」拒掉,而调用点 quiet() 吞错——症状是 Alt-Tab/任务栏
  // 里永远是 index.html 的静态标题,界面上看不出任何异常。所以这里钉的是
  // **载荷字面键名**,不是"调用过就行"
  it("壳内:命令名与载荷键名按 Tauri 契约(value,不是 title)", async () => {
    const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
    stubShell("Windows NT 10.0", (cmd: string, args?: Record<string, unknown>) => {
      calls.push({ cmd, args });
      return Promise.resolve(null);
    });
    setWindowTitle("任务一 — MonkeyCode");
    await Promise.resolve();
    expect(calls).toEqual([{ cmd: "plugin:window|set_title", args: { value: "任务一 — MonkeyCode" } }]);
    expect(Object.keys(calls[0]?.args ?? {})).not.toContain("title");
  });

  it("浏览器模式:退回 document.title,不发命令", () => {
    const doc = { title: "" };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", doc); // 本文件跑在 node 环境,document 得自己给
    setWindowTitle("浏览器标题");
    expect(doc.title).toBe("浏览器标题");
  });
});

describe("hostInfo", () => {
  it("浏览器模式返回 null;壳内透传;命令失败也回落 null(启动期不炸 UI)", async () => {
    vi.stubGlobal("window", {});
    expect(await hostInfo()).toBeNull();

    stubShell("Windows NT 10.0", vi.fn(() => Promise.resolve({ version: "1.2.3", engine_version: null })));
    expect(await hostInfo()).toEqual({ version: "1.2.3", engine_version: null });

    stubShell("Windows NT 10.0", vi.fn(() => Promise.reject(new Error("boom"))));
    expect(await hostInfo()).toBeNull();
  });
});
