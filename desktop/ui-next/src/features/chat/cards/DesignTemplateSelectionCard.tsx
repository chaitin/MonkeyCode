import { IconCheck } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { localFrameSender, sendDesignSelectionVia, type FrameSender } from "@/lib/ipc/approvals";
import type {
  DesignSelectionAction,
  DesignSelectionResponse,
  DesignTemplatePreview as Preview,
  DesignTemplateSelectionItem,
} from "@/lib/protocol/types";

type PreviewState = { status: "idle" | "loading" | "error" } | { status: "ready"; url: string };
type UploadUrl = (path: string, expectedDigest?: string) => Promise<string>;

function DesignTemplateImage({
  title,
  path,
  uploadUrl,
  expectedDigest,
  onValidation,
  fit = "cover",
  showLoading = true,
}: {
  title: string;
  path: string;
  uploadUrl?: UploadUrl;
  expectedDigest?: string;
  onValidation?: (path: string, digest: string, valid: boolean) => void;
  fit?: "cover" | "contain";
  showLoading?: boolean;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    if (!uploadUrl) {
      if (expectedDigest) onValidation?.(path, expectedDigest, false);
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    void uploadUrl(path, expectedDigest).then(
      (url) => {
        if (!alive) return;
        const valid = Boolean(url);
        setState(valid ? { status: "ready", url } : { status: "error" });
        if (expectedDigest) onValidation?.(path, expectedDigest, valid);
      },
      () => {
        if (alive) setState({ status: "error" });
        if (alive && expectedDigest) onValidation?.(path, expectedDigest, false);
      },
    );
    return () => {
      alive = false;
    };
  }, [expectedDigest, onValidation, path, uploadUrl]);

  if (!uploadUrl || state.status === "error") {
    return <span className="flex size-full items-center justify-center text-xs text-base-content/50">{t("chat.design.previewError")}</span>;
  }
  if (state.status !== "ready") {
    return showLoading ? <span className="flex size-full items-center justify-center text-xs text-base-content/50">{t("chat.design.previewLoading")}</span> : null;
  }
  return <img src={state.url} alt={title} className={fit === "contain" ? "block h-auto w-full object-contain" : "size-full object-cover"} onError={() => setState({ status: "error" })} />;
}

export function createDesignTemplateBlobUrl(html: string): string {
  return URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
}

export function resolveDesignTemplatePreviewState(status: PreviewState["status"], hasFallback: boolean) {
  return {
    showHtml: status === "ready",
    showFallback: hasFallback && status !== "ready",
    showError: !hasFallback && status === "error",
  };
}

/** Preview content is loaded only near the viewport. The iframe has an opaque origin:
 * allow-scripts is intentional, while allow-same-origin must never be added. */
