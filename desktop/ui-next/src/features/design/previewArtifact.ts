import type { RepoChange, RepoPreviewFile } from "@/lib/ipc/repo";
import type { ToolItem } from "@/lib/protocol/types";

export type DesignPreviewTarget =
  | { kind: "localhost"; url: string }
  | { kind: "artifact"; path: string; artifactKind: RepoPreviewFile["kind"] };

const KIND_RANK: Record<RepoPreviewFile["kind"], number> = { html: 0, image: 1, text: 2 };
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const HTML_EXT = /\.html?$/i;
const DESIGN_FILE_EXT = /\.(?:html?|css|scss|less|jsx?|tsx?|vue|svelte|png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const DESIGN_WORDS = /(?:design|designer|preview|mockup|prototype|wireframe|landing|homepage|webpage|website|frontend|front-end|ui|ux|页面|网页|界面|设计|原型|预览|落地页)/i;
const PREFERRED_BASENAME = /(?:preview|design|mockup|prototype|page)/i;
const WRITE_ACTIONS = new Set(["edit", "write", "create", "save", "patch", "update", "modify"]);
const READ_ACTIONS = new Set(["read", "view", "inspect", "search", "find", "list", "glob", "grep"]);

type ToolAction = "write" | "read";

function classifiedAction(token: string): ToolAction | null {
  const normalized = token.toLocaleLowerCase();
  if (WRITE_ACTIONS.has(normalized)) return "write";
  if (READ_ACTIONS.has(normalized)) return "read";
  return null;
}

/** Tool kinds are structured identifiers (for example opencode_write or
 * functions.Edit). If they do not name an action, only the title's leading
 * token is considered; the rest may be a filename such as README.md. */
function toolAction(toolKind: string | undefined, title: string): ToolAction | null {
  for (const token of (toolKind ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const action = classifiedAction(token);
    if (action) return action;
  }
  const titleToken = title.match(/^[\s]*([\p{L}\p{N}]+)/u)?.[1];
  return titleToken ? classifiedAction(titleToken) : null;
}

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function isAbsolutePath(path: string): boolean {
  return /^(?:[a-z]:)?\//i.test(normalizePath(path));
}

/** 绝对路径落在 workdir 内时转成 workdir 相对路径(artifact_read 只收相对路径)。
 * Windows 盘符比较不区分大小写；工作区外返回 null，不能仅凭同名尾段误认。 */
function toWorkdirRelative(path: string, workdir: string): string | null {
  const normalized = normalizePath(path);
  if (!isAbsolutePath(normalized)) return normalized;
  const root = normalizePath(workdir).replace(/\/+$/, "");
  const insensitive = /^[a-z]:\//i.test(normalized) || /^[a-z]:\//i.test(root);
  const candidate = insensitive ? normalized.toLocaleLowerCase() : normalized;
  const base = insensitive ? root.toLocaleLowerCase() : root;
  if (candidate === base) return "";
  if (candidate.startsWith(`${base}/`)) return normalized.slice(root.length + 1);
  return null;
}

/** 地址栏输入的绝对路径落在 workdir 内时折算成 workdir 相对路径。Windows
 * 用户习惯粘贴 `c:\xxx\yyy.html` 全路径(2026-08-31 报障),盘符大小写与
 * 分隔符风格都不敏感;非绝对路径或工作区外返回 null,交回调用方按原样匹配。 */
export function typedWorkdirRelativePath(typed: string, workdir: string | undefined): string | null {
  if (!workdir) return null;
  const normalized = normalizePath(typed);
  if (!/^(?:[a-z]:)?\//i.test(normalized)) return null;
  const root = normalizePath(workdir).replace(/\/+$/, "");
  const haystack = normalized.toLocaleLowerCase();
  const needle = root.toLocaleLowerCase();
  if (!haystack.startsWith(`${needle}/`)) return null;
  return normalized.slice(root.length + 1);
}

/** Paths explicitly named by write-like tools in the current turn. */
export function writtenToolPaths(items: Pick<ToolItem, "title" | "toolKind" | "rawInput">[]): string[] {
  const paths = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:file_path|filePath|path)$/.test(key) && typeof child === "string" && child.trim()) paths.add(normalizePath(child));
      else visit(child);
    }
  };
  for (const item of items) {
    if (toolAction(item.toolKind, item.title) !== "write") continue;
    visit(item.rawInput);
  }
  return [...paths];
}

