import { useEffect, useState } from "react"
import { FolderGit2 } from "lucide-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamProjectItem } from "@/api/Api"
import { TeamDataTablePagination } from "@/components/manager/team-data-table-pagination"
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

export default function TeamManagerProjects() {
  const [projects, setProjects] = useState<DomainTeamProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pageSize, setPageSize] = useState(20)
  const [currentCursor, setCurrentCursor] = useState<string | undefined>()
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [hasNextPage, setHasNextPage] = useState(false)
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([undefined])

  const fetchProjects = async (cursor?: string, limit = pageSize) => {
    setLoading(true)
    setCurrentCursor(cursor)
    await apiRequest("v1TeamsProjectsList", { cursor, limit }, [], (resp) => {
      if (resp.code === 0) {
        const page = resp.data?.page as Dbv2Cursor | undefined
        setProjects(resp.data?.projects || [])
        setNextCursor(page?.cursor)
        setHasNextPage(!!page?.has_next_page)
      } else {
        toast.error(resp.message || "获取项目列表失败")
      }
    })
    setLoading(false)
  }

  useEffect(() => {
    fetchProjects()
  }, [])

  const goFirst = () => {
    setCursorHistory([undefined])
    fetchProjects(undefined)
  }

  const goPrev = () => {
    if (cursorHistory.length <= 1) return
    const nextHistory = [...cursorHistory]
    nextHistory.pop()
    const prev = nextHistory[nextHistory.length - 1]
    setCursorHistory(nextHistory)
    fetchProjects(prev)
  }

  const goNext = () => {
    if (!nextCursor || !hasNextPage) return
    setCursorHistory((prev) => [...prev, currentCursor])
    fetchProjects(nextCursor)
  }

  const changePageSize = (size: number) => {
    setPageSize(size)
    setCursorHistory([undefined])
    fetchProjects(undefined, size)
  }

  if (loading && projects.length === 0) {
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
        <FolderGit2 className="size-5" />
        <h1 className="text-xl font-semibold">项目</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead>仓库</TableHead>
              <TableHead>创建人</TableHead>
              <TableHead>任务</TableHead>
              <TableHead>需求</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>更新时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-3.5 text-center">
                  无数据
                </TableCell>
              </TableRow>
            )}
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="font-medium">{project.name || "-"}</TableCell>
                <TableCell className="max-w-[360px] truncate">{project.repo_url || "-"}</TableCell>
                <TableCell>{project.creator?.name || project.creator?.email || "-"}</TableCell>
                <TableCell>{project.task_count || 0}</TableCell>
                <TableCell>{project.issue_count || 0}</TableCell>
                <TableCell>{formatTime(project.created_at)}</TableCell>
                <TableCell>{formatTime(project.updated_at)}</TableCell>
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
