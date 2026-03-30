import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { apiRequest } from "@/utils/requestUtils"
import { normalizePath } from "@/utils/common"
import { TaskflowFileKind, type TaskflowFile } from "@/api/Api"
import { toast } from "sonner"
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconFolderOpen } from "@tabler/icons-react"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface TreeNode {
  file: TaskflowFile
  path: string
  depth: number
  children?: TreeNode[]
  isLoading?: boolean
}

interface FilePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  envid?: string
  onSelect: (filePaths: string[]) => void
  defaultSelectedFiles?: string[]
}

const ROOT_PATH = '/workspace'

export default function FilePickerDialog({
  open,
  onOpenChange,
  envid,
  onSelect,
  defaultSelectedFiles = [],
}: FilePickerDialogProps) {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])

  const sortFiles = (files: TaskflowFile[]) => {
    return [...files].sort((a, b) => {
      const getTypePriority = (file: TaskflowFile) => {
        if (file.kind === 'symlink') {
          return file.symlink_kind === 'dir' ? 0 : 2
        }
        return file.kind === 'dir' ? 0 : 2
      }
      
      const priorityA = getTypePriority(a)
      const priorityB = getTypePriority(b)
      
      if (priorityA !== priorityB) {
        return priorityA - priorityB
      }
      
      return (a.name || '').localeCompare(b.name || '')
    })
  }

  const fetchFiles = useCallback(async (path: string, depth: number): Promise<TreeNode[]> => {
    if (!envid) return []

    let result: TreeNode[] = []
    await apiRequest('v1UsersFoldersList', {
      id: envid,
      path: path
    }, [], (resp) => {
      if (resp.code === 0) {
        // Filter out . and .. entries
        const filteredFiles = (resp.data || []).filter(
          (file: TaskflowFile) => file.name !== '.' && file.name !== '..'
        )
        const sortedFiles = sortFiles(filteredFiles)
        result = sortedFiles.map(file => ({
          file,
          path: normalizePath(path + '/' + file.name),
          depth,
        }))
      } else {
        toast.error("获取文件列表失败: " + resp.message)
      }
    })
    return result
  }, [envid])

  useEffect(() => {
    if (open) {
      setSelectedFiles(defaultSelectedFiles)
      setExpandedDirs(new Set([ROOT_PATH])) // Auto expand workspace
      setLoading(true)
      fetchFiles(ROOT_PATH, 1).then(children => {
        // Create root workspace node with children
        const rootNode: TreeNode = {
          file: { name: 'workspace', kind: TaskflowFileKind.FileKindDir },
          path: ROOT_PATH,
          depth: 0,
          children,
        }
        setTreeNodes([rootNode])
        setLoading(false)
      })
    }
  }, [open, defaultSelectedFiles, fetchFiles])

  const isDirectory = (file: TaskflowFile) => {
    return file.kind === 'dir' || (file.kind === 'symlink' && file.symlink_kind === 'dir')
  }

  const handleExpandToggle = async (node: TreeNode, e: React.MouseEvent) => {
    e.stopPropagation()
    const dirPath = node.path
    const isExpanded = expandedDirs.has(dirPath)

    if (isExpanded) {
      // Collapse: remove from expanded set
      setExpandedDirs(prev => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    } else {
      // Expand: load children if not loaded
      if (!node.children) {
        // Mark as loading
        setTreeNodes(prev => updateNodeChildren(prev, dirPath, [], true))
        
        const children = await fetchFiles(dirPath, node.depth + 1)
        setTreeNodes(prev => updateNodeChildren(prev, dirPath, children, false))
      }
      
      setExpandedDirs(prev => {
        const next = new Set(prev)
        next.add(dirPath)
        return next
      })
    }
  }

  const updateNodeChildren = (nodes: TreeNode[], targetPath: string, children: TreeNode[], isLoading: boolean): TreeNode[] => {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return { ...node, children, isLoading }
      }
      if (node.children) {
        return { ...node, children: updateNodeChildren(node.children, targetPath, children, isLoading) }
      }
      return node
    })
  }

  // Get all file paths under a node (recursively)
  const getAllFilesUnderNode = (node: TreeNode): string[] => {
    const files: string[] = []
    
    if (!isDirectory(node.file)) {
      files.push(node.path)
    } else if (node.children) {
      for (const child of node.children) {
        files.push(...getAllFilesUnderNode(child))
      }
    }
    
    return files
  }

  // Check directory selection state
  const getDirSelectionState = (node: TreeNode): 'none' | 'some' | 'all' => {
    if (!node.children || node.children.length === 0) {
      return 'none'
    }
    
    const allFiles = getAllFilesUnderNode(node)
    if (allFiles.length === 0) return 'none'
    
    const selectedCount = allFiles.filter(f => selectedFiles.includes(f)).length
    
    if (selectedCount === 0) return 'none'
    if (selectedCount === allFiles.length) return 'all'
    return 'some'
  }

  // Check if a directory has unloaded content (itself or child directories)
  const hasUnloadedContent = (node: TreeNode): boolean => {
    // If this directory itself hasn't been loaded
    if (!node.children) return true
    
    // Check child directories
    for (const child of node.children) {
      if (isDirectory(child.file)) {
        // This child is a directory - check if it's loaded
        if (!child.children) {
          return true // Unloaded directory found
        }
        // Recursively check
        if (hasUnloadedContent(child)) {
          return true
        }
      }
    }
    return false
  }

  const handleFileToggle = (filePath: string) => {
    setSelectedFiles(prev => 
      prev.includes(filePath)
        ? prev.filter(f => f !== filePath)
        : [...prev, filePath]
    )
  }

  const handleDirToggle = async (node: TreeNode) => {
    // If not expanded, expand first to load children
    if (!node.children) {
      setTreeNodes(prev => updateNodeChildren(prev, node.path, [], true))
      const children = await fetchFiles(node.path, node.depth + 1)
      setTreeNodes(prev => updateNodeChildren(prev, node.path, children, false))
      
      // After loading, select all files
      const allFiles = children.flatMap(child => {
        if (!isDirectory(child.file)) {
          return [child.path]
        }
        return []
      })
      
      setSelectedFiles(prev => {
        const newSelected = [...prev]
        for (const file of allFiles) {
          if (!newSelected.includes(file)) {
            newSelected.push(file)
          }
        }
        return newSelected
      })
      
      // Also expand
      setExpandedDirs(prev => {
        const next = new Set(prev)
        next.add(node.path)
        return next
      })
      return
    }
    
    const state = getDirSelectionState(node)
    const allFiles = getAllFilesUnderNode(node)
    
    if (state === 'all') {
      // Unselect all
      setSelectedFiles(prev => prev.filter(f => !allFiles.includes(f)))
    } else {
      // Select all
      setSelectedFiles(prev => {
        const newSelected = [...prev]
        for (const file of allFiles) {
          if (!newSelected.includes(file)) {
            newSelected.push(file)
          }
        }
        return newSelected
      })
    }
  }

  const handleConfirm = () => {
    onSelect(selectedFiles)
    onOpenChange(false)
  }

  const getFileIcon = (file: TaskflowFile, isExpanded: boolean) => {
    const kind = file.kind === 'symlink' ? file.symlink_kind : file.kind
    switch (kind) {
      case 'dir':
        return isExpanded 
          ? <IconFolderOpen className="h-4 w-4 text-yellow-500" />
          : <IconFolder className="h-4 w-4 text-yellow-500" />
      case 'file':
      default:
        return <IconFile className="h-4 w-4" />
    }
  }

  const formatFileSize = (size?: number) => {
    if (size === undefined || size === null) return ''
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const renderNode = (node: TreeNode): React.ReactNode => {
    const isDir = isDirectory(node.file)
    const isExpanded = expandedDirs.has(node.path)
    const isSelected = selectedFiles.includes(node.path)
    const dirState = isDir ? getDirSelectionState(node) : null
    const hasUnloaded = isDir && hasUnloadedContent(node)
    const paddingLeft = node.depth * 16 + 12

    return (
      <div key={node.path}>
        <div
          className={cn(
            "flex items-center gap-2 py-3 cursor-pointer border-b",
            (isSelected || dirState === 'all') ? "bg-primary/10" : "hover:bg-muted",
            isDir && "font-medium"
          )}
          style={{ paddingLeft }}
          onClick={() => isDir ? handleDirToggle(node) : handleFileToggle(node.path)}
        >
          {/* Chevron for directories, spacer for files */}
          {isDir ? (
            <div 
              className="flex items-center size-4"
              onClick={(e) => handleExpandToggle(node, e)}
            >
              {node.isLoading ? (
                <Spinner className="size-4" />
              ) : isExpanded ? (
                <IconChevronDown className="size-4" />
              ) : (
                <IconChevronRight className="size-4" />
              )}
            </div>
          ) : (
            <div className="size-4" /> 
          )}
          {/* Checkbox */}
          <Checkbox
            checked={isDir ? dirState === 'all' : isSelected}
            indeterminate={isDir ? dirState === 'some' : false}
            onClick={(e) => {
              e.stopPropagation()
              if (isDir) {
                handleDirToggle(node)
              } else {
                handleFileToggle(node.path)
              }
            }}
          />
          {getFileIcon(node.file, isExpanded)}
          <span className="truncate text-sm">{node.file.name}</span>
          {isDir && hasUnloaded && (
            <span className="text-muted-foreground text-xs flex-shrink-0">
              (子目录未完全加载)
            </span>
          )}
          <span className="flex-1" />
          {node.file.kind === 'symlink' && node.file.symlink_target && (
            <span className="text-muted-foreground text-xs pr-3">
              → {node.file.symlink_target}
            </span>
          )}
          {!isDir && node.file.size !== undefined && (
            <span className="text-muted-foreground text-xs pr-3 flex-shrink-0">
              {formatFileSize(node.file.size)}
            </span>
          )}
        </div>
        {isDir && isExpanded && node.children && (
          <>
            {node.children.length === 0 ? (
              <div 
                className="text-muted-foreground text-xs py-1 border-b"
                style={{ paddingLeft: paddingLeft + 24 }}
              >
                (空目录)
              </div>
            ) : (
              node.children.map(child => renderNode(child))
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择产出物</DialogTitle>
        </DialogHeader>
        <div className="h-[50vh] overflow-y-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner className="size-6" />
            </div>
          ) : treeNodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground py-8">
              此目录为空
            </div>
          ) : (
            <div className="flex flex-col">
              {treeNodes.map(node => renderNode(node))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
