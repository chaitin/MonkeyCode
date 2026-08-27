import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconShieldExclamation } from "@tabler/icons-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useI18n } from "@/lib/i18n";
import {
  skillsImportReadText,
  type SkillImportAction,
  type SkillImportCatalogConflict,
  type SkillImportFile,
  type SkillImportItem,
  type SkillImportRiskKind,
} from "@/lib/ipc/skills";

const TEXT_PAGE_BYTES = 64 * 1024;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function fileCount(files: SkillImportFile[]): number {
  return files.reduce((count, file) => count + (file.kind === "file" ? 1 : 0) + fileCount(file.children), 0);
}

function executablePaths(files: SkillImportFile[]): string[] {
  return files.flatMap((file) => [
    ...(file.kind === "file" && file.executable ? [file.relative_path] : []),
    ...executablePaths(file.children),
  ]);
}

function riskLabel(kind: SkillImportRiskKind, t: ReturnType<typeof useI18n>["t"]): string {
  return t(`settings.skills.importDialog.risk.${kind}` as
    | "settings.skills.importDialog.risk.executable-content"
    | "settings.skills.importDialog.risk.tools"
    | "settings.skills.importDialog.risk.scripts"
    | "settings.skills.importDialog.risk.hooks"
    | "settings.skills.importDialog.risk.mcp"
    | "settings.skills.importDialog.risk.network");
}

