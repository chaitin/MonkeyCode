import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
import { getFileExtension } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconCloudOff, IconFileCode, IconFileSymlink, IconFileText, IconFolder, IconFolderOpen, IconFolderRoot, IconLoader, IconPhoto, IconReload, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { RepoFileEntryMode, TaskWebSocketManager, type RepoFileChange, type RepoFileStatus, type TaskStreamStatus } from "./ws-manager"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { FileActionsDropdown } from "./file-actions-dropdown"
import AceEditor from "react-ace"
import "ace-builds/src-noconflict/mode-text"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/mode-typescript"
import "ace-builds/src-noconflict/mode-python"
import "ace-builds/src-noconflict/mode-json"
import "ace-builds/src-noconflict/mode-yaml"
import "ace-builds/src-noconflict/mode-markdown"
import "ace-builds/src-noconflict/mode-html"
import "ace-builds/src-noconflict/mode-css"
import "ace-builds/src-noconflict/mode-sql"
import "ace-builds/src-noconflict/mode-sh"
import "ace-builds/src-noconflict/mode-dockerfile"
import "ace-builds/src-noconflict/mode-c_cpp"
import "ace-builds/src-noconflict/mode-csharp"
import "ace-builds/src-noconflict/mode-golang"
import "ace-builds/src-noconflict/mode-ruby"
import "ace-builds/src-noconflict/mode-rust"
import "ace-builds/src-noconflict/mode-perl"
import "ace-builds/src-noconflict/mode-swift"
import "ace-builds/src-noconflict/mode-lua"
import "ace-builds/src-noconflict/mode-php"
import "ace-builds/src-noconflict/mode-java"
import "@/utils/ace-theme"
import React from "react"
import { toast } from "sonner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

interface TaskFileExplorerProps {
  className?: string
  disabled?: boolean
  streamStatus?: TaskStreamStatus
  fileChangesMap: Map<string, RepoFileChange>
  changedPaths?: string[]
  taskManager: TaskWebSocketManager | null
  onRefresh?: () => void
  onClosePanel?: () => void
  envid?: string
}

// --- 文件树逻辑 ---
const sortFiles = (files: RepoFileStatus[]) => {
  return files.sort((a, b) => {
    const getTypePriority = (file: RepoFileStatus) => {
      return (file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule) ? 0 : 2
    }
    const priorityA = getTypePriority(a)
    const priorityB = getTypePriority(b)
    if (priorityA !== priorityB) return priorityA - priorityB
    return (a.name.toLowerCase() || '').localeCompare(b.name.toLowerCase() || '')
  })
}

const isDirectory = (file: RepoFileStatus) => {
  return file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule
}

const getFileIcon = (file: RepoFileStatus, isOpen?: boolean) => {
  switch (file.entry_mode) {
    case RepoFileEntryMode.RepoEntryModeTree:
      return isOpen ? <IconFolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <IconFolder className="h-3.5 w-3.5 text-primary shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSymlink:
      return <IconFileSymlink className="size-3.5 text-muted-foreground shrink-0" />
    case RepoFileEntryMode.RepoEntryModeExecutable:
      return <IconFileCode className="size-3.5 text-muted-foreground shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSubmodule:
      return isOpen ? <IconFolderOpen className="h-3.5 w-3.5 text-primary shrink-0" /> : <IconFolderRoot className="h-3.5 w-3.5 text-primary shrink-0" />
    case RepoFileEntryMode.RepoEntryModeFile:
    case RepoFileEntryMode.RepoEntryModeUnspecified:
    default:
      if (['jpg', 'png', 'gif', 'jpeg', 'webp', 'svg', 'ico'].includes(getFileExtension(file.name))) {
        return <IconPhoto className="size-3.5 text-muted-foreground shrink-0" />
      }
      return <IconFileText className="size-3.5 text-muted-foreground shrink-0" />
  }
}

