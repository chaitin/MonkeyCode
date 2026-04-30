import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react"
import { getFileExtension } from "@/utils/common"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconCloudOff, IconFileCode, IconFileDiff, IconFileSymlink, IconFileText, IconFolder, IconFolderOpen, IconFolderRoot, IconLoader, IconPhoto, IconReload, IconReport, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  RepoFileEntryMode,
  type RepoFileChange,
  type RepoFileStatus,
  type TaskRepositoryClient,
} from "./task-shared"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { parseDiff, Diff, Hunk } from "react-diff-view"
import "react-diff-view/style/index.css"

interface TaskFileExplorerProps {
  className?: string
  disabled?: boolean
  repository: TaskRepositoryClient | null
  refreshSignal?: number
  onChangesCountChange?: (count: number) => void
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
      return isOpen ? <IconFolderOpen className="size-4 text-primary shrink-0" /> : <IconFolder className="size-4 text-primary shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSymlink:
      return <IconFileSymlink className="size-4 text-muted-foreground shrink-0" />
    case RepoFileEntryMode.RepoEntryModeExecutable:
      return <IconFileCode className="size-4 text-muted-foreground shrink-0" />
    case RepoFileEntryMode.RepoEntryModeSubmodule:
      return isOpen ? <IconFolderOpen className="size-4 text-primary shrink-0" /> : <IconFolderRoot className="size-4 text-primary shrink-0" />
    case RepoFileEntryMode.RepoEntryModeFile:
    case RepoFileEntryMode.RepoEntryModeUnspecified:
    default:
      if (['jpg', 'png', 'gif', 'jpeg', 'webp', 'svg', 'ico'].includes(getFileExtension(file.name))) {
        return <IconPhoto className="size-4 text-muted-foreground shrink-0" />
      }
      return <IconFileText className="size-4 text-muted-foreground shrink-0" />
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

type FilePanelMode = "tree" | "changes"

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
  taskManager: TaskRepositoryClient | null
  fileChangesMap: Map<string, RepoFileChange>
  envid?: string
  onRefresh?: () => void
  selectedPath?: string | null
}>(({ file, depth, onFileSelect, defaultExpanded = false, taskManager, fileChangesMap, envid, onRefresh, selectedPath }, ref) => {
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
  repository,
  refreshSignal,
  onChangesCountChange,
  onClosePanel,
  envid,
}: TaskFileExplorerProps): React.JSX.Element => {
  const rootRef = useRef<DirNodeRef>(null)
  const lastRefreshSignalRef = useRef<number | undefined>(undefined)
  const pendingTreeRefreshRef = useRef(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [fileChangesMap, setFileChangesMap] = useState<Map<string, RepoFileChange>>(new Map())
  const [changedPaths, setChangedPaths] = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<FileItem | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [panelMode, setPanelMode] = useState<FilePanelMode>("tree")
  const [diffContent, setDiffContent] = useState("")
  const [diffLoading, setDiffLoading] = useState(false)
  const [changesLoading, setChangesLoading] = useState(false)
  const sortedChangedPaths = useMemo(() => [...fileChangesMap.keys()].sort((a, b) => a.localeCompare(b)), [fileChangesMap])

  const refreshFileTree = useCallback(() => {
    pendingTreeRefreshRef.current = true
    setRefreshKey((prev) => prev + 1)
  }, [])

  const loadFileChanges = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setChangesLoading(true)
    }
    try {
      const changes = await repository?.getFileChanges()
      if (changes === null || changes === undefined) {
        return null
      }

      const nextMap = new Map<string, RepoFileChange>()
      const nextPaths: string[] = []
      changes.forEach((change) => {
        nextMap.set(change.path, change)
        nextPaths.push(change.path)
      })

      setFileChangesMap(nextMap)
      setChangedPaths(nextPaths)
      onChangesCountChange?.(nextPaths.length)
      return changes
    } finally {
      if (showLoading) {
        setChangesLoading(false)
      }
    }
  }, [onChangesCountChange, repository])

  const refreshChanges = useCallback(async () => {
    await loadFileChanges(true)
  }, [loadFileChanges])

  const handleRefresh = useCallback(async () => {
    if (panelMode === "tree") {
      refreshFileTree()
      void loadFileChanges(false)
      return
    }
    await refreshChanges()
  }, [loadFileChanges, panelMode, refreshChanges, refreshFileTree])

  useEffect(() => {
    if (disabled) {
      return
    }
    void handleRefresh()
  }, [disabled, handleRefresh])

  useEffect(() => {
    if (disabled || refreshSignal === undefined) {
      return
    }
    if (lastRefreshSignalRef.current === undefined) {
      lastRefreshSignalRef.current = refreshSignal
      return
    }
    if (refreshSignal === lastRefreshSignalRef.current) {
      return
    }

    lastRefreshSignalRef.current = refreshSignal
    void loadFileChanges(panelMode === "changes")
  }, [disabled, loadFileChanges, panelMode, refreshSignal])

  const refreshPathsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!changedPaths || changedPaths.length === 0) return
    if (refreshPathsTimeoutRef.current) {
      clearTimeout(refreshPathsTimeoutRef.current)
    }
    refreshPathsTimeoutRef.current = setTimeout(() => {
      rootRef.current?.refreshPaths(changedPaths)
      refreshPathsTimeoutRef.current = null
    }, 300)
    return () => {
      if (refreshPathsTimeoutRef.current) {
        clearTimeout(refreshPathsTimeoutRef.current)
      }
    }
  }, [changedPaths])

  useEffect(() => {
    if (panelMode !== "tree" || !pendingTreeRefreshRef.current) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      pendingTreeRefreshRef.current = false
      void rootRef.current?.refresh()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [panelMode, refreshKey])

  const fetchFileContent = useCallback(async (path: string) => {
    let bytes: Uint8Array | null = null
    setFileLoading(true)
    if (repository) {
      bytes = await repository.getFileContent(path)
      if (!bytes) toast.error(`文件读取失败`)
    }
    setFileLoading(false)
    return bytes
  }, [repository])

  const openFile = useCallback(async (path: string) => {
    if (!envid || !path) return null
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
    setDiffContent("")
    setDiffLoading(false)
    setCurrentFile(file)
    return file
  }, [envid, fetchFileContent])

  const clearCurrentFile = useCallback(() => {
    setFileLoading(false)
    setDiffContent("")
    setDiffLoading(false)
    setCurrentFile(null)
  }, [])

  const handleFileSelect = useCallback((path: string, file: RepoFileStatus) => {
    if (file.entry_mode === RepoFileEntryMode.RepoEntryModeTree || file.entry_mode === RepoFileEntryMode.RepoEntryModeSubmodule) return
    if (currentFile?.path === path) {
      clearCurrentFile()
      return
    }
    openFile(path)
  }, [clearCurrentFile, currentFile?.path, openFile])

  const handleChangedFileSelect = useCallback((path: string) => {
    if (currentFile?.path === path) {
      clearCurrentFile()
      return
    }
    setFileLoading(false)
    setDiffContent("")
    setDiffLoading(false)
    setCurrentFile({
      name: path.split('/').pop() || path,
      path,
      bytes: null,
      content: null,
      isBinary: false,
      isTooLarge: false,
    })
  }, [clearCurrentFile, currentFile?.path])

  const switchPanelMode = useCallback((mode: FilePanelMode) => {
    if (mode === panelMode) {
      return
    }
    setPanelMode(mode)
    setDiffContent("")
    setDiffLoading(false)
    setFileLoading(false)
    setCurrentFile(null)
  }, [panelMode])

  const loadCurrentFileDiff = useCallback(async () => {
    if (!currentFile) return
    setDiffLoading(true)
    setDiffContent("")
    const diff = await repository?.getFileDiff(currentFile.path)
    setDiffContent(diff || "")
    setDiffLoading(false)
  }, [currentFile, repository])

  useEffect(() => {
    if (panelMode !== "changes" || !currentFile) {
      return
    }
    loadCurrentFileDiff()
  }, [currentFile, loadCurrentFileDiff, panelMode])

  const renderFileDiff = () => {
    if (!currentFile) return null
    if (diffLoading) {
      return (
        <Empty className="w-full h-full min-h-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyDescription>加载中...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    const diffFiles = diffContent ? parseDiff(diffContent) : []
    if (diffFiles.length > 0 && diffFiles.some((file) => file.hunks?.length)) {
      return (
        <div className="h-full overflow-auto" style={{ "--diff-font-family": "var(--font-code)" } as React.CSSProperties}>
          <style>{`
            .task-file-preview-diff .diff-line td:nth-child(2) {
              border-left: 1px var(--border) solid;
            }
          `}</style>
          <div className="text-xs rounded-md overflow-x-auto bg-muted/30">
            {diffFiles.map((file, index) => (
              <Diff key={index} viewType="split" diffType={file.type} hunks={file.hunks} gutterType="none" hunkClassName="task-file-preview-diff">
                {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
              </Diff>
            ))}
          </div>
        </div>
      )
    }

    return (
      <Empty className="w-full h-full min-h-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconReport className="size-6" />
          </EmptyMedia>
          <EmptyDescription>当前文件暂无变更</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const renderFileContent = () => {
    if (!currentFile) {
      return null
    }
    if (fileLoading) {
      return (
        <Empty className="w-full h-full min-h-0">
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
        <Empty className="w-full h-full min-h-0">
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
        <Empty className="w-full h-full min-h-0">
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
        setOptions={{ fontFamily: "var(--font-code)", fontSize: 12 }}
      />
    )
  }

  const renderPreviewContent = () => {
    if (panelMode === "changes") {
      return renderFileDiff()
    }
    return renderFileContent()
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
          <Empty className="w-full flex-1 min-h-0">
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

  const renderChangedFiles = () => {
    if (changesLoading) {
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

    if (sortedChangedPaths.length === 0) {
      return (
        <Empty className="w-full flex-1 min-h-0 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconReport className="size-6 opacity-50" />
            </EmptyMedia>
            <EmptyDescription>暂无文件变更</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    return (
      <div className="py-1">
        {sortedChangedPaths.map((path) => {
          const change = fileChangesMap.get(path)
          const additions = change?.additions ?? 0
          const deletions = change?.deletions ?? 0
          const isSelected = currentFile?.path === path

          return (
            <div
              key={path}
              className={cn(
                "flex items-center gap-1 mx-1.5 my-0.5 pl-1 pr-1.5 py-0.5 hover:bg-muted/60 rounded-md cursor-pointer select-none group transition-colors",
              )}
              onClick={() => handleChangedFileSelect(path)}
            >
              <div className="flex items-center gap-1.5 py-0.5 flex-1 min-w-0">
                <IconFileText className="size-4 text-muted-foreground shrink-0" />
                <div className={cn("text-sm truncate flex-1", isSelected && "text-primary")} title={path}>
                  {path}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 tabular-nums text-xs font-medium">
                {additions > 0 && (
                  <span className="text-green-700 dark:text-green-400">+{additions}</span>
                )}
                {deletions > 0 && (
                  <span className="text-red-700 dark:text-red-400">-{deletions}</span>
                )}
                {additions === 0 && deletions === 0 && change?.status && (
                  <span className="text-amber-600 dark:text-amber-500">{change.status}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const fileListPanel = (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex-1 min-h-0 overflow-y-auto py-1 flex flex-col">
        {panelMode === "tree" ? (
          <DirNode
            key={refreshKey}
            ref={rootRef}
            depth={0}
            onFileSelect={handleFileSelect}
            defaultExpanded
            taskManager={repository}
            fileChangesMap={fileChangesMap}
            envid={envid}
            onRefresh={handleRefresh}
            selectedPath={currentFile?.path}
          />
        ) : (
          renderChangedFiles()
        )}
      </div>
    </div>
  )

  const previewPanel = (
    <div className="flex flex-col min-h-0 flex-1 bg-background">
      <div className="flex-1 min-h-0 overflow-hidden">{renderPreviewContent()}</div>
    </div>
  )

  return (
    <div className={cn("flex flex-col h-full min-h-0", className)}>
      <div className="flex flex-col min-h-0 flex-1 rounded-lg border overflow-hidden bg-background">
        <div className="flex items-center justify-between px-2 py-1 min-h-11 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={panelMode}
              variant="outline"
              size="sm"
              className="shrink-0 bg-background"
              onValueChange={(value) => {
                if (value === "tree" || value === "changes") {
                  switchPanelMode(value)
                }
              }}
            >
              <ToggleGroupItem value="tree" className="h-7 px-2 text-xs gap-1.5 data-[state=on]:text-primary hover:data-[state=on]:text-primary">
                <IconFolder className="size-3.5" />
                目录
              </ToggleGroupItem>
              <ToggleGroupItem value="changes" className="h-7 px-2 text-xs gap-1.5 data-[state=on]:text-primary hover:data-[state=on]:text-primary">
                <IconFileDiff className="size-3.5" />
                变更
              </ToggleGroupItem>
            </ToggleGroup>
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
            {panelMode === "tree" && (
              <FileActionsDropdown
                file={{ entry_mode: RepoFileEntryMode.RepoEntryModeTree, mode: 0, modified_at: 0, name: 'workspace', path: '', size: 0 }}
                envid={envid}
                onRefresh={handleRefresh}
                onSuccess={handleRefresh}
                alwaysVisible
                hideDestructive
              />
            )}
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
        <div className="flex flex-1 min-h-0">
          <div
            className={cn(
              "min-h-0 flex flex-col overflow-hidden",
              currentFile ? "w-[180px] shrink-0" : "flex-1",
            )}
          >
            {fileListPanel}
          </div>
          {currentFile && (
            <div className="min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden border-l bg-background">
              {previewPanel}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
