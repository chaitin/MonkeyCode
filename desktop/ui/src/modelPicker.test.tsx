import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelMenuItem, ModelPicker } from "./chat";

describe("ModelMenuItem", () => {
  it("本地和云端共用整行 hover 与当前项勾选", () => {
    const html = renderToStaticMarkup(<ModelMenuItem label="测试模型" selected onClick={vi.fn()} />);

    expect(html).toContain('class="hv menu-item"');
    expect(html).toContain("width:100%");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("测试模型");
    // 长名截断后 hover 仍可读全名(title 缺省 = label)
    expect(html).toContain('title="测试模型"');
  });

  it("会员条目:tag 档位药丸 + title 用完整原名覆盖短名", () => {
    const html = renderToStaticMarkup(
      <ModelMenuItem label="deepseek-pro" tag="专业" title="monkeycode-pro/deepseek-pro" selected={false} onClick={vi.fn()} />,
    );

    expect(html).toContain("专业");
    expect(html).toContain('title="monkeycode-pro/deepseek-pro"');
    expect(html).toContain("deepseek-pro");
  });

  it("locked 条目灰态禁选:disabled、降透明度、无 hover 类", () => {
    const html = renderToStaticMarkup(
      <ModelMenuItem label="claude-x" disabled title="超档 · 当前会员档不可用" selected={false} onClick={vi.fn()} />,
    );

    expect(html).toContain("disabled");
    expect(html).toContain("opacity:0.55");
    expect(html).toContain('class="menu-item"'); // 不带 hv,悬停无高亮
    expect(html).toContain('title="超档 · 当前会员档不可用"');
  });
});

describe("ModelPicker 关闭态(静态渲染,不触 localStorage)", () => {
  it("trigger 可收缩且 hover 显示当前模型全名,宽度上限收在包裹层", () => {
    const html = renderToStaticMarkup(
      <ModelPicker
        models={[{ name: "一个非常非常非常长的模型名字", default: true }]}
        current="一个非常非常非常长的模型名字"
        onPick={vi.fn()}
      />,
    );

    // 包裹层限宽 + 允许收缩(长名不得把 composer 行的按钮挤出卡片)
    expect(html).toContain("max-width:220px");
    expect(html).toContain("min-width:0");
    expect(html).toContain("flex:0 1 auto");
    // trigger 不再自带 220 上限(由包裹层给),title 含全名
    expect(html).toContain("max-width:100%");
    expect(html).toContain("一个非常非常非常长的模型名字 · 点击切换(下一轮生效)");
  });

  it("会员长名:trigger 显示剥前缀短名,title 保留完整原名(仅剥寻址后缀)", () => {
    const full = "monkeycode-pro/deepseek-pro";
    const html = renderToStaticMarkup(
      <ModelPicker
        models={[{ name: full, model: full, source: "monkeycode", default: true }]}
        current={full}
        onPick={vi.fn()}
      />,
    );

    expect(html).toContain(">deepseek-pro<");
    expect(html).toContain(`${full} · 点击切换(下一轮生效)`);
  });

  it("落盘名的来源后缀不出现在任何展示面(短名与 title 都剥掉)", () => {
    const stored = "monkeycode-pro/deepseek-pro@monkeycode#cfg-9";
    const html = renderToStaticMarkup(
      <ModelPicker
        models={[{ name: stored, model: "monkeycode-pro/deepseek-pro", source: "monkeycode", default: true }]}
        current={stored}
        onPick={vi.fn()}
      />,
    );

    expect(html).not.toContain("@monkeycode");
    expect(html).not.toContain("cfg-9");
    expect(html).toContain(">deepseek-pro<");
    expect(html).toContain("monkeycode-pro/deepseek-pro · 点击切换(下一轮生效)");
  });
});
