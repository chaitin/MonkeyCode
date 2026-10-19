import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { useTranslation } from "react-i18next"
import { PageSizeSelect } from "@/components/page-size-select"
import { Button } from "@/components/ui/button"

export function TablePagination({
  page,
  pageSize,
  itemCount,
  total,
  loading,
  error = false,
  hasNext,
  onPageSizeChange,
  onPrevious,
  onNext,
}: {
  page: number
  pageSize: number
  itemCount: number
  total?: number
  loading: boolean
  error?: boolean
  hasNext?: boolean
  onPageSizeChange: (size: number) => void
  onPrevious: () => void
  onNext: () => void
}) {
  const { t } = useTranslation()
  const pages =
    total === undefined ? undefined : Math.max(1, Math.ceil(total / pageSize))
  const from = itemCount ? (page - 1) * pageSize + 1 : 0
  const to = itemCount ? (page - 1) * pageSize + itemCount : 0
  const canNext = hasNext ?? (pages !== undefined && page < pages)
  return (
    <div
      data-slot="table-pagination"
      aria-busy={loading}
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-(--card-spacing)"
    >
      <div className="flex flex-wrap items-center gap-3">
        <PageSizeSelect
          value={pageSize}
          onValueChange={(size) => {
            if (size !== pageSize) onPageSizeChange(size)
          }}
        />
        <p className="text-sm text-muted-foreground">
          {total === undefined
            ? t("pages.sessionReporting.clients.cursorSummary", { from, to })
            : t("pages.operationLogs.pagination.summary", { from, to, total })}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {pages === undefined
            ? t("pages.sessionReporting.clients.cursorPage", { page })
            : t("pages.operationLogs.pagination.page", { page, pages })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={loading || page <= 1}
          onClick={onPrevious}
          aria-label={t("pages.operationLogs.pagination.previous")}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="rtl:rotate-180" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={loading || error || !canNext}
          onClick={onNext}
          aria-label={t("pages.operationLogs.pagination.next")}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  )
}
