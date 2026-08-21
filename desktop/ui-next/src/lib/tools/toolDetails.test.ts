// 详情模型单测(旧工程 toolDetails.test.ts 迁移):文本抽取本身归 codec.test.ts,
// 这里只断 toolDetailFor 的四型选择与结构化 command(不断 UI 文案)。
import { describe, expect, it } from "vitest";

import { isUnifiedDiff } from "@/lib/util/diff";
import type { ToolItem } from "@/lib/protocol/types";
import { toolDetailFor } from "./toolDetails";

const tool = (overrides: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  tcId: "t1",
  title: "tool",
  status: "ok",
  out: "",
  ...overrides,
});

describe("统一工具详情", () => {
  it("读取云端 output 对象为文本详情", () => {
    expect(toolDetailFor(tool({ toolKind: "read", rawOutput: { output: "第一行\n第二行" } }))).toEqual({
      kind: "text",
      text: "第一行\n第二行",
    });
  });

  it("读取 Claude metadata 中的文件正文", () => {
    expect(toolDetailFor(tool({
      toolKind: "read",
      _meta: { claudeCode: { toolResponse: { file: { filePath: "/workspace/a.ts", content: "const a = 1" } } } },
    }))).toEqual({ kind: "text", text: "const a = 1" });
  });

  it("把云端命令数组与 stdout/stderr 合成结构化命令详情", () => {
    expect(toolDetailFor(tool({
      toolKind: "execute",
      rawInput: { cwd: "/workspace", command: ["cd /workspace", "npm test"] },
      rawOutput: { stdout: "passed", stderr: "warning" },
    }))).toEqual({
      kind: "command",
      command: "npm test",
      cwd: "/workspace",
      output: "passed\nwarning",
    });
  });

  it("命令无输出时返回空 output,由视图层配占位文案", () => {
    expect(toolDetailFor(tool({ toolKind: "execute", rawInput: { command: "true" } }))).toEqual({
      kind: "command",
      command: "true",
      cwd: "",
      output: "",
    });
  });

  it("本地 snake_case 与云端 camelCase 编辑都生成统一 diff", () => {
    const local = toolDetailFor(tool({
      title: "Edit src/a.ts",
      rawInput: { file_path: "src/a.ts", old_string: "const a = 1", new_string: "const a = 2" },
    }));
    const cloud = toolDetailFor(tool({
      toolKind: "edit",
      rawInput: { filePath: "src/a.ts", oldString: "const a = 1", newString: "const a = 2" },
    }));
    expect(local).toEqual(cloud);
    expect(cloud?.kind).toBe("diff");
    if (cloud?.kind !== "diff") return;
    expect(cloud.text).toContain("@@ -1,1 +1,1 @@");
    expect(cloud.text).toContain("-const a = 1");
    expect(cloud.text).toContain("+const a = 2");
    // 合成 diff 与 util/diff 的行模型解析器同一契约(渲染层直接复用)
    expect(isUnifiedDiff(cloud.text)).toBe(true);
  });

  it("本地 Edit edits 批量替换生成 diff，而不是退化成结果文本", () => {
    const detail = toolDetailFor(tool({
      title: "Edit src/a.ts",
      rawInput: {
        file_path: "src/a.ts",
        edits: [
          { old_string: "const a = 1", new_string: "const a = 2" },
          { old_string: "const b = 1", new_string: "const b = 2", replace_all: true },
        ],
      },
      rawOutput: "Replaced 3 occurrence(s) in src/a.ts",
    }));
    expect(detail?.kind).toBe("diff");
    if (detail?.kind !== "diff") return;
    expect(detail.text).toContain("-const a = 1");
    expect(detail.text).toContain("+const a = 2");
    expect(detail.text).toContain("-const b = 1");
    expect(detail.text).toContain("+const b = 2");
  });

  it("优先展示云端 apply patch 返回的真实 diff", () => {
    const diff = "@@ -1,1 +1,1 @@\n-old\n+new";
    expect(toolDetailFor(tool({ rawOutput: { metadata: { diff } }, toolKind: "edit" }))).toEqual({ kind: "diff", text: diff });
  });

  it("apply_patch 原始格式使用分段补丁详情", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch";
    expect(toolDetailFor(tool({ title: "apply_patch", rawInput: { patch } }))).toEqual({ kind: "patch", text: patch });
  });
});
