import { useEffect, useState } from "react"
import { IconListCheck } from "@tabler/icons-react"
import { toast } from "sonner"

import type { Dbv2Cursor, GithubComChaitinMonkeyCodeBackendDomainTeamTaskItem as DomainTeamTaskItem } from "@/api/Api"
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
import { useTranslation } from "react-i18next"

type Translate = (key: string) => string

function formatTime(value: number | undefined, language: string) {
  if (!value) return "-"
  const locale = language === "cn" ? "zh-CN" : "en-US"
  return new Date(value * 1000).toLocaleString(locale, { hour12: false }).replace(/\//g, "-")
}

function taskTitle(task: DomainTeamTaskItem, t: Translate) {
  return task.title || task.content || t("managerTasks.fallback.unnamedTask")
}

function creatorName(task: DomainTeamTaskItem) {
  return task.creator?.name || task.creator?.email || "-"
}

function taskStatusMeta(status: string | undefined, t: Translate) {
  switch (status) {
    case "pending":
      return {
        label: t("managerTasks.status.pending"),
        className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
      }
    case "processing":
      return {
        label: t("managerTasks.status.processing"),
        className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
      }
    case "finished":
      return {
        label: t("managerTasks.status.finished"),
        className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
      }
    case "error":
      return {
        label: t("managerTasks.status.error"),
        className: "border-destructive/20 bg-destructive/10 text-destructive",
      }
    default:
      return {
        label: status || "-",
        className: "text-muted-foreground",
      }
  }
}

function taskKindText(kind: string | undefined, t: Translate) {
  switch (kind) {
    case "develop":
      return t("managerTasks.kind.develop")
    case "design":
      return t("managerTasks.kind.design")
    case "review":
      return t("managerTasks.kind.review")
    case "generate_docs":
      return t("managerTasks.kind.generateDocs")
    case "generate_requirement":
      return t("managerTasks.kind.generateRequirement")
    case "generate_design":
      return t("managerTasks.kind.generateDesign")
    case "generate_tasklist":
      return t("managerTasks.kind.generateTasklist")
    case "execute_task":
      return t("managerTasks.kind.executeTask")
    case "pr_review":
      return t("managerTasks.kind.prReview")
    default:
      return kind || "-"
  }
}

function TaskStatusBadge({ status, t }: { status?: string; t: Translate }) {
  const meta = taskStatusMeta(status, t)

  return (
    <Badge variant="outline" className={cn(meta.className)}>
      {meta.label}
    </Badge>
  )
}

export default function TeamManagerTasks() {
  const { i18n, t } = useTranslation()
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
        toast.error(resp.message || t("managerTasks.toast.fetchFailed"))
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
    return <ManagerListLoading title={t("managerTasks.loading")} />
  }

  return (
    <ManagerListCard
      title={t("managerTasks.title")}
      description={t("managerTasks.description")}
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
            <TableHead className="px-6">{t("managerTasks.columns.task")}</TableHead>
            <TableHead>{t("managerTasks.columns.status")}</TableHead>
            <TableHead>{t("managerTasks.columns.kind")}</TableHead>
            <TableHead>{t("managerTasks.columns.creator")}</TableHead>
            <TableHead>{t("managerTasks.columns.lastActive")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && tasks.length === 0 && (
            <ManagerListEmpty
              colSpan={5}
              title={t("managerTasks.empty.title")}
              description={t("managerTasks.empty.description")}
            />
          )}
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="px-6">
                <div className="max-w-[520px] space-y-1">
                  <div className="truncate font-medium">{taskTitle(task, t)}</div>
                  <div className="truncate text-xs leading-4 text-muted-foreground">
                    {task.project_name || t("managerTasks.fallback.unlinkedProject")}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <TaskStatusBadge status={task.status} t={t} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {taskKindText(task.kind, t)}
              </TableCell>
              <TableCell>
                <div className="max-w-[180px] truncate text-sm">
                  {creatorName(task)}
                </div>
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <div className="text-sm">{formatTime(task.last_active_at, i18n.language)}</div>
                  <div className="text-xs leading-4 text-muted-foreground">
                    {t("managerTasks.createdAt", { time: formatTime(task.created_at, i18n.language) })}
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
