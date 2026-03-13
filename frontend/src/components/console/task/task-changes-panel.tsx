import { useState } from "react"
import type { RepoFileChange, TaskWebSocketManager } from "./ws-manager"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item"
import { IconFileDiff, IconLoader, IconReport } from "@tabler/icons-react"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"
import { cn } from "@/lib/utils"

interface TaskChangesPanelProps {
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskWebSocketManager | null
}

function getStatusLabel(status?: string): string {
  switch (status) {
    case "A":
      return "新增"
    case "D":
      return "删除"
    case "M":
      return "修改"
    case "R":
      return "重命名"
    case "RM":
      return "删除"
    default:
      return "变更"
  }
}

export function TaskChangesPanel({ fileChanges, fileChangesMap, taskManager }: TaskChangesPanelProps) {
  const sortedPaths = [...fileChanges].sort((a, b) => a.localeCompare(b))
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>("")
  const [loading, setLoading] = useState(false)

  const handlePathClick = async (path: string) => {
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

  const diffFiles = diffContent ? parseDiff(diffContent) : []

  const renderDiffContent = () => {
    if (!selectedFile) return null
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500">
          <IconLoader className="size-5 animate-spin mb-2" />
          <span className="text-xs">加载中...</span>
        </div>
      )
    }
    if (diffFiles.length > 0 && diffFiles.some((file) => file.hunks?.length)) {
      return (
        <div className="h-full overflow-auto p-2" style={{ "--diff-font-family": "var(--font-google-sans-code)" } as React.CSSProperties}>
          <style>{`
            .task-changes-diff .diff-line td:nth-child(2) {
              border-left: 1px var(--border) solid;
            }
          `}</style>
          <div className="text-xs border rounded-md overflow-x-auto bg-muted/30">
            {diffFiles.map((file, index) => (
              <Diff key={index} viewType="split" diffType={file.type} hunks={file.hunks} gutterType="none" hunkClassName="task-changes-diff">
                {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
              </Diff>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500">
        <IconReport className="size-5 mr-1 mb-1" />
        <span className="text-xs">无内容</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={cn("min-h-0 flex flex-col overflow-hidden p-4", selectedFile ? "h-1/2 border-b" : "flex-1")}>
        <div className="text-sm font-medium text-foreground mb-3 shrink-0">文件变更</div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {sortedPaths.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconFileDiff className="size-6" />
                </EmptyMedia>
                <EmptyDescription>暂无文件变更</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {sortedPaths.map((path) => {
                const change = fileChangesMap.get(path)
                const status = getStatusLabel(change?.status)
                const additions = change?.additions ?? 0
                const deletions = change?.deletions ?? 0
                const isSelected = selectedFile === path
                return (
                  <Item variant="outline" size="sm" key={path} className={cn("group hover:border-primary/50", isSelected && "border-primary bg-primary/5")}>
                    <ItemContent>
                      <ItemTitle
                        className={cn(
                          "truncate font-mono text-xs cursor-pointer transition-colors hover:text-primary",
                          isSelected && "text-primary"
                        )}
                        onClick={() => handlePathClick(path)}
                      >
                        {path}
                      </ItemTitle>
                      <ItemDescription className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-xs font-normal">
                          {status}
                        </Badge>
                        <div className="flex items-center gap-1 shrink-0">
                          {additions > 0 && (
                            <Badge variant="outline" className="text-xs font-normal tabular-nums text-green-700 dark:text-green-400">
                              增加 {additions} 行
                            </Badge>
                          )}
                          {deletions > 0 && (
                            <Badge variant="outline" className="text-xs font-normal tabular-nums text-red-700 dark:text-red-400">
                              删除 {deletions} 行
                            </Badge>
                          )}
                        </div>
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )
              })}
            </ItemGroup>
          )}
        </div>
      </div>
      {selectedFile && (
        <div className="h-1/2 min-h-0 flex flex-col overflow-hidden">
          {renderDiffContent()}
        </div>
      )}
    </div>
  )
}