/** New dirty paths plus files explicitly written this turn (covers re-editing an already dirty file). */
export function touchedTurnChanges(
  baseline: RepoChange[],
  ending: RepoChange[],
  toolPaths: string[],
  workdir?: string,
): RepoChange[] {
  const baselinePaths = new Set(baseline.map((change) => normalizePath(change.path)));
  const selected = new Map<string, RepoChange>();
  for (const change of ending) {
    const normalized = normalizePath(change.path);
    if (!baselinePaths.has(normalized)) selected.set(normalized, change);
  }
  for (const rawToolPath of toolPaths) {
    const rel = workdir ? toWorkdirRelative(rawToolPath, workdir) : rawToolPath;
    if (rel === null) continue;
    const toolPath = normalizePath(rel);
    const match = ending.find((change) => {
      const repoPath = normalizePath(change.path);
      return repoPath === toolPath || toolPath.endsWith(`/${repoPath}`);
    });
    if (match) selected.set(normalizePath(match.path), match);
    else if (!isAbsolutePath(toolPath) && !toolPath.includes("../")) selected.set(toolPath, { path: toolPath, status: "M" });
  }
  return [...selected.values()];
}

export function rankPreviewFiles(files: RepoPreviewFile[], query = ""): RepoPreviewFile[] {
  const needle = query.trim().toLocaleLowerCase();
  return files
    .filter((file) => !needle || file.path.toLocaleLowerCase().includes(needle))
    .toSorted((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.path.localeCompare(b.path));
}

export function targetForFile(file: RepoPreviewFile): DesignPreviewTarget {
  return { kind: "artifact", path: file.path, artifactKind: file.kind };
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function mentionedByUser(path: string, userText: string): boolean {
  const name = basename(path).toLocaleLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  const text = userText.toLocaleLowerCase();
  return (name.length > 2 && text.includes(name)) || (stem.length > 2 && text.includes(stem));
}

/** Conservative guard against treating the whole-worktree repoChanges result as this turn's output. */
export function turnWarrantsArtifactPreview(userText: string, agentText: string, _changes: RepoChange[]): boolean {
  // repoChanges describes the entire dirty worktree, not files touched by this turn.
  // A stale visual artifact is therefore not evidence on its own.
  return DESIGN_WORDS.test(`${userText}\n${agentText}`);
}

function changedFile(path: string): RepoPreviewFile | null {
  if (HTML_EXT.test(path)) return { path, kind: "html", mime: "text/html", size: 0 };
  if (IMAGE_EXT.test(path)) return { path, kind: "image", mime: "application/octet-stream", size: 0 };
  return null;
}

/** Pick only visual artifacts; text files are intentionally never auto-opened. */
export function selectTurnPreviewArtifact(
  changes: RepoChange[],
  userText: string,
  agentText: string,
  repoFiles: RepoPreviewFile[] = [],
): RepoPreviewFile | null {
  const candidates = changes
    .filter((change) => change.status !== "D")
    .map((change) => ({ change, file: changedFile(change.path) }))
    .filter((entry): entry is { change: RepoChange; file: RepoPreviewFile } => entry.file !== null)
    .toSorted((a, b) => {
      const kind = KIND_RANK[a.file.kind] - KIND_RANK[b.file.kind];
      if (kind) return kind;
      const aIndex = basename(a.file.path).toLocaleLowerCase() === "index.html";
      const bIndex = basename(b.file.path).toLocaleLowerCase() === "index.html";
      const aPreferred = mentionedByUser(a.file.path, userText) || PREFERRED_BASENAME.test(basename(a.file.path));
      const bPreferred = mentionedByUser(b.file.path, userText) || PREFERRED_BASENAME.test(basename(b.file.path));
      return Number(bPreferred) - Number(aPreferred)
        || Number(a.change.status !== "A") - Number(b.change.status !== "A")
        || Number(aIndex) - Number(bIndex)
        || a.file.path.localeCompare(b.file.path);
    });
  if (candidates[0]) return candidates[0].file;
  if (!turnWarrantsArtifactPreview(userText, agentText, changes)) return null;

  // A design/frontend turn may update components and styles while leaving its existing HTML
  // entry untouched. Only then consult the bounded repository preview index.
  const hasDesignChange = changes.some((change) => change.status !== "D" && DESIGN_FILE_EXT.test(change.path));
  if (!hasDesignChange) return null;
  return repoFiles
    .filter((file) => file.kind === "html")
    .toSorted((a, b) => {
      const aIndex = basename(a.path).toLocaleLowerCase() === "index.html";
      const bIndex = basename(b.path).toLocaleLowerCase() === "index.html";
      const aPreferred = mentionedByUser(a.path, userText) || PREFERRED_BASENAME.test(basename(a.path));
      const bPreferred = mentionedByUser(b.path, userText) || PREFERRED_BASENAME.test(basename(b.path));
      return Number(bPreferred) - Number(aPreferred) || Number(aIndex) - Number(bIndex) || a.path.localeCompare(b.path);
    })[0] ?? null;
}

export function hasDesignRelatedChanges(changes: RepoChange[]): boolean {
  return changes.some((change) => change.status !== "D" && DESIGN_FILE_EXT.test(change.path));
}
