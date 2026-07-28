import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TitleBar, { MacBrandBand, MacWindowControls } from "./titlebar";

/** isMacShell() = 有 __TAURI__ + UA 含 Mac;两者都桩掉才算 mac 壳 */
function stubShell(platform: "mac" | "windows" | "browser") {
  vi.stubGlobal("navigator", { userAgent: platform === "mac" ? "Mac OS X" : "Windows NT" });
  vi.stubGlobal("window", platform === "browser" ? {} : { __TAURI__: { core: { invoke: () => {} } } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Windows 标题栏", () => {
  it("主界面延续双层侧栏,只承载品牌与窗口按钮", () => {
    const html = renderToStaticMarkup(<TitleBar />);

    expect(html).toContain('data-window-titlebar=""');
    expect(html).toContain("MonkeyCode");
    expect(html).toContain(">work<");
    // 页面上下文不再入栏(唯一标题在 ViewHeader;窗口级上下文走原生标题)
    expect(html).not.toContain("新建任务");
    expect(html).toContain("width:62px");
    expect(html).toContain("width:232px");
    expect(html).toContain('title="最小化"');
  });

  it("设置页使用与设置导航一致的左侧宽度", () => {
    const html = renderToStaticMarkup(<TitleBar layout="settings" />);

    expect(html).toContain("width:168px");
    expect(html).not.toContain("width:232px");
    // 168px 是三处品牌位里最窄的一格,徽标同样要在
    expect(html).toContain(">work<");
  });
});

describe("mac 自绘小红绿灯", () => {
  it("mac 下是 50px 拖拽区,带关闭/最小化/全屏三颗替身", () => {
    stubShell("mac");
    const html = renderToStaticMarkup(<MacWindowControls />);

    expect(html).toContain('data-tauri-drag-region=""');
    expect(html).toContain("height:50px");
    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain('aria-label="最小化"');
    expect(html).toContain('aria-label="全屏"');
    expect(html).not.toContain("MonkeyCode");
  });

  it("非 mac 壳退回 12px 留白,窗口按钮归自绘标题栏", () => {
    stubShell("windows");
    const html = renderToStaticMarkup(<MacWindowControls />);

    expect(html).toContain("height:12px");
    expect(html).not.toContain("data-tauri-drag-region");
    expect(html).not.toContain("aria-label");
  });
});

describe("侧栏顶部品牌带", () => {
  it("mac 下是 50px 拖拽区,携带与 Windows 标题栏同款字标和徽标", () => {
    stubShell("mac");
    const html = renderToStaticMarkup(<MacBrandBand />);

    expect(html).toContain('data-tauri-drag-region=""');
    expect(html).toContain("height:50px");
    expect(html).toContain("MonkeyCode");
    expect(html).toContain(">work<");
  });

  it("非 mac 壳退回 12px 留白——Windows 的品牌在自绘标题栏里,不重复", () => {
    stubShell("windows");
    const html = renderToStaticMarkup(<MacBrandBand />);

    expect(html).toContain("height:12px");
    expect(html).not.toContain("MonkeyCode");
    expect(html).not.toContain(">work<");
  });
});
