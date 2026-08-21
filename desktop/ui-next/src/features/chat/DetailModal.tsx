import { IconX } from "@tabler/icons-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import { useEscLayer } from "@/lib/util/escLayer";

export function DetailModal({
  ariaLabel,
  title,
  children,
  onClose,
}: {
  ariaLabel: string;
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEscLayer(
    true,
    useCallback(() => {
      onCloseRef.current();
      return true;
    }, []),
  );

  return createPortal(
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      <div className="modal-box flex max-h-[84vh] w-[min(860px,92vw)] max-w-[min(860px,92vw)] flex-col gap-3 p-5">
        <div className="flex shrink-0 items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <button
            type="button"
            aria-label={t("chat.dismiss")}
            title={t("chat.dismiss")}
            className="btn btn-ghost btn-square btn-xs"
            onClick={onClose}
          >
            <IconX size={14} stroke={1.75} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
      </div>
      <div className="modal-backdrop cursor-pointer" onClick={onClose} aria-hidden />
    </div>,
    document.body,
  );
}