function DesignTemplatePreview({
  title,
  preview,
  fallbackPath,
  expectedDigest,
  onValidation,
  uploadUrl,
  loadHtml,
  expanded = false,
}: {
  title: string;
  preview: Preview;
  fallbackPath?: string;
  expectedDigest?: string;
  onValidation?: (path: string, digest: string, valid: boolean) => void;
  uploadUrl?: UploadUrl;
  loadHtml?: (path: string) => Promise<string>;
  expanded?: boolean;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  useEffect(() => {
    const node = host.current;
    if (!node || mounted) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setMounted(true);
        observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted]);

  useEffect(() => {
    if (!mounted || preview.type !== "html") return;
    if (!loadHtml) {
      setState({ status: "error" });
      return;
    }
    let alive = true;
    let objectUrl: string | undefined;
    setState({ status: "loading" });
    void loadHtml(preview.path).then(
      (html) => {
        if (!alive) return;
        try {
          objectUrl = createDesignTemplateBlobUrl(html);
          setState({ status: "ready", url: objectUrl });
        } catch {
          setState({ status: "error" });
        }
      },
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [loadHtml, mounted, preview.path, preview.type]);

  const view = resolveDesignTemplatePreviewState(state.status, Boolean(fallbackPath && uploadUrl));
  return (
    <div ref={host} data-preview-state={preview.type === "html" ? state.status : undefined} className={`pointer-events-none w-full overflow-hidden bg-base-200 ${expanded && preview.type === "image" ? "" : "aspect-video"}`}>
      {mounted && preview.type === "image" && (
        <DesignTemplateImage key={`${preview.path}\u0000${expectedDigest ?? ""}`} title={title} path={preview.path} uploadUrl={uploadUrl} expectedDigest={expectedDigest} onValidation={onValidation} fit={expanded ? "contain" : "cover"} />
      )}
      {mounted && preview.type === "html" && view.showHtml && state.status === "ready" && (
        <iframe
          title={t("chat.design.dynamicPreview", { title })}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={state.url}
          tabIndex={-1}
          className="block size-full border-0"
        />
      )}
      {mounted && preview.type === "html" && view.showFallback && fallbackPath && (
        <DesignTemplateImage key={`${fallbackPath}\u0000${expectedDigest ?? ""}`} title={title} path={fallbackPath} uploadUrl={uploadUrl} expectedDigest={expectedDigest} onValidation={onValidation} showLoading={false} />
      )}
      {mounted && preview.type === "html" && view.showError && (
        <span className="flex size-full items-center justify-center text-xs text-base-content/50">{t("chat.design.previewError")}</span>
      )}
    </div>
  );
}

function TerminalDesign({
  item,
  response,
  unanswered,
  uploadUrl,
  loadHtml,
}: {
  item: DesignTemplateSelectionItem;
  response?: DesignSelectionResponse;
  unanswered?: boolean;
  uploadUrl?: UploadUrl;
  loadHtml?: (path: string) => Promise<string>;
}) {
  const { t } = useI18n();
  const action = response?.action ?? item.action;
  const selectedId = response?.selected_id ?? item.selectedId;
  const selected = item.items.find((candidate) => candidate.id === selectedId);
  const actionKey = action === "direct" && item.mode === "template" ? "skipTemplate" : action ?? "cancel";
  let label = unanswered
    ? t("chat.design.unanswered")
    : item.state === "cancelled"
      ? t("chat.design.cancelled")
      : item.state === "expired"
        ? t("chat.design.expired")
        : t(`chat.design.action.${actionKey}`);
  if (selected) label += ` · ${selected.title}`;
  if (item.reason) label += ` · ${item.reason}`;

  if (action === "select" && selected) {
    const preview = selected.image
      ? { type: "image" as const, path: selected.image }
      : selected.preview;
    return (
      <section className="card card-border w-full max-w-[760px] overflow-hidden bg-base-100" aria-label={item.title || t("chat.design.title")}>
        <header className="flex items-center gap-1.5 border-b border-base-300 px-4 py-3.5">
          <IconCheck size={14} stroke={1.75} aria-hidden />
          <h3 role="status" className="text-sm font-semibold leading-5">{label}</h3>
        </header>
        <div className="p-4">
          <div className="mx-auto max-w-lg overflow-hidden rounded-xl border border-base-300 bg-base-100">
            {preview && (
              <DesignTemplatePreview title={selected.title} preview={preview} fallbackPath={preview.type === "html" ? selected.image : undefined} expectedDigest={preview.type === "image" ? selected.previewDigest : undefined} uploadUrl={uploadUrl} loadHtml={loadHtml} expanded />
            )}
            {selected.description && <p className="px-3 py-2.5 text-xs leading-relaxed text-base-content/60">{selected.description}</p>}
            {selected.reason && (
              <p className="border-t border-base-200 px-3 py-2.5 text-xs leading-relaxed text-base-content/70">
                <strong>{t("chat.design.reason")}</strong>{selected.reason}
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div role="status" className="flex items-center justify-center gap-1.5 text-xs text-base-content/50">
      <IconCheck size={12} stroke={1.75} aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function DesignTemplateSelectionCard({
  item,
  sessionId,
  sendFrame,
  readonly,
  uploadUrl,
  loadHtml,
}: {
  item: DesignTemplateSelectionItem;
  sessionId: string;
  sendFrame?: FrameSender;
  readonly?: boolean;
  uploadUrl?: UploadUrl;
  loadHtml?: (path: string) => Promise<string>;
}) {
  const { t } = useI18n();
  const isTemplate = item.mode === "template";
  const [selectedSnapshot, setSelectedSnapshot] = useState<{ id: string; path: string; digest?: string }>();
  const [refinement, setRefinement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sent, setSent] = useState<DesignSelectionResponse>();
  const [validatedImages, setValidatedImages] = useState<Set<string>>(() => new Set());
  const markImageValidation = useCallback((path: string, digest: string, valid: boolean) => {
    const key = `${path}\u0000${digest}`;
    setValidatedImages((current) => {
      const next = new Set(current);
      if (valid) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  if (item.state !== "open" || sent) return <TerminalDesign item={item} response={sent} uploadUrl={uploadUrl} loadHtml={loadHtml} />;
  if (readonly) return <TerminalDesign item={item} unanswered uploadUrl={uploadUrl} loadHtml={loadHtml} />;

  const send = sendFrame ?? localFrameSender(sessionId);
  // Duplicate request upserts keep the row/component mounted. Validate the complete
  // click-time binding so a same-id candidate whose path/digest changed becomes stale.
  const selected = selectedSnapshot && item.items.find((candidate) => {
    const path = candidate.image || candidate.preview?.path;
    return candidate.id === selectedSnapshot.id
      && path === selectedSnapshot.path
      && candidate.previewDigest === selectedSnapshot.digest;
  });
  const submit = async (action: DesignSelectionAction) => {
    if (submitting || !item.allowedActions[action] || (action === "select" && (!selected || !selectedSnapshot))) return;
    const text = refinement.trim();
    const response: DesignSelectionResponse = {
      request_id: item.requestId,
      action,
      ...(action === "select" && selectedSnapshot ? {
        selected_id: selectedSnapshot.id,
        selected_preview_path: selectedSnapshot.path,
        ...(selectedSnapshot.digest ? { selected_preview_digest: selectedSnapshot.digest } : {}),
      } : {}),
      ...(text ? { refinement_text: text } : {}),
    };
    setSubmitting(true);
    setFailed(false);
    try {
      await sendDesignSelectionVia(send, response);
      setSent(response);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  };
  const selectable = item.allowedActions.select && !submitting;

  if (confirming && selected) {
    const preview = selected.image
      ? { type: "image" as const, path: selected.image }
      : selected.preview;
    return (
      <section className="card card-border w-full max-w-[760px] overflow-hidden bg-base-100" aria-label={item.title || t("chat.design.title")}>
        <header className="border-b border-base-300 px-4 py-3.5">
          <h3 className="text-sm font-semibold leading-5">{t("chat.design.selected", { title: selected.title })}</h3>
        </header>
        <div className="p-4">
          <div className="mx-auto max-w-lg overflow-hidden rounded-xl border border-primary bg-primary/5">
            {preview && (
              <DesignTemplatePreview title={selected.title} preview={preview} fallbackPath={preview.type === "html" ? selected.image : undefined} expectedDigest={preview.type === "image" ? selected.previewDigest : undefined} uploadUrl={uploadUrl} loadHtml={loadHtml} expanded />
            )}
            {selected.description && <p className="px-3 py-2.5 text-xs leading-relaxed text-base-content/60">{selected.description}</p>}
          </div>
        </div>
        <footer className="border-t border-base-300 bg-base-200/40 px-4 py-3">
          {item.allowedActions.next && item.refinement?.enabled && (
            <textarea
              rows={2}
              className="block min-h-16 w-full resize-none rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs leading-5 outline-none transition-colors placeholder:text-base-content/40 focus:border-primary"
              value={refinement}
              disabled={submitting}
              aria-label={t("chat.design.refinement")}
              placeholder={item.refinement.placeholder || t("chat.design.refinement")}
              onChange={(event) => setRefinement(event.target.value)}
            />
          )}
          <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${item.allowedActions.next && item.refinement?.enabled ? "mt-3" : ""}`}>
            {failed && <span role="alert" className="me-auto text-xs text-error">{t("chat.design.submitFailed")}</span>}
            {item.allowedActions.next && <button type="button" className="btn btn-outline btn-xs" disabled={submitting} onClick={() => { setConfirming(false); void submit("next"); }}>{t("chat.design.next")}</button>}
            <button type="button" className="btn btn-outline btn-xs" disabled={submitting} onClick={() => { setConfirming(false); setFailed(false); }}>{t("chat.design.reselect")}</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={submitting} onClick={() => void submit("select")}>{submitting ? t("chat.design.submitting") : t(isTemplate ? "chat.design.confirmTemplate" : "chat.design.confirmDevelopment")}</button>
          </div>
        </footer>
      </section>
    );
  }

  return (
    <section className="card card-border w-full max-w-[760px] overflow-hidden bg-base-100" aria-label={item.title || t("chat.design.title")}>
      <header className="border-b border-base-300 px-4 py-3.5">
        <h3 className="text-sm font-semibold leading-5">{item.title || t("chat.design.title")}</h3>
        {item.description && <p className="mt-1 break-words text-xs leading-relaxed text-base-content/60">{item.description}</p>}
      </header>

      <div
        className="grid min-w-0 content-start items-start gap-3 p-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}
      >
        {item.items.map((candidate) => {
          const active = selected?.id === candidate.id;
          const preview = candidate.image
            ? { type: "image" as const, path: candidate.image }
            : candidate.preview;
          const digestVerified = !candidate.previewDigest
            || (preview?.type === "image" && validatedImages.has(`${preview.path}\u0000${candidate.previewDigest}`));
          const candidateSelectable = selectable && digestVerified;
          return (
            <button
              key={candidate.id}
              type="button"
              disabled={!candidateSelectable}
              aria-pressed={active}
              className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border text-start ${active ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20" : "border-base-300 bg-base-100"} ${candidateSelectable ? "cursor-pointer transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-base-content/30 hover:shadow-sm" : "cursor-default"}`}
              onClick={() => {
                if (!candidateSelectable) return;
                const path = candidate.image || candidate.preview?.path;
                if (path) setSelectedSnapshot({
                  id: candidate.id,
                  path,
                  ...(candidate.previewDigest ? { digest: candidate.previewDigest } : {}),
                });
                setConfirming(false);
              }}
            >
              <span className="relative block w-full overflow-hidden border-b border-base-300 bg-base-200">
                {preview && !(candidate.previewDigest && preview.type === "html") ? (
                  <DesignTemplatePreview
                    title={candidate.title}
                    preview={preview}
                    fallbackPath={preview.type === "html" ? candidate.image : undefined}
                    expectedDigest={preview.type === "image" ? candidate.previewDigest : undefined}
                    onValidation={markImageValidation}
                    uploadUrl={uploadUrl}
                    loadHtml={loadHtml}
                  />
                ) : <span className="flex aspect-video items-center justify-center text-xs text-base-content/50">{candidate.previewDigest ? t("chat.design.previewError") : null}</span>}
                {candidate.recommended && <span className="badge badge-primary badge-sm absolute start-2 top-2 z-10 shadow-sm">{t("chat.design.recommended")}</span>}
                {active && (
                  <span className="absolute end-2 top-2 z-10 flex size-5 items-center justify-center rounded-full bg-primary text-primary-content shadow-sm" aria-hidden>
                    <IconCheck size={13} stroke={2.5} />
                  </span>
                )}
              </span>
              <span className="flex min-w-0 flex-col px-3 py-2.5">
                <strong className="line-clamp-2 break-words text-xs font-semibold leading-snug">{candidate.title}</strong>
                {candidate.description && <span className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-base-content/50">{candidate.description}</span>}
                {candidate.reason && (
                  <span className="mt-2 line-clamp-3 break-words border-t border-base-200 pt-2 text-xs leading-relaxed text-base-content/70">
                    <strong>{t("chat.design.reason")}</strong>{candidate.reason}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <footer className="border-t border-base-300 bg-base-200/40 px-4 py-3">
        {item.allowedActions.next && item.refinement?.enabled && (
          <textarea
            rows={2}
            className="block min-h-16 w-full resize-none rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs leading-5 outline-none transition-colors placeholder:text-base-content/40 focus:border-primary"
            value={refinement}
            disabled={submitting}
            aria-label={t("chat.design.refinement")}
            placeholder={item.refinement.placeholder || t("chat.design.refinement")}
            onChange={(event) => setRefinement(event.target.value)}
          />
        )}
        <div className={`flex min-w-0 flex-wrap items-center justify-end gap-2 ${item.allowedActions.next && item.refinement?.enabled ? "mt-3" : ""}`}>
          {failed && <span role="alert" className="me-auto text-xs text-error">{t("chat.design.submitFailed")}</span>}
          {!item.allowedActions.select && !item.allowedActions.next && !item.allowedActions.direct && item.allowedActions.cancel && <button type="button" className="btn btn-ghost btn-xs" disabled={submitting} onClick={() => void submit("cancel")}>{t("chat.design.cancel")}</button>}
          {item.allowedActions.direct && <button type="button" className="btn btn-ghost btn-xs" disabled={submitting} onClick={() => void submit("direct")}>{t(isTemplate ? "chat.design.skipTemplate" : "chat.design.direct")}</button>}
          {item.allowedActions.next && <button type="button" className="btn btn-outline btn-xs" disabled={submitting} onClick={() => void submit("next")}>{t("chat.design.next")}</button>}
          {item.allowedActions.select && <button type="button" className="btn btn-primary btn-sm" disabled={submitting || !selected} onClick={() => setConfirming(true)}>{t("chat.design.select")}</button>}
        </div>
      </footer>
    </section>
  );
}
