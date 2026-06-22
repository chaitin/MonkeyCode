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
import { useTranslation } from "react-i18next"

function formatTime(value: number | undefined, language: string) {
  if (!value) return "-"
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return new Date(value * 1000).toLocaleString(locale, { hour12: false }).replace(/\//g, "-")
}

function creatorName(project: DomainTeamProjectItem) {
  return project.creator?.name || project.creator?.email || "-"
}

export default function TeamManagerProjects() {
  const { i18n, t } = useTranslation()
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
        toast.error(resp.message || t("managerProjects.toast.fetchFailed"))
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
    return <ManagerListLoading title={t("managerProjects.loading")} />
  }

  return (
    <ManagerListCard
      title={t("managerProjects.title")}
      description={t("managerProjects.description")}
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
            <TableHead className="px-6">{t("managerProjects.columns.project")}</TableHead>
            <TableHead>{t("managerProjects.columns.creator")}</TableHead>
            <TableHead className="text-right">{t("managerProjects.columns.tasks")}</TableHead>
            <TableHead className="text-right">{t("managerProjects.columns.issues")}</TableHead>
            <TableHead>{t("managerProjects.columns.updatedAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && projects.length === 0 && (
            <ManagerListEmpty
              colSpan={5}
              title={t("managerProjects.empty.title")}
              description={t("managerProjects.empty.description")}
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
                    {project.repo_url || t("managerProjects.fallback.noRepo")}
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
                  <div className="text-sm">{formatTime(project.updated_at, i18n.language)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">
                    {t("managerProjects.createdAt", { time: formatTime(project.created_at, i18n.language) })}
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
