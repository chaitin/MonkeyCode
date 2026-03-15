import { useState } from "react"
import { Button } from "@/components/ui/button"
import { IconLoader, IconReport } from "@tabler/icons-react"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"
import type { RepoFileChange, TaskWebSocketManager } from "./ws-manager"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"

interface TaskFileChangesPanelProps {
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskWebSocketManager | null
  onSubmit: (selectedFiles: string[]) => void
  disabled?: boolean
}

export function TaskFileChangesPanel({
  fileChanges,
  fileChangesMap,
  taskManager,
  onSubmit,
  disabled,
}: TaskFileChangesPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set())

  const handleCheckboxChange = (path: string, checked: boolean) => {
    setCheckedFiles((prev) => {
      const newSet = new Set(prev)
      if (checked) newSet.add(path)
      else newSet.delete(path)
      return newSet
    })
  }

  const handleSubmitSelected = () => {
    onSubmit(Array.from(checkedFiles))
  }

  const handleSubmitAll = () => {
    onSubmit(fileChanges)
  }

  const handleFileClick = async (path: string) => {
    if (selectedFile === path) {
      setSelectedFile(null)
      setDiffContent("")
      return
    }
    setSelectedFile(path)
    setLoading(true)
    setDiffContent("")
    const diff = await taskManager?.getFileDiff(path)
    setDiffContent(diff || "")
    setLoading(false)
  }

  const files = diffContent ? parseDiff(diffContent) : []

  const renderStatusBadge = (change?: RepoFileChange) => {
    if (!change) return null
    switch (change.status) {
      case "A":
        return <Badge variant="outline">新增</Badge>
      case "D":
        return <Badge variant="outline">删除</Badge>
      case "M":
        return <Badge variant="outline">修改</Badge>
      case "R":
        return <Badge variant="outline">移动</Badge>
      case "RM":
        return <Badge variant="outline">删除</Badge>
      default:
        return <Badge variant="outline">新增</Badge>
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/50 shrink-0">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">以下修改尚未提交</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSubmitSelected} disabled={disabled || checkedFiles.size === 0}>
            提交选中 ({checkedFiles.size})
          </Button>
          <Button size="sm" className="h-6 text-xs" onClick={handleSubmitAll} disabled={disabled}>
            全部提交
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {fileChanges.map((path) => {
          const change = fileChangesMap.get(path)
          const isSelected = selectedFile === path
          return (
            <div key={path}>
              <div
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs border cursor-pointer transition-colors",
                  isSelected ? "text-primary border-primary bg-primary/5" : "hover:border-slate-300 dark:hover:border-slate-600"
                )}
              >
                <Checkbox
                  checked={checkedFiles.has(path)}
                  onCheckedChange={(checked) => handleCheckboxChange(path, checked as boolean)}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className="truncate flex-1 min-w-0" onClick={() => handleFileClick(path)}>
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
                <div className="mt-1" style={{ "--diff-font-family": "var(--font-google-sans-code)" } as React.CSSProperties}>
                  {loading ? (
                    <div className="flex items-center justify-center py-8 text-slate-500">
                      <IconLoader className="size-5 animate-spin" />
                    </div>
                  ) : files.length > 0 && files.some((file) => file.hunks?.length) ? (
                    <div className="text-xs border rounded-md py-1 overflow-x-auto">
                      {files.map((file, index) => (
                        <Diff key={index} viewType="split" diffType={file.type} hunks={file.hunks} gutterType="none" hunkClassName="user-diff-style">
                          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
                        </Diff>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-8 text-slate-500">
                      <IconReport className="size-5 mr-1" />
                      <span className="text-xs">无内容</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
