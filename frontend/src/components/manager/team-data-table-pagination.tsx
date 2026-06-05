import { IconChevronLeft, IconChevronRight, IconChevronsLeft } from "@tabler/icons-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function TeamDataTablePagination({
  page,
  pageSize,
  loading,
  hasNextPage,
  canPrevPage,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  loading: boolean
  hasNextPage: boolean
  canPrevPage: boolean
  onFirstPage: () => void
  onPrevPage: () => void
  onNextPage: () => void
  onPageSizeChange: (size: number) => void
}) {
  return (
    <div className="flex shrink-0 flex-col items-start justify-between gap-4 border-t bg-background px-6 py-4 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-sm text-muted-foreground">每页显示：</span>
        <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-8 w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10</SelectItem>
            <SelectItem value="20">20</SelectItem>
            <SelectItem value="50">50</SelectItem>
            <SelectItem value="100">100</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <div className="mr-2 text-sm text-muted-foreground">
          第 <span className="font-medium text-foreground">{page}</span> 页
        </div>
        <Button variant="outline" size="sm" onClick={onFirstPage} disabled={!canPrevPage || loading} title="首页">
          <IconChevronsLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onPrevPage} disabled={!canPrevPage || loading} title="上一页">
          <IconChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onNextPage} disabled={!hasNextPage || loading} title="下一页">
          <IconChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
