// 改名空转判定的真值表(头部与侧栏右键共用,分叉过一次:头部 4ab809db
// 修了旧版缺 title_custom 的补标记,侧栏还停在「文本未变即空转」)。
import { describe, expect, it } from "vitest";

import { renameIsNoop } from "./rename";

describe("renameIsNoop", () => {
  it("改成新文本:恒提交", () => {
    expect(renameIsNoop("新标题", { title: "旧标题", title_custom: true })).toBe(false);
    expect(renameIsNoop("新标题", { title: "旧标题" })).toBe(false);
  });

  it("原文确认:已有标记才是空转;旧版缺标记必须提交补 title_custom", () => {
    expect(renameIsNoop("标题", { title: "标题", title_custom: true })).toBe(true);
    // 旧版自定义标题只写 title——不提交的话标记永远补不上,行里一直显示 summary
    expect(renameIsNoop("标题", { title: "标题" })).toBe(false);
  });

  it("空提交:改过名 = 撤销自定义要提交;没改过名才是纯空转", () => {
    expect(renameIsNoop("", { title: "标题", title_custom: true })).toBe(false);
    expect(renameIsNoop("", { title: "首句自动标题" })).toBe(true);
  });
});
