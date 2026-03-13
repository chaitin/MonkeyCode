import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
import { getFileExtension } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconChevronRight, IconCloudOff, IconFileCode, IconFileSymlink, IconFileText, IconFolder, IconFolderOpen, IconFolderRoot, IconLoader, IconPhoto, IconReload, IconX } from "@tabler/icons-react"
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

interface TaskFileExplorerProps {
  className?: string
  disabled?: boolean
  streamStatus?: TaskStreamStatus
  fileChangesMap: Map<string, RepoFileChange>
  changedPaths?: string[]
  taskManager: TaskWebSocketManager | null
  onRefresh?: () => void
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
      return isOpen ? <IconFolderOpen className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : <IconFolder className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSymlink:
      return <IconFileSymlink className="size-3.5 text-slate-500 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeExecutable:
      return <IconFileCode className="size-3.5 text-slate-500 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSubmodule:
      return isOpen ? <IconFolderOpen className="h-3.5 w-3.5 text-emerald-600 shrink-0" /> : <IconFolderRoot className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
    case RepoFileEntryMode.RepoEntryModeFile:
    case RepoFileEntryMode.RepoEntryModeUnspecified:
    default:
      if (['jpg', 'png', 'gif', 'jpeg', 'webp', 'svg', 'ico'].includes(getFileExtension(file.name))) {
        return <IconPhoto className="size-3.5 text-slate-500 shrink-0" />
      }
      return <IconFileText className="size-3.5 text-slate-500 shrink-0" />
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
const FileNode = ({ file, depth, onFileSelect, fileChangesMap, envid, onRefresh }: {
  file: RepoFileStatus
  depth: number
  onFileSelect?: (path: string, file: RepoFileStatus) => void
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
}) => {
  const paddingLeft = depth * 14
  const fileChange = fileChangesMap.get(file.path)
  const hasChanges = !!fileChange?.status

  return (
    <div
      className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-md cursor-pointer select-none group transition-colors"
      style={{ paddingLeft: `${paddingLeft + 6}px` }}
    >
      <div className="flex items-center gap-1.5 py-0.5 flex-1 truncate min-w-0" onClick={() => onFileSelect?.(file.path, file)}>
        {getFileIcon(file)}
        <span className="text-xs truncate flex-1">{file.name}</span>
      </div>
      <div className="relative size-4 shrink-0 flex items-center justify-center">
        {hasChanges && (
          <span className="text-[10px] font-medium text-amber-600 group-hover:opacity-0 transition-opacity">●</span>
        )}
        <div className="absolute inset-0">
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
}>(({ file, depth, onFileSelect, defaultExpanded = false, streamStatus, taskManager, fileChangesMap, envid, onRefresh }, ref) => {
  const [children, setChildren] = useState<RepoFileStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loaded, setLoaded] = useState(false)
  const childRefs = useRef<Map<string, DirNodeRef>>(new Map())
  const fullPath = file?.path || ''
  const paddingLeft = depth * 14

  const fetchChildren = useCallback(async () => {
    setLoading(true)
    if (taskManager) {
      const result = await taskManager.getFileList(fullPath)
      const filtered = (result || []).filter(f => f.name !== '.git')
      setChildren(sortFiles(filtered))
      setLoaded(true)
    }
    setLoading(false)
  }, [fullPath, taskManager])

  const refresh = useCallback(async () => {
    await fetchChildren()
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
    if (needsRefresh) await fetchChildren()
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
    if (open && !loaded) fetchChildren()
  }, [loaded, fetchChildren])

  useEffect(() => {
    if (defaultExpanded && !loaded && (streamStatus === 'waiting' || streamStatus === 'executing')) {
      fetchChildren()
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
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <IconLoader className="size-6 animate-spin mb-2" />
          <span className="text-xs">正在加载...</span>
        </div>
      )
    }
    if (children.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-slate-500">
          <IconFolder className="size-8 mb-2 opacity-50" />
          <span className="text-xs">当前目录没有文件</span>
        </div>
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
            />
          ) : (
            <FileNode key={child.name} file={child} depth={depth} onFileSelect={onFileSelect} fileChangesMap={fileChangesMap} envid={envid} onRefresh={onRefresh} />
          )
        )}
      </div>
    )
  }

  return (
    <Collapsible open={expanded} onOpenChange={handleToggle}>
      <div
        className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800/80 rounded-md cursor-pointer select-none group transition-colors"
        style={{ paddingLeft: `${paddingLeft + 6}px` }}
      >
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 py-0.5">
            {loading ? <IconLoader className="h-3.5 w-3.5 animate-spin text-emerald-600 shrink-0" /> : getFileIcon(file, expanded)}
            <span className="text-xs truncate flex-1">{file.name}</span>
            <IconChevronRight className={cn("size-3 shrink-0 transition-transform text-slate-400", expanded && "rotate-90")} />
          </div>
        </CollapsibleTrigger>
        <div className="relative w-4 h-4 shrink-0 flex items-center justify-center">
          {hasChangesInChildren && <span className="text-[10px] font-medium text-amber-600 group-hover:opacity-0 transition-opacity">●</span>}
          <div className="absolute inset-0">
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
            />
          ) : (
            <FileNode key={child.name} file={child} depth={depth + 1} onFileSelect={onFileSelect} fileChangesMap={fileChangesMap} envid={envid} onRefresh={onRefresh} />
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
  envid,
}: TaskFileExplorerProps): React.JSX.Element => {
  const rootRef = useRef<DirNodeRef>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [fileList, setFileList] = useState<FileItem[]>([])
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  const currentFile = useMemo(() => fileList.find((f) => f.path === currentFilePath) || null, [fileList, currentFilePath])

  const handleRefresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
    onRefresh?.()
  }, [onRefresh])

  useEffect(() => {
    if (changedPaths && changedPaths.length > 0) {
      rootRef.current?.refreshPaths(changedPaths)
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
    const existing = fileList.find((f) => f.path === path)
    if (existing) {
      setCurrentFilePath(path)
      return existing
    }
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
    setFileList((prev) => [...prev, file])
    setCurrentFilePath(path)
    return file
  }, [envid, fileList, fetchFileContent])

  const handleFileSelect = useCallback((path: string, file: RepoFileStatus) => {
    if (file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule) return
    openFile(path)
  }, [openFile])

  const reloadFile = useCallback(async () => {
    if (!currentFile || !currentFilePath) return
    const bytes = await fetchFileContent(currentFilePath)
    if (!bytes) return
    const isBinaryByExt = isBinaryExtension(currentFilePath)
    const isTooLarge = bytes.length > MAX_FILE_SIZE
    const { text, isText } = isBinaryByExt ? { text: '', isText: false } : tryDecodeAsText(bytes)
    setFileList((prev) => prev.map((f) => (f.path === currentFilePath ? {
      ...f,
      bytes,
      content: isText ? text : null,
      isBinary: isBinaryByExt || !isText,
      isTooLarge,
    } : f)))
    toast.success(`文件 ${currentFilePath} 已重新加载`)
  }, [currentFile, currentFilePath, fetchFileContent])

  const closeFile = useCallback(() => {
    const newList = fileList.filter((f) => f.path !== currentFilePath)
    setFileList(newList)
    setCurrentFilePath(newList.length > 0 ? newList[0].path : null)
  }, [fileList, currentFilePath])

  const renderFileContent = () => {
    if (!currentFile) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-400">
          <IconFileText className="size-12 mb-3 opacity-40" />
          <span className="text-sm">点击左侧文件查看内容</span>
        </div>
      )
    }
    if (fileLoading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500">
          <IconLoader className="size-8 animate-spin mb-2" />
          <span className="text-xs">加载中...</span>
        </div>
      )
    }
    if (currentFile.isTooLarge) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500">
          <span className="text-sm">文件太大不支持预览</span>
        </div>
      )
    }
    if (currentFile.isBinary) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-slate-500">
          <span className="text-sm">二进制文件不支持预览</span>
        </div>
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
        <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/50 shrink-0">
          <IconFolderOpen className="size-4 text-emerald-600" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">项目文件</span>
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

  return (
    <div className={cn("flex flex-col h-full gap-2", className)}>
      <div className={cn("flex flex-col min-h-0 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden", currentFile ? "h-1/2" : "flex-1")}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <IconFolderOpen className="size-4 text-emerald-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">项目文件</span>
          </div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefresh} disabled={disabled}>
                  <IconReload className="size-3.5" />
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
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
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
          />
        </div>
      </div>

      {currentFile && (
        <div className="h-1/2 min-h-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/50 shrink-0">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate flex-1">{currentFile.name}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reloadFile} disabled={fileLoading}>
              <IconReload className={cn("size-3", fileLoading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={closeFile}>
              <IconX className="size-3" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">{renderFileContent()}</div>
        </div>
      )}
    </div>
  )
}