const getLanguageMode = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const modeMap: Record<string, string> = {
    'bash': 'sh', 'c': 'c_cpp', 'cpp': 'c_cpp', 'cs': 'csharp', 'fish': 'sh', 'go': 'golang',
    'h': 'c_cpp', 'htm': 'html', 'html': 'html', 'hpp': 'c_cpp', 'java': 'java', 'js': 'javascript',
    'jsx': 'javascript', 'lua': 'lua', 'markdown': 'markdown', 'md': 'markdown', 'php': 'php',
    'pl': 'perl', 'py': 'python', 'rb': 'ruby', 'rs': 'rust', 'sh': 'sh', 'swift': 'swift',
    'sql': 'sql', 'ts': 'typescript', 'tsx': 'typescript', 'yml': 'yaml', 'yaml': 'yaml', 'zsh': 'sh',
  }
  return modeMap[ext || ''] || 'text'
}

const MAX_FILE_SIZE = 100 * 1024 // 100KB

const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.mp4', '.webm', '.ogv', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma',
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]

function isBinaryExtension(path: string): boolean {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.includes(ext)
}

function tryDecodeAsText(bytes: Uint8Array): { text: string; isText: boolean } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, isText: true }
  } catch {
    return { text: '', isText: false }
  }
}

interface FileItem {
  name: string
  path: string
  bytes: Uint8Array | null
  content: string | null
  isBinary: boolean
  isTooLarge: boolean
}

// --- DirNode ref ---
interface DirNodeRef {
  refresh: () => Promise<void>
  refreshPaths: (paths: string[]) => Promise<void>
}

