
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

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) return '未知'
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN', {
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
  const [audits, setAudits] = useState<DomainAudit[]>([])
  const [loading, setLoading] = useState(true)
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined) // 当前页使用的游标
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]) // 用于返回上一页，记录每页的起始游标
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogContent, setDialogContent] = useState<string>('')
  const [dialogTitle, setDialogTitle] = useState<string>('')
  const [pageSize, setPageSize] = useState(20)

  const fetchAudits = async (cursorToUse?: string, limit?: number) => {
    setLoading(true)
    setCurrentCursor(cursorToUse) // 记录当前页使用的游标
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
    // 初始化时，将 undefined 加入历史栈（表示第一页）
    setCursorHistory([undefined])
    fetchAudits()
  }, [])

  const handleNextPage = () => {
    if (nextCursor && hasNextPage) {
      // 将当前页的游标加入历史栈（用于返回上一页）
      setCursorHistory(prev => [...prev, currentCursor])
      fetchAudits(nextCursor)
    }
  }

  const handlePrevPage = () => {
    if (cursorHistory.length > 1) {
      // 从历史栈中移除当前页，获取上一页的游标
      const newHistory = [...cursorHistory]
      newHistory.pop() // 移除当前页
      const prevCursor = newHistory[newHistory.length - 1] // 获取上一页的游标
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
    // 重置到第一页并重新获取数据
    setCursorHistory([undefined])
    fetchAudits(undefined, size)
  }

  const handleViewRequest = (request: string | undefined) => {
    setDialogTitle('查看请求')
    setDialogContent(request || '无请求内容')
    setDialogOpen(true)
  }

  const handleViewResponse = (response: string | undefined) => {
    setDialogTitle('查看响应')
    setDialogContent(response || '无响应内容')
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
              <TableHead className="">时间</TableHead>
              <TableHead className="">用户</TableHead>
              <TableHead className="">操作</TableHead>
              <TableHead className="">来源IP</TableHead>
              <TableHead className="">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && audits.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-3.5">
                  <div className="flex items-center justify-center gap-2">
                    <Spinner className="size-4" />
                    正在加载
                  </div>
                </TableCell>
              </TableRow>
            )}
            {audits.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-3.5">
                  无数据
                </TableCell>
              </TableRow>
            )}
            {!loading && audits.map((audit) => (
              <TableRow key={audit.id}>
                <TableCell>{formatTimestamp(audit.created_at)}</TableCell>
                <TableCell>{audit.user?.email || audit.user?.name || '未知'}</TableCell>
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
                      查看请求
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewResponse(audit.response)}
                      disabled={!audit.response}
                    >
                      查看响应
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      
      {/* 分页组件 - 固定在底部 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-4 py-4 border-t bg-background shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">每页显示：</span>
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
            第 <span className="font-medium text-foreground">{cursorHistory.length}</span> 页
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFirstPage}
            disabled={cursorHistory.length <= 1 || loading}
            title="首页"
          >
            <IconChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrevPage}
            disabled={cursorHistory.length <= 1 || loading}
            title="上一页"
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNextPage}
            disabled={!hasNextPage || loading}
            title="下一页"
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 查看请求/响应的 Dialog */}
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

