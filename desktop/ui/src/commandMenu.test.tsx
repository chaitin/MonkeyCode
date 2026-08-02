// 斜杠指令菜单的渲染契约(状态机的纯逻辑在 slashCommands.test.ts)。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlashCommandMenu, type SlashCommandsHandle } from "./commandMenu";
import type { SlashCommand } from "./types";

const handle = (over: Partial<SlashCommandsHandle> = {}): SlashCommandsHandle => ({
  open: true,
  list: [],
  active: 0,
  setActive: vi.fn(),
  pick: vi.fn(),
  toggle: vi.fn(),
  close: vi.fn(),
  onKeyDown: () => false,
  ...over,
});

const list: SlashCommand[] = [
  { name: "compact", description: "压缩上下文,释放 token 空间" },
  { name: "review", description: "代码审查", input: { hint: "<file>" } },
];

describe("SlashCommandMenu", () => {
  it("列出 /指令、参数提示与描述,高亮当前项", () => {
    const html = renderToStaticMarkup(<SlashCommandMenu h={handle({ list, active: 1 })} count={2} />);
    expect(html).toContain("/compact");
    expect(html).toContain("压缩上下文,释放 token 空间");
    expect(html).toContain("&lt;file&gt;"); // 参数提示
    // active=1 那项(review)拿到高亮底色,首项不带
    const [, first, second] = html.split('class="menu-item"');
    expect(first).toContain("background:transparent");
    expect(second).toContain("background:var(--hov)");
    // 键盘用法就地说明:桌面这条路径是主路径,不能只靠试
    expect(html).toContain("↑↓ 选择");
  });

  it("过滤无命中时给空态而不是空菜单", () => {
    const html = renderToStaticMarkup(<SlashCommandMenu h={handle({ list: [] })} count={3} />);
    expect(html).toContain("无匹配指令");
  });

  it("关闭态只渲染触发按钮;按钮带「使用技能」文字,title 提示可直接敲 /", () => {
    const html = renderToStaticMarkup(<SlashCommandMenu h={handle({ open: false, list })} count={2} />);
    expect(html).not.toContain("↑↓ 选择");
    // 按钮可见文字(纯 / 图标普通用户看不懂,措辞与移动端对齐)
    expect(html).toContain(">使用技能</button>");
    expect(html).toContain("使用技能(2)");
    expect(html).toContain("在输入框直接敲 / 也可唤起");
  });

  it("Agent 还没上报技能时按钮灰态并说明原因", () => {
    const html = renderToStaticMarkup(<SlashCommandMenu h={handle({ open: false })} count={0} />);
    expect(html).toContain("opacity:0.4");
    expect(html).toContain("尚未上报可用技能");
  });
});
