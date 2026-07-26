import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import TitleBar, { MacDragSpacer } from "./titlebar";

/** isMacShell() = 有 __TAURI__ + UA 含 Mac;两者都桩掉才算 mac 壳 */
function stubShell(platform: "mac" | "windows" | "browser") {
  vi.stubGlobal("navigator", { userAgent: platform === "mac" ? "Mac OS X" : "Windows NT" });
  vi.stubGlobal("window", platform === "browser" ? {} : { __TAURI__: { core: { invoke: () => {} } } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Windows 标题栏", () => {
  it("主界面延续双层侧栏并展示页面上下文", () => {
    const html = renderToStaticMarkup(<TitleBar context="新建任务" />);

    expect(html).toContain('data-window-titlebar=""');
    expect(html).toContain("MonkeyCode");
    expect(html).toContain(">work<");
    expect(html).toContain("新建任务");
    expect(html).toContain("width:62px");
    expect(html).toContain("width:232px");
    expect(html).toContain('title="最小化"');
  });

  it("设置页使用与设置导航一致的左侧宽度", () => {
    const html = renderToStaticMarkup(<TitleBar context="设置" layout="settings" />);

    expect(html).toContain("width:168px");
    expect(html).not.toContain("width:232px");
    // 168px 是三处品牌位里最窄的一格,徽标同样要在
    expect(html).toContain(">work<");
  });
});

describe("侧栏顶部拖拽区", () => {
  it("mac 下二级栏顶部是 50px 拖拽区并承担品牌位", () => {
    stubShell("mac");
    const html = renderToStaticMarkup(<MacDragSpacer brand />);

    expect(html).toContain('data-tauri-drag-region=""');
    expect(html).toContain("height:50px");
    expect(html).toContain("MonkeyCode");
    expect(html).toContain(">work<");
  });

  it("一级栏顶部只留拖拽区,不放品牌——那片被红绿灯占着", () => {
    stubShell("mac");
    const html = renderToStaticMarkup(<MacDragSpacer />);

    expect(html).toContain("height:50px");
    expect(html).not.toContain("MonkeyCode");
    expect(html).not.toContain(">work<");
  });

  it("非 mac 壳退回 12px 留白:Windows 的品牌在自绘标题栏里,不重复一份", () => {
    stubShell("windows");
    const html = renderToStaticMarkup(<MacDragSpacer brand />);

    expect(html).toContain("height:12px");
    expect(html).not.toContain("MonkeyCode");
    expect(html).not.toContain("data-tauri-drag-region");
  });
});
