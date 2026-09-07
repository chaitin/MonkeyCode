import type { RepoPreviewFile } from "@/lib/ipc/repo";

export type DesignPreviewTarget =
  | { kind: "localhost"; url: string }
  | { kind: "artifact"; path: string; artifactKind: RepoPreviewFile["kind"] };

const KIND_RANK: Record<RepoPreviewFile["kind"], number> = { html: 0, image: 1, text: 2 };

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
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

/** 排序用 sort(链上 filter 已产出新数组,不会改到入参)。此前用 toSorted,
 * Safari 16+ 才有,macOS 12 自带的 WKWebView 一进预览工作台就整屏「启动异常」
 * (2026-09-04 报障);现在构建期按用量注入 polyfill(vite.config.ts),但能不依赖
 * 就不依赖。 */
export function rankPreviewFiles(files: RepoPreviewFile[], query = ""): RepoPreviewFile[] {
  const needle = query.trim().toLocaleLowerCase();
  return files
    .filter((file) => !needle || file.path.toLocaleLowerCase().includes(needle))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.path.localeCompare(b.path));
}

export function targetForFile(file: RepoPreviewFile): DesignPreviewTarget {
  return { kind: "artifact", path: file.path, artifactKind: file.kind };
}
