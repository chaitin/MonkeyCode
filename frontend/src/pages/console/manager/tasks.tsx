import { useEffect, useState } from "react"
import { ListTodo } from "lucide-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamTaskItem } from "@/api/Api"
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

function taskTitle(task: DomainTeamTaskItem) {
  return task.title || task.content || "未命名任务"
}

export default function TeamManagerTasks() {
  const [tasks, setTasks] = useState<DomainTeamTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pageSize, setPageSize] = useState(20)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>()
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasNextPage, setHasNextPage] = useState(false)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined])

  const fetchTasks = async (cursor?: string, limit = pageSize) => {
    setLoading(true)
    setCurrentCursor(cursor)
    await apiRequest("v1TeamsTasksList", { cursor, limit }, [], (resp) => {
      if (resp.code === 0) {
        const page = resp.data?.page as Dbv2Cursor | undefined
        setTasks(resp.data?.tasks || [])
        setNextCursor(page?.cursor)
        setHasNextPage(!!page?.has_next_page)
      } else {
        toast.error(resp.message || "获取任务列表失败")
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  const goFirst = () => {
    setCursorHistory([undefined])
    fetchTasks(undefined)
  }

  const goPrev = () => {
    if (cursorHistory.length <= 1) return
    const nextHistory = [...cursorHistory]
    nextHistory.pop()
    const prev = nextHistory[nextHistory.length - 1]
    setCursorHistory(nextHistory)
    fetchTasks(prev)
  }

  const goNext = () => {
    if (!nextCursor || !hasNextPage) return
    setCursorHistory((prev) => [...prev, currentCursor])
    fetchTasks(nextCursor)
  }

  const changePageSize = (size: number) => {
    setPageSize(size)
    setCursorHistory([undefined])
    fetchTasks(undefined, size)
  }

  if (loading && tasks.length === 0) {
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
        <ListTodo className="size-5" />
        <h1 className="text-xl font-semibold">任务</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead>项目</TableHead>
              <TableHead>创建人</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>最后活动</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && tasks.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-3.5 text-center">
                  无数据
                </TableCell>
              </TableRow>
            )}
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="max-w-[360px] truncate font-medium">{taskTitle(task)}</TableCell>
                <TableCell>{task.project_name || "-"}</TableCell>
                <TableCell>{task.creator?.name || task.creator?.email || "-"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{task.status || "-"}</Badge>
                </TableCell>
                <TableCell>{task.kind || "-"}</TableCell>
                <TableCell>{formatTime(task.created_at)}</TableCell>
                <TableCell>{formatTime(task.last_active_at)}</TableCell>
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
