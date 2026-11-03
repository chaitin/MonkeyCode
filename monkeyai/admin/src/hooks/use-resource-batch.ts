import { useState, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import { useAppToast } from "@/components/animated-toast-provider"
import type { useResourceList } from "@/hooks/use-resource-list"
import type { ResourceRow } from "@/lib/resources"
import {
  applyResourceBatch,
  type ResourceBatchChange,
  type ResourceBatchKind,
  type ResourceBatchProgress,
} from "@/lib/resource-batch"

export function useResourceBatch(
  kind: ResourceBatchKind,
  remote: ReturnType<typeof useResourceList<ResourceRow>>
) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [progress, setProgress] = useState<ResourceBatchProgress>({
    completed: 0,
    total: 0,
  })
  const selectedRows = remote.items.filter(
    (row) => row.ownership_type === "system" && selectedIds.includes(row.id)
  )
  const resource = t(`resources.batch.resourceNames.${kind}`)
  const exit = () => {
    setSelecting(false)
    setSelectedIds([])
  }
  const toggle = (id: string) => {
    if (remote.pending) return
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    )
  }
  const apply = async (change: ResourceBatchChange) => {
    if (remote.loading || selectedRows.length === 0) return false
    return remote.run(async () => {
      setProgress({ completed: 0, total: selectedRows.length })
      const result = await applyResourceBatch(
        kind,
        selectedRows,
        change,
        undefined,
        setProgress
      )
      if (
        change.action === "delete" &&
        result.succeeded.length === remote.items.length &&
        remote.page > 1
      ) {
        remote.previousPage(remote.type)
      }
      setSelectedIds(result.failed.map((failure) => failure.id))
      setSelecting(result.failed.length > 0)
      showToast({
        status: result.failed.length
          ? "error"
          : result.skipped.length
            ? "info"
            : "success",
        title: t("resources.batch.result", {
          succeeded: result.succeeded.length,
          failed: result.failed.length,
          skipped: result.skipped.length,
        }),
        description: result.failed.length
          ? `${t("resources.batch.retryFailed")} ${result.failed
              .slice(0, 3)
              .map((failure) => `${failure.name}: ${failure.message}`)
              .join("；")}`
          : result.skipped.length
            ? t("resources.batch.packageSkipped", {
                resource,
                count: result.skipped.length,
              })
            : undefined,
      })
    })
  }

  return {
    key: `${remote.type}:${remote.search}:${remote.page}:${remote.pageSize}`,
    exit,
    toggle,
    isSelected: (id: string) => selecting && selectedIds.includes(id),
    actions: {
      kind,
      selecting,
      selectedCount: selectedRows.length,
      disabled:
        remote.loading ||
        remote.pending ||
        (!selecting && remote.items.length === 0),
      pending: remote.pending,
      progress,
      onApply: apply,
      onEnter: () => {
        setSelectedIds([])
        setSelecting(true)
      },
      onSelectAll: () =>
        setSelectedIds(
          remote.items
            .filter((row) => row.ownership_type === "system")
            .map((row) => row.id)
        ),
      onClear: () => setSelectedIds([]),
      onExit: exit,
    },
    page: {
      ...remote,
      setType: (...args: Parameters<typeof remote.setType>) => {
        if (!remote.pending) {
          exit()
          remote.setType(...args)
        }
      },
      handleSearch: (...args: Parameters<typeof remote.handleSearch>) => {
        args[0].preventDefault()
        if (!remote.pending) {
          exit()
          remote.handleSearch(...args)
        }
      },
      setPageSize: (...args: Parameters<typeof remote.setPageSize>) => {
        if (!remote.pending) {
          exit()
          remote.setPageSize(...args)
        }
      },
      nextPage: () => {
        if (!remote.pending) {
          exit()
          remote.nextPage()
        }
      },
      previousPage: (type = remote.type) => {
        if (!remote.pending) {
          exit()
          remote.previousPage(type)
        }
      },
    },
    cardProps: (id: string, name: string, ownership: "system" | "user") => {
      const selectable = selecting && ownership === "system"
      return {
        selectable,
        selected: selectable && selectedIds.includes(id),
        role: selectable ? "checkbox" : undefined,
        "aria-checked": selectable ? selectedIds.includes(id) : undefined,
        "aria-disabled": selectable && remote.pending ? true : undefined,
        "aria-label": selectable
          ? t("resources.batch.selectResource", { name })
          : undefined,
        tabIndex: selectable ? 0 : undefined,
        onClick: selectable ? () => toggle(id) : undefined,
        onKeyDown: selectable
          ? (event: KeyboardEvent<HTMLDivElement>) => {
              if (
                event.target !== event.currentTarget ||
                (event.key !== "Enter" && event.key !== " ")
              )
                return
              event.preventDefault()
              toggle(id)
            }
          : undefined,
      }
    },
  }
}
