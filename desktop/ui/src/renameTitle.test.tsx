import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ViewHeader, nextRenameTitle, useRenameDraft, type RenameDraft } from "./viewChrome";

describe("nextRenameTitle", () => {
  it("去掉首尾空白后提交", () => {
    expect(nextRenameTitle("  新标题 ", "旧标题")).toBe("新标题");
  });

  it("空白标题不提交(内核只收非空标题)", () => {
    expect(nextRenameTitle("   ", "旧标题")).toBeNull();
    expect(nextRenameTitle("", "")).toBeNull();
  });

  it("与原标题相同不提交(避免无谓的写库与列表刷新)", () => {
    expect(nextRenameTitle("旧标题", "旧标题")).toBeNull();
    expect(nextRenameTitle(" 旧标题 ", "旧标题")).toBeNull();
  });
});

describe("useRenameDraft", () => {
  it("进编辑态即全选(Finder 手感:直接打字整体覆盖)", () => {
    // 静态渲染看不到事件,把 inputProps 捞出来直接验:少了这条,
    // 谁把 onFocus 顺手删了都不会有测试红。
    const captured: RenameDraft["inputProps"][] = [];
    function Capture() {
      captured.push(useRenameDraft("旧标题", () => {}).inputProps);
      return null;
    }
    renderToStaticMarkup(<Capture />);
    const select = vi.fn();
    captured[0].onFocus({ currentTarget: { select } } as never);
    expect(select).toHaveBeenCalledTimes(1);
  });
});

function RenamableHeader() {
  const rename = useRenameDraft("旧标题", () => {});
  return <ViewHeader title="旧标题" subtitle={null} rename={rename} />;
}

describe("ViewHeader 标题改名", () => {
  it("可改名时标题给出双击提示", () => {
    const html = renderToStaticMarkup(<RenamableHeader />);
    expect(html).toContain('title="双击重命名"');
  });

  it("标题本身不是窗口拖拽区,双击才不会被壳吃成最大化", () => {
    const html = renderToStaticMarkup(<RenamableHeader />);
    const titleSpan = html.match(/<span class="ellipsis"[^>]*>/)?.[0];
    expect(titleSpan).toBeDefined();
    expect(titleSpan).not.toContain("data-tauri-drag-region");
    // 标题栏本身与右侧留白仍可拖拽窗口
    expect(html.match(/data-tauri-drag-region/g)?.length).toBe(2);
  });

  it("不可改名时(云端任务)保留原有的完整标题提示,不冒充可编辑", () => {
    const html = renderToStaticMarkup(<ViewHeader title="云端任务" titleTip="云端任务全名" subtitle={null} />);
    expect(html).toContain('title="云端任务全名"');
    expect(html).not.toContain("双击重命名");
    expect(html).not.toContain("cursor:text");
  });
});
