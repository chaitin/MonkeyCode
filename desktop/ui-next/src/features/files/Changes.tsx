// 改动列表:状态徽标 + 文件名 + 目录 + 可选 +N/-N,点击 → diff 预览。
// 本地 repo_file_changes 只给 {path, status},additions/deletions 是云端
// 超集字段——有则展示,无则整列缺席(不发明数据)。changes null = 加载中。
import { IconFileDiff } from "@tabler/icons-react";

import { useI18n } from "@/lib/i18n";
import type { RepoChange } from "@/lib/ipc/repo";
import { fileIconOf } from "./fileIcon";
import { basename, statusMeta } from "./status";

export interface ChangeItem extends RepoChange {
  additions?: number;
  deletions?: number;
}

export function Changes({
  changes,
  activePath,
  onOpen,
}: {
  changes: ChangeItem[] | null;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const { t } = useI18n();
  if (changes === null) {
    return (
      <div role="status" className="flex items-center gap-2 px-4 py-3 text-xs text-base-content/50">
        <span className="loading loading-spinner loading-xs" aria-hidden />
        {t("files.loading")}
      </div>
    );
  }
  if (changes.length === 0) {
    // 空态统一形态:图标 + 标题档,居中
    return (
      <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
        <IconFileDiff size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
        <div className="text-sm font-semibold">{t("files.changes.empty")}</div>
      </div>
    );
  }
  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  return (
    <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">
      {sorted.map((c) => {
        const meta = statusMeta(c.status);
        const sep = c.path.lastIndexOf("/");
        const dir = sep > 0 ? c.path.slice(0, sep) : "";
        const deleted = c.status === "D" || c.status === "RM";
        return (
          <li key={c.path}>
            <button
              type="button"
              title={c.path}
              onClick={() => onOpen(c.path)}
              className={`flex min-w-0 items-center gap-2 ${activePath === c.path ? "menu-active" : ""}`}
            >
              {/* 行首类型图标(与文件树同一份 fileIcon):此前改动列表
                  一个图标都没有,一屏文字糊成一片(用户报障 2026-08-06) */}
              {(() => {
                const spec = fileIconOf(c.path);
                return <spec.icon size={14} stroke={1.75} aria-hidden className={`shrink-0 ${spec.tone}`} />;
              })()}
              <span className={`shrink-0 ${deleted ? "line-through opacity-60" : ""}`}>{basename(c.path)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-base-content/40">{dir}</span>
              {(c.additions ?? 0) > 0 && (
                <span className="shrink-0 font-mono text-2xs text-success tabular-nums">+{c.additions}</span>
              )}
              {(c.deletions ?? 0) > 0 && (
                <span className="shrink-0 font-mono text-2xs text-error tabular-nums">-{c.deletions}</span>
              )}
              {meta ? (
                <span className={`badge badge-soft badge-xs shrink-0 ${meta.badgeClass}`}>{t(meta.labelKey)}</span>
              ) : (
                <span className="badge badge-ghost badge-xs shrink-0">{c.status}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
