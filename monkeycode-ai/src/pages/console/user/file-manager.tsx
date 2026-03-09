import { useState, useEffect, Fragment } from "react"
import { useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { ConstsFileKind, type DomainVirtualMachine, type TypesFile } from "@/api/Api"
import { Link as LinkIcon, MoreVertical } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { getStatusBadgeProps, translateStatus, normalizePath, downloadFile } from "@/utils/common"
import { IconArrowLeft, IconCirclePlus, IconCopy, IconDownload, IconFile, IconFileText, IconFolder, IconFolderFilled, IconReload, IconTransfer, IconTrash, IconUpload } from "@tabler/icons-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Spinner } from "@/components/ui/spinner"
import FileEditor from "@/components/console/files/editor"
import MoveFileDialog from "@/components/console/files/move"
import CopyFileDialog from "@/components/console/files/copy"
import CreateFolderDialog from "@/components/console/files/create-folder"
import CreateFileDialog from "@/components/console/files/create-file"
import UploadFileDialog from "@/components/console/files/upload-file"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

const formatPermissions = (mode?: number) => {
  if (typeof mode !== 'number') return '未知'
  
  // 只取低9位（用户、组、其他用户的权限）
  const perm = mode & 0o777
  
  // 定义权限字符
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  
  // 提取用户、组、其他用户的权限
  const user = perms[(perm >> 6) & 0o7]
  const group = perms[(perm >> 3) & 0o7]
  const others = perms[perm & 0o7]
  
  // 检查是否是目录
  const isDirectory = (mode & 0o40000) !== 0
  
  return (isDirectory ? 'd' : '-') + user + group + others
}

const formatFileSize = (bytes?: number) => {
  if (!bytes || bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return '未知'
  const date = new Date(timestamp * 1000) // 假设时间戳是秒级的
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-')
}

const sortFiles = (files: TypesFile[]) => {
  return [...files].sort((a, b) => {
    // 首先按类型排序：目录在前，文件在后，符号链接根据 symlink_kind 判断
    const getTypePriority = (file: TypesFile) => {
      if (file.kind === ConstsFileKind.FileKindSymlink) {
        // 符号链接根据 symlink_kind 判断类型
        return file.symlink_kind === ConstsFileKind.FileKindDir ? 0 : 2
      }
      return file.kind === ConstsFileKind.FileKindDir ? 0 : 2
    }
    
    const priorityA = getTypePriority(a)
    const priorityB = getTypePriority(b)
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }
    
    // 类型相同时，按文件名字典序排序
    return (a.name || '').localeCompare(b.name || '')
  })
}

const getFileIcon = (file: TypesFile) => {
  const kind = file.kind === ConstsFileKind.FileKindSymlink ? file.symlink_kind : file.kind
  switch (kind) {
    case ConstsFileKind.FileKindDir:
      return <IconFolderFilled className="h-4 w-4 text-amber-500" />
    case ConstsFileKind.FileKindSymlink:
      return <LinkIcon className="h-4 w-4" />
    case ConstsFileKind.FileKindFile:
    default:
      return <IconFileText className="h-4 w-4" />
  }
}

export default function FileManagerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [files, setFiles] = useState<TypesFile[]>([])
  const [loading, setLoading] = useState(true)
  const [vm, setVm] = useState<DomainVirtualMachine | null>(null)
  const [envid] = useState<string>(searchParams.get('envid') || '')
  const [currentPath, setCurrentPath] = useState<string>(normalizePath(searchParams.get('path') || '/'))
  const [editFileDialogOpen, setEditFileDialogOpen] = useState(false)
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false)
  const [createFileDialogOpen, setCreateFileDialogOpen] = useState(false)
  const [uploadFileDialogOpen, setUploadFileDialogOpen] = useState(false)
  const [connectionErrorDialogOpen, setConnectionErrorDialogOpen] = useState(false)
  const [copyFileDialogOpen, setCopyFileDialogOpen] = useState(false)
  const [copySourcePath, setCopySourcePath] = useState('')
  const [moveFileDialogOpen, setMoveFileDialogOpen] = useState(false)
  const [moveSourcePath, setMoveSourcePath] = useState('')


  // 获取虚拟机详情
  const fetchVMInfo = async () => {    
    if (!envid) {
      return
    }

    await apiRequest('v1UsersHostsVmsDetail', {}, [envid], (resp) => {
      if (resp.code === 0) {
        setVm(resp.data || null)
        setConnectionErrorDialogOpen(false)
      } else {
        setConnectionErrorDialogOpen(true)
      }
    }, () => {
      setConnectionErrorDialogOpen(true)
    })
  }

  useEffect(() => {
    fetchVMInfo()
  }, [])
  
  useEffect(() => {
    fetchFiles()
  }, [currentPath])
  
  // 获取文件列表
  const fetchFiles = async () => {
    if (!envid) {
      setFiles([])
      setLoading(false)
      return
    }

    setLoading(true)
    await apiRequest('v1UsersFoldersList', {
      id: envid,
      path: currentPath
    }, [], (resp) => {
      if (resp.code === 0) {
        setFiles(sortFiles(resp.data || []))
      } else {
        toast.error(resp.message || "获取文件列表失败")
      }
    })
    setLoading(false)
  }

  const ChangeDirectory = (path: string) => {
    if (path.startsWith('/')) {
      path = normalizePath(path)
    } else {
      path = normalizePath(currentPath + '/' + path)
    }
    setCurrentPath(path)
    setSearchParams({ envid: envid, path: path })
  }

  const handleFileClick = (file: TypesFile) => {
    if ((file.kind === ConstsFileKind.FileKindDir || (file.kind === ConstsFileKind.FileKindSymlink && file.symlink_kind === ConstsFileKind.FileKindDir)) && file.name) {
      ChangeDirectory(file.name)
    } else if (file.kind === ConstsFileKind.FileKindFile) {
      if (file.size && file.size > 1024 * 1024) {
        toast.error('文件太大，禁止在线编辑（超过 1MB）')
        return
      }
      
      setEditingFile(normalizePath(currentPath + '/' + file.name))
      setEditFileDialogOpen(true)
    }
  }

  const handleDeleteFile = async (file: TypesFile) => {
    if (!file.name || !envid) {
      return
    }

    const filePath = normalizePath(currentPath + '/' + file.name)
    const fileType = file.kind === ConstsFileKind.FileKindDir || (file.kind === ConstsFileKind.FileKindSymlink && file.symlink_kind === ConstsFileKind.FileKindDir) ? '目录' : '文件'

    await apiRequest('v1UsersFilesDelete',{
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已删除${fileType} "${file.name}"`)
        fetchFiles()
      } else {
        toast.error(resp.message || "删除文件失败")
      }
    })
  }


  const handleCopyFileClick = (file: TypesFile) => {
    if (!file.name) {
      return
    }
    
    const sourcePath = normalizePath(currentPath + '/' + file.name)
    setCopySourcePath(sourcePath)
    setCopyFileDialogOpen(true)
  }

  const handleMoveFileClick = (file: TypesFile) => {
    if (!file.name) {
      return
    }
    
    const sourcePath = normalizePath(currentPath + '/' + file.name)
    setMoveSourcePath(sourcePath)
    setMoveFileDialogOpen(true)
  }

  const breadcrumbList = () => {
    const parts = ['/'].concat(currentPath.split('/').filter((part) => part !== ''))
    return (
      <BreadcrumbList>
        {parts.map((part, i) => {
          const path = normalizePath('/' + parts.slice(0, i + 1).join('/'))
          return (
            <Fragment key={i}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem onClick={() => ChangeDirectory(path)} className="cursor-pointer hover:underline hover:text-primary">
                {part}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center gap-2">
          {vm?.name}
          <Badge {...getStatusBadgeProps(vm?.status)}>{translateStatus(vm?.status)}</Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="hidden md:block cursor-default">{vm?.os}</Badge>
            </TooltipTrigger>
            <TooltipContent>
              操作系统
            </TooltipContent>
          </Tooltip>
        </div>
        {/*<ModeToggle />*/}
      </div>
      <div className="p-2 pt-0">
        <div className="mt-0 border rounded-lg">
          <div className="flex items-center gap-2 p-2">
            <Button variant="outline" size="sm" className="hidden sm:flex" onClick={() => ChangeDirectory('..')}>
              <IconArrowLeft />
              上级目录
            </Button>
            <Breadcrumb className="flex-1 bg-muted rounded-md py-1.5 text-sm px-4">
              {breadcrumbList()}
            </Breadcrumb>
            <Button variant="outline" size="sm" className="hidden sm:flex" onClick={fetchFiles}>
              <IconReload />
              重新加载
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden sm:flex">
                  <IconCirclePlus />
                  新建
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCreateFolderDialogOpen(true)}>
                  <IconFolder />
                  创建文件夹
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateFileDialogOpen(true)}>
                  <IconFile />
                  创建文件
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUploadFileDialogOpen(true)}>
                  <IconUpload />
                  上传文件
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Separator />
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[40%] pl-2">名称</TableHead>
                <TableHead className="w-[10%]">大小</TableHead>
                <TableHead className="hidden sm:table-cell w-[15%]">用户</TableHead>
                <TableHead className="hidden md:table-cell w-[15%]">属性</TableHead>
                <TableHead className="hidden lg:table-cell w-[15%]">修改时间</TableHead>
                <TableHead className="w-[5%] pr-2"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-3.5">
                    <div className="flex items-center justify-center gap-2">
                      <Spinner className="size-4" />
                      正在加载
                    </div>
                  </TableCell>
                </TableRow>
              }
              {files.length === 0 && !loading &&
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-3.5">
                    无数据
                  </TableCell>
                </TableRow>
              }
              {!loading && files.map((file) => (
                <TableRow key={file.name} className="group">
                  <TableCell
                    className="cursor-pointer pl-2"
                    onClick={() => handleFileClick(file)}
                  >
                    <div className="flex items-center gap-2">
                      {getFileIcon(file)}
                      <span className="hover:underline">{file.name}</span>
                      {file.kind === ConstsFileKind.FileKindSymlink && file.symlink_target && (
                        <span className="text-muted-foreground text-xs">
                          → {file.symlink_target}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatFileSize(file.size)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">
                    {file.user || '未知'}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {formatPermissions(file.unix_mode)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {formatTimestamp(file.updated_at || file.created_at)}
                  </TableCell>
                  <TableCell className="pr-2">
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {file.kind === ConstsFileKind.FileKindFile && (
                            <DropdownMenuItem onClick={() => handleCopyFileClick(file)}>
                              <IconCopy />复制
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleMoveFileClick(file)}>
                            <IconTransfer />移动
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={async () => {
                            const filePath = normalizePath(currentPath + '/' + file.name)
                            const filename = file.kind === ConstsFileKind.FileKindDir ? `${file.name}.zip` : file.name
                            try {
                              await downloadFile(envid, filePath, filename)
                            } catch (error) {
                              toast.error('下载失败：' + (error instanceof Error ? error.message : '未知错误'))
                            }
                          }}>
                            <IconDownload />下载
                          </DropdownMenuItem>
                          {file.kind === ConstsFileKind.FileKindFile && <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem className="text-destructive" onSelect={(e) => { e.preventDefault() }}>
                                <IconTrash />删除
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>确认删除</AlertDialogTitle>
                                <AlertDialogDescription>
                                  确定要删除 "{normalizePath(currentPath + '/' + file.name)}" 吗？此操作不可撤销。
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>取消</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteFile(file)}>确认删除</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <FileEditor
        open={editFileDialogOpen}
        onOpenChange={setEditFileDialogOpen}
        path={editingFile}
        envid={envid}
      />
      
      {/* 创建文件夹对话框 */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* 创建文件对话框 */}
      <CreateFileDialog
        open={createFileDialogOpen}
        onOpenChange={setCreateFileDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* 上传文件对话框 */}
      <UploadFileDialog
        open={uploadFileDialogOpen}
        onOpenChange={setUploadFileDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* 复制文件对话框 */}
      <CopyFileDialog
        open={copyFileDialogOpen}
        onOpenChange={setCopyFileDialogOpen}
        sourcePath={copySourcePath}
        envid={envid}
        onSuccess={() => {
          setCopySourcePath('')
          fetchFiles()
        }}
      />

      {/* 移动文件对话框 */}
      <MoveFileDialog
        open={moveFileDialogOpen}
        onOpenChange={setMoveFileDialogOpen}
        sourcePath={moveSourcePath}
        envid={envid}
        onSuccess={() => {
          setMoveSourcePath('')
          fetchFiles()
        }}
      />

      <AlertDialog open={connectionErrorDialogOpen} onOpenChange={setConnectionErrorDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>无法连接主机</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
          <AlertDialogCancel onClick={() => window.close()}>关闭</AlertDialogCancel>
          <AlertDialogAction onClick={() => window.location.reload()}>刷新</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
