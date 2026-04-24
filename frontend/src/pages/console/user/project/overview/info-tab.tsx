import { useEffect, useRef, useState } from "react"
import { ProjectFileManager } from "@/components/console/project/files"
import { Markdown } from "@/components/common/markdown"
import { type DomainBranch, type DomainProject } from "@/api/Api"
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
  const [readmeRef, setReadmeRef] = useState<string>("")
  const [readmeRefProjectId, setReadmeRefProjectId] = useState<string>("")
  const [readmeRefResolved, setReadmeRefResolved] = useState(false)
  const [readmeLoaded, setReadmeLoaded] = useState(false)
  const readmeRefValueRef = useRef(readmeRef)
  readmeRefValueRef.current = readmeRef

  useEffect(() => {
    if (!project?.id || !project?.git_identity_id || !project?.full_name) {
      setReadmeRef("")
      setReadmeRefProjectId(project?.id || "")
      setReadmeRefResolved(true)
      return
    }

    const requestedProjectId = project.id
    const encodedRepoName = encodeURIComponent(project.full_name)
    setReadmeRefProjectId("")
    setReadmeRefResolved(false)

    apiRequest(
      "v1UsersGitIdentitiesBranchesDetail",
      {},
      [project.git_identity_id, encodedRepoName],
      (resp) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (resp.code !== 0 || !resp.data?.length) {
          setReadmeRef("")
          setReadmeRefProjectId(requestedProjectId)
          setReadmeRefResolved(true)
          return
        }

        const branchNames = resp.data.map((b: DomainBranch) => b.name || "").filter(Boolean)
        if (branchNames.includes("main")) {
          setReadmeRef("main")
        } else if (branchNames.includes("master")) {
          setReadmeRef("master")
        } else {
          setReadmeRef(branchNames.sort()[0] || "")
        }
        setReadmeRefProjectId(requestedProjectId)
        setReadmeRefResolved(true)
      },
      () => {
        if (projectIdRef.current !== requestedProjectId) return
        setReadmeRef("")
        setReadmeRefProjectId(requestedProjectId)
        setReadmeRefResolved(true)
      },
    )
  }, [project?.git_identity_id, project?.full_name, project?.id])

  useEffect(() => {
    if (!project?.id) {
      setReadmeContent("")
      setReadmePath("")
      setReadmeLoaded(true)
      return
    }
    if (!readmeRefResolved) return
    if (readmeRefProjectId !== project.id) return

    const requestedProjectId = project.id
    const requestedReadmeRef = readmeRef
    setReadmeLoaded(false)
    const query = { recursive: false, path: "", ref: readmeRef || undefined }
    apiRequest("v1UsersProjectsTreeDetail", query, [project.id], (resp) => {
      if (projectIdRef.current !== requestedProjectId) return
      if (readmeRefValueRef.current !== requestedReadmeRef) return
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
      apiRequest("v1UsersProjectsTreeBlobDetail", { path: readmePathVal, ref: readmeRef || undefined }, [project.id as string], (r) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (readmeRefValueRef.current !== requestedReadmeRef) return
        if (r.code === 0 && r.data?.content) {
          setReadmeContent(b64decode(r.data.content))
          setReadmePath(readmePathVal)
          window.scrollTo(0, 0)
        }
        setReadmeLoaded(true)
      })
    })
  }, [project?.id, project?.git_identity_id, project?.full_name, readmeRef, readmeRefProjectId, readmeRefResolved])

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
    <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-auto">
      <ProjectFileManager key={`files-${projectId}`} project={project} className="w-full" />
      {renderReadme()}
    </div>
  )
}