// --- FileNode (新样式) ---
const FileNode = ({ file, depth, onFileSelect, fileChangesMap, envid, onRefresh, selectedPath }: {
  file: RepoFileStatus
  depth: number
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
  selectedPath?: string | null
}) => {
  const paddingLeft = depth * 14
  const fileChange = fileChangesMap.get(file.path)
  const hasChanges = !!fileChange?.status
  const isSelected = selectedPath === file.path

  return (
    <div
      className="flex items-center gap-1 mx-1.5 my-0.5 pl-1 pr-1.5 py-0.5 hover:bg-muted/60 rounded-md cursor-pointer select-none group transition-colors"
      style={{ paddingLeft: `${paddingLeft + 6}px` }}
    >
      <div className="flex items-center gap-1.5 py-0.5 flex-1 truncate min-w-0" onClick={() => onFileSelect?.(file.path, file)}>
        {getFileIcon(file)}
        <span className={cn("text-sm truncate flex-1", isSelected && "text-primary")}>{file.name}</span>
      </div>
      <div className="relative size-5 shrink-0 flex items-center justify-center">
        {hasChanges && (
          <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500 group-hover:opacity-0 transition-opacity">●</span>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <FileActionsDropdown file={file} envid={envid} onRefresh={onRefresh} onSuccess={onRefresh} />
        </div>
      </div>
    </div>
  )
}

// --- DirNode (新样式) ---
const DirNode = forwardRef<DirNodeRef, {
  file?: RepoFileStatus
  depth: number
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  defaultExpanded?: boolean
  taskManager: TaskWebSocketManager | null
  streamStatus?: TaskStreamStatus
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
  selectedPath?: string | null
}>(({ file, depth, onFileSelect, defaultExpanded = false, streamStatus, taskManager, fileChangesMap, envid, onRefresh, selectedPath }, ref) => {
  const [children, setChildren] = useState<RepoFileStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loaded, setLoaded] = useState(false)
  const childRefs = useRef<Map<string, DirNodeRef>>(new Map())
  const fullPath = file?.path || ''
  const paddingLeft = depth * 14

  const fetchChildren = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      if (taskManager) {
        const result = await taskManager.getFileList(fullPath)
        const filtered = (result || []).filter(f => f.name !== '.git')
        setChildren(sortFiles(filtered))
        setLoaded(true)
      }
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [fullPath, taskManager])

  const refresh = useCallback(async () => {
    await fetchChildren(true)
    const refreshPromises: Promise<void>[] = []
    childRefs.current.forEach((childRef) => refreshPromises.push(childRef.refresh()))
    await Promise.all(refreshPromises)
  }, [fetchChildren])

  const refreshPaths = useCallback(async (paths: string[]) => {
    const needsRefresh = paths.some(p => {
      const lastSlashIndex = p.lastIndexOf('/')
      const parentPath = lastSlashIndex > 0 ? p.substring(0, lastSlashIndex) : ''
      return parentPath === fullPath || (fullPath === '' && parentPath === '')
    })
    if (needsRefresh) await fetchChildren(false)
    const childPaths = paths.filter(p => fullPath === '' || fullPath === '/' || p.startsWith(fullPath + '/'))
    if (childPaths.length > 0) {
      const refreshPromises: Promise<void>[] = []
      childRefs.current.forEach((childRef) => refreshPromises.push(childRef.refreshPaths(childPaths)))
      await Promise.all(refreshPromises)
    }
  }, [fullPath, fetchChildren])

  useImperativeHandle(ref, () => ({ refresh, refreshPaths }), [refresh, refreshPaths])

  const handleToggle = useCallback((open: boolean) => {
    setExpanded(open)
    if (open && !loaded) fetchChildren(true)
  }, [loaded, fetchChildren])

  useEffect(() => {
    if (defaultExpanded && !loaded && (streamStatus === 'waiting' || streamStatus === 'executing')) {
      fetchChildren(true)
    }
  }, [defaultExpanded, loaded, fetchChildren, streamStatus])

  const hasChangesInChildren = useMemo(() => {
    if (fileChangesMap.has(fullPath)) return true
    if (children.some((child) => fileChangesMap.has(fullPath + '/' + child.name))) return true
    const prefix = fullPath === '' ? '' : fullPath + '/'
    for (const changedPath of fileChangesMap.keys()) {
      if (prefix === '' || changedPath.startsWith(prefix)) return true
    }
    return false
  }, [children, fileChangesMap, fullPath])

  if (!file) {
    if (loading && children.length === 0) {
      return (
        <Empty className="w-full flex-1 min-h-0 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyDescription>正在加载...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (children.length === 0) {
      return (
        <Empty className="w-full flex-1 min-h-0 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder className="size-6 opacity-50" />
            </EmptyMedia>
            <EmptyDescription>当前目录没有文件</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    return (
      <div className="py-0.5">
        {children.map((child) =>
          isDirectory(child) ? (
            <DirNode
              key={child.name}
              ref={(r) => { if (r) childRefs.current.set(child.name!, r); else childRefs.current.delete(child.name!) }}
              file={child}
              depth={depth}
              onFileSelect={onFileSelect}
              taskManager={taskManager}
              fileChangesMap={fileChangesMap}
              envid={envid}
              onRefresh={onRefresh}
              selectedPath={selectedPath}
            />
          ) : (
            <FileNode key={child.name} file={child} depth={depth} onFileSelect={onFileSelect} fileChangesMap={fileChangesMap} envid={envid} onRefresh={onRefresh} selectedPath={selectedPath} />
          )
        )}
      </div>
    )
  }

  return (
    <Collapsible open={expanded} onOpenChange={handleToggle}>
      <div
        className="flex items-center gap-1 mx-1.5 my-0.5 pl-1 pr-1.5 py-0.5 hover:bg-muted/60 rounded-md cursor-pointer select-none group transition-colors"
        style={{ paddingLeft: `${paddingLeft + 6}px` }}
      >
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5">
            {loading ? <IconLoader className="h-3.5 w-3.5 animate-spin text-primary shrink-0" /> : getFileIcon(file, expanded)}
            <span className="text-sm truncate flex-1">{file.name}</span>
          </div>
        </CollapsibleTrigger>
        <div className="relative size-5 shrink-0 flex items-center justify-center">
          {hasChangesInChildren && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500 group-hover:opacity-0 transition-opacity">●</span>}
          <div className="absolute inset-0 flex items-center justify-center">
            <FileActionsDropdown file={file} envid={envid} onRefresh={async () => { await refresh(); onRefresh?.() }} onSuccess={async () => { await refresh(); onRefresh?.() }} />
          </div>
        </div>
      </div>
      <CollapsibleContent>
        {children.map((child) =>
          isDirectory(child) ? (
            <DirNode
              key={child.name}
              ref={(r) => { if (r) childRefs.current.set(child.name!, r); else childRefs.current.delete(child.name!) }}
              file={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              taskManager={taskManager}
              fileChangesMap={fileChangesMap}
              envid={envid}
              onRefresh={onRefresh}
              selectedPath={selectedPath}
            />
          ) : (
            <FileNode key={child.name} file={child} depth={depth + 1} onFileSelect={onFileSelect} fileChangesMap={fileChangesMap} envid={envid} onRefresh={onRefresh} selectedPath={selectedPath} />
          )
        )}
      </CollapsibleContent>
    </Collapsible>
  )
})

DirNode.displayName = 'DirNode'

export const TaskFileExplorer = ({
  className,
  disabled,
  streamStatus,
  fileChangesMap,
  changedPaths,
  taskManager,
  onRefresh,
  onClosePanel,
  envid,
}: TaskFileExplorerProps): React.JSX.Element => {
  const rootRef = useRef<DirNodeRef>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [currentFile, setCurrentFile] = useState<FileItem | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
    onRefresh?.()
  }, [onRefresh])

  const refreshPathsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!changedPaths || changedPaths.length === 0) return
    refreshPathsTimeoutRef.current && clearTimeout(refreshPathsTimeoutRef.current)
    refreshPathsTimeoutRef.current = setTimeout(() => {
      rootRef.current?.refreshPaths(changedPaths)
      refreshPathsTimeoutRef.current = null
    }, 300)
    return () => {
      refreshPathsTimeoutRef.current && clearTimeout(refreshPathsTimeoutRef.current)
    }
  }, [changedPaths])

  const fetchFileContent = useCallback(async (path: string) => {
    let bytes: Uint8Array | null = null
    setFileLoading(true)
    if (taskManager) {
      bytes = await taskManager.getFileContent(path)
      if (!bytes) toast.error(`文件读取失败`)
    }
    setFileLoading(false)
    return bytes
  }, [taskManager])

  const openFile = useCallback(async (path: string) => {
    if (!envid || !path) return null
    if (currentFile?.path === path) return currentFile
    const bytes = await fetchFileContent(path)
    if (!bytes) return null
    const isBinaryByExt = isBinaryExtension(path)
    const isTooLarge = bytes.length > MAX_FILE_SIZE
    const { text, isText } = isBinaryByExt ? { text: '', isText: false } : tryDecodeAsText(bytes)
    const isBinary = isBinaryByExt || !isText
    const file: FileItem = {
      name: path.split('/').pop() || path,
      path,
      bytes,
      content: isText ? text : null,
      isBinary,
      isTooLarge,
    }
    setCurrentFile(file)
    return file
  }, [envid, currentFile, fetchFileContent])

  const handleFileSelect = useCallback((path: string, file: RepoFileStatus) => {
    if (file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule) return
    openFile(path)
  }, [openFile])

  const reloadFile = useCallback(async () => {
    if (!currentFile) return
    const bytes = await fetchFileContent(currentFile.path)
    if (!bytes) return
    const isBinaryByExt = isBinaryExtension(currentFile.path)
    const isTooLarge = bytes.length > MAX_FILE_SIZE
    const { text, isText } = isBinaryByExt ? { text: '', isText: false } : tryDecodeAsText(bytes)
    setCurrentFile({
      ...currentFile,
      bytes,
      content: isText ? text : null,
      isBinary: isBinaryByExt || !isText,
      isTooLarge,
    })
    toast.success(`文件 ${currentFile.path} 已重新加载`)
  }, [currentFile, fetchFileContent])

  const closeFile = useCallback(() => {
    setCurrentFile(null)
  }, [])

  const renderFileContent = () => {
    if (!currentFile) {
      return (
        <Empty className="border border-dashed w-full h-full min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileText className="size-6 opacity-40" />
            </EmptyMedia>
            <EmptyDescription>点击左侧文件查看内容</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (fileLoading) {
      return (
        <Empty className="border border-dashed w-full h-full min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyDescription>加载中...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (currentFile.isTooLarge) {
      return (
        <Empty className="border border-dashed w-full h-full min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileText className="size-6 opacity-50" />
            </EmptyMedia>
            <EmptyDescription>文件太大不支持预览</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (currentFile.isBinary) {
      return (
        <Empty className="border border-dashed w-full h-full min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileText className="size-6 opacity-50" />
            </EmptyMedia>
            <EmptyDescription>二进制文件不支持预览</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    return (
      <AceEditor
        mode={getLanguageMode(currentFile.path)}
        readOnly
        theme="monkeycode"
        width="100%"
        height="100%"
        value={currentFile.content || ''}
        showPrintMargin={false}
        showGutter={true}
        setOptions={{ fontFamily: "var(--font-google-sans-code)", fontSize: 12 }}
      />
    )
  }

  if (disabled) {
    return (
      <div className={cn("flex flex-col h-full min-h-0", className)}>
        <div className="flex items-center justify-between gap-2 px-4 py-1 min-h-11 border-b bg-muted/50 shrink-0">
          <span className="text-sm font-medium">项目文件</span>
          {onClosePanel && (
            <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
              <IconX className="size-4" />
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <Empty className="border border-dashed w-full flex-1 min-h-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconCloudOff className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                开发环境未就绪，请先进入开发页面启动任务
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </div>
    )
  }

  const fileTreePanel = (
    <div className="flex flex-col min-h-0 flex-1 rounded-lg border overflow-hidden">
      <div className="flex items-center justify-between pl-4 pr-2 py-1 min-h-11 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">项目文件</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={handleRefresh} disabled={disabled}>
                <IconReload className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新</TooltipContent>
          </Tooltip>
          <FileActionsDropdown
            file={{ entry_mode: RepoFileEntryMode.RepoEntryModeTree, mode: 0, modified_at: 0, name: 'workspace', path: '', size: 0 }}
            envid={envid}
            onRefresh={handleRefresh}
            onSuccess={handleRefresh}
            alwaysVisible
            hideDestructive
          />
          {onClosePanel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={onClosePanel}>
                  <IconX className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>关闭面板</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1 flex flex-col">
        <DirNode
          key={refreshKey}
          ref={rootRef}
          streamStatus={streamStatus}
          depth={0}
          onFileSelect={handleFileSelect}
          defaultExpanded
          taskManager={taskManager}
          fileChangesMap={fileChangesMap}
          envid={envid}
          onRefresh={handleRefresh}
          selectedPath={currentFile?.path}
        />
      </div>
    </div>
  )

  const previewPanel = currentFile && (
    <div className="flex flex-col min-h-0 flex-1 rounded-lg border overflow-hidden bg-background">
      <div className="flex items-center justify-between px-4 py-1 min-h-11 border-b bg-muted/30 shrink-0">
        <span className="text-sm font-medium truncate flex-1 min-w-0">{currentFile.name}</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={reloadFile} disabled={fileLoading}>
            <IconReload className={cn("size-4", fileLoading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 shrink-0 hover:text-primary" onClick={closeFile}>
            <IconX className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{renderFileContent()}</div>
    </div>
  )

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      {currentFile ? (
        <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 gap-2">
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
            {fileTreePanel}
          </ResizablePanel>
          <ResizableHandle withHandle className="shrink-0" />
          <ResizablePanel defaultSize={50} minSize={20} className="min-h-0 flex flex-col overflow-hidden">
            {previewPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{fileTreePanel}</div>
      )}
    </div>
  )
}