function FileTree({
  files,
  selectedPath,
  onSelect,
  nested = false,
}: {
  files: SkillImportFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  nested?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ul
      role={nested ? "group" : "tree"}
      aria-label={nested ? undefined : t("settings.skills.importDialog.fileTree")}
      className="ml-1 border-s border-base-300 ps-2 text-2xs"
    >
      {files.map((file) => (
        <li key={`${file.kind}:${file.relative_path}`} role="none">
          {file.kind === "directory" ? (
            <>
              <span role="treeitem" aria-expanded="true" className="flex items-center gap-1 py-0.5 text-base-content/60">
                <IconFolder size={12} stroke={1.75} aria-hidden />
                {file.name}
              </span>
              {file.children.length > 0 && <FileTree files={file.children} selectedPath={selectedPath} onSelect={onSelect} nested />}
            </>
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-selected={selectedPath === file.relative_path}
              className={`flex max-w-full items-center gap-1 py-0.5 text-start hover:text-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${selectedPath === file.relative_path ? "font-semibold text-primary" : "text-base-content/70"}`}
              onClick={() => onSelect(file.relative_path)}
            >
              <IconFile size={12} stroke={1.75} aria-hidden />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-base-content/40">{formatBytes(file.size)}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function catalogConflictForItem(item: SkillImportItem): SkillImportCatalogConflict {
  return item.conflict.kind === "batch-duplicate" ? item.conflict.catalog_conflict : item.conflict;
}

export function selectedActionForItem(item: SkillImportItem): Exclude<SkillImportAction, "skip"> {
  return catalogConflictForItem(item).kind === "user-skill" ? "replace" : "install";
}

function conflictLabel(item: SkillImportItem, t: ReturnType<typeof useI18n>["t"]): string {
  if (item.validity.status === "invalid") return t("settings.skills.importDialog.status.invalid");
  if (item.state === "failed") return t("settings.skills.importDialog.status.failed");
  if (item.state === "succeeded") return t("settings.skills.importDialog.status.succeeded");
  if (item.state === "skipped") return t("settings.skills.importDialog.status.skipped");
  switch (item.conflict.kind) {
    case "none":
      return t("settings.skills.importDialog.status.ready");
    case "batch-duplicate":
      return t("settings.skills.importDialog.conflict.duplicate");
    case "user-skill":
      return t("settings.skills.importDialog.conflict.user", { name: item.conflict.existing_name });
    case "builtin-skill":
      return t("settings.skills.importDialog.conflict.builtin", { name: item.conflict.existing_name });
    case "user-name-case":
    case "builtin-name-case":
      return t("settings.skills.importDialog.conflict.case", { name: item.conflict.existing_name });
  }
}

export function SkillImportItemRow({
  batchId,
  item,
  action,
  disabled,
  onActionChange,
}: {
  batchId: string;
  item: SkillImportItem;
  action: SkillImportAction;
  disabled: boolean;
  onActionChange: (action: SkillImportAction) => void;
}) {
  const { t } = useI18n();
  const rowId = useId();
  const toggleId = `${rowId}-toggle`;
  const detailsId = `${rowId}-details`;
  const stateId = `${rowId}-state`;
  const [expanded, setExpanded] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [nextOffset, setNextOffset] = useState(0);
  const [previewEof, setPreviewEof] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef({
    batchId,
    itemId: item.item_id,
    path: null as string | null,
    generation: 0,
  });
  const mountedRef = useRef(false);

  // A row is normally keyed by item_id, but keep the preview safe if a caller
  // reuses the component instance for another batch/item.
  useLayoutEffect(() => {
    const current = previewRequestRef.current;
    if (current.batchId === batchId && current.itemId === item.item_id) return;
    previewRequestRef.current = {
      batchId,
      itemId: item.item_id,
      path: null,
      generation: current.generation + 1,
    };
    setPreviewPath(null);
    setPreviewText("");
    setNextOffset(0);
    setPreviewEof(false);
    setPreviewBusy(false);
    setPreviewError(null);
  }, [batchId, item.item_id]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      previewRequestRef.current.generation += 1;
    };
  }, []);

  const invalid = item.validity.status === "invalid";
  const catalogConflict = catalogConflictForItem(item);
  const caseConflict = catalogConflict.kind === "user-name-case" || catalogConflict.kind === "builtin-name-case";
  const selectable = !invalid && !caseConflict && item.state !== "succeeded" && item.state !== "skipped";
  const executables = useMemo(() => executablePaths(item.files), [item.files]);

  const readPage = async (path: string, offset: number) => {
    const previous = previewRequestRef.current;
    const request = {
      batchId,
      itemId: item.item_id,
      path,
      generation: previous.generation + 1,
    };
    previewRequestRef.current = request;
    const isLatestRequest = () => {
      const current = previewRequestRef.current;
      return mountedRef.current &&
        current.generation === request.generation &&
        current.batchId === request.batchId &&
        current.itemId === request.itemId &&
        current.path === request.path;
    };

    setPreviewBusy(true);
    setPreviewError(null);
    try {
      const chunk = await skillsImportReadText({
        batchId: request.batchId,
        itemId: request.itemId,
        relativePath: request.path,
        offset,
        limit: TEXT_PAGE_BYTES,
      });
      if (!isLatestRequest()) return;
      setPreviewText((current) => (offset === 0 ? chunk.text : current + chunk.text));
      setNextOffset(chunk.next_offset);
      setPreviewEof(chunk.eof);
    } catch (reason) {
      if (!isLatestRequest()) return;
      setPreviewError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (isLatestRequest()) setPreviewBusy(false);
    }
  };

  const selectFile = (path: string) => {
    // Clear the previous file synchronously; a late append is guarded by the
    // generation and captured item/path in readPage.
    setPreviewPath(path);
    setPreviewText("");
    setNextOffset(0);
    setPreviewEof(false);
    setPreviewError(null);
    void readPage(path, 0);
  };

  const selectConflictByKeyboard = (
    event: ReactKeyboardEvent<HTMLSelectElement>,
    choices: SkillImportAction[],
  ) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = Math.max(0, choices.indexOf(action));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : event.key === "ArrowDown" || event.key === "ArrowRight"
          ? Math.min(choices.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
    onActionChange(choices[nextIndex]!);
  };

  const badgeTone = invalid || caseConflict || item.state === "failed"
    ? "badge-error"
    : item.risks.length > 0
      ? "badge-warning"
      : item.state === "succeeded"
        ? "badge-success"
        : "badge-ghost";

  return (
    <li className="flex flex-col" data-skill-import-item={item.item_id}>
      <div className="flex items-center gap-2 px-3 py-2">
        {item.conflict.kind === "batch-duplicate" ? (
          <input
            type="radio"
            className="radio radio-xs"
            name={`skill-import-duplicate-${item.duplicate_group ?? item.portable_name_key ?? item.item_id}`}
            aria-label={t("settings.skills.importDialog.selectCandidate", { name: item.name ?? item.item_id })}
            aria-describedby={stateId}
            checked={action !== "skip"}
            disabled={disabled || !selectable}
            onChange={() => onActionChange(selectedActionForItem(item))}
          />
        ) : (
          <input
            type="checkbox"
            className="checkbox checkbox-xs"
            aria-label={t("settings.skills.importDialog.selectItem", { name: item.name ?? item.item_id })}
            aria-describedby={stateId}
            checked={action !== "skip"}
            disabled={disabled || !selectable}
            onChange={(event) => onActionChange(event.currentTarget.checked ? selectedActionForItem(item) : "skip")}
          />
        )}
        <button
          id={toggleId}
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-start focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={t(expanded ? "settings.skills.importDialog.collapseItem" : "settings.skills.importDialog.expandItem", { name: item.name ?? item.item_id })}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-mono text-xs font-semibold">{item.name ?? t("settings.skills.importDialog.unnamed")}</span>
              <span id={stateId} className={`badge badge-sm badge-soft ${badgeTone}`}>{conflictLabel(item, t)}</span>
            </span>
            <span className="mt-0.5 block truncate text-2xs text-base-content/50">
              {item.source_display_name}{item.relative_root ? ` / ${item.relative_root}` : ""} · {fileCount(item.files)} {t("settings.skills.importDialog.files")} · {formatBytes(item.total_size)}
            </span>
          </span>
        </button>
        {item.conflict.kind !== "batch-duplicate" && catalogConflict.kind === "user-skill" && (
          <select
            className="select select-xs w-28"
            aria-label={t("settings.skills.importDialog.conflictAction", { name: item.name ?? item.item_id })}
            value={action === "replace" ? "replace" : "skip"}
            disabled={disabled || !selectable}
            onKeyDown={(event) => selectConflictByKeyboard(event, ["skip", "replace"])}
            onChange={(event) => onActionChange(event.currentTarget.value as SkillImportAction)}
          >
            <option value="skip">{t("settings.skills.importDialog.action.skip")}</option>
            <option value="replace">{t("settings.skills.importDialog.action.replace")}</option>
          </select>
        )}
        {item.conflict.kind !== "batch-duplicate" && catalogConflict.kind === "builtin-skill" && (
          <select
            className="select select-xs w-32"
            aria-label={t("settings.skills.importDialog.conflictAction", { name: item.name ?? item.item_id })}
            value={action === "install" ? "install" : "skip"}
            disabled={disabled || !selectable}
            onKeyDown={(event) => selectConflictByKeyboard(event, ["skip", "install"])}
            onChange={(event) => onActionChange(event.currentTarget.value as SkillImportAction)}
          >
            <option value="skip">{t("settings.skills.importDialog.action.skip")}</option>
            <option value="install">{t("settings.skills.importDialog.action.overrideBuiltin")}</option>
          </select>
        )}
      </div>

      {expanded && (
        <div
          id={detailsId}
          role="region"
          aria-labelledby={toggleId}
          className="grid gap-3 border-t border-base-300 bg-base-200/20 px-4 py-3 text-xs md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
        >
          <div className="min-w-0 space-y-3">
            <div>
              <p className="font-medium">{item.description || t("settings.skills.importDialog.noDescription")}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-2xs text-base-content/60">
                <dt>{t("settings.skills.importDialog.source")}</dt><dd className="break-all">{item.source_display_name}</dd>
                <dt>{t("settings.skills.importDialog.root")}</dt><dd className="break-all font-mono">{item.relative_root || "."}</dd>
                <dt>{t("settings.skills.importDialog.itemId")}</dt><dd className="break-all font-mono">{item.item_id}</dd>
              </dl>
              {item.name && item.relative_root && item.relative_root.split("/").at(-1) !== item.name && (
                <div className="alert alert-info alert-soft mt-2 py-2 text-2xs">
                  {t("settings.skills.importDialog.renameHint", { name: item.name })}
                </div>
              )}
              {catalogConflict.kind === "user-skill" && action === "replace" && (
                <div className="alert alert-warning alert-soft mt-2 py-2 text-2xs">
                  {t("settings.skills.importDialog.replaceHint", { name: catalogConflict.existing_name })}
                </div>
              )}
              {catalogConflict.kind === "builtin-skill" && action === "install" && (
                <div className="alert alert-warning alert-soft mt-2 py-2 text-2xs">
                  {t("settings.skills.importDialog.builtinHint")}
                </div>
              )}
            </div>

            {item.validity.status === "invalid" && (
              <div className="alert alert-error alert-soft py-2 text-2xs">
                <div><strong>{t("settings.skills.importDialog.invalidReasons")}</strong><ul className="list-disc ps-4">{item.validity.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
              </div>
            )}
            {caseConflict && <div className="alert alert-error alert-soft py-2 text-2xs">{t("settings.skills.importDialog.conflict.case", { name: catalogConflict.kind === "user-name-case" || catalogConflict.kind === "builtin-name-case" ? catalogConflict.existing_name : "" })}</div>}
            {item.last_error && <div className="alert alert-error alert-soft py-2 text-2xs">{item.last_error}</div>}

            {(executables.length > 0 || item.risks.length > 0) && (
              <div className="rounded-box border border-warning/40 bg-warning/5 p-2">
                <h4 className="flex items-center gap-1 font-semibold text-warning-content"><IconShieldExclamation size={14} aria-hidden />{t("settings.skills.importDialog.risks")}</h4>
                {executables.length > 0 && <p className="mt-1 text-2xs"><strong>{t("settings.skills.importDialog.executables")}</strong>: {executables.join(", ")}</p>}
                <ul className="mt-1 space-y-1 text-2xs">
                  {item.risks.map((risk, index) => (
                    <li key={`${risk.kind}:${index}`}><span className="badge badge-warning badge-soft badge-xs me-1">{riskLabel(risk.kind, t)}</span>{risk.paths.join(", ") || "—"}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid min-h-44 min-w-0 grid-cols-[minmax(8rem,0.8fr)_minmax(0,1.2fr)] overflow-hidden rounded-box border border-base-300 bg-base-100">
            <div className="overflow-auto border-e border-base-300 p-2">
              <FileTree files={item.files} selectedPath={previewPath} onSelect={selectFile} />
            </div>
            <section
              role="region"
              aria-label={t("settings.skills.importDialog.filePreview", { path: previewPath ?? t("settings.skills.importDialog.chooseFile") })}
              aria-live="polite"
              aria-busy={previewBusy}
              className="flex min-w-0 flex-col"
            >
              <div className="border-b border-base-300 px-2 py-1 font-mono text-2xs text-base-content/50">{previewPath ?? t("settings.skills.importDialog.chooseFile")}</div>
              <pre role={previewError ? "alert" : undefined} className="min-h-0 flex-1 overflow-auto p-2 font-mono text-2xs whitespace-pre-wrap">{previewError ? t("settings.skills.importDialog.previewFailed", { reason: previewError }) : previewText}</pre>
              {previewPath && !previewEof && !previewError && (
                <button type="button" className="btn btn-ghost btn-xs m-1 self-start" disabled={previewBusy} onClick={() => void readPage(previewPath, nextOffset)}>
                  {previewBusy ? t("settings.skills.importDialog.loading") : t("settings.skills.importDialog.loadMore")}
                </button>
              )}
            </section>
          </div>
        </div>
      )}
    </li>
  );
}
