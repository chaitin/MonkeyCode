import { useState, useCallback, memo, useMemo, useRef, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { type DomainProject, type DomainProjectTreeEntry, type DomainBranch } from "@/api/Api"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { IconFileText, IconFolder, IconFolderOpen, IconLoader, IconGitBranch, IconFile, IconFileSymlink, IconExternalLink } from "@tabler/icons-react"
import { Label } from "@/components/ui/label"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { b64decode } from "@/utils/common"
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
import dayjs from "dayjs"

type TreeEntry = DomainProjectTreeEntry

const getLanguageMode = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const modeMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'sh': 'sh',
    'bash': 'sh',
    'zsh': 'sh',
    'fish': 'sh',
    'sql': 'sql',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'markdown': 'markdown',
    'dockerfile': 'dockerfile',
  }
  return modeMap[ext || ''] || 'text'
}

// 文件模式枚举
const FileMode = {
  UNKNOWN: 0,    // 未知文件
  REGULAR: 1,      // 普通文件
  EXECUTABLE: 2,   // 可执行文件
  SYMLINK: 3,      // 符号连接
  DIRECTORY: 4,    // 目录
  SUBMODULE: 5,    // Git Submodule
} as const

interface ProjectFileManagerProps {
  project?: DomainProject
  onFileSelect?: (entry: TreeEntry) => void
  onLoaded?: () => void
  className?: string
}

// 判断是否为目录
const isDirectory = (entry: TreeEntry) => {
  return entry.mode === FileMode.DIRECTORY
}

// 文件排序：目录在前，文件在后，按名称排序
const sortEntries = (entries: TreeEntry[]) => {
  return [...entries].sort((a, b) => {
    const aIsDir = isDirectory(a)
    const bIsDir = isDirectory(b)
    
    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1
    }
    
    return (a.name || '').localeCompare(b.name || '')
  })
}

