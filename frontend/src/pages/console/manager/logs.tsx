
import { useState, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import type { DomainAudit, Dbv2Cursor } from "@/api/Api"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconChevronLeft, IconChevronRight, IconChevronsLeft } from "@tabler/icons-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslation } from "react-i18next"

const formatTimestamp = (timestamp: string | undefined, language: string, fallback: string) => {
  if (!timestamp) return fallback
  const date = new Date(timestamp)
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-')
}

export default function TeamManagerLogs() {
  const { i18n, t } = useTranslation()
  const [audits, setAudits] = useState<DomainAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogContent, setDialogContent] = useState<string>('')
  const [dialogTitle, setDialogTitle] = useState<string>('')
  const [pageSize, setPageSize] = useState(20)

  const fetchAudits = async (cursorToUse?: string, limit?: number) => {
    setLoading(true)
    setCurrentCursor(cursorToUse)
    await apiRequest('v1TeamsAuditsList', {
      cursor: cursorToUse,
      limit: limit || pageSize
    }, [], (resp) => {
      if (resp.code === 0) {
        const data = resp.data as { audits?: DomainAudit[]; page?: Dbv2Cursor }
        setAudits(data.audits || [])
        setHasNextPage(data.page?.has_next_page || false)
        setNextCursor(data.page?.cursor)
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    setCursorHistory([undefined])
    fetchAudits()
  }, [])

  const handleNextPage = () => {
    if (nextCursor && hasNextPage) {
      setCursorHistory(prev => [...prev, currentCursor])
      fetchAudits(nextCursor)
    }
  }

  const handlePrevPage = () => {
    if (cursorHistory.length > 1) {
      const newHistory = [...cursorHistory]
      newHistory.pop()
      const prevCursor = newHistory[newHistory.length - 1]
      setCursorHistory(newHistory)
      fetchAudits(prevCursor)
    }
  }

  const handleFirstPage = () => {
    setCursorHistory([undefined])
    fetchAudits(undefined)
  }

  const handlePageSizeChange = (newSize: string) => {
    const size = parseInt(newSize, 10)
    setPageSize(size)
    setCursorHistory([undefined])
    fetchAudits(undefined, size)
  }

  const handleViewRequest = (request: string | undefined) => {
    setDialogTitle(t("managerLogs.dialog.requestTitle"))
    setDialogContent(request || t("managerLogs.dialog.noRequest"))
    setDialogOpen(true)
  }

  const handleViewResponse = (response: string | undefined) => {
    setDialogTitle(t("managerLogs.dialog.responseTitle"))
    setDialogContent(response || t("managerLogs.dialog.noResponse"))
    setDialogOpen(true)
  }

  if (loading && audits.length === 0) {
    return (
      <Empty className="bg-muted">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
      </Empty>
    )
  }

  const formatJSON = (json: string) => {
    try {
      return JSON.stringify(JSON.parse(json || '{}'), null, 2)
    } catch (error) {
      return json
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0">
        <Table className="flex-1 overflow-auto min-h-0">
          <TableHeader className="">
            <TableRow>
              <TableHead className="">{t("managerLogs.columns.time")}</TableHead>
              <TableHead className="">{t("managerLogs.columns.user")}</TableHead>
              <TableHead className="">{t("managerLogs.columns.operation")}</TableHead>
              <TableHead className="">{t("managerLogs.columns.sourceIp")}</TableHead>
              <TableHead className="">{t("managerLogs.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && audits.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-3.5">
                  <div className="flex items-center justify-center gap-2">
                    <Spinner className="size-4" />
                    {t("managerLogs.loading")}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {audits.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-3.5">
                  {t("managerLogs.empty")}
                </TableCell>
              </TableRow>
            )}
            {!loading && audits.map((audit) => (
              <TableRow key={audit.id}>
                <TableCell>{formatTimestamp(audit.created_at, i18n.language, t("managerLogs.unknown"))}</TableCell>
                <TableCell>{audit.user?.email || audit.user?.name || t("managerLogs.unknown")}</TableCell>
                <TableCell>{audit.operation || '-'}</TableCell>
                <TableCell>{audit.source_ip || '-'}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewRequest(audit.request)}
                      disabled={!audit.request}
                    >
                      {t("managerLogs.actions.viewRequest")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewResponse(audit.response)}
                      disabled={!audit.response}
                    >
                      {t("managerLogs.actions.viewResponse")}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4 py-4 border-t bg-background shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {t("managerPagination.perPage")}
            </span>
            <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[80px] h-8">
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
        </div>
        
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground mr-2">
            {t("managerPagination.page", { page: cursorHistory.length })}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFirstPage}
            disabled={cursorHistory.length <= 1 || loading}
            title={t("managerPagination.firstPage")}
          >
            <IconChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrevPage}
            disabled={cursorHistory.length <= 1 || loading}
            title={t("managerPagination.prevPage")}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!hasNextPage || loading}
            title={t("managerPagination.nextPage")}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap bg-muted break-all text-sm p-4 rounded-md">
            {formatJSON(dialogContent)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
