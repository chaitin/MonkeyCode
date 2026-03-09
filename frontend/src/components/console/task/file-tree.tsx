import { useState, useEffect, useCallback, useMemo, useRef, useImperativeHandle, forwardRef } from "react"
import { getFileExtension } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconFileCode, IconFileDiff, IconFileSymlink, IconFileText, IconFolder, IconFolderOpen, IconFolderRoot, IconLoader, IconPhoto, IconReload } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { RepoFileEntryMode, TaskWebSocketManager, type RepoFileChange, type RepoFileStatus, type TaskStreamStatus } from "./ws-manager"
import { FileChangesDialog } from "./file-changes-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FileActionsDropdown } from "./file-actions-dropdown"

interface TaskFileTreeProps {
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  className?: string
  disabled?: boolean
  streamStatus?: TaskStreamStatus
  fileChanges: string[]
  fileChangesMap: Map<string, RepoFileChange>
  /** 用于触发 refreshPaths 刷新相关目录 */
  changedPaths?: string[]
  taskManager: TaskWebSocketManager | null
  onRefresh?: () => void
  sendUserInput?: (content: string) => void
  envid?: string
}

// 文件排序：目录在前，文件在后，按名称排序
const sortFiles = (files: RepoFileStatus[]) => {
  return files.sort((a, b) => {
    const getTypePriority = (file: RepoFileStatus) => {
      return (file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule) ? 0 : 2
    }

    const priorityA = getTypePriority(a)
    const priorityB = getTypePriority(b)

    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }

    return (a.name.toLowerCase() || '').localeCompare(b.name.toLowerCase() || '')
  })
}

// 判断是否为目录
const isDirectory = (file: RepoFileStatus) => {
  return file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule
}

// 获取文件图标
const getFileIcon = (file: RepoFileStatus, isOpen?: boolean) => {
  switch (file.entry_mode) {
    case RepoFileEntryMode.RepoEntryModeTree:
      return isOpen 
        ? <IconFolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        : <IconFolder className="h-4 w-4 text-amber-500 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSymlink:
      return <IconFileSymlink className="size-4 text-foreground/60 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeExecutable:
      return <IconFileCode className="size-4 text-foreground/60 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSubmodule:
      return isOpen 
        ? <IconFolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        : <IconFolderRoot className="h-4 w-4 text-amber-500 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeFile:
    case RepoFileEntryMode.RepoEntryModeUnspecified:
    default:
      if (['jpg', 'png', 'gif', 'jpeg', 'webp', 'svg', 'ico'].includes(getFileExtension(file.name))) {
        return <IconPhoto className="size-4 text-foreground/60 shrink-0" />
      } else {
        return <IconFileText className="size-4 text-foreground/60 shrink-0" />
      }
  }
}

// 文件节点组件
const FileNode = ({ file, depth, onFileSelect, fileChangesMap, envid, onRefresh }: {
  file: RepoFileStatus
  depth: number
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
}) => {
  const paddingLeft = depth * 12
  const fileChange = fileChangesMap.get(file.path)
  const hasChanges = !!fileChange?.status

  return (
    <div
      className="flex items-center gap-1 pl-2 pr-1 hover:bg-accent rounded-sm cursor-pointer select-none group"
      style={{ paddingLeft: `${paddingLeft + 8}px` }}
    >
      <div className="flex items-center gap-1 py-1 flex-1 truncate" onClick={() => onFileSelect?.(file.path, file)}>
        {getFileIcon(file)}
        <span className="text-sm truncate flex-1">{file.name}</span>
      </div>
      <div className="relative size-5 shrink-0 flex items-center justify-center">
        {hasChanges && (
          <span className="text-xs font-medium text-yellow-500 group-hover:opacity-0 transition-opacity">●</span>
        )}
        <div className="absolute inset-0">
          <FileActionsDropdown
            file={file}
            envid={envid}
            onRefresh={onRefresh}
            onSuccess={onRefresh}
          />
        </div>
      </div>
    </div>
  )
}

// DirNode ref 类型
interface DirNodeRef {
  refresh: () => Promise<void>
  refreshPaths: (paths: string[]) => Promise<void>
}

// 目录节点组件 - 自己管理 children 和 loading 状态
interface DirNodeProps {
  file?: RepoFileStatus  // 根目录时为 undefined
  depth: number
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  defaultExpanded?: boolean
  taskManager: TaskWebSocketManager | null
  streamStatus?: TaskStreamStatus
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
}

