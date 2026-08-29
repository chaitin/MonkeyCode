import { IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import {
  isSkillCommandError,
  skillsRecoveryList,
  skillsRecoveryResolve,
  type SkillRecoveryAction,
  type SkillRecoveryIssue,
  type SkillsCatalogSnapshot,
} from "@/lib/ipc/skills";

interface RecoveryPanelProps {
  refreshSkillsCatalog: (targetRevision?: number) => Promise<SkillsCatalogSnapshot>;
  /** The batch dialog can immediately seed issues carried by RecoveryPending. */
  initialIssues?: SkillRecoveryIssue[];
  onCatalogReady?: () => void;
  className?: string;
}

function errorText(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (reason && typeof reason === "object") {
    try {
      return JSON.stringify(reason);
    } catch {
      // Fall through to String for unusual host objects.
    }
  }
  return String(reason);
}

const CANDIDATES = ["backup", "installed", "isolated"] as const;

/**
 * Shared transaction recovery UI. Recovery state lives here rather than in the
 * catalog Provider or import controller: both hosts mount this same component
 * and continue to use the Provider as the only catalog authority.
 */
export function RecoveryPanel({
  refreshSkillsCatalog,
  initialIssues = [],
  onCatalogReady,
  className = "",
}: RecoveryPanelProps) {
  const { t } = useI18n();
  const panelId = useId();
  const titleId = `${panelId}-title`;
  const [issues, setIssues] = useState(initialIssues);
  const [loading, setLoading] = useState(initialIssues.length === 0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<unknown>(null);
  const [preservedPaths, setPreservedPaths] = useState<Record<string, string>>({});
  // A resolve may advance the revision while another authoritative issue still
  // gates skills_list. Keep the highest mutation target and wait for it after
  // the last authoritative-missing issue is gone.
  const pendingCatalogRevisionRef = useRef(0);

  const refreshPendingCatalog = useCallback(async (current: SkillRecoveryIssue[]) => {
    if (current.some((entry) => entry.authoritative_target_missing)) return;
    const targetRevision = pendingCatalogRevisionRef.current;
    if (targetRevision <= 0) return;
    await refreshSkillsCatalog(targetRevision);
    // Only a successful catalog refresh consumes the target. A list or catalog
    // failure leaves it available for the manual refresh button to retry.
    if (pendingCatalogRevisionRef.current === targetRevision) {
      pendingCatalogRevisionRef.current = 0;
    }
    onCatalogReady?.();
  }, [onCatalogReady, refreshSkillsCatalog]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    // Manual refresh is also the retry path for a resolve whose follow-up list
    // or catalog refresh failed; do not leave that stale error visible.
    setResolveError(null);
    try {
      const response = await skillsRecoveryList();
      const current = Array.isArray(response) ? response : [];
      setIssues(current);
      await refreshPendingCatalog(current);
      return current;
    } catch (reason) {
      setLoadError(reason);
      throw reason;
    } finally {
      setLoading(false);
    }
  }, [refreshPendingCatalog]);

  useEffect(() => {
    // Initial IPC probe intentionally drives the panel's loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload().catch(() => {});
  }, [reload]);

  const resolve = async (issue: SkillRecoveryIssue, action: SkillRecoveryAction) => {
    setResolving(issue.transaction_id);
    setResolveError(null);
    try {
      const result = await skillsRecoveryResolve(issue.transaction_id, action);
      pendingCatalogRevisionRef.current = Math.max(
        pendingCatalogRevisionRef.current,
        result.catalog_revision,
      );
      if (result.preserved_path) {
        setPreservedPaths((current) => ({
          ...current,
          [issue.transaction_id]: result.preserved_path!,
        }));
      }

      const response = await skillsRecoveryList();
      const remaining = Array.isArray(response) ? response : [];
      setIssues(remaining);
      await refreshPendingCatalog(remaining);
    } catch (reason) {
      // A cross-process transaction may appear between list and refresh. Its
      // structured issues are immediately actionable without losing preserved
      // path output from the resolve that already succeeded.
      if (isSkillCommandError(reason) && reason.code === "recovery-pending") {
        setIssues(reason.issues);
      }
      setResolveError(reason);
    } finally {
      setResolving(null);
    }
  };

  // The settings banner is conditional: a routine no-issue probe must not
  // flash a recovery warning while its first IPC is in flight.
  if (issues.length === 0 && !loadError && !resolveError && Object.keys(preservedPaths).length === 0) {
    return null;
  }

  return (
    <aside
      role="region"
      aria-labelledby={titleId}
      aria-busy={loading || resolving !== null}
      className={`rounded-box border border-warning/30 bg-warning/5 p-3 text-xs ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="font-semibold text-warning-content">{t("settings.skills.recovery.title")}</h3>
          <p className="mt-0.5 text-base-content/60">{t("settings.skills.recovery.hint")}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-square btn-xs"
          aria-label={t("settings.skills.recovery.refresh")}
          disabled={loading || resolving !== null}
          onClick={() => void reload().catch(() => {})}
        >
          <IconRefresh size={14} aria-hidden />
        </button>
      </div>

      {loading && <p role="status" aria-live="polite" className="mt-2 text-base-content/60">{t("settings.skills.recovery.loading")}</p>}
      {loadError != null && <p role="alert" className="mt-2 text-error">{t("settings.skills.recovery.loadFailed", { reason: errorText(loadError) })}</p>}
      {resolveError != null && <p role="alert" className="mt-2 text-error">{t("settings.skills.recovery.resolveFailed", { reason: errorText(resolveError) })}</p>}
      {resolving != null && (
        <p role="status" aria-live="assertive" className="mt-2 text-base-content/60">
          {t("settings.skills.recovery.resolvingIssue", { name: issues.find((issue) => issue.transaction_id === resolving)?.skill_name ?? resolving })}
        </p>
      )}

      {issues.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label={t("settings.skills.recovery.issues")}>
          {issues.map((issue) => {
            const busy = resolving === issue.transaction_id;
            const issueNameId = `${panelId}-${issue.transaction_id}-name`;
            return (
              <li key={issue.transaction_id} aria-busy={busy} className="rounded-box border border-base-300 bg-base-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong id={issueNameId} className="font-mono">{issue.skill_name}</strong>
                  {issue.authoritative_target_missing && (
                    <span className="badge badge-warning badge-soft badge-sm">
                      {t("settings.skills.recovery.authorityMissing")}
                    </span>
                  )}
                </div>
                {issue.entry_path && <p className="mt-1 break-all font-mono text-2xs text-base-content/50">{issue.entry_path}</p>}
                <p className="mt-1 text-base-content/60">{issue.error}</p>

                <dl className="mt-2 grid gap-1 sm:grid-cols-3" aria-label={t("settings.skills.recovery.candidates")}>
                  {CANDIDATES.map((candidate) => {
                    const available = issue[`${candidate}_available` as const];
                    return (
                      <div key={candidate} className="flex items-center justify-between gap-2 rounded bg-base-200/50 px-2 py-1">
                        <dt>{t(`settings.skills.recovery.candidate.${candidate}` as const)}</dt>
                        <dd className={available ? "text-success" : "text-base-content/40"}>
                          {t(available ? "settings.skills.recovery.available" : "settings.skills.recovery.unavailable")}
                        </dd>
                      </div>
                    );
                  })}
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                  {issue.actions.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={`btn btn-xs ${action === "preserve-files" ? "btn-warning" : "btn-outline"}`}
                      aria-describedby={issueNameId}
                      disabled={resolving !== null}
                      onClick={() => void resolve(issue, action)}
                    >
                      {busy
                        ? t("settings.skills.recovery.resolving")
                        : t(`settings.skills.recovery.action.${action}` as const)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {Object.entries(preservedPaths).map(([transactionId, path]) => (
        <p key={transactionId} role="status" aria-live="polite" className="mt-2 break-all rounded bg-base-100 px-2 py-1 text-success">
          {t("settings.skills.recovery.preservedPath", { path })}
        </p>
      ))}
    </aside>
  );
}
