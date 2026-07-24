import type { LogItem } from "./types";

type ToolItem = Extract<LogItem, { kind: "tool" }>;
type UnknownRecord = Record<string, unknown>;

export interface ToolDetail {
  kind: "diff" | "command" | "text" | "json";
  text: string;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringAt(value: unknown, keys: string[]): string | undefined {
  const source = record(value);
  if (!source) return undefined;
  for (const key of keys) {
    if (typeof source[key] === "string") return source[key] as string;
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

/** 云端工具的 rawOutput 常为对象，本地工具通常直接给字符串。 */
export function toolOutputText(rawOutput: unknown): string {
  if (typeof rawOutput === "string") return rawOutput;
  const output = record(rawOutput);
  if (!output) return "";

  const direct = stringAt(output, ["output", "result"]);
  if (direct !== undefined) return direct;

  const stdout = typeof output.stdout === "string" ? output.stdout : "";
  const stderr = typeof output.stderr === "string" ? output.stderr : "";
  if (stdout || stderr) return [stdout, stderr].filter(Boolean).join("\n");

  const error = stringAt(output, ["error", "message"]);
  return error ?? "";
}

/** 提取 ACP content block（以及本地 {text} 分片）中的纯文本。 */
export function toolContentText(content: unknown, depth = 0): string {
  if (depth > 5 || content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => toolContentText(item, depth + 1)).filter(Boolean).join("\n");
  }
  const source = record(content);
  if (!source) return "";
  if (typeof source.text === "string") return source.text;
  if (source.content !== undefined) return toolContentText(source.content, depth + 1);
  return "";
}

/** 工具结果的可读正文；供归约摘要和详情面板共用。 */
export function toolResultText(rawOutput: unknown, content?: unknown): string {
  return toolOutputText(rawOutput) || toolContentText(content);
}

export function toolCommand(rawInput: unknown): string {
  const input = record(rawInput);
  if (!input) return "";
  if (typeof input.command === "string") return input.command.trim();
  if (Array.isArray(input.command)) {
    for (let i = input.command.length - 1; i >= 0; i--) {
      if (typeof input.command[i] === "string" && input.command[i].trim()) return input.command[i].trim();
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
    if (diff.trim()) return { kind: "diff", text: diff };
  }

  if (isCommand) {
    const command = toolCommand(item.rawInput);
    if (command || result) {
      const cwd = stringAt(item.rawInput, ["cwd"]);
      const prompt = command ? `${cwd ? `${cwd}\n` : ""}$ ${command}` : "";
      return {
        kind: "command",
        text: [prompt, result || "（命令输出为空）"].filter(Boolean).join("\n"),
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
