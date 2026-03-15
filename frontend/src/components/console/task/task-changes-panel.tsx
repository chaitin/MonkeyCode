import { useState } from "react"
import type { RepoFileChange, TaskWebSocketManager } from "./ws-manager"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { IconCloudOff, IconFileDiff, IconLoader, IconReport } from "@tabler/icons-react"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"
import { cn } from "@/lib/utils"

interface TaskChangesPanelProps {
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskWebSocketManager | null
  disabled?: boolean
}

export function TaskChangesPanel({ fileChanges, fileChangesMap, taskManager, disabled }: TaskChangesPanelProps) {
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

  if (disabled) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <div className="text-sm font-medium text-foreground mb-3 shrink-0">文件变更</div>
        <div className="flex-1 min-h-0 flex flex-col">
          <Empty className="border border-dashed w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconCloudOff className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                开发环境未就绪，无法查看变更
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    )
  }

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
        <div className="h-full overflow-auto" style={{ "--diff-font-family": "var(--font-google-sans-code)" } as React.CSSProperties}>
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

  const fileListContent = (
    <div className={cn("flex-1 min-h-0", sortedPaths.length === 0 ? "flex flex-col" : "overflow-y-auto")}>
      {sortedPaths.length === 0 ? (
        <Empty className="border border-dashed w-full flex-1 min-h-0">
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
            const additions = change?.additions ?? 0
            const deletions = change?.deletions ?? 0
            const isSelected = selectedFile === path
            return (
              <Item variant="outline" size="sm" key={path} className={cn("group hover:border-primary/50", isSelected && "border-primary bg-primary/5")}>
                <ItemContent className="flex flex-row items-center justify-between gap-2">
                  <ItemTitle
                    className={cn(
                      "truncate font-mono text-xs cursor-pointer transition-colors hover:text-primary min-w-0 flex-1",
                      isSelected && "text-primary"
                    )}
                    onClick={() => handlePathClick(path)}
                  >
                    {path}
                  </ItemTitle>
                  <div className="flex items-center gap-1 shrink-0 tabular-nums text-xs">
                    {additions > 0 && (
                      <span className="text-green-700 dark:text-green-400">+{additions}</span>
                    )}
                    {deletions > 0 && (
                      <span className="text-red-700 dark:text-red-400">-{deletions}</span>
                    )}
                  </div>
                </ItemContent>
              </Item>
            )
          })}
        </ItemGroup>
      )}
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="text-sm font-medium text-foreground mb-3 shrink-0">文件变更</div>
      {selectedFile ? (
        <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 gap-4">
          <ResizablePanel defaultSize={40} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
            {fileListContent}
          </ResizablePanel>
          <ResizableHandle withHandle className="shrink-0" />
          <ResizablePanel defaultSize={60} minSize={30} className="min-h-0 flex flex-col overflow-hidden">
            {renderDiffContent()}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{fileListContent}</div>
      )}
    </div>
  )
}
