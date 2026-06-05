import { useEffect, useState } from "react"
import { IconListCheck } from "@tabler/icons-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamTaskItem } from "@/api/Api"
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
import { cn } from "@/lib/utils"
import { apiRequest } from "@/utils/requestUtils"

function formatTime(value?: number) {
  if (!value) return "-"
  return new Date(value * 1000).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-")
}

function taskTitle(task: DomainTeamTaskItem) {
  return task.title || task.content || "未命名任务"
}

function creatorName(task: DomainTeamTaskItem) {
  return task.creator?.name || task.creator?.email || "-"
}

function taskStatusMeta(status?: string) {
  switch (status) {
    case "pending":
      return {
        label: "准备中",
        className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
      }
    case "processing":
      return {
        label: "运行中",
        className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
      }
    case "finished":
      return {
        label: "已完成",
        className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
      }
    case "error":
      return {
        label: "失败",
        className: "border-destructive/20 bg-destructive/10 text-destructive",
      }
    default:
      return {
        label: status || "-",
        className: "text-muted-foreground",
      }
  }
}

function taskKindText(kind?: string) {
  switch (kind) {
    case "develop":
      return "开发"
    case "design":
      return "设计"
    case "review":
      return "评审"
    case "generate_docs":
      return "生成文档"
    case "generate_requirement":
      return "生成需求"
    case "generate_design":
      return "生成设计"
    case "generate_tasklist":
      return "生成任务"
    case "execute_task":
      return "执行任务"
    case "pr_review":
      return "PR 评审"
    default:
      return kind || "-"
  }
}

function TaskStatusBadge({ status }: { status?: string }) {
  const meta = taskStatusMeta(status)

  return (
    <Badge variant="outline" className={cn(meta.className)}>
      {meta.label}
    </Badge>
  )
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
    return <ManagerListLoading title="正在加载任务" />
  }

  return (
    <ManagerListCard
      title="任务"
      description="查看团队任务的状态、归属项目、创建人和最后活动时间。"
      icon={<IconListCheck />}
      count={tasks.length}
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
            <TableHead className="px-6">任务</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>创建人</TableHead>
            <TableHead>最后活动</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && tasks.length === 0 && (
            <ManagerListEmpty
              colSpan={5}
              title="暂无任务"
              description="团队成员创建任务后，这里会显示任务状态和活动时间。"
            />
          )}
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="px-6">
                <div className="max-w-[520px] space-y-1">
                  <div className="truncate font-medium">{taskTitle(task)}</div>
                  <div className="truncate text-xs leading-4 text-muted-foreground">
                    {task.project_name || "未关联项目"}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <TaskStatusBadge status={task.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {taskKindText(task.kind)}
              </TableCell>
              <TableCell>
                <div className="max-w-[180px] truncate text-sm">
                  {creatorName(task)}
                </div>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <div className="text-sm">{formatTime(task.last_active_at)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">
                    创建于 {formatTime(task.created_at)}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ManagerListCard>
  )
}
