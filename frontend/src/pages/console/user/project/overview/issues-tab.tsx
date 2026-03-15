import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ConstsProjectIssueStatus,
  type DomainProject,
  type DomainProjectIssue,
} from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IconPlus } from "@tabler/icons-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import ProjectIssueList from "@/components/console/project/issue-list"
import ViewIssueDialog from "@/components/console/project/issue-detail"
import CreateIssueDialog from "@/components/console/project/create-issue"
import { getStatusName } from "@/utils/common"

interface ProjectOverviewIssuesTabProps {
  projectId: string
  project?: DomainProject
  onTaskCreated?: () => void
}

const STATUS_ALL = "__all__"
const PRIORITY_ALL = "__all__"

const STATUS_OPTIONS = [
  { value: STATUS_ALL, label: "全部状态" },
  { value: ConstsProjectIssueStatus.ProjectIssueStatusOpen, label: getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusOpen) },
  { value: ConstsProjectIssueStatus.ProjectIssueStatusCompleted, label: getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusCompleted) },
  { value: ConstsProjectIssueStatus.ProjectIssueStatusClosed, label: getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusClosed) },
]

const PRIORITY_OPTIONS = [
  { value: PRIORITY_ALL, label: "全部优先级" },
  { value: "3", label: "高" },
  { value: "2", label: "中" },
  { value: "1", label: "低" },
]

export default function ProjectOverviewIssuesTab({ projectId, project, onTaskCreated }: ProjectOverviewIssuesTabProps) {
  const [issues, setIssues] = useState<DomainProjectIssue[]>([])
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_ALL)
  const [priorityFilter, setPriorityFilter] = useState<string>(PRIORITY_ALL)
  const [isCreateIssueDialogOpen, setIsCreateIssueDialogOpen] = useState(false)
  const [viewingIssue, setViewingIssue] = useState<DomainProjectIssue | undefined>(undefined)
  const [viewIssueDialogOpen, setViewIssueDialogOpen] = useState(false)

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter !== STATUS_ALL && issue.status !== statusFilter) return false
      if (priorityFilter !== PRIORITY_ALL && issue.priority?.toString() !== priorityFilter) return false
      return true
    })
  }, [issues, statusFilter, priorityFilter])

  const fetchProjectIssues = useCallback(async () => {
    if (!projectId) return
    await apiRequest("v1UsersProjectsIssuesDetail", {}, [projectId], (resp) => {
      if (resp.code === 0) {
        const rawIssues = resp.data?.issues || []
        const sorted = [...rawIssues].sort((a, b) => {
          const getStatusOrder = (s?: string) => (s === "open" ? 1 : s === "completed" ? 2 : s === "closed" ? 3 : 4)
          const d = getStatusOrder(a.status) - getStatusOrder(b.status)
          if (d !== 0) return d
          const pA = a.priority ?? 999
          const pB = b.priority ?? 999
          if (pA !== pB) return pA - pB
          return (b.created_at ?? 0) - (a.created_at ?? 0)
        })
        setIssues(sorted)
      } else {
        toast.error(resp.message || "获取项目需求失败")
      }
    })
  }, [projectId])

  const handleViewIssue = (issue: DomainProjectIssue) => {
    setViewingIssue(issue)
    setViewIssueDialogOpen(true)
  }

  useEffect(() => {
    if (projectId) {
      setIssues([])
      fetchProjectIssues()
    }
  }, [projectId, fetchProjectIssues])

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-row gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue placeholder="全部优先级" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="default" size="sm" className="ml-auto" onClick={() => setIsCreateIssueDialogOpen(true)}>
          <IconPlus />
          创建需求
        </Button>
      </div>
      <ProjectIssueList
        issues={filteredIssues}
        projectId={projectId}
        project={project}
        onViewIssue={handleViewIssue}
        onTaskCreated={onTaskCreated}
      />
      <CreateIssueDialog
        open={isCreateIssueDialogOpen}
        onOpenChange={setIsCreateIssueDialogOpen}
        projectId={projectId}
        onSuccess={fetchProjectIssues}
      />
      <ViewIssueDialog
        open={viewIssueDialogOpen}
        onOpenChange={setViewIssueDialogOpen}
        issue={viewingIssue}
        projectId={projectId}
        project={project}
        onSuccess={fetchProjectIssues}
        onTaskCreated={onTaskCreated}
      />
    </div>
  )
}
