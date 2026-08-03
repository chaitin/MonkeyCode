import { describe, expect, it } from "vitest";

import { isUnifiedDiff, parseUnifiedDiff } from "./diff";

const MODIFY = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -3,4 +3,5 @@ function f() {",
  " ctx-1",
  "-old-line",
  "+new-line-1",
  "+new-line-2",
  " ctx-2",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("文件头不进模型;增删/上下文行号按新旧两侧推进", () => {
    const rows = parseUnifiedDiff(MODIFY);
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "ctx", "del", "add", "add", "ctx"]);
    // hunk 头原样保留(渲染灰条)
    expect(rows[0]?.text).toBe("@@ -3,4 +3,5 @@ function f() {");
    // ctx 双侧行号;del 只有旧侧;add 只有新侧
    expect(rows[1]).toEqual({ kind: "ctx", text: "ctx-1", oldNo: 3, newNo: 3 });
    expect(rows[2]).toEqual({ kind: "del", text: "old-line", oldNo: 4 });
    expect(rows[3]).toEqual({ kind: "add", text: "new-line-1", newNo: 4 });
    expect(rows[4]).toEqual({ kind: "add", text: "new-line-2", newNo: 5 });
    expect(rows[5]).toEqual({ kind: "ctx", text: "ctx-2", oldNo: 5, newNo: 6 });
  });

  it("多 hunk 重置行号;末尾换行不产出幽灵行", () => {
    const text = ["@@ -1 +1 @@", "-a", "+b", "@@ -10,2 +20,2 @@", " c", "+d", ""].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows).toHaveLength(6);
    expect(rows[4]).toEqual({ kind: "ctx", text: "c", oldNo: 10, newNo: 20 });
    expect(rows[5]).toEqual({ kind: "add", text: "d", newNo: 21 });
  });

  it("多文件 diff:文件之间的头部区(diff 行重置 hunk 态)整段跳过", () => {
    const text = [
      "diff --git a/a b/a",
      "--- a/a",
      "+++ b/a",
      "@@ -1 +1 @@",
      "+one",
      "diff --git a/b b/b",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/b",
      "@@ -0,0 +1 @@",
      "+two",
    ].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows.map((r) => r.kind)).toEqual(["hunk", "add", "hunk", "add"]);
    expect(rows[3]).toEqual({ kind: "add", text: "two", newNo: 1 });
  });

  it("未跟踪文件的全新增 diff(--no-index 构造)从 1 起编号", () => {
    const text = ["diff --git a/dev/null b/new.txt", "--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+first", "+second"].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows.map((r) => [r.kind, r.newNo])).toEqual([
      ["hunk", undefined],
      ["add", 1],
      ["add", 2],
    ]);
  });

  it("反斜杠 meta 行(No newline)不吃行号", () => {
    const text = ["@@ -1 +1 @@", "-a", "+b", "\\ No newline at end of file"].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows[3]).toEqual({ kind: "meta", text: "\\ No newline at end of file" });
  });

  it("hunk 内以 +/- 开头的内容行不被当成文件头", () => {
    const text = ["@@ -1,2 +1,2 @@", "-------", "+++++++"].join("\n");
    const rows = parseUnifiedDiff(text);
    expect(rows[1]).toEqual({ kind: "del", text: "------", oldNo: 1 });
    expect(rows[2]).toEqual({ kind: "add", text: "++++++", newNo: 1 });
  });
});

describe("isUnifiedDiff", () => {
  it("有 hunk 头才算 diff;错误占位/普通文本不算", () => {
    expect(isUnifiedDiff(MODIFY)).toBe(true);
    expect(isUnifiedDiff("")).toBe(false);
    expect(isUnifiedDiff("✗ 读取失败")).toBe(false);
    expect(isUnifiedDiff("+ 这行只是以加号开头的普通文本")).toBe(false);
  });
});
