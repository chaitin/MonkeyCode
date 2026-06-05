import { useEffect, useState } from "react"
import { IconFolder } from "@tabler/icons-react"
import { toast } from "sonner"

import type { Dbv2Cursor, DomainTeamProjectItem } from "@/api/Api"
import {
  ManagerListEmpty,
  ManagerListLoading,
  ManagerListCard,
} from "@/components/manager/manager-list-page"
import { TeamDataTablePagination } from "@/components/manager/team-data-table-pagination"
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

function creatorName(project: DomainTeamProjectItem) {
  return project.creator?.name || project.creator?.email || "-"
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
    return <ManagerListLoading title="正在加载项目" />
  }

  return (
    <ManagerListCard
      title="项目"
      description="查看团队内项目、仓库来源、创建人和任务规模。"
      icon={<IconFolder />}
      count={projects.length}
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
            <TableHead className="px-6">项目</TableHead>
            <TableHead>创建人</TableHead>
            <TableHead className="text-right">任务</TableHead>
            <TableHead className="text-right">需求</TableHead>
            <TableHead>更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && projects.length === 0 && (
            <ManagerListEmpty
              colSpan={5}
              title="暂无项目"
              description="团队创建项目后，这里会显示项目、仓库和任务规模。"
            />
          )}
          {projects.map((project) => (
            <TableRow key={project.id}>
              <TableCell className="px-6">
                <div className="max-w-[480px] space-y-1">
                  <div className="truncate font-medium">
                    {project.name || "-"}
                  </div>
                  <div className="truncate text-xs leading-4 text-muted-foreground">
                    {project.repo_url || "暂无仓库地址"}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-[180px] truncate text-sm">
                  {creatorName(project)}
                </div>
              </TableCell>
              <TableCell className="text-right font-medium">
                {project.task_count || 0}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {project.issue_count || 0}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <div className="text-sm">{formatTime(project.updated_at)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">
                    创建于 {formatTime(project.created_at)}
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
