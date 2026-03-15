import { useEffect, useRef, useState } from "react"
import { ProjectFileManager } from "@/components/console/project/files"
import { Markdown } from "@/components/common/markdown"
import { type DomainProject } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { IconFileText, IconLoader } from "@tabler/icons-react"
import { cn } from "@/lib/utils"

interface ProjectOverviewInfoTabProps {
  projectId: string
  project?: DomainProject
}

export default function ProjectOverviewInfoTab({ projectId, project }: ProjectOverviewInfoTabProps) {
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const [readmeContent, setReadmeContent] = useState<string>("")
  const [readmePath, setReadmePath] = useState<string>("")
  const [readmeLoaded, setReadmeLoaded] = useState(false)

  useEffect(() => {
    if (!project?.id) {
      setReadmeContent("")
      setReadmePath("")
      setReadmeLoaded(true)
      return
    }
    const requestedProjectId = project.id
    setReadmeLoaded(false)
    apiRequest("v1UsersProjectsTreeDetail", { recursive: false, path: "" }, [project.id], (resp) => {
      if (projectIdRef.current !== requestedProjectId) return
      if (resp.code !== 0 || !resp.data) {
        setReadmeLoaded(true)
        return
      }
      const readme = (resp.data as { name?: string; path?: string }[]).find(
        (e) => e.name?.toLowerCase() === "readme.md"
      )
      const readmePathVal = readme?.path
      if (!readme || !readmePathVal) {
        setReadmeContent("")
        setReadmePath("")
        setReadmeLoaded(true)
        return
      }
      apiRequest("v1UsersProjectsTreeBlobDetail", { path: readmePathVal }, [project.id as string], (r) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (r.code === 0 && r.data?.content) {
          setReadmeContent(b64decode(r.data.content))
          setReadmePath(readmePathVal)
          window.scrollTo(0, 0)
        }
        setReadmeLoaded(true)
      })
    })
  }, [project?.id])

  const ReadmeHeader = (
    <div className="px-4 py-2 flex items-center border-b bg-muted/50">
      <Label className="flex items-center h-6">
        <IconFileText className="size-4" />
        {readmePath || "README"}
      </Label>
    </div>
  )

  const renderReadme = () => {
    if (!readmeLoaded) {
      return (
        <div className={cn("flex flex-col border rounded-md w-full max-w-full")}>
          {ReadmeHeader}
          <Empty className="opacity-50">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconLoader className="animate-spin" />
              </EmptyMedia>
              <EmptyDescription>正在加载...</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )
    }
    if (!readmeContent) {
      return (
        <div className={cn("flex flex-col border rounded-md w-full max-w-full")}>
          {ReadmeHeader}
          <Empty className="opacity-50">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFileText />
              </EmptyMedia>
              <EmptyDescription>暂无文档</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )
    }
    return (
      <div className={cn("flex flex-1 flex-col border rounded-md w-full max-w-full")}>
        {ReadmeHeader}
        <div className="p-4">
          <Markdown>{readmeContent}</Markdown>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ProjectFileManager key={`files-${projectId}`} project={project} className="w-full" />
      {renderReadme()}
    </div>
  )
}
