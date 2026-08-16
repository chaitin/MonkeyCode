// 文件树:目录懒加载(点开才拉子层),子项缓存 + 展开集合 + 目录粒度加载态
// (骨架屏),缩进表达层级(每层 16px,动态 px 走内联样式)。已删除文件只
// 属于「改动」页;这里只展示当前真实存在的文件,改动状态以徽标标注。
import { IconChevronRight, IconFiles, IconFolder, IconFolderOpen } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import type { RepoEntry } from "@/lib/ipc/repo";
import { fileIconOf } from "./fileIcon";
import { fmtSize, statusMeta } from "./status";

/** 某目录子树内的改动条目数(含各级子目录)。改动表的键是工作区相对路径,
 *  前缀比对即可;必须带上分隔符,否则 `src` 会把 `src2/a.ts` 也算进去。 */
export function countChangesUnder(changeStatus: ReadonlyMap<string, string> | undefined, dir: string): number {
  if (!changeStatus || changeStatus.size === 0) return 0;
  const prefix = dir.endsWith("/") ? dir : `${dir}/`;
  let n = 0;
  for (const path of changeStatus.keys()) if (path.startsWith(prefix)) n += 1;
  return n;
}

export function Tree({
  listDir,
  onOpenFile,
  activePath,
  changeStatus,
}: {
  listDir: (dir: string) => Promise<RepoEntry[]>;
  onOpenFile: (entry: RepoEntry) => void;
  activePath: string | null;
  /** 路径 → 改动状态(文件行徽标;缺省不标注) */
  changeStatus?: ReadonlyMap<string, string>;
}) {
  const { t } = useI18n();
  // 目录 → 子项缓存("" = 工作区根)、展开集合、按目录粒度的加载中标记
  const [tree, setTree] = useState<Map<string, RepoEntry[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");

  // 调用方每次渲染的新闭包经 ref 转接,不搅动 mount effect;
  // 已缓存/在途守卫也用 ref——快速连点时 state 闭包读到的是旧集合
  const listDirRef = useRef(listDir);
  listDirRef.current = listDir;
  const loadedRef = useRef(new Set<string>());
  const pendingRef = useRef(new Set<string>());

  const load = async (dir: string) => {
    if (loadedRef.current.has(dir) || pendingRef.current.has(dir)) return;
    pendingRef.current.add(dir);
    setLoading((s) => new Set(s).add(dir));
    try {
      const items = await listDirRef.current(dir);
      loadedRef.current.add(dir);
      setTree((m) => new Map(m).set(dir, items));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      pendingRef.current.delete(dir);
      setLoading((s) => {
        const n = new Set(s);
        n.delete(dir);
        return n;
      });
    }
  };

  // 挂载即拉根目录(抽屉关闭整体卸载,重开自然是全新状态)
  useEffect(() => {
    void load("");
     
  }, []);

  // 展开/收起目录(展开时懒加载子项,已缓存的即时展开)
  const toggleDir = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        void load(dir);
      }
      return next;
    });
  };

  // 展开的目录原地铺开子项,层级用缩进表达(行 = menu 的 li>button)
  const renderDir = (dir: string, depth: number): ReactNode[] => {
    const rows: ReactNode[] = [];
    const items = tree.get(dir);
    if (!items) {
      if (loading.has(dir)) {
        for (let i = 0; i < (dir === "" ? 4 : 2); i++) {
          rows.push(
            <li key={`skeleton:${dir}:${i}`} className="menu-disabled">
              <div
                aria-hidden
                className="flex items-center gap-2 py-1.5 pr-4"
                style={{ paddingLeft: 24 + depth * 16 }}
              >
                <div className="skeleton size-3.5 rounded" />
                <div className="skeleton h-3 w-32" />
              </div>
            </li>,
          );
        }
      }
      return rows;
    }
    for (const en of items) {
      const open = en.isDir && expanded.has(en.path);
      const meta = !en.isDir && changeStatus ? statusMeta(changeStatus.get(en.path) ?? "") : undefined;
      // 目录行:聚合子树里的改动数(旧 UI dirChangeBadges)。折叠着的目录
      // 不给这个数就完全看不出里面有没有改动,只能逐层点开找
      const dirChanges = en.isDir ? countChangesUnder(changeStatus, en.path) : 0;
      rows.push(
        <li key={en.path}>
          <button
            type="button"
            title={en.path}
            onClick={() => (en.isDir ? toggleDir(en.path) : onOpenFile(en))}
            className={`flex min-w-0 items-center gap-2 ${activePath === en.path ? "menu-active" : ""}`}
            style={{ paddingLeft: 8 + depth * 16 }}
          >
            <span className="flex w-3 shrink-0 justify-center">
              {en.isDir && (
                <IconChevronRight
                  size={12}
                  stroke={1.75}
                  aria-hidden
                  className={`text-base-content/40 transition-transform ${open ? "rotate-90" : ""}`}
                />
              )}
            </span>
            {/* 目录:开合两态两形(FolderOpen/Folder);文件:按类型分型
                上色(fileIcon,语义色跟主题走)——清一色灰 File 分不出
                谁是谁(用户报障 2026-08-06「太丑」) */}
            {en.isDir ? (
              open ? (
                <IconFolderOpen size={14} stroke={1.75} aria-hidden className="shrink-0 text-primary/70" />
              ) : (
                <IconFolder size={14} stroke={1.75} aria-hidden className="shrink-0 text-primary/60" />
              )
            ) : (
              (() => {
                const spec = fileIconOf(en.name);
                return <spec.icon size={14} stroke={1.75} aria-hidden className={`shrink-0 ${spec.tone}`} />;
              })()
            )}
            <span className="min-w-0 flex-1 truncate">{en.name}</span>
            {meta ? (
              <span className={`badge badge-soft badge-xs shrink-0 ${meta.badgeClass}`}>{t(meta.labelKey)}</span>
            ) : en.isDir ? (
              dirChanges > 0 && (
                <span
                  title={t("files.dirChanges", { n: String(dirChanges) })}
                  className="badge badge-soft badge-primary badge-xs shrink-0 tabular-nums"
                >
                  {dirChanges}
                </span>
              )
            ) : (
              <span className="shrink-0 font-mono text-2xs text-base-content/35 tabular-nums">
                {fmtSize(en.size)}
              </span>
            )}
          </button>
        </li>,
      );
      if (open) rows.push(...renderDir(en.path, depth + 1));
    }
    if (items.length === 0 && dir !== "") {
      rows.push(
        <li key={`empty:${dir}`} className="menu-disabled">
          <p className="py-1 text-base-content/40" style={{ paddingLeft: 28 + depth * 16 }}>
            {t("files.tree.empty")}
          </p>
        </li>,
      );
    }
    return rows;
  };

  const rootItems = tree.get("");
  return (
    <div className="flex flex-col">
      {err && (
        <p role="alert" className="px-4 py-2 text-xs text-error">
          {err}
        </p>
      )}
      {rootItems && rootItems.length === 0 ? (
        // 空态统一形态:图标 + 标题档,居中(整块面板态,不进 menu 行)
        <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
          <IconFiles size={20} stroke={1.75} className="text-base-content/30" aria-hidden />
          <div className="text-sm font-semibold">{t("files.tree.emptyRoot")}</div>
        </div>
      ) : (
        <ul className="menu w-full flex-nowrap p-0 [&_li]:flex-nowrap">{renderDir("", 0)}</ul>
      )}
    </div>
  );
}
