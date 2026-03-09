import { useState, useCallback, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { cn } from "@/lib/utils"
import { IconFileText } from "@tabler/icons-react"
import { b64decode } from "@/utils/common"
import { Markdown } from "@/components/common/markdown"
import { Label } from "@/components/ui/label"
import { type DomainProject } from "@/api/Api"

interface DocsViewerProps {
  project?: DomainProject
  ref?: string
  docPath?: string
  candidatePaths?: string[]
  className?: string
}

export const DocsViewer = ({ project, ref: gitRef, docPath, candidatePaths, className }: DocsViewerProps) => {
  const [content, setContent] = useState<string>('')
  const [resolvedPath, setResolvedPath] = useState<string>('')

  const fetchWithCandidates = useCallback(async () => {
    if (!project?.id) {
      setContent('')
      setResolvedPath('')
      return
    }

    const paths = candidatePaths && candidatePaths.length > 0
      ? candidatePaths
      : docPath ? [docPath] : []

    if (paths.length === 0) {
      setContent('')
      setResolvedPath('')
      return
    }

    for (const path of paths) {
      let found = false
      await apiRequest('v1UsersProjectsTreeBlobDetail', {
        path,
        ref: gitRef
      }, [project.id], (resp) => {
        if (resp.code === 0 && resp.data?.content) {
          setContent(b64decode(resp.data.content))
          setResolvedPath(path)
          found = true
        }
      })
      if (found) {
        window.scrollTo(0, 0)
        return
      }
    }

    setContent('')
    setResolvedPath('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, docPath, gitRef])

  useEffect(() => {
    fetchWithCandidates()
  }, [fetchWithCandidates])

  const displayPath = resolvedPath || docPath || ''

  const renderHeader = () => {
    return (
      <div className="px-4 py-2 flex items-center border-b bg-muted/50">
        <Label className="flex items-center h-6">
          <IconFileText className="size-4" />
          {displayPath}
        </Label>
      </div>
    )
  }

  if (!content) {
    return null
  }

  return (
    <div className={cn("flex flex-1 flex-col border rounded-md", className)}>
      {renderHeader()}
      <div className="p-4">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  )
}

export default DocsViewer
