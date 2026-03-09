import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { IconReport, IconLoader } from "@tabler/icons-react"
import { useState, useEffect } from "react"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"
import type { RepoFileChange, TaskWebSocketManager } from "./ws-manager"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

interface FileChangesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskWebSocketManager | null
  onSubmit: (selectedFiles: string[]) => void
  onCancel: () => void
}

export function FileChangesDialog({
  open,
  onOpenChange,
  fileChanges,
  fileChangesMap,
  taskManager,
  onSubmit,
  onCancel,
}: FileChangesDialogProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())

  // 当 dialog 打开时，清空选中状态
  useEffect(() => {
    if (open) {
      setSelectedFile(null)
      setDiffContent('')
      setCheckedFiles(new Set())
    }
  }, [open])

  const handleCheckboxChange = (path: string, checked: boolean) => {
    setCheckedFiles(prev => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(path)
      } else {
        newSet.delete(path)
      }
      return newSet
    })
  }

  const handleSubmitSelected = () => {
    onSubmit(Array.from(checkedFiles))
    onOpenChange(false)
  }

  const handleSubmitAll = () => {
    onSubmit(fileChanges)
    onOpenChange(false)
  }

  const handleCancel = () => {
    onCancel()
    onOpenChange(false)
  }

  const handleFileClick = async (path: string) => {
    if (selectedFile === path) {
      setSelectedFile(null)
      setDiffContent('')
      return
    }
    
    setSelectedFile(path)
    setLoading(true)
    setDiffContent('')
    
    const diff = await taskManager?.getFileDiff(path)
    setDiffContent(diff || '')
    setLoading(false)
  }

  const files = diffContent ? parseDiff(diffContent) : []

  const renderStatusBadge = (change?: RepoFileChange) => {
    if (!change) {
      return null
    }

    switch (change.status) {
      case 'A':
        return <Badge variant="outline">新增</Badge>
      case 'D':
        return <Badge variant="outline">删除</Badge>
      case 'M':
        return <Badge variant="outline">修改</Badge>
      case 'R':
        return <Badge variant="outline">移动</Badge>
      case 'RM':
        return <Badge variant="outline">删除</Badge>
      default:
        return <Badge variant="outline">新增</Badge>
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[90vw] md:max-w-[80vw] lg:max-w-[70vw] xl:max-w-[60vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            以下修改尚未提交
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 max-w-full overflow-x-hidden max-h-[60vh]">
          {fileChanges.map((path) => {
            const change = fileChangesMap.get(path)
            const isSelected = selectedFile === path

            return (
              <div key={path}>
                <div
                  className={cn("flex items-center gap-2 px-3 py-2 rounded-md text-sm border hover:text-primary hover:border-primary/50", isSelected ? 'text-primary border-primary': '')}
                >
                  <Checkbox
                    checked={checkedFiles.has(path)}
                    onCheckedChange={(checked) => handleCheckboxChange(path, checked as boolean)}
                  />
                  <div 
                    className={cn("truncate flex-1 min-w-0 cursor-pointer", isSelected ? 'text-primary' : '')}
                    onClick={() => handleFileClick(path)}
                  >
                    {path}
                  </div>
                  {renderStatusBadge(change)}
                </div>
                <style>{`
                  .user-diff-style .diff-line td:nth-child(2) {
                    border-left: 1px var(--border) solid;
                  }
                `}</style>

                {isSelected && (
                  <div className="" style={{ '--diff-font-family': 'var(--font-google-sans-code)' } as React.CSSProperties}>
                    {loading ? (
                      <Empty className="border mt-2">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconLoader className="animate-spin" />
                          </EmptyMedia>
                        </EmptyHeader>
                      </Empty>
                    ) : files.length > 0 && files.some(file => file.hunks?.length > 0) ? (
                      <div className="text-xs mt-2 border rounded-md py-1">
                        {files.map((file, index) => (
                          <Diff key={index} viewType="split" diffType={file.type} hunks={file.hunks} gutterType="none" hunkClassName="user-diff-style">
                            {(hunks) => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
                          </Diff>
                        ))}
                      </div>
                    ) : (
                      <Empty className="border mt-2">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <IconReport />
                          </EmptyMedia>
                          <EmptyDescription>无内容</EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            不急
          </Button>
          <Button variant="outline" size="sm" onClick={handleSubmitSelected} disabled={checkedFiles.size === 0}>
            提交选中 ({checkedFiles.size})
          </Button>
          <Button size="sm" onClick={handleSubmitAll}>
            全部提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