const DirNode = forwardRef<DirNodeRef, DirNodeProps>(({ file, depth, onFileSelect, defaultExpanded = false, streamStatus, taskManager, fileChangesMap, envid, onRefresh }, ref) => {
  const [children, setChildren] = useState<RepoFileStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loaded, setLoaded] = useState(false)
  const childRefs = useRef<Map<string, DirNodeRef>>(new Map())

  const fullPath = file?.path || ''
  const paddingLeft = depth * 12

  const fetchChildren = useCallback(async () => {
    setLoading(true)
    if (taskManager) {
      const result = await taskManager.getFileList(fullPath)
      const filtered = (result || []).filter(f => f.name !== '.git')
      setChildren(sortFiles(filtered))
      setLoaded(true)
    }
    setLoading(false)
  }, [fullPath])

  const refresh = useCallback(async () => {
    // 刷新自己
    await fetchChildren()
    // 刷新所有已展开的子目录
    const refreshPromises: Promise<void>[] = []
    childRefs.current.forEach((childRef) => {
      refreshPromises.push(childRef.refresh())
    })
    await Promise.all(refreshPromises)
  }, [fetchChildren])

  // 根据变动的文件路径，只刷新相关目录
  const refreshPaths = useCallback(async (paths: string[]) => {
    // 检查是否有任何路径是当前目录的直接子项
    const needsRefresh = paths.some(p => {
      const lastSlashIndex = p.lastIndexOf('/')
      const parentPath = lastSlashIndex > 0 ? p.substring(0, lastSlashIndex) : ''
      return parentPath === fullPath || (fullPath === '' && parentPath === '')
    })

    if (needsRefresh) {
      await fetchChildren()
    }

    // 过滤出属于当前目录子树的路径，递归传递给子目录
    const childPaths = paths.filter(p => {
      if (fullPath === '' || fullPath === '/') {
        return true
      }
      return p.startsWith(fullPath + '/')
    })

    if (childPaths.length > 0) {
      const refreshPromises: Promise<void>[] = []
      childRefs.current.forEach((childRef) => {
        refreshPromises.push(childRef.refreshPaths(childPaths))
      })
      await Promise.all(refreshPromises)
    }
  }, [fullPath, fetchChildren])

  useImperativeHandle(ref, () => ({ refresh, refreshPaths }), [refresh, refreshPaths])

  const handleToggle = useCallback((open: boolean) => {
    setExpanded(open)
    if (open && !loaded) {
      fetchChildren()
    }
  }, [loaded, fetchChildren])

  // 根目录自动加载
  useEffect(() => {
    if (defaultExpanded && !loaded && (streamStatus === 'waiting' || streamStatus === 'executing')) {
      fetchChildren()
    }
  }, [defaultExpanded, loaded, fetchChildren, streamStatus])

  // 根目录情况：不显示目录本身，直接显示子内容
  if (!file) {
    if (loading && children.length === 0) {
      return (
        <Empty className="opacity-50 h-full w-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>正在加载...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    if (children.length === 0) {
      return (
        <Empty className="opacity-50 h-full w-full">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>当前目录没有文件</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    return (
      <div className="p-1">
        {children.map((child) => 
          isDirectory(child) ? (
            <DirNode
              key={child.name}
              ref={(r) => {
                if (r) childRefs.current.set(child.name!, r)
                else childRefs.current.delete(child.name!)
              }}
              file={child}
              depth={depth}
              onFileSelect={onFileSelect}
              taskManager={taskManager}
              fileChangesMap={fileChangesMap}
              envid={envid}
            />
          ) : (
            <FileNode
              key={child.name}
              file={child}
              depth={depth}
              onFileSelect={onFileSelect}
              fileChangesMap={fileChangesMap}
              envid={envid}
            />
          )
        )}
      </div>
    )
  }

  // 检查目录自身或子文件是否有变更（基于 fileChangesMap）
  const hasChangesInChildren = useMemo(() => {
    // 检查目录自身是否有变更
    if (fileChangesMap.has(fullPath)) {
      return true
    }
    
    // 检查当前目录下的直接子文件是否有变更
    const hasDirectChanges = children.some((child) => {
      return fileChangesMap.has(fullPath + '/' + child.name)
    })
    if (hasDirectChanges) return true
    
    // 检查是否有任何变更文件在当前目录的子树中
    const prefix = fullPath === '' ? '' : fullPath + '/'
    for (const changedPath of fileChangesMap.keys()) {
      if (prefix === '' || changedPath.startsWith(prefix)) {
        return true
      }
    }
    return false
  }, [children, fileChangesMap, fullPath])

  // 普通目录节点
  return (
    <Collapsible open={expanded} onOpenChange={handleToggle}>
      <div
        className="flex items-center gap-1 pl-2 pr-1 hover:bg-accent rounded-sm cursor-pointer select-none group"
        style={{ paddingLeft: `${paddingLeft + 8}px` }}
      >
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-1 flex-1 min-w-0 py-1">
            {loading ? <IconLoader className="h-4 w-4 animate-spin text-primary shrink-0" /> : getFileIcon(file, expanded)}
            <span className="text-sm truncate flex-1">{file.name}</span>
          </div>
        </CollapsibleTrigger>
        <div className="relative w-5 h-5 shrink-0 flex items-center justify-center">
          {hasChangesInChildren && (
            <span className="text-xs font-medium text-yellow-500 group-hover:opacity-0 transition-opacity">●</span>
          )}
          <div className="absolute inset-0">
            <FileActionsDropdown
              file={file}
              envid={envid}
              onRefresh={async () => {
                await refresh()
                onRefresh?.()
              }}
              onSuccess={async () => {
                await refresh()
                onRefresh?.()
              }}
            />
          </div>
        </div>
      </div>
      <CollapsibleContent>
        {children.map((child) => 
          isDirectory(child) ? (
            <DirNode
              key={child.name}
              ref={(r) => {
                if (r) childRefs.current.set(child.name!, r)
                else childRefs.current.delete(child.name!)
              }}
              file={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              taskManager={taskManager}
              fileChangesMap={fileChangesMap}
              envid={envid}
              onRefresh={onRefresh}
            />
          ) : (
            <FileNode
              key={child.name}
              file={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              fileChangesMap={fileChangesMap}
              envid={envid}
              onRefresh={onRefresh}
            />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})

DirNode.displayName = 'DirNode'

export const TaskFileTree = ({ onFileSelect, className, disabled, streamStatus, fileChanges, fileChangesMap, changedPaths, taskManager, onRefresh, sendUserInput, envid }: TaskFileTreeProps) => {
  const rootRef = useRef<DirNodeRef>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [fileChangesDialogOpen, setFileChangesDialogOpen] = useState(false)

  const handleRefresh = useCallback(() => {
    // 重置整个树
    setRefreshKey(prev => prev + 1)
    // 通知父组件刷新
    onRefresh?.()
  }, [onRefresh])

  // changedPaths 变化时刷新相关目录
  useEffect(() => {
    if (changedPaths && changedPaths.length > 0) {
      rootRef.current?.refreshPaths(changedPaths)
    }
  }, [changedPaths])

  const Header = (
    <div className="p-2 flex items-center justify-between border-b bg-muted/50">
      <Label>
        <IconFolderOpen className="size-4 text-primary" />
        项目文件
      </Label>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleRefresh}
          disabled={disabled}
        >
          <IconReload />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFileChangesDialogOpen(true)} disabled={disabled || fileChanges.length === 0}>
              <IconFileDiff />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            查看修改
          </TooltipContent>
        </Tooltip>
        <FileActionsDropdown
          file={{
            entry_mode: RepoFileEntryMode.RepoEntryModeTree,
            mode: 0,
            modified_at: 0,
            name: 'workspace',
            path: '',
            size: 0,
          }} 
          envid={envid} 
          onRefresh={handleRefresh}
          onSuccess={handleRefresh}
          alwaysVisible
          hideDestructive
        />
        </div>
    </div>
  )

  if (disabled) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>无法连接开发环境</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (disabled) {
    return (
      <div className={cn("flex flex-col h-full", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>开发环境不可用</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {Header}
      <div className="flex-1 h-0 overflow-y-auto">
        <DirNode
          key={refreshKey}
          ref={rootRef}
          streamStatus={streamStatus}
          depth={0}
          onFileSelect={onFileSelect}
          defaultExpanded
          taskManager={taskManager}
          fileChangesMap={fileChangesMap}
          envid={envid}
          onRefresh={handleRefresh}
        />
      </div>
      <FileChangesDialog
        open={fileChangesDialogOpen}
        onOpenChange={setFileChangesDialogOpen}
        fileChanges={fileChanges}
        fileChangesMap={fileChangesMap}
        taskManager={taskManager}
        onSubmit={(selectedFiles) => {
          if (selectedFiles.length === fileChanges.length) {
            sendUserInput?.("用 git 提交所有修改，并推送到远程仓库")
          } else {
            sendUserInput?.(`用 git 提交以下文件的修改，并推送到远程仓库:  \n${selectedFiles.map((file) => `- ${file}`).join('\n')}`)
          }
        }}
        onCancel={() => {
          setFileChangesDialogOpen(false)
        }}
      />
    </div>
  )
}
