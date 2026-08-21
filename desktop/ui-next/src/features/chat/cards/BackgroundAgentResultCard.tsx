import { IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";

import { Markdown } from "@/components/markdown/Markdown";
import { useI18n, type MessageKey } from "@/lib/i18n";
import type { BackgroundAgentResultItem } from "@/lib/protocol/types";
import { DetailModal } from "../DetailModal";
import { statusDot, type DotTone } from "./statusDot";

interface StatusPresentation {
  tone: DotTone;
  key?: MessageKey;
  fallback: string;
  textClass: string;
}

function presentStatus(status: string): StatusPresentation {
  const normalized = status.trim().toLowerCase();
  if (["error", "failed", "failure"].includes(normalized)) {
    return { tone: "fail", key: "chat.backgroundResult.failed", fallback: status, textClass: "text-error" };
  }
  if (["stopped", "cancelled", "canceled", "interrupted"].includes(normalized)) {
    return { tone: "warn", key: "chat.backgroundResult.stopped", fallback: status, textClass: "text-warning" };
  }
  if (["running", "in_progress", "in-progress", "started"].includes(normalized)) {
    return { tone: "run", key: "chat.backgroundResult.running", fallback: status, textClass: "text-primary" };
  }
  if (!normalized || ["completed", "complete", "done", "finished", "success", "succeeded", "ok"].includes(normalized)) {
    return { tone: "ok", key: "chat.backgroundResult.completed", fallback: status, textClass: "text-base-content/50" };
  }
  return { tone: "idle", fallback: status, textClass: "text-base-content/60" };
}

/** 结果首条非空 Markdown 行，折叠态只做轻量标记清理，不解析完整正文。 */
function resultSummary(result: string): string {
  const line = result.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .trim();
}

export function BackgroundAgentResultCard({
  item,
  uploadUrl,
  onLocalLink,
}: {
  item: BackgroundAgentResultItem;
  uploadUrl?: (path: string) => Promise<string>;
  onLocalLink?: (path: string) => void;
}) {
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = presentStatus(item.status);
  const summary = resultSummary(item.result);
  const name = item.agentName.trim() || item.agentId;
  const statusText = status.key ? t(status.key) : status.fallback;

  const target = item.description.trim() || summary || name;

  return (
    <section className="card card-border overflow-hidden bg-base-100">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-start text-xs"
        aria-haspopup="dialog"
        onClick={() => setDialogOpen(true)}
      >
        <span aria-hidden className={`shrink-0 ${statusDot(status.tone)}`} />
        <span className="shrink-0">{t("chat.backgroundResult.label")}</span>
        <span className="min-w-0 flex-1 truncate text-base-content/60" title={target}>
          {target}
        </span>
        <span className={`shrink-0 ${status.textClass}`}>{statusText}</span>
        <IconChevronRight
          size={12}
          stroke={1.75}
          aria-hidden
          className="shrink-0 text-base-content/40"
        />
      </button>

      {dialogOpen && (
        <DetailModal
          ariaLabel={t("chat.backgroundResult.label")}
          title={
            <>
              {t("chat.backgroundResult.label")} <span className="text-xs font-normal text-base-content/50">{target}</span>
            </>
          }
          onClose={() => setDialogOpen(false)}
        >
          <div className="text-sm">
            <div className="mb-3 text-xs text-base-content/50">{name}</div>
            <Markdown source={item.result} localImageUrl={uploadUrl} onLocalLink={onLocalLink} />
          </div>
        </DetailModal>
      )}
    </section>
  );
}
