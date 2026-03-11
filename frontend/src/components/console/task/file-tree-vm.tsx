import { ConstsFileKind, type TypesFile } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { normalizePath } from "@/utils/common"
import { Button } from "@/components/ui/button"
import { IconChevronRight, IconFile, IconFolder, IconFolderOpen, IconLoader, IconReload } from "@tabler/icons-react"
import React, { useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface FileTreeVmProps {
  envid?: string
  disabled?: boolean
  rootPath?: string
  className?: string
}

const sortFiles = (files: TypesFile[]) =>
  [...files].sort((a, b) => {
    const isDir = (f: TypesFile) =>
      f.kind === ConstsFileKind.FileKindDir ||
      (f.kind === ConstsFileKind.FileKindSymlink && f.symlink_kind === ConstsFileKind.FileKindDir)
    const priority = (f: TypesFile) => (isDir(f) ? 0 : 1)
    if (priority(a) !== priority(b)) return priority(a) - priority(b)
    return (a.name || "").localeCompare(b.name || "")
  })

const getFileIcon = (file: TypesFile, expanded?: boolean) => {
  const isDir =
    file.kind === ConstsFileKind.FileKindDir ||
    (file.kind === ConstsFileKind.FileKindSymlink && file.symlink_kind === ConstsFileKind.FileKindDir)
  if (isDir) {
    return expanded ? (
      <IconFolderOpen className="size-4 text-amber-500 shrink-0" />
    ) : (
      <IconFolder className="size-4 text-amber-500 shrink-0" />
    )
  }
  return <IconFile className="size-4 text-muted-foreground shrink-0" />
}

interface TreeNodeProps {
  file: TypesFile
  path: string
  depth: number
  envid: string
  disabled: boolean
  onFileSelect?: (path: string, file: TypesFile) => void
}

function TreeNode({ file, path, depth, envid, disabled, onFileSelect }: TreeNodeProps) {
  const [children, setChildren] = useState<TypesFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const isDir =
    file.kind === ConstsFileKind.FileKindDir ||
    (file.kind === ConstsFileKind.FileKindSymlink && file.symlink_kind === ConstsFileKind.FileKindDir)

  const fetchChildren = useCallback(async () => {
    if (!envid || !isDir) return
    setLoading(true)
    await apiRequest("v1UsersFoldersList", { id: envid, path }, [], (resp) => {
      if (resp.code === 0) {
        setChildren(sortFiles(resp.data || []))
      } else {
        toast.error(resp.message || "获取文件列表失败")
      }
    })
    setLoading(false)
  }, [envid, path, isDir])

  const handleToggle = useCallback(() => {
    if (!isDir || disabled) return
    if (children === null) {
      void fetchChildren()
    }
    setExpanded((e) => !e)
  }, [isDir, disabled, children, fetchChildren])

  const handleClick = useCallback(() => {
    if (isDir) {
      handleToggle()
    } else if (onFileSelect && file.name) {
      onFileSelect(path, file)
    }
  }, [isDir, handleToggle, onFileSelect, path, file])

  const pl = 8 + depth * 16

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 px-1 rounded-sm cursor-pointer hover:bg-accent/50",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        style={{ paddingLeft: pl }}
        onClick={handleClick}
      >
        <span className="w-4 shrink-0 flex items-center justify-center">
          {isDir ? (
            <IconChevronRight
              className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-90")}
            />
          ) : (
            <span className="w-4" />
          )}
        </span>
        {loading ? (
          <IconLoader className="size-4 animate-spin text-muted-foreground shrink-0" />
        ) : (
          getFileIcon(file, expanded)
        )}
        <span className="text-sm truncate flex-1">{file.name}</span>
      </div>
      {isDir && expanded && (
        <div>
          {loading ? (
            <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
              <IconLoader className="size-4 animate-spin" />
              加载中...
            </div>
          ) : children !== null ? (
            children.map((child) => {
            const childPath = normalizePath(path + "/" + (child.name || ""))
            return (
              <TreeNode
                key={childPath}
                file={child}
                path={childPath}
                depth={depth + 1}
                envid={envid}
                disabled={disabled}
                onFileSelect={onFileSelect}
              />
            )
          })
          ) : null}
        </div>
      )}
    </div>
  )
}

export function FileTreeVm({ envid, disabled, rootPath = "/workspace", className }: FileTreeVmProps) {
  const [rootFiles, setRootFiles] = useState<TypesFile[] | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchRoot = useCallback(() => {
    if (!envid) return
    setLoading(true)
    apiRequest("v1UsersFoldersList", { id: envid, path: rootPath }, [], (resp) => {
      if (resp.code === 0) {
        setRootFiles(sortFiles(resp.data || []))
      } else {
        toast.error(resp.message || "获取文件列表失败")
      }
      setLoading(false)
    })
  }, [envid, rootPath])

  React.useEffect(() => {
    if (!envid) {
      setRootFiles(null)
      return
    }
    fetchRoot()
  }, [envid, fetchRoot])

  if (!envid) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", className)}>开发环境不可用</div>
    )
  }

  if (loading && rootFiles === null) {
    return (
      <div className={cn("flex items-center justify-center p-4 gap-2 text-sm text-muted-foreground", className)}>
        <IconLoader className="size-4 animate-spin" />
        加载中...
      </div>
    )
  }

  if (!rootFiles?.length) {
    return (
      <div className={cn("p-4 text-sm text-muted-foreground", className)}>空目录</div>
    )
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-end p-1 border-b shrink-0">
        <Button variant="ghost" size="icon-sm" onClick={fetchRoot} disabled={disabled}>
          <IconReload className="size-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto py-1">
      {rootFiles.map((file) => {
        const path = normalizePath(rootPath + "/" + (file.name || ""))
        return (
          <TreeNode
            key={path}
            file={file}
            path={path}
            depth={0}
            envid={envid}
            disabled={!!disabled}
            onFileSelect={undefined}
          />
        )
      })}
      </div>
    </div>
  )
}