// 获取文件图标
const getFileIcon = (entry: TreeEntry, isOpen?: boolean, loading?: boolean) => {
  if (loading) {
    return <IconLoader className="h-4 w-4 shrink-0 animate-spin" />
  }
  switch (entry.mode) {
    case FileMode.DIRECTORY:
      return isOpen
        ? <IconFolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
        : <IconFolder className="h-4 w-4 text-amber-500 shrink-0" />
    case FileMode.SYMLINK:
      return <IconFileSymlink className="h-4 w-4 text-muted-foreground shrink-0" />
    case FileMode.SUBMODULE:
      return <IconGitBranch className="h-4 w-4 text-amber-500 shrink-0" />
    case FileMode.REGULAR:
    case FileMode.EXECUTABLE:
    default:
      return <IconFileText className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}

// 格式化文件大小
const formatSize = (size?: number) => {
  if (size === undefined || size === null) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

interface TreeNodeProps {
  entry: TreeEntry
  projectId: string
  depth: number
  branch?: string
  onFileSelect?: (entry: TreeEntry) => void
}

const TreeNode = memo(({ entry, projectId, depth, branch, onFileSelect }: TreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const isDir = isDirectory(entry)

  const loadChildren = useCallback(async () => {
    if (loaded || !isDir) return

    setLoading(true)
    await apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: entry.path,
      ref: branch || undefined
    }, [projectId], (resp) => {
      if (resp.code === 0) {
        setChildren(sortEntries(resp.data || []))
        setLoaded(true)
      }
    })
    setLoading(false)
  }, [projectId, entry.path, isDir, loaded, branch])

  const handleToggle = useCallback((open: boolean) => {
    setIsOpen(open)
    if (open && !loaded) {
      loadChildren()
    }
  }, [loaded, loadChildren])

  const handleClick = useCallback(() => {
    if (isDir) {
      handleToggle(!isOpen)
    } else if (onFileSelect) {
      onFileSelect(entry)
    }
  }, [isDir, isOpen, handleToggle, onFileSelect, entry])

  const paddingLeft = depth * 16

  if (isDir) {
    return (
      <Collapsible open={isOpen} onOpenChange={handleToggle}>
        <CollapsibleTrigger asChild>
          <div
            className="flex items-center gap-1.5 py-2.5 px-4 hover:bg-accent/50 rounded-sm cursor-pointer select-none group border-b border-border/50"
            style={{ paddingLeft: `${paddingLeft + 12}px` }}
          >
            {getFileIcon(entry, isOpen, loading)}
            <span className="text-sm truncate flex-1 group-hover:text-primary">{entry.name}</span>
            <div className="text-muted-foreground text-xs shrink-0">
              -
            </div>
            {entry.last_modified_at ? (
              <div className="text-muted-foreground text-xs shrink-0 w-30 text-right">
                {dayjs.unix(entry.last_modified_at).fromNow()}
              </div>
            ) : null}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              projectId={projectId}
              depth={depth + 1}
              branch={branch}
              onFileSelect={onFileSelect}
            />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <div
      className="flex items-center gap-1.5 py-2.5 px-4 hover:bg-accent/50 group rounded-sm cursor-pointer select-none border-b border-border/50"
      style={{ paddingLeft: `${paddingLeft + 12}px` }}
      onClick={handleClick}
    >
      {getFileIcon(entry)}
      <div className="text-sm truncate flex-1 group-hover:text-primary">
        {entry.name}
      </div>
      <div className="text-muted-foreground text-xs shrink-0">
        {formatSize(entry.size)}
      </div>
      {entry.last_modified_at ? (
        <div className="text-muted-foreground text-xs shrink-0 w-30 text-right">
          {dayjs.unix(entry.last_modified_at).fromNow()}
        </div>
      ) : null}
    </div>
  )
})

TreeNode.displayName = 'TreeNode'

export const ProjectFileManager = ({ project, onFileSelect, onLoaded, className }: ProjectFileManagerProps) => {
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [branches, setBranches] = useState<DomainBranch[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')
  const [branchResolved, setBranchResolved] = useState(false)
  const [branchProjectId, setBranchProjectId] = useState<string>('')
  const projectIdRef = useRef(project?.id)
  projectIdRef.current = project?.id
  const selectedBranchRef = useRef(selectedBranch)
  selectedBranchRef.current = selectedBranch
  const isMountedRef = useRef(true)

  // 文件内容对话框状态
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<TreeEntry | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileLoading, setFileLoading] = useState(false)

  const languageMode = useMemo(() => {
    return selectedFile?.name ? getLanguageMode(selectedFile.name) : 'text'
  }, [selectedFile])

  const fetchRootEntries = useCallback(async () => {
    if (!project?.id) {
      setEntries([])
      setLoading(false)
      return
    }
    if (!branchResolved) return
    if (branchProjectId !== project.id) return

    const requestedProjectId = project.id
    const requestedBranch = selectedBranch
    setLoading(true)
    await apiRequest('v1UsersProjectsTreeDetail', {
      recursive: false,
      path: '',
      ref: selectedBranch || undefined
    }, [project?.id], (resp) => {
      // 忽略过期响应：切换 project 后，旧请求可能晚于新请求返回；或组件已卸载
      if (!isMountedRef.current || projectIdRef.current !== requestedProjectId) return
      if (selectedBranchRef.current !== requestedBranch) return
      if (resp.code === 0) {
        setEntries(sortEntries(resp.data || []))
      } else {
        setEntries([])
      }
    })
    if (!isMountedRef.current || projectIdRef.current !== requestedProjectId) return
    if (selectedBranchRef.current !== requestedBranch) return
    setLoading(false)
    onLoaded?.()
  }, [project?.id, onLoaded, selectedBranch, branchProjectId, branchResolved])

  // 获取分支列表
  useEffect(() => {
    const fetchBranches = async () => {
      if (!project?.id || !project?.git_identity_id || !project?.full_name) {
        setBranches([])
        setSelectedBranch('')
        setBranchProjectId(project?.id || '')
        setBranchResolved(true)
        return
      }

      const requestedProjectId = project.id
      const encodedRepoName = encodeURIComponent(project.full_name)
      setBranches([])
      setSelectedBranch('')
      setEntries([])
      setLoading(true)
      setBranchProjectId('')
      setBranchResolved(false)

      await apiRequest('v1UsersGitIdentitiesBranchesDetail', {}, [project.git_identity_id, encodedRepoName], (resp) => {
        if (projectIdRef.current !== requestedProjectId) return
        if (resp.code === 0 && resp.data) {
          setBranches(resp.data)
          if (resp.data.length > 0) {
            const branchNames = resp.data.map((b: DomainBranch) => b.name || '').filter(Boolean)
            let defaultBranch = ''
            if (branchNames.includes('main')) {
              defaultBranch = 'main'
            } else if (branchNames.includes('master')) {
              defaultBranch = 'master'
            } else {
              defaultBranch = branchNames.sort()[0] || ''
            }
            setSelectedBranch(defaultBranch)
          }
        }
        setBranchProjectId(requestedProjectId)
        setBranchResolved(true)
      }, () => {
        if (projectIdRef.current !== requestedProjectId) return
        setBranchProjectId(requestedProjectId)
        setBranchResolved(true)
      })
    }

    fetchBranches()
  }, [project?.id, project?.git_identity_id, project?.full_name])

  useEffect(() => {
    isMountedRef.current = true
    fetchRootEntries()
    return () => {
      isMountedRef.current = false
    }
  }, [project?.id, fetchRootEntries])

  // 获取文件内容
  const fetchFileContent = useCallback(async (entry: TreeEntry) => {
    if (!project?.id) return
    setFileLoading(true)
    setFileContent('')
    
    await apiRequest('v1UsersProjectsTreeBlobDetail', {
      path: entry.path || '',
      ref: selectedBranch || undefined,
    }, [project?.id], (resp) => {
      if (selectedBranchRef.current !== selectedBranch) return
      if (resp.code === 0 && resp.data?.content) {
        setFileContent(b64decode(resp.data?.content))
      }
    })
    setFileLoading(false)
  }, [project?.id, selectedBranch])

  // 处理文件点击
  const handleFileClick = useCallback((entry: TreeEntry) => {
    setSelectedFile(entry)
    setDialogOpen(true)
    fetchFileContent(entry)
    
    // 如果有外部回调也调用
    if (onFileSelect) {
      onFileSelect(entry)
    }
  }, [fetchFileContent, onFileSelect])

  const Header = (
    <div className="px-4 py-2 flex items-center justify-between border-b bg-muted/50">
      <div className="flex items-center gap-2">
        <Label className="flex items-center">
          <IconFolderOpen className="size-4" />
          项目文件
        </Label>
        {branches.length > 0 && (
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-[140px] text-xs" style={{ height: '28px' }}>
              <SelectValue placeholder="选择分支" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch.name} value={branch.name || ''} className="text-xs">
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 cursor-pointer"
        disabled={!project?.repo_url}
        onClick={() => project?.repo_url && window.open(project.repo_url, '_blank')}
      >
        <IconExternalLink className="size-4" />
        访问原仓库
      </Button>
    </div>
  )

  if (!project?.id) {
    return null
  }

  if (loading) {
    return (
      <div className={cn("flex flex-col border rounded-md", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>正在加载...</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className={cn("flex flex-col border rounded-md", className)}>
        {Header}
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>当前项目没有文件</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <>
      <div className={cn("flex flex-col border rounded-md", className)}>
        {Header}
        <div className="flex-1">
          <div className="p-1">
            {entries.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                projectId={project?.id || ''}
                depth={0}
                branch={selectedBranch}
                onFileSelect={handleFileClick}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 文件内容对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[80vw] xl:max-w-[60vw] h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconFile className="h-5 w-5" />
              <span className="truncate">{selectedFile?.path}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden rounded-md border">
            {fileLoading ? (
              <Empty className="opacity-50 h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <IconLoader className="animate-spin" />
                  </EmptyMedia>
                </EmptyHeader>
              </Empty>
            ) : (
              <AceEditor
                mode={languageMode}
                theme="monkeycode"
                width="100%"
                height="100%"
                readOnly={true}
                value={fileContent}
                showPrintMargin={false}
                showGutter={true}
                setOptions={{
                  fontFamily: "var(--font-code)",
                  fontSize: 12,
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default ProjectFileManager
