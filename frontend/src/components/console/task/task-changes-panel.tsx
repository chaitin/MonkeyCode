import { useState } from "react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Item, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Button } from "@/components/ui/button"
import { IconCloudOff, IconFileDiff, IconLoader, IconReload, IconReport, IconX } from "@tabler/icons-react"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"
import { cn } from "@/lib/utils"
import type { RepoFileChange, TaskRepositoryClient } from "./task-shared"

interface TaskChangesPanelProps {
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  taskManager: TaskRepositoryClient | null
  disabled?: boolean
  onRefresh?: () => void
  onClosePanel?: () => void
}

export function TaskChangesPanel({ fileChanges, fileChangesMap, taskManager, disabled, onRefresh, onClosePanel }: TaskChangesPanelProps) {
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
      <div className="flex flex-col h-full min-h-0 rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-1 min-h-11 border-b bg-muted/50 shrink-0">
          <span className="text-sm font-medium">文件变更</span>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={() => onRefresh?.()} disabled={!onRefresh || !!disabled}>
              <IconReload className="size-4" />
            </Button>
            {onClosePanel && (
              <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
                <IconX className="size-4" />
              </Button>
            )}
          </div>
        </div>
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
        <Empty className="w-full flex-1 min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyDescription>加载中...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (diffFiles.length > 0 && diffFiles.some((file) => file.hunks?.length)) {
      return (
        <div className="h-full overflow-auto" style={{ "--diff-font-family": "var(--font-code)" } as React.CSSProperties}>
          <style>{`
            .task-changes-diff .diff-line td:nth-child(2) {
              border-left: 1px var(--border) solid;
            }
          `}</style>
          <div className="text-xs rounded-md overflow-x-auto bg-muted/30">
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
      <Empty className="w-full flex-1 min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconReport className="size-6" />
          </EmptyMedia>
          <EmptyDescription>无内容</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const fileListPanel = (
    <div className="flex flex-col min-h-0 flex-1 rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between gap-2 pl-4 pr-2 py-1 min-h-11 border-b bg-muted/30 shrink-0">
        <span className="text-sm font-medium">变更文件</span>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={() => onRefresh?.()} disabled={!onRefresh}>
            <IconReload className="size-4" />
          </Button>
          {onClosePanel && (
            <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
              <IconX className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <div className={cn("flex-1 min-h-0 py-2 overflow-x-hidden", sortedPaths.length === 0 ? "flex flex-col" : "overflow-y-auto")}>
        {sortedPaths.length === 0 ? (
          <Empty className="w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFileDiff className="size-6" />
              </EmptyMedia>
              <EmptyDescription>暂无文件变更</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2 mx-2">
            {sortedPaths.map((path) => {
              const change = fileChangesMap.get(path)
              const additions = change?.additions ?? 0
              const deletions = change?.deletions ?? 0
              const isSelected = selectedFile === path
              return (
                <Item variant="outline" size="sm" key={path} className={cn("group hover:border-primary/50 py-2", isSelected && "border-primary bg-primary/5")}>
                  <ItemContent className="flex flex-row items-center justify-between gap-2 min-w-0">
                    <ItemTitle
                      className={cn(
                        "truncate font-mono text-xs cursor-pointer transition-colors hover:text-primary min-w-0 flex-1 overflow-hidden",
                        isSelected && "text-primary"
                      )}
                      onClick={() => handlePathClick(path)}
                      title={path}
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
    </div>
  )

  const diffPanel = selectedFile && (
    <div className="flex flex-col min-h-0 flex-1 rounded-lg border overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-2 px-4 py-1 min-h-11 border-b bg-muted/30 shrink-0">
        <span className="text-sm font-medium truncate font-mono flex-1 min-w-0">{selectedFile}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 hover:text-primary"
          onClick={() => {
            setSelectedFile(null)
            setDiffContent("")
          }}
        >
          <IconX className="size-4" />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{renderDiffContent()}</div>
    </div>
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      {selectedFile ? (
        <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 gap-2">
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
            {fileListPanel}
          </ResizablePanel>
          <ResizableHandle withHandle className="shrink-0" />
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
            {diffPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{fileListPanel}</div>
      )}
    </div>
  )
}
