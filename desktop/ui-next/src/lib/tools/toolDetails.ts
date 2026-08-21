// 工具卡详情模型:ToolItem → diff/patch/command/text/json 五型二择(纯函数,旧工程
// toolDetails.ts 移植)。结果文本抽取复用 protocol/codec 的 toolResultText,
// 不再自带副本;lib 层不产 UI 文案——command 型返回结构化 command/cwd/output
// (output 可为空串),"命令输出为空"之类的提示由视图层按 locale 配文。
// diff 型产出的 unified diff 与 lib/util/diff.ts 的 parseUnifiedDiff 同一契约,
// 渲染层可直接复用 FilesDrawer 的 diff 行模型。
import { toolResultText } from "@/lib/protocol/codec";
import type { ToolItem } from "@/lib/protocol/types";
import { isApplyPatchText } from "./applyPatch";

type UnknownRecord = Record<string, unknown>;

/** 详情五型:diff = unified diff 文本;patch = apply_patch 原始补丁;command = 结构化命令回显;
 * text = 可读正文;json = 原始载荷兜底(pretty JSON)。 */
export type ToolDetail =
  | { kind: "diff"; text: string }
  | { kind: "patch"; text: string }
  | { kind: "command"; command: string; cwd: string; output: string }
  | { kind: "text"; text: string }
  | { kind: "json"; text: string };

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringAt(value: unknown, keys: string[]): string | undefined {
  const source = record(value);
  if (!source) return undefined;
  for (const key of keys) {
    const found = source[key];
    if (typeof found === "string") return found;
  }
  return undefined;
}

function nested(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    const source = record(current);
    if (!source) return undefined;
    current = source[key];
  }
  return current;
}

function jsonText(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

export function toolCommand(rawInput: unknown): string {
  const input = record(rawInput);
  if (!input) return "";
  if (typeof input.command === "string") return input.command.trim();
  if (Array.isArray(input.command)) {
    for (let i = input.command.length - 1; i >= 0; i--) {
      const value = input.command[i];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (Array.isArray(input.parsed_cmd)) {
    for (const parsed of input.parsed_cmd) {
      const cmd = stringAt(parsed, ["cmd"]);
      if (cmd?.trim()) return cmd.trim();
    }
  }
  return "";
}

function patchFromOutput(rawOutput: unknown): string {
  const metadata = record(nested(rawOutput, ["metadata"]));
  if (!metadata) return "";
  if (typeof metadata.diff === "string" && metadata.diff.trim()) return metadata.diff;
  if (!Array.isArray(metadata.files)) return "";
  return metadata.files
    .map((file) => stringAt(file, ["patch"]) ?? "")
    .filter((patch) => patch.trim())
    .join("\n");
}

/** 无真实 patch 时,由 old/new 全量替换合成 unified diff(单 hunk)。 */
function unifiedReplacement(path: string, oldText: string, newText: string): string {
  const safePath = path.replace(/[\r\n\t]+/g, " ").trim() || "untitled";
  const oldLines = oldText === "" ? [] : oldText.split("\n");
  const newLines = newText === "" ? [] : newText.split("\n");
  const oldStart = oldLines.length ? 1 : 0;
  const newStart = newLines.length ? 1 : 0;
  return [
    `--- a/${safePath}`,
    `+++ b/${safePath}`,
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ].join("\n");
}

function editDiff(item: ToolItem): string {
  const outputPatch = patchFromOutput(item.rawOutput);
  if (outputPatch) return outputPatch;

  const input = record(item.rawInput);
  const inputPatch = stringAt(input, ["patchText", "patch"]);
  if (inputPatch?.trim()) return inputPatch;

  const response = nested(item._meta, ["claudeCode", "toolResponse"]);
  const path = stringAt(input, ["file_path", "filePath", "path"])
    ?? stringAt(response, ["filePath", "path"])
    ?? "untitled";
  const edits = Array.isArray(input?.edits) ? input.edits : [];
  const editPatches = edits.flatMap((value) => {
    const edit = record(value);
    const oldText = stringAt(edit, ["old_string", "oldString"]);
    const newText = stringAt(edit, ["new_string", "newString"]);
    if (oldText === undefined || newText === undefined || oldText === newText) return [];
    return [unifiedReplacement(path, oldText, newText)];
  });
  if (editPatches.length) return editPatches.join("\n");

  const oldText = stringAt(input, ["old_string", "oldString"])
    ?? stringAt(response, ["oldString"]);
  const newText = stringAt(input, ["new_string", "newString", "content"])
    ?? stringAt(response, ["newString", "content"]);
  if (oldText === undefined && newText === undefined) return "";
  if ((oldText ?? "") === (newText ?? "")) return "";
  return unifiedReplacement(path, oldText ?? "", newText ?? "");
}

function rawTool(title: string): string {
  return title.trim().split(/\s/, 1)[0]?.replace(/:+$/, "").toLowerCase() ?? "";
}

/** 本地与云端工具共用的详情模型。 */
export function toolDetailFor(item: ToolItem): ToolDetail | null {
  const tool = rawTool(item.title);
  const hasPatch = !!patchFromOutput(item.rawOutput)
    || !!stringAt(item.rawInput, ["patchText", "patch"])?.trim();
  const isEdit = item.toolKind === "edit" || hasPatch || ["edit", "write", "notebookedit", "apply_patch"].includes(tool);
  const isCommand = item.toolKind === "execute" || ["bash", "cmd", "powershell"].includes(tool);

  const providerFile = nested(item._meta, ["claudeCode", "toolResponse", "file"]);
  const providerReadText = stringAt(providerFile, ["content"]);
  const result = toolResultText(item.rawOutput, item.content) || providerReadText || item.result || "";

  if (isEdit && item.status !== "fail") {
    const diff = editDiff(item);
    if (isApplyPatchText(diff)) return { kind: "patch", text: diff };
    if (diff.trim()) return { kind: "diff", text: diff };
  }

  if (isCommand) {
    const command = toolCommand(item.rawInput);
    if (command || result) {
      return {
        kind: "command",
        command,
        cwd: stringAt(item.rawInput, ["cwd"]) ?? "",
        output: result,
      };
    }
  }
  if (result.trim()) return { kind: "text", text: result };

  const rawOutput = jsonText(item.rawOutput);
  if (rawOutput && rawOutput !== "{}") return { kind: "json", text: rawOutput };
  const rawInput = jsonText(item.rawInput);
  if (rawInput && rawInput !== "{}") return { kind: "json", text: rawInput };
  return null;
}
