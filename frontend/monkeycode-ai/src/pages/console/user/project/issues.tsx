import { useEffect, useState } from "react";
import { type DomainProjectIssue } from "@/api/Api";
import { apiRequest } from "@/utils/requestUtils";
import { toast } from "sonner";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
import ProjectIssueList from "@/components/console/project/issue-list";
import ViewIssueDialog from "@/components/console/project/issue-detail";
import CreateIssueDialog from "@/components/console/project/create-issue";

export default function ProjectIssuesPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [issues, setIssues] = useState<DomainProjectIssue[]>([])
  const [isCreateIssueDialogOpen, setIsCreateIssueDialogOpen] = useState(false)
  const [viewingIssue, setViewingIssue] = useState<DomainProjectIssue | undefined>(undefined)
  const [viewIssueDialogOpen, setViewIssueDialogOpen] = useState(false)

  const fetchProjectIssues = async () => {
    await apiRequest('v1UsersProjectsIssuesDetail', {}, [projectId], (resp) => {
      if (resp.code === 0) {
        const issues = resp.data?.issues || []
        // 排序：首先按状态（open -> completed -> closed），其次按优先级（1 -> 2 -> 3），最后按修改时间（最新的在前）
        const sortedIssues = [...issues].sort((a, b) => {
          // 1. 首先按状态排序
          const getStatusOrder = (status?: string) => {
            if (status === 'open') return 1
            if (status === 'completed') return 2
            if (status === 'closed') return 3
            return 4 // 其他状态排在最后
          }
          const statusDiff = getStatusOrder(a.status) - getStatusOrder(b.status)
          if (statusDiff !== 0) return statusDiff

          // 2. 其次按优先级排序（1 最高优先级，3 最低优先级）
          const priorityA = a.priority ?? 999 // 没有优先级的排在最后
          const priorityB = b.priority ?? 999
          const priorityDiff = priorityA - priorityB
          if (priorityDiff !== 0) return priorityDiff

          // 3. 最后按修改时间排序（最新的在前，即时间戳大的在前）
          const timeA = a.created_at ?? 0
          const timeB = b.created_at ?? 0
          return timeB - timeA
        })
        setIssues(sortedIssues)
      } else {
        toast.error(resp.message || "获取项目需求失败")
      }
    })
  }

  const handleViewIssue = (issue: DomainProjectIssue) => {
    setViewingIssue(issue)
    setViewIssueDialogOpen(true)
  }

  useEffect(() => {
    if (projectId) {
      fetchProjectIssues()
    }
  }, [projectId])


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
        onSuccess={fetchProjectIssues}
      />
    </div>
  )
}