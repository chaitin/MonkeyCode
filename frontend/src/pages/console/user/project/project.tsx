import { type DomainProject } from "@/api/Api"
import { Markdown } from "@/components/common/markdown"
import { ProjectFileManager } from "@/components/console/project/files"
import ProjectInfo from "@/components/console/project/project-info"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { apiRequest } from "@/utils/requestUtils"
import { b64decode } from "@/utils/common"
import { cn } from "@/lib/utils"
import { isProjectRepoUnbound } from "@/utils/project"
import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { toast } from "sonner"
import { IconAlertCircle, IconFileText, IconLoader } from "@tabler/icons-react"

export default function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const [project, setProject] = useState<DomainProject | undefined>(undefined)
  const [readmeContent, setReadmeContent] = useState<string>('')
  const [readmePath, setReadmePath] = useState<string>('')
  const [readmeLoaded, setReadmeLoaded] = useState(false)

  const fetchProject = async () => {
    const requestedId = projectId
    await apiRequest("v1UsersProjectsDetail", {}, [requestedId], (resp) => {
      // 忽略过期响应：切换 project 后，旧请求可能晚于新请求返回
      if (projectIdRef.current !== requestedId) return
      if (resp.code === 0) {
        setProject(resp.data)
      } else {
        toast.error(resp.message || "获取项目失败")
      }
    })
  }

  const isRepoUnbound = isProjectRepoUnbound(project)

  useEffect(() => {
    if (projectId) {
      setProject(undefined)
      setReadmeContent('')
      setReadmePath('')
      setReadmeLoaded(false)
      fetchProject()
    }
  }, [projectId])

  // 读取根目录文件列表，找到 readme.md（忽略大小写）后拉取内容
  useEffect(() => {
    if (!project?.id) {
      setReadmeContent('')
      setReadmePath('')
      setReadmeLoaded(true)
      return
    }

    const requestedProjectId = project.id
    setReadmeLoaded(false)
    apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: ''
    }, [project.id], (resp) => {
      if (projectIdRef.current !== requestedProjectId) return
      if (resp.code !== 0 || !resp.data) {
        setReadmeLoaded(true)
        return
      }
      const readme = (resp.data as { name?: string; path?: string }[]).find(
        (e) => e.name?.toLowerCase() === 'readme.md'
      )
      const readmePathVal = readme?.path
      if (!readme || !readmePathVal) {
        setReadmeContent('')
        setReadmePath('')
        setReadmeLoaded(true)
        return
      }
      const pathToFetch = readmePathVal as string
      apiRequest('v1UsersProjectsTreeBlobDetail', { path: pathToFetch }, [project.id as string], (r) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (r.code === 0 && r.data?.content) {
          setReadmeContent(b64decode(r.data.content))
          setReadmePath(pathToFetch)
          window.scrollTo(0, 0)
        }
        setReadmeLoaded(true)
      })
    })
  }, [project?.id])

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

  const ReadmeHeader = (
    <div className="px-4 py-2 flex items-center border-b bg-muted/50">
      <Label className="flex items-center h-6">
        <IconFileText className="size-4" />
        {readmePath || 'README'}
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
    <div className="flex flex-col gap-4 h-full w-full">
      <ProjectInfo project={project} onRefresh={fetchProject} />

      <ProjectFileManager key={`files-${projectId}`} project={project} className="w-full" />

      {renderReadme()}
    </div>
  )
}
