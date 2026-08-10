import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiffView } from "./DiffView";

describe("diff 视图", () => {
  it("无 hunk 的内容按纯文本兜底(错误/提示文案)", () => {
    render(<DiffView text="✗ 非 git 仓库,无法生成 diff" />);
    expect(screen.getByText("✗ 非 git 仓库,无法生成 diff")).toBeTruthy();
  });

  it("hunk 头灰条 + 新旧行号双栏 + 增删行", () => {
    const text = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -3,3 +30,3 @@",
      " ctx-line",
      "-del-line",
      "+add-line",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    render(<DiffView text={text} />);

    expect(screen.getByText("@@ -3,3 +30,3 @@")).toBeTruthy();
    // 文件头(diff/---/+++)不出现
    expect(screen.queryByText(/^diff --git/)).toBeNull();
    expect(screen.queryByText("--- a/a")).toBeNull();

    // ctx 行:旧 3 新 30;del 行:旧 4;add 行:新 31
    expect(screen.getByText("ctx-line")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("del-line")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("add-line")).toBeTruthy();
    expect(screen.getByText("31")).toBeTruthy();
    // 增删标记列
    expect(screen.getByText("+")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();
    // meta 行原样保留
    expect(screen.getByText("\\ No newline at end of file")).toBeTruthy();
  });
});
