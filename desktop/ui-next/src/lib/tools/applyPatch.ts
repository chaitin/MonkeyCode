export interface ApplyPatchSection {
  action: "Update" | "Add" | "Delete";
  path: string;
  movePath?: string;
  lines: string[];
}

const FILE_HEADER = /^\*\*\* (Update|Add|Delete) File: (.+)$/;
const MOVE_HEADER = /^\*\*\* Move to: (.+)$/;

export function isApplyPatchText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("*** Begin Patch") && trimmed.endsWith("*** End Patch");
}

export function parseApplyPatch(value: string): ApplyPatchSection[] {
  const sections: ApplyPatchSection[] = [];
  let current: ApplyPatchSection | null = null;

  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    const header = FILE_HEADER.exec(line);
    if (header) {
      if (current) sections.push(current);
      current = {
        action: header[1] as ApplyPatchSection["action"],
        path: header[2] ?? "",
        lines: [],
      };
      continue;
    }
    const move = MOVE_HEADER.exec(line);
    if (current && move) current.movePath = move[1] ?? "";
    if (!current || line === "*** End Patch") continue;
    current.lines.push(line);
  }

  if (current) sections.push(current);
  return sections;
}

export function applyPatchPaths(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return [];
  const input = rawInput as Record<string, unknown>;
  const value = typeof input.patch === "string"
    ? input.patch
    : typeof input.patchText === "string" ? input.patchText : "";
  return [...new Set(
    parseApplyPatch(value)
      .flatMap((section) => [section.path, section.movePath])
      .filter((path): path is string => !!path),
  )];
}
