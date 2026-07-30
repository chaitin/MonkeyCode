import { describe, expect, it } from "vitest";
import { toolContentText, toolDetailFor, toolOutputText } from "./toolDetails";
import type { LogItem } from "./types";

type ToolItem = Extract<LogItem, { kind: "tool" }>;

const tool = (overrides: Partial<ToolItem> = {}): ToolItem => ({
  kind: "tool",
  tcId: "t1",
  title: "tool",
  status: "ok",
  out: "",
  ...overrides,
});

describe("统一工具详情", () => {
  it("读取云端 output 对象和 ACP content block", () => {
    expect(toolOutputText({ output: "文件正文" })).toBe("文件正文");
    expect(toolContentText([{ type: "content", content: { type: "text", text: "块正文" } }])).toBe("块正文");
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

  it("把云端命令数组与 stdout/stderr 合成命令详情", () => {
    expect(toolDetailFor(tool({
      toolKind: "execute",
      rawInput: { cwd: "/workspace", command: ["cd /workspace", "npm test"] },
      rawOutput: { stdout: "passed", stderr: "warning" },
    }))).toEqual({
      kind: "command",
      text: "/workspace\n$ npm test\npassed\nwarning",
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
    expect(cloud?.text).toContain("@@ -1,1 +1,1 @@");
    expect(cloud?.text).toContain("-const a = 1");
    expect(cloud?.text).toContain("+const a = 2");
  });

  it("优先展示云端 apply patch 返回的真实 diff", () => {
    const diff = "@@ -1,1 +1,1 @@\n-old\n+new";
    expect(toolDetailFor(tool({ rawOutput: { metadata: { diff } }, toolKind: "edit" }))).toEqual({ kind: "diff", text: diff });
  });
});
