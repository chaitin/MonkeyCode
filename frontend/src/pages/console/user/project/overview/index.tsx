import { useCallback, useEffect, useRef, useState } from "react"
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
import { useTranslation } from "react-i18next"

export default function ProjectOverviewPage() {
  const { t } = useTranslation()
  const { projectId = "" } = useParams<{ projectId: string }>()
  const projectIdRef = useRef(projectId)

  const [project, setProject] = useState<DomainProject | undefined>(undefined)
  const [tasksRefreshKey, setTasksRefreshKey] = useState(0)

  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  const fetchProject = useCallback(async () => {
    const requestedId = projectId
    await apiRequest("v1UsersProjectsDetail", {}, [requestedId], (resp) => {
      if (projectIdRef.current !== requestedId) return
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || t("projectOverview.toast.fetchProjectFailed"))
      }
    })
  }, [projectId, t])

  useEffect(() => {
    if (!projectId) {
      return
    }

    let active = true
    queueMicrotask(() => {
      if (!active) {
        return
      }
      setProject(undefined)
      fetchProject()
    })

    return () => {
      active = false
    }
  }, [fetchProject, projectId])

  const isRepoUnbound = isProjectRepoUnbound(project)

  if (projectId && project && isRepoUnbound) {
    return (
      <Empty className="bg-muted flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertCircle className="size-6" />
          </EmptyMedia>
          <EmptyTitle>{t("projectOverview.unbound.title")}</EmptyTitle>
          <EmptyDescription>{t("projectOverview.unbound.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full w-full min-h-0">
      <ProjectInfo project={project} onRefresh={fetchProject} />
      <Tabs defaultValue="info" className="w-full flex-1 min-h-0 flex flex-col overflow-hidden">
        <TabsList>
          <TabsTrigger value="info">{t("projectOverview.tabs.info")}</TabsTrigger>
          <TabsTrigger value="issues">{t("projectOverview.tabs.issues")}</TabsTrigger>
          <TabsTrigger value="tasks">{t("projectOverview.tabs.tasks")}</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-2 flex-1 min-h-0 flex flex-col overflow-hidden">
          <ProjectOverviewInfoTab projectId={projectId} project={project} />
        </TabsContent>
        <TabsContent value="issues" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewIssuesTab projectId={projectId} project={project} onTaskCreated={() => setTasksRefreshKey((k) => k + 1)} />
        </TabsContent>
        <TabsContent value="tasks" className="mt-2 flex-1 min-h-0 flex flex-col">
          <ProjectOverviewTasksTab projectId={projectId} refreshKey={tasksRefreshKey} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
