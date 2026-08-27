import { IconChevronDown, IconFileZip, IconFolder, IconRefresh, IconX } from "@tabler/icons-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import {
  type SkillImportAction,
  type SkillImportBatchPreview,
  type SkillImportDecision,
  type SkillImportItem,
  isSkillCommandError,
  type SkillImportSourceKind,
  type SkillsCatalogSnapshot,
} from "@/lib/ipc/skills";
import { useDismiss } from "@/lib/util/useDismiss";
import { useEscLayer } from "@/lib/util/escLayer";
import { catalogConflictForItem, selectedActionForItem, SkillImportItemRow } from "./SkillImportItemRow";
import type { SkillImportController } from "./useSkillImportController";

type Filter = "all" | "importable" | "conflicts" | "risks" | "invalid";

function isInvalid(item: SkillImportItem): boolean {
  return item.validity.status === "invalid";
}

function isCaseConflict(item: SkillImportItem): boolean {
  const conflict = catalogConflictForItem(item);
  return conflict.kind === "user-name-case" || conflict.kind === "builtin-name-case";
}

function defaultActions(items: SkillImportItem[]): Record<string, SkillImportAction> {
  const selectedDuplicateGroups = new Set<string>();
  const actions: Record<string, SkillImportAction> = {};
  for (const item of [...items].sort((left, right) => left.order - right.order)) {
    if (isInvalid(item) || isCaseConflict(item) || item.state === "succeeded" || item.state === "skipped") {
      actions[item.item_id] = "skip";
      continue;
    }
    if (item.conflict.kind === "none") {
      actions[item.item_id] = "install";
    } else if (item.conflict.kind === "batch-duplicate") {
      const group = item.duplicate_group ?? item.portable_name_key ?? item.item_id;
      actions[item.item_id] = selectedDuplicateGroups.has(group) ? "skip" : selectedActionForItem(item);
      selectedDuplicateGroups.add(group);
    } else {
      actions[item.item_id] = "skip";
    }
  }
  return actions;
}

function conflictSignature(item: SkillImportItem): string {
  return JSON.stringify([item.validity, item.conflict, item.duplicate_group, item.state]);
}

function countsFromBatch(batch: SkillImportBatchPreview) {
  return {
    success: batch.items.filter((item) => item.state === "succeeded").length,
    failed: batch.items.filter((item) => item.state === "failed").length,
    skipped: batch.items.filter((item) => item.state === "skipped").length,
  };
}

function actionDecisions(batch: SkillImportBatchPreview, actions: Record<string, SkillImportAction>, itemIds?: Set<string>): SkillImportDecision[] {
  const expectedState = batch.phase === "completed" ? "failed" : "pending";
  return [...batch.items]
    .sort((left, right) => left.order - right.order)
    .filter((item) => item.state === expectedState && (!itemIds || itemIds.has(item.item_id)))
    .map((item) => ({ item_id: item.item_id, action: actions[item.item_id] ?? "skip" }));
}

function itemMatchesFilter(item: SkillImportItem, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "importable") return !isInvalid(item) && item.conflict.kind === "none";
  if (filter === "conflicts") return item.conflict.kind !== "none";
  if (filter === "risks") return item.risks.length > 0;
  return isInvalid(item);
}

function SourceMenu({ disabled, onPick }: { disabled: boolean; onPick: (kind: SkillImportSourceKind) => void }) {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(open, ref, () => setOpen(false));
  const pick = (kind: SkillImportSourceKind) => {
    setOpen(false);
    onPick(kind);
  };
  return (
    <div ref={ref} className={`dropdown dropdown-end ${open ? "dropdown-open" : ""}`}>
      <button type="button" className="btn btn-sm btn-outline" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} autoFocus disabled={disabled} onClick={() => setOpen((value) => !value)}>
        {t("settings.skills.importDialog.addSource")} <IconChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <ul id={menuId} role="menu" aria-label={t("settings.skills.importDialog.addSource")} className="dropdown-content menu z-[var(--z-popover)] mt-1 w-52 flex-nowrap [&_li]:flex-nowrap rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
          <li><button type="button" role="menuitem" onClick={() => pick("folders")}><IconFolder size={15} aria-hidden />{t("settings.skills.importFolders")}</button></li>
          <li><button type="button" role="menuitem" onClick={() => pick("zips")}><IconFileZip size={15} aria-hidden />{t("settings.skills.importZips")}</button></li>
        </ul>
      )}
    </div>
  );
}

