import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CloudModelGroups } from "./cloudModelMenu";
import type { McCloudModelGroup } from "./cloud";

const groups: McCloudModelGroup[] = [
  {
    key: "monkeycode-pro",
    label: "专业模型",
    badge: "专业会员免费",
    models: [{ id: "m1", model: "monkeycode-pro/deepseek-pro" }],
  },
  {
    key: "paid",
    label: "付费模型",
    badge: "消耗积分",
    models: [{ id: "m2", model: "gpt-x", remark: "内部 GPT" }],
  },
];

describe("CloudModelGroups(newtask 建任务 / cloudtask 切换共用)", () => {
  it("组头+徽标+条目短名齐全,选中项勾选,hover 全名", () => {
    const html = renderToStaticMarkup(<CloudModelGroups groups={groups} selectedId="m1" onPick={vi.fn()} />);

    expect(html).toContain("专业模型");
    expect(html).toContain("专业会员免费");
    expect(html).toContain("付费模型");
    expect(html).toContain("消耗积分");
    // 条目是分组短名(组头已表达档位),title 兜底完整展示名
    expect(html).toContain(">deepseek-pro<");
    expect(html).toContain('title="专业模型 / deepseek-pro"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("内部 GPT");
  });

  it("locked(超会员档)条目灰态禁选,title 说明解锁路径", () => {
    const lockedGroups: McCloudModelGroup[] = [
      {
        key: "monkeycode-ultra",
        label: "旗舰模型",
        badge: "旗舰会员免费",
        models: [{ id: "u1", model: "monkeycode-ultra/gemini", locked: true }],
      },
    ];
    const html = renderToStaticMarkup(<CloudModelGroups groups={lockedGroups} onPick={vi.fn()} />);

    expect(html).toContain("旗舰模型");
    expect(html).toContain("disabled");
    expect(html).toContain("opacity:0.55");
    expect(html).toContain('class="menu-item"'); // 不带 hv,悬停无高亮
    expect(html).toContain("当前会员档不可用,升级会员后可用");
  });
});
