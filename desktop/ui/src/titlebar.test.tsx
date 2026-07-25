import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TitleBar from "./titlebar";

describe("Windows 标题栏", () => {
  it("主界面延续双层侧栏并展示页面上下文", () => {
    const html = renderToStaticMarkup(<TitleBar context="新建任务" />);

    expect(html).toContain('data-window-titlebar=""');
    expect(html).toContain("MonkeyCode");
    expect(html).toContain("新建任务");
    expect(html).toContain("width:62px");
    expect(html).toContain("width:232px");
    expect(html).toContain('title="最小化"');
  });

  it("设置页使用与设置导航一致的左侧宽度", () => {
    const html = renderToStaticMarkup(<TitleBar context="设置" layout="settings" />);

    expect(html).toContain("width:168px");
    expect(html).not.toContain("width:232px");
  });
});
