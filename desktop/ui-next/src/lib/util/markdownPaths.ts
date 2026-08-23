/** Markdown 资源地址的纯函数归一化。DOM 解析与壳 IPC 留在组件层,
 * 这里专门覆盖 Marked 对空格和 Windows 反斜杠的百分号编码。 */

export type MarkdownResource =
  | { kind: "empty" }
  | { kind: "local"; path: string }
  | { kind: "url"; src: string };

const INLINE_FILE_MAX_CHARS = 512;
const INLINE_FILE_NAME_RE = /(?:^\.[^./\\]+$|\.[a-z0-9][a-z0-9+_-]{0,15}$)/i;
const INLINE_SPECIAL_FILE_RE = /^(?:dockerfile|makefile|readme|license|changelog|gemfile|rakefile)$/i;

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveMarkdownResource(src: string): MarkdownResource {
  const value = src.trim();
  if (!value) return { kind: "empty" };
  // Tauri 的页面协议不是稳定的 https,http(s) CDN 简写必须显式补成 https。
  if (value.startsWith("//")) return { kind: "url", src: `https:${value}` };
  if (/^(?:https?:|data:|blob:|asset:)/i.test(value) || value.startsWith("#")) {
    return { kind: "url", src: value };
  }
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      let path = decodePath(url.pathname);
      if (url.host && url.host !== "localhost") path = `//${url.host}${path}`;
      // Windows file:///C:/path 在 URL 中多一个前导斜杠。
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      return path ? { kind: "local", path } : { kind: "empty" };
    } catch {
      return { kind: "empty" };
    }
  }
  // 本地资源同样按 URL 语义取 pathname：只移除未编码的 query/fragment。
  // 必须先切再 decode，否则合法文件名中的 `%3F`/`%23` 会被误切掉。
  const rawPath = value.split(/[?#]/, 1)[0] ?? "";
  const decoded = decodePath(rawPath);
  // Marked 会把 C:\path 编成 C:%5Cpath,须先 decode 再判断盘符。
  if (/^[a-z]:[\\/]/i.test(decoded)) return { kind: "local", path: decoded };
  // 其他显式协议交给净化器处理,不误当成本地文件。
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return { kind: "url", src: value };
  return decoded ? { kind: "local", path: decoded } : { kind: "empty" };
}

/** 保守识别 Markdown 行内代码中的文件引用。这里只做纯文本判断，不查文件
 * 系统；工作区判界与存在性检查留到用户点击后的壳调用。 */
export function inferInlineCodeFilePath(value: string): string | null {
  const text = value.trim();
  if (!text || text.length > INLINE_FILE_MAX_CHARS || /[\r\n\t]/.test(text)) return null;
  if (/^(?:https?|data|blob|asset|mailto|javascript):/i.test(text)) return null;
  if (/[|;&<>`]/.test(text) || /^\$\s/.test(text)) return null;

  // 行列号只参与展示，不属于实际路径。兼容 IDE 常见的 :line:column 与 #LxCy。
  const location = text.match(/^(.*?)(?::\d+(?::\d+)?|#L\d+(?:C\d+)?)$/i);
  const candidate = (location?.[1] ?? text).trim();
  if (!candidate || /^\.\.[\\/]/.test(candidate) || /^~[\\/]/.test(candidate)) return null;
  const firstWhitespace = candidate.search(/\s/);
  const firstSeparator = candidate.search(/[\\/]/);
  if (firstWhitespace >= 0 && (firstSeparator < 0 || firstWhitespace < firstSeparator)) return null;

  const resource = resolveMarkdownResource(candidate);
  if (resource.kind !== "local") return null;
  const path = resource.path;
  const slashed = path.replace(/\\/g, "/");
  if (!slashed.includes("/")) return null;

  const withoutTrailingSlash = slashed.replace(/\/+$/, "");
  const fileName = withoutTrailingSlash.slice(withoutTrailingSlash.lastIndexOf("/") + 1);
  const explicitDirectory = /[\\/]$/.test(path);
  if (!explicitDirectory && !INLINE_FILE_NAME_RE.test(fileName) && !INLINE_SPECIAL_FILE_RE.test(fileName)) return null;
  return path;
}

function pathPrefix(path: string): { prefix: string; rest: string; absolute: boolean; windows: boolean } {
  const slashed = path.replace(/\\/g, "/");
  const drive = slashed.match(/^([a-z]:)\//i);
  if (drive) {
    return { prefix: drive[1]!, rest: slashed.slice(drive[0].length), absolute: true, windows: true };
  }
  if (slashed.startsWith("//")) return { prefix: "//", rest: slashed.slice(2), absolute: true, windows: true };
  if (slashed.startsWith("/")) return { prefix: "/", rest: slashed.slice(1), absolute: true, windows: false };
  return { prefix: "", rest: slashed, absolute: false, windows: false };
}

/** 纯词法归一化；路径试图越过其根时返回 null。 */
function normalizePath(path: string): { path: string; absolute: boolean; windows: boolean } | null {
  const { prefix, rest, absolute, windows } = pathPrefix(path);
  const segments: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  const tail = segments.join("/");
  const normalized = prefix === "/" || prefix === "//" ? prefix + tail : prefix ? `${prefix}/${tail}` : tail;
  return { path: normalized, absolute, windows };
}

/** 按 Markdown 文件所在目录解析本地资源。相对 Markdown 路径以工作区根为
 * 坐标，任何越过根的 `..` 都被词法拒绝；绝对资源保留为绝对路径，交给消费
 * 方结合实际 workdir 或 `/workspace` 再收口。 */
export function resolveMarkdownPath(markdownPath: string, resourcePath: string): string | null {
  const resource = pathPrefix(resourcePath);
  if (resource.absolute) return normalizePath(resourcePath)?.path ?? null;

  const markdown = pathPrefix(markdownPath);
  const slashedMarkdown = markdown.rest.replace(/\/+$/, "");
  const slash = slashedMarkdown.lastIndexOf("/");
  const dir = slash < 0 ? "" : slashedMarkdown.slice(0, slash);
  const base = markdown.prefix === "/" || markdown.prefix === "//" ? markdown.prefix + dir : markdown.prefix ? `${markdown.prefix}/${dir}` : dir;
  return normalizePath([base, resourcePath].filter(Boolean).join("/"))?.path ?? null;
}

/** 把已识别的本地链接收敛为工作区相对路径,供 repo_reveal 使用。
 * 工作区外绝对路径返回 null;最终的组件级/符号链接校验仍由壳负责。 */
export function workspaceRelativePath(path: string, workdir: string): string | null {
  const target = normalizePath(path);
  if (!target || !target.path) return null;
  // 相对路径已经按工作区根做过词法收口，不要求调用方一定知道 workdir。
  if (!target.absolute) return target.path;

  const rootPath = normalizePath(workdir);
  if (!rootPath?.absolute || !rootPath.path) return null;
  const root = rootPath.path !== "/" && !/^[a-z]:\/$/i.test(rootPath.path) ? rootPath.path.replace(/\/$/, "") : rootPath.path;
  const insensitive = target.windows || rootPath.windows;
  const lhs = insensitive ? target.path.toLowerCase() : target.path;
  const rhs = insensitive ? root.toLowerCase() : root;
  if (lhs === rhs) return "";
  const boundary = rhs === "/" || /^[a-z]:\/$/i.test(rhs) ? rhs : rhs + "/";
  return lhs.startsWith(boundary) ? target.path.slice(boundary.length) : null;
}
