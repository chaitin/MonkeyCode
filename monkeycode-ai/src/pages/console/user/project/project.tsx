import { type DomainProject } from "@/api/Api"
import { DocsViewer } from "@/components/console/project/docs-viewer"
import { ProjectFileManager } from "@/components/console/project/files"
import ProjectInfo from "@/components/console/project/project-info"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { apiRequest } from "@/utils/requestUtils"
import { isProjectRepoUnbound } from "@/utils/project"
import { useCallback, useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { IconAlertCircle } from "@tabler/icons-react"

export default function ProjectPage() {
  const { projectId = '', '*': docPath = '' } = useParams<{ projectId: string; '*': string }>()
  const [project, setProject] = useState<DomainProject | undefined>(undefined)
  const [filesReady, setFilesReady] = useState(false)
  const fetchProject = async () => {
    await apiRequest("v1UsersProjectsDetail", {}, [projectId], (resp) => {
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || "获取项目失败")
      }
    })
  }

  const defaultCandidatePaths = [".monkeycode/docs/INDEX.md", "README.md"]
  const isRepoUnbound = isProjectRepoUnbound(project)

  useEffect(() => {
    if (projectId) {
      setProject(undefined)
      setFilesReady(false)
      fetchProject()
    }
  }, [projectId])

  const handleFilesLoaded = useCallback(() => {
    setFilesReady(true)
  }, [])

  if (project && isRepoUnbound) {
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
    <div className="flex flex-col gap-4 h-full w-full">
      <ProjectInfo project={project} onRefresh={fetchProject} />

      <ProjectFileManager key={`files-${projectId}`} project={project} className="w-full" onLoaded={handleFilesLoaded} />

      {filesReady && (
        <DocsViewer
          key={`docs-${projectId}`}
          project={project}
          docPath={docPath || undefined}
          candidatePaths={docPath ? undefined : defaultCandidatePaths}
          className="w-full max-w-full"
        />
      )}
    </div>
  )
}
