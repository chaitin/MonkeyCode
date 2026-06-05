import { useEffect, useState } from "react"
import { IconMessages } from "@tabler/icons-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamConversationItem } from "@/api/Api"
import {
  ManagerListEmpty,
  ManagerListLoading,
  ManagerListCard,
} from "@/components/manager/manager-list-page"
import { TeamDataTablePagination } from "@/components/manager/team-data-table-pagination"
import { Badge } from "@/components/ui/badge"
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

function creatorName(item: DomainTeamConversationItem) {
  return item.creator?.name || item.creator?.email || "-"
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
    return <ManagerListLoading title="正在加载对话" />
  }

  return (
    <ManagerListCard
      title="对话"
      description="查看团队对话输入、关联任务、创建人和附件数量。"
      icon={<IconMessages />}
      count={conversations.length}
      pagination={
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
      }
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/30 hover:bg-muted/30">
            <TableHead className="px-6">用户输入</TableHead>
            <TableHead>创建人</TableHead>
            <TableHead>附件</TableHead>
            <TableHead>时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && conversations.length === 0 && (
            <ManagerListEmpty
              colSpan={4}
              title="暂无对话"
              description="团队成员发起对话后，这里会显示输入内容和关联任务。"
            />
          )}
          {conversations.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="px-6">
                <div className="max-w-[560px] space-y-1">
                  <div className="truncate font-medium">
                    {item.content || "-"}
                  </div>
                  <div className="truncate text-xs leading-4 text-muted-foreground">
                    {item.task_title || item.task_id || "未关联任务"}
                    {item.project_name ? ` · ${item.project_name}` : ""}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-[180px] truncate text-sm">
                  {creatorName(item)}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={item.attachment_count ? "secondary" : "outline"}>
                  {item.attachment_count || 0}
                </Badge>
              </TableCell>
              <TableCell>{formatTime(item.created_at)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ManagerListCard>
  )
}
