import { useEffect, useState } from "react"
import { MessagesSquare } from "lucide-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamConversationItem } from "@/api/Api"
import { TeamDataTablePagination } from "@/components/manager/team-data-table-pagination"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiRequest } from "@/utils/requestUtils"

function formatTime(value?: number) {
  if (!value) return "-"
  return new Date(value * 1000).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
}

export default function TeamManagerConversations() {
  const [conversations, setConversations] = useState<DomainTeamConversationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pageSize, setPageSize] = useState(20)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>()
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasNextPage, setHasNextPage] = useState(false)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined])

  const fetchConversations = async (cursor?: string, limit = pageSize) => {
    setLoading(true)
    setCurrentCursor(cursor)
    await apiRequest("v1TeamsConversationsList", { cursor, limit }, [], (resp) => {
      if (resp.code === 0) {
        const page = resp.data?.page as Dbv2Cursor | undefined
        setConversations(resp.data?.conversations || [])
        setNextCursor(page?.cursor)
        setHasNextPage(!!page?.has_next_page)
      } else {
        toast.error(resp.message || "获取对话列表失败")
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchConversations()
  }, [])

  const goFirst = () => {
    setCursorHistory([undefined])
    fetchConversations(undefined)
  }

  const goPrev = () => {
    if (cursorHistory.length <= 1) return
    const nextHistory = [...cursorHistory]
    nextHistory.pop()
    const prev = nextHistory[nextHistory.length - 1]
    setCursorHistory(nextHistory)
    fetchConversations(prev)
  }

  const goNext = () => {
    if (!nextCursor || !hasNextPage) return
    setCursorHistory((prev) => [...prev, currentCursor])
    fetchConversations(nextCursor)
  }

  const changePageSize = (size: number) => {
    setPageSize(size)
    setCursorHistory([undefined])
    fetchConversations(undefined, size)
  }

  if (loading && conversations.length === 0) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center gap-2">
        <MessagesSquare className="size-5" />
        <h1 className="text-xl font-semibold">对话</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户输入</TableHead>
              <TableHead>任务</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>创建人</TableHead>
              <TableHead>附件</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && conversations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-3.5 text-center">
                  无数据
                </TableCell>
              </TableRow>
            )}
            {conversations.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-[420px] truncate font-medium">{item.content || "-"}</TableCell>
                <TableCell className="max-w-[240px] truncate">{item.task_title || item.task_id || "-"}</TableCell>
                <TableCell>{item.project_name || "-"}</TableCell>
                <TableCell>{item.creator?.name || item.creator?.email || "-"}</TableCell>
                <TableCell>
                  <Badge variant={item.attachment_count ? "secondary" : "outline"}>{item.attachment_count || 0}</Badge>
                </TableCell>
                <TableCell>{formatTime(item.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TeamDataTablePagination
        page={cursorHistory.length}
        pageSize={pageSize}
        loading={loading}
        hasNextPage={hasNextPage}
        canPrevPage={cursorHistory.length > 1}
        onFirstPage={goFirst}
        onPrevPage={goPrev}
        onNextPage={goNext}
        onPageSizeChange={changePageSize}
      />
    </div>
  )
}
