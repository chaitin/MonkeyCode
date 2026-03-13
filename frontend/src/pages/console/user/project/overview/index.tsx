import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import ProjectInfo from "@/components/console/project/project-info"
import { type DomainProject } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { isProjectRepoUnbound } from "@/utils/project"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { IconAlertCircle } from "@tabler/icons-react"
import ProjectOverviewInfoTab from "./info-tab"
import ProjectOverviewIssuesTab from "./issues-tab"
import ProjectOverviewTasksTab from "./tasks-tab"

export default function ProjectOverviewPage() {
  const { projectId = "" } = useParams<{ projectId: string }>()
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const [project, setProject] = useState<DomainProject | undefined>(undefined)

  const fetchProject = async () => {
    const requestedId = projectId
    await apiRequest("v1UsersProjectsDetail", {}, [requestedId], (resp) => {
      if (projectIdRef.current !== requestedId) return
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || "获取项目失败")
      }
    })
  }

  useEffect(() => {
    if (projectId) {
      setProject(undefined)
      fetchProject()
    }
  }, [projectId])

  const isRepoUnbound = isProjectRepoUnbound(project)

  if (projectId && project && isRepoUnbound) {
    return (
      <Empty className="bg-muted flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertCircle className="size-6" />
          </EmptyMedia>
          <EmptyTitle>项目异常</EmptyTitle>
          <EmptyDescription>这个项目没有绑定仓库</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full w-full min-h-0">
      <ProjectInfo project={project} onRefresh={fetchProject} />
      <Tabs defaultValue="info" className="w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        <TabsList>
          <TabsTrigger value="info">信息</TabsTrigger>
          <TabsTrigger value="issues">需求</TabsTrigger>
          <TabsTrigger value="tasks">任务</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-2 flex flex-col gap-4">
          <ProjectOverviewInfoTab projectId={projectId} project={project} />
        </TabsContent>
        <TabsContent value="issues" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewIssuesTab projectId={projectId} project={project} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewTasksTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
