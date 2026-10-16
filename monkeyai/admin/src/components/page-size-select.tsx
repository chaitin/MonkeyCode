import { useTranslation } from "react-i18next"
import { PAGE_SIZE_OPTIONS } from "@/lib/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PageSizeSelect({
  value,
  onValueChange,
  disabled = false,
}: {
  value: number
  onValueChange: (size: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const items = PAGE_SIZE_OPTIONS.map((size) => ({
    value: size,
    label: t("pages.operationLogs.pagination.perPage", { count: size }),
  }))
  return (
    <Select
      items={items}
      value={String(value)}
      disabled={disabled}
      onValueChange={(next) => {
        if (next) onValueChange(Number(next))
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={t("pages.operationLogs.pagination.pageSizeLabel")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
