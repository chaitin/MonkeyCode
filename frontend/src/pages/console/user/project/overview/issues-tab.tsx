import { useCallback, useEffect, useState } from "react"
import { type DomainProject, type DomainProjectIssue } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IconPlus } from "@tabler/icons-react"
import ProjectIssueList from "@/components/console/project/issue-list"
import ViewIssueDialog from "@/components/console/project/issue-detail"
import CreateIssueDialog from "@/components/console/project/create-issue"

interface ProjectOverviewIssuesTabProps {
  projectId: string
  project?: DomainProject
}

export default function ProjectOverviewIssuesTab({ projectId, project }: ProjectOverviewIssuesTabProps) {
  const [issues, setIssues] = useState<DomainProjectIssue[]>([])
  const [isCreateIssueDialogOpen, setIsCreateIssueDialogOpen] = useState(false)
  const [viewingIssue, setViewingIssue] = useState<DomainProjectIssue | undefined>(undefined)
  const [viewIssueDialogOpen, setViewIssueDialogOpen] = useState(false)

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
      <div className="flex flex-row gap-2">
        <h2 className="text-lg font-semibold flex-1">项目需求列表</h2>
        <Button variant="default" size="sm" onClick={() => setIsCreateIssueDialogOpen(true)}>
          <IconPlus />
          创建需求
        </Button>
      </div>
      <ProjectIssueList
        issues={issues}
        projectId={projectId}
        project={project}
        onViewIssue={handleViewIssue}
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
      />
    </div>
  )
}
