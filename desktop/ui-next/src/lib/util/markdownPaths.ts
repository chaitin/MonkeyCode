/** Markdown 资源地址的纯函数归一化。DOM 解析与壳 IPC 留在组件层,
 * 这里专门覆盖 Marked 对空格和 Windows 反斜杠的百分号编码。 */

export type MarkdownResource =
  | { kind: "empty" }
  | { kind: "local"; path: string }
  | { kind: "url"; src: string };

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
  const decoded = decodePath(value);
  // Marked 会把 C:\path 编成 C:%5Cpath,须先 decode 再判断盘符。
  if (/^[a-z]:[\\/]/i.test(decoded)) return { kind: "local", path: decoded };
  // 其他显式协议交给净化器处理,不误当成本地文件。
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return { kind: "url", src: value };
  return { kind: "local", path: decoded };
}

/** 把已识别的本地链接收敛为工作区相对路径,供 repo_reveal 使用。
 * 工作区外绝对路径返回 null;最终的组件级/符号链接校验仍由壳负责。 */
export function workspaceRelativePath(path: string, workdir: string): string | null {
  const normalize = (v: string) => v.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const target = normalize(path);
  let root = normalize(workdir);
  if (root.length > 1) root = root.replace(/\/$/, "");
  if (!target || !root) return null;
  const absolute = target.startsWith("/") || /^[a-z]:\//i.test(target);
  if (!absolute) return target.replace(/^\.\//, "");
  const windows = /^[a-z]:\//i.test(root);
  const lhs = windows ? target.toLowerCase() : target;
  root = windows ? root.toLowerCase() : root;
  if (lhs === root) return "";
  return lhs.startsWith(root + "/") ? target.slice(root.length + 1) : null;
}