export function BatchSkillImportDialog({
  controller,
  refreshSkillsCatalog,
  onImported,
  recoverySlot,
}: {
  controller: SkillImportController;
  refreshSkillsCatalog: (targetRevision?: number) => Promise<SkillsCatalogSnapshot>;
  onImported: (names: string[]) => void;
  /** Task 20 inserts RecoveryPanel here when catalog refresh reports RecoveryPending. */
  recoverySlot?: ReactNode;
}) {
  const { t } = useI18n();
  const dialogId = useId();
  const summaryId = `${dialogId}-summary`;
  const filterPanelId = `${dialogId}-filter-panel`;
  const dialogContentRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const batch = controller.batch;
  const batchId = batch?.batch_id ?? null;
  const [filter, setFilter] = useState<Filter>("all");
  const [actions, setActions] = useState<Record<string, SkillImportAction>>({});
  const signaturesRef = useRef<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [catalogReadyKey, setCatalogReadyKey] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogRefreshError, setCatalogRefreshError] = useState<unknown>(null);

  useEffect(() => {
    if (!batch) return;
    const defaults = defaultActions(batch.items);
    setActions((current) => {
      const next: Record<string, SkillImportAction> = {};
      const signatures: Record<string, string> = {};
      for (const item of batch.items) {
        const signature = conflictSignature(item);
        signatures[item.item_id] = signature;
        next[item.item_id] = signaturesRef.current[item.item_id] === signature
          ? (current[item.item_id] ?? defaults[item.item_id] ?? "skip")
          : (defaults[item.item_id] ?? "skip");
      }
      signaturesRef.current = signatures;
      return next;
    });
  }, [batch]);

  const selectedExecutableSignature = useMemo(() => {
    if (!batch) return "";
    const eligibleState = batch.phase === "completed" ? "failed" : "pending";
    return batch.items
      .filter((item) => item.state === eligibleState && actions[item.item_id] !== "skip")
      .filter((item) => item.risks.some((risk) => risk.kind === "executable-content" && risk.paths.length > 0))
      .map((item) => item.item_id)
      .sort()
      .join("|");
  }, [actions, batch]);

  const previousExecutableSignature = useRef("");
  useEffect(() => {
    if (previousExecutableSignature.current && previousExecutableSignature.current !== selectedExecutableSignature) setReviewed(false);
    previousExecutableSignature.current = selectedExecutableSignature;
  }, [selectedExecutableSignature]);

  const completedSuccessNames = useMemo(
    () => batch?.items.filter((item) => item.state === "succeeded" && item.name).map((item) => item.name!) ?? [],
    [batch],
  );
  const completedKey = batch?.phase === "completed" && completedSuccessNames.length > 0
    ? `${batch.batch_id}:${batch.catalog_revision ?? "none"}:${completedSuccessNames.sort().join("|")}`
    : null;

  const refreshCompletedCatalog = useCallback(async () => {
    if (!batch || !completedKey) return;
    setCatalogRefreshing(true);
    setCatalogRefreshError(null);
    try {
      await refreshSkillsCatalog(batch.catalog_revision ?? undefined);
      setCatalogReadyKey(completedKey);
      onImported(completedSuccessNames);
    } catch (reason) {
      setCatalogRefreshError(reason);
    } finally {
      setCatalogRefreshing(false);
    }
  }, [batch, completedKey, completedSuccessNames, onImported, refreshSkillsCatalog]);

  useEffect(() => {
    if (completedKey && catalogReadyKey !== completedKey && !catalogRefreshing && !catalogRefreshError) {
      // completed 快照是外部 Rust 状态；进入该状态即必须启动 catalog 同步门。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void refreshCompletedCatalog();
    }
  }, [catalogReadyKey, catalogRefreshError, catalogRefreshing, completedKey, refreshCompletedCatalog]);

  const needsCatalogRefresh = completedKey !== null && catalogReadyKey !== completedKey;
  const recoveryPending = isSkillCommandError(catalogRefreshError) && catalogRefreshError.code === "recovery-pending";
  const locked = !!batch && (controller.operations.locked || controller.operation === "committing" || controller.operation === "cancelling" || catalogRefreshing || needsCatalogRefresh);
  const active = !!batch && batch.phase !== "collecting" && batch.phase !== "completed";
  const canClose = !!batch && controller.operations.canCancel && !locked;
  const close = useCallback(() => {
    if (!canClose) return;
    void controller.cancel().catch(() => {});
  }, [canClose, controller]);
  const canCloseRef = useRef(canClose);
  const closeRef = useRef(close);
  useEffect(() => { canCloseRef.current = canClose; closeRef.current = close; }, [canClose, close]);
  useEscLayer(!!batch, useCallback(() => {
    if (canCloseRef.current) closeRef.current();
    return true;
  }, []));
  useLayoutEffect(() => {
    const content = dialogContentRef.current;
    if (!batchId || !content || content.contains(document.activeElement)) return;
    // phase 切换会同步卸载刚被点击的提交/重试按钮。浏览器随后把焦点落到
    // body；在绘制前把它接到当前状态容器。若用户焦点仍在 modal 内则不抢。
    (active ? progressRef.current : content)?.focus();
  }, [active, batch?.phase, batchId, locked]);

  if (!batch) return null;

  const completed = batch.phase === "completed";
  const counts = countsFromBatch(batch);
  const eligibleState = completed ? "failed" : "pending";
  const selectedCount = batch.items.filter((item) => item.state === eligibleState && actions[item.item_id] !== "skip").length;
  const visibleItems = completed ? batch.items : batch.items.filter((item) => itemMatchesFilter(item, filter));
  const hasExecutableSelected = selectedExecutableSignature.length > 0;
  const submitDisabled = !controller.operations.canCommit || selectedCount === 0 || (hasExecutableSelected && !reviewed) || controller.operation !== null;
  const retryDisabled = !controller.operations.canRetry || selectedCount === 0 || (hasExecutableSelected && !reviewed) || controller.operation !== null || needsCatalogRefresh;

  const updateAction = (item: SkillImportItem, action: SkillImportAction) => {
    if (locked) return;
    setActions((current) => {
      const next = { ...current, [item.item_id]: action };
      if (action !== "skip" && item.conflict.kind === "batch-duplicate") {
        const group = item.duplicate_group ?? item.portable_name_key ?? item.item_id;
        for (const candidate of batch.items) {
          const candidateGroup = candidate.duplicate_group ?? candidate.portable_name_key ?? candidate.item_id;
          if (candidate.item_id !== item.item_id && candidate.conflict.kind === "batch-duplicate" && candidateGroup === group) next[candidate.item_id] = "skip";
        }
      }
      return next;
    });
  };

  const selectAllImportable = () => setActions((current) => {
    const next = { ...current };
    for (const item of batch.items) if (item.state === "pending" && !isInvalid(item) && item.conflict.kind === "none") next[item.item_id] = "install";
    return next;
  });
  const clearSelection = () => setActions((current) => {
    const next = { ...current };
    for (const item of batch.items) if (item.state === eligibleState) next[item.item_id] = "skip";
    return next;
  });

  const commit = async (only?: Set<string>) => {
    setReviewed((value) => value);
    try {
      await controller.commit(actionDecisions(batch, actions, only), reviewed);
      setReviewed(false);
    } catch {
      // controller owns the structured error and re-attaches the authoritative snapshot.
    }
  };

  const filters: Array<{ key: Filter; count: number }> = [
    { key: "all", count: batch.totals.item_count },
    { key: "importable", count: batch.totals.importable_count },
    { key: "conflicts", count: batch.totals.conflict_count },
    { key: "risks", count: batch.totals.risk_count },
    { key: "invalid", count: batch.totals.invalid_count },
  ];
  const selectFilterByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % filters.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + filters.length) % filters.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = filters.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = filters[nextIndex]!.key;
    setFilter(next);
    document.getElementById(`${dialogId}-filter-${next}`)?.focus();
  };
  const keepFocusInDialog = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const content = dialogContentRef.current;
    if (!content) return;
    const focusable = [...content.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="skill-import-title" aria-describedby={summaryId} aria-busy={locked}>
      <div ref={dialogContentRef} tabIndex={-1} onKeyDown={keepFocusInDialog} className="modal-box flex max-h-[90vh] w-[min(960px,94vw)] max-w-[min(960px,94vw)] flex-col gap-0 overflow-hidden p-0 focus:outline-none">
        <header className="flex shrink-0 items-start gap-3 border-b border-base-300 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="skill-import-title" className="text-sm font-semibold">{completed ? t("settings.skills.importDialog.completedTitle") : t("settings.skills.importDialog.title")}</h2>
            {!completed && <p id={summaryId} aria-live="polite" className="mt-1 text-2xs text-base-content/50">{t("settings.skills.importDialog.summary", { sources: batch.totals.source_count, items: batch.totals.item_count, importable: batch.totals.importable_count, conflicts: batch.totals.conflict_count, risks: batch.totals.risk_count, invalid: batch.totals.invalid_count })}</p>}
            {completed && <p id={summaryId} aria-live="polite" className="mt-1 text-xs text-base-content/60">{t("settings.skills.importDialog.resultSummary", { success: counts.success, failed: counts.failed, skipped: counts.skipped })}</p>}
          </div>
          {!completed && <SourceMenu disabled={!controller.operations.canPick || controller.operation !== null} onPick={(kind) => void controller.pick(kind).catch(() => {})} />}
          <button type="button" className="btn btn-ghost btn-square btn-xs" aria-label={t("settings.skills.importDialog.close")} disabled={!canClose} onClick={close}><IconX size={15} aria-hidden /></button>
        </header>

        {!completed && (
          <>
            {batch.in_flight_source_picks > 0 && <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-base-300 bg-info/5 px-5 py-2 text-xs"><span className="loading loading-spinner loading-xs" aria-hidden />{t("settings.skills.importDialog.indexing")}</div>}
            {batch.sources.some((source) => source.status === "failed" || source.status === "empty") && (
              <div role="alert" aria-label={t("settings.skills.importDialog.sourceIssues")} className="border-b border-base-300 px-5 py-2 text-2xs text-base-content/60">
                {batch.sources.filter((source) => source.status === "failed" || source.status === "empty").map((source) => <p key={source.source_id}>{source.display_name}: {source.error ?? t(source.status === "empty" ? "settings.skills.importDialog.sourceEmpty" : "settings.skills.importDialog.sourceFailed")}</p>)}
              </div>
            )}
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-base-300 px-5 py-2">
              <div role="tablist" className="flex flex-wrap items-center gap-1" aria-label={t("settings.skills.importDialog.filters")}>
                {filters.map(({ key, count }, index) => <button key={key} id={`${dialogId}-filter-${key}`} type="button" role="tab" className={`btn btn-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${filter === key ? "btn-primary" : "btn-ghost"}`} aria-selected={filter === key} aria-controls={filterPanelId} tabIndex={filter === key ? 0 : -1} onKeyDown={(event) => selectFilterByKeyboard(event, index)} onClick={() => setFilter(key)}>{t(`settings.skills.importDialog.filter.${key}` as const)} {count}</button>)}
              </div>
              <span className="min-w-2 flex-1" />
              <button type="button" className="btn btn-ghost btn-xs" disabled={locked} onClick={selectAllImportable}>{t("settings.skills.importDialog.selectAll")}</button>
              <button type="button" className="btn btn-ghost btn-xs" disabled={locked} onClick={clearSelection}>{t("settings.skills.importDialog.selectNone")}</button>
            </div>
          </>
        )}

        {active && <div ref={progressRef} tabIndex={-1} role="status" aria-live="assertive" aria-label={t("settings.skills.importDialog.progress")} className="flex min-h-52 flex-1 items-center justify-center gap-3 focus:outline-none"><span className="loading loading-spinner loading-md" aria-hidden /><span className="text-sm">{t(batch.phase === "validating" || batch.phase === "retry-validating" ? "settings.skills.importDialog.validating" : batch.phase === "retrying" ? "settings.skills.importDialog.retrying" : "settings.skills.importDialog.submitting")}</span></div>}

        {!active && (
          <div
            id={completed ? undefined : filterPanelId}
            role={completed ? undefined : "tabpanel"}
            aria-labelledby={completed ? undefined : `${dialogId}-filter-${filter}`}
            className="flex min-h-0 flex-1"
          >
          <ul role="list" className="min-h-0 flex-1 divide-y divide-base-300 overflow-x-hidden overflow-y-auto" aria-label={completed ? t("settings.skills.importDialog.results") : t("settings.skills.importDialog.items")}>
            {visibleItems.map((item) => completed ? (
              <li key={item.item_id} className="flex items-center gap-3 px-5 py-2 text-xs">
                <span aria-hidden className={`w-4 text-center font-bold ${item.state === "succeeded" ? "text-success" : item.state === "failed" ? "text-error" : "text-base-content/40"}`}>{item.state === "succeeded" ? "✓" : item.state === "failed" ? "×" : "—"}</span>
                <span className="sr-only">{t(`settings.skills.importDialog.status.${item.state}` as "settings.skills.importDialog.status.pending" | "settings.skills.importDialog.status.failed" | "settings.skills.importDialog.status.succeeded" | "settings.skills.importDialog.status.skipped")}</span>
                <span className="min-w-0 flex-1"><span className="font-mono font-medium">{item.name ?? item.item_id}</span>{(item.last_error || item.state === "skipped") && <span className="ms-3 text-base-content/50">{item.last_error ?? t("settings.skills.importDialog.skipped")}</span>}</span>
                {item.state === "failed" && item.conflict.kind !== "batch-duplicate" && catalogConflictForItem(item).kind === "user-skill" && (
                  <select className="select select-xs w-28" aria-label={t("settings.skills.importDialog.conflictAction", { name: item.name ?? item.item_id })} value={actions[item.item_id] === "replace" ? "replace" : "skip"} disabled={locked} onChange={(event) => updateAction(item, event.currentTarget.value as SkillImportAction)}>
                    <option value="skip">{t("settings.skills.importDialog.action.skip")}</option><option value="replace">{t("settings.skills.importDialog.action.replace")}</option>
                  </select>
                )}
                {item.state === "failed" && item.conflict.kind !== "batch-duplicate" && catalogConflictForItem(item).kind === "builtin-skill" && (
                  <select className="select select-xs w-32" aria-label={t("settings.skills.importDialog.conflictAction", { name: item.name ?? item.item_id })} value={actions[item.item_id] === "install" ? "install" : "skip"} disabled={locked} onChange={(event) => updateAction(item, event.currentTarget.value as SkillImportAction)}>
                    <option value="skip">{t("settings.skills.importDialog.action.skip")}</option><option value="install">{t("settings.skills.importDialog.action.overrideBuiltin")}</option>
                  </select>
                )}
                {item.state === "failed" && item.conflict.kind === "batch-duplicate" && !isCaseConflict(item) && (
                  <select className="select select-xs w-28" aria-label={t("settings.skills.importDialog.conflictAction", { name: item.name ?? item.item_id })} value={actions[item.item_id] === selectedActionForItem(item) ? selectedActionForItem(item) : "skip"} disabled={locked} onChange={(event) => updateAction(item, event.currentTarget.value as SkillImportAction)}>
                    <option value="skip">{t("settings.skills.importDialog.action.skip")}</option><option value={selectedActionForItem(item)}>{t("settings.skills.importDialog.action.selectCandidate")}</option>
                  </select>
                )}
                {item.state === "failed" && isCaseConflict(item) && <span className="badge badge-error badge-soft badge-sm">{t("settings.skills.importDialog.action.caseDisabled")}</span>}
                {item.state === "failed" && <button type="button" className="btn btn-ghost btn-xs" aria-label={t("settings.skills.importDialog.retryItem", { name: item.name ?? item.item_id })} disabled={retryDisabled || actions[item.item_id] === "skip"} onClick={() => void commit(new Set([item.item_id]))}>{t("settings.skills.importDialog.retry")}</button>}
              </li>
            ) : (
              <SkillImportItemRow key={item.item_id} batchId={batch.batch_id} item={item} action={actions[item.item_id] ?? "skip"} disabled={locked} onActionChange={(action) => updateAction(item, action)} />
            ))}
            {visibleItems.length === 0 && <li className="px-5 py-10 text-center text-xs text-base-content/50">{t("settings.skills.importDialog.noItems")}</li>}
          </ul>
          </div>
        )}

        {!active && (
          <footer className="shrink-0 space-y-2 border-t border-base-300 px-5 py-3">
            {hasExecutableSelected && (
              <label className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" className="checkbox checkbox-warning checkbox-xs" checked={reviewed} disabled={locked} onChange={(event) => setReviewed(event.currentTarget.checked)} />{t("settings.skills.importDialog.reviewExecutable")}</label>
            )}
            {controller.error != null && <div role="alert" className="alert alert-error alert-soft py-2 text-xs">{t("settings.skills.importDialog.operationFailed", { reason: controller.error instanceof Error ? controller.error.message : JSON.stringify(controller.error) })}</div>}
            {catalogRefreshError != null && (
              <div className="space-y-2">
                {recoveryPending && recoverySlot}
                <div role="alert" className={`alert py-2 text-xs ${recoveryPending ? "alert-warning alert-soft" : "alert-error alert-soft"}`}>
                  <span>{recoveryPending ? t("settings.skills.importDialog.recoveryPending") : t("settings.skills.importDialog.refreshFailed")}</span>
                  <button type="button" className="btn btn-ghost btn-xs" disabled={catalogRefreshing || controller.operation !== null} onClick={() => { setCatalogRefreshError(null); void refreshCompletedCatalog(); }}>
                    <IconRefresh size={13} aria-hidden />
                    {t("settings.skills.importDialog.retryRefresh")}
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <span role="status" aria-live="polite" className="me-auto text-xs text-base-content/50">{completed ? (needsCatalogRefresh ? t("settings.skills.importDialog.refreshingCatalog") : "") : t("settings.skills.importDialog.selected", { count: selectedCount })}</span>
              {!completed && <button type="button" className="btn btn-ghost btn-sm" disabled={!canClose} onClick={close}>{t("settings.skills.cancel")}</button>}
              {completed ? (
                <>
                  {counts.failed > 0 && <button type="button" className="btn btn-outline btn-sm" disabled={retryDisabled} onClick={() => void commit()}>{t("settings.skills.importDialog.retryFailed", { count: counts.failed })}</button>}
                  <button type="button" className="btn btn-primary btn-sm" disabled={!canClose} onClick={close}>{t("settings.skills.importDialog.close")}</button>
                </>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" disabled={submitDisabled} onClick={() => void commit()}>{t("settings.skills.importDialog.submit", { count: selectedCount })}</button>
              )}
            </div>
          </footer>
        )}
      </div>
      <div className={`modal-backdrop ${canClose ? "cursor-pointer" : "cursor-not-allowed"}`} onClick={close} aria-hidden />
    </div>,
    document.body,
  );
}
