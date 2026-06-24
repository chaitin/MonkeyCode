import { useCallback, useState, useEffect, Fragment } from "react"
import { useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { GithubComChaitinMonkeyCodeBackendPkgTaskflowFileKind as TaskflowFileKind, type DomainVirtualMachine, type GithubComChaitinMonkeyCodeBackendPkgTaskflowFile as TaskflowFile } from "@/api/Api"
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
import { useTranslation } from "react-i18next"

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
  }) => Promise<FileSystemFileHandle>
}

const formatPermissions = (mode: number | undefined, unknownText: string) => {
  if (typeof mode !== 'number') return unknownText

  // Keep only the low 9 permission bits for user, group, and others.
  const perm = mode & 0o777

  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']

  const user = perms[(perm >> 6) & 0o7]
  const group = perms[(perm >> 3) & 0o7]
  const others = perms[perm & 0o7]

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

const formatTimestamp = (timestamp: number | undefined, unknownText: string, locale: string) => {
  if (!timestamp) return unknownText
  const date = new Date(timestamp * 1000)
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-')
}

const sortFiles = (files: TaskflowFile[]) => {
  return [...files].sort((a, b) => {
    // Directories first, then files; symlinks are ordered by their target kind.
    const getTypePriority = (file: TaskflowFile) => {
      if (file.kind === TaskflowFileKind.FileKindSymlink) {
        return file.symlink_kind === TaskflowFileKind.FileKindDir ? 0 : 2
      }
      return file.kind === TaskflowFileKind.FileKindDir ? 0 : 2
    }

    const priorityA = getTypePriority(a)
    const priorityB = getTypePriority(b)

    if (priorityA !== priorityB) {
      return priorityA - priorityB
    }

    return (a.name || '').localeCompare(b.name || '')
  })
}

const getFileIcon = (file: TaskflowFile) => {
  const kind = file.kind === TaskflowFileKind.FileKindSymlink ? file.symlink_kind : file.kind
  switch (kind) {
    case TaskflowFileKind.FileKindDir:
      return <IconFolderFilled className="h-4 w-4 text-primary" />
    case TaskflowFileKind.FileKindSymlink:
      return <LinkIcon className="h-4 w-4" />
    case TaskflowFileKind.FileKindFile:
    default:
      return <IconFileText className="h-4 w-4" />
  }
}

export default function FileManagerPage() {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [files, setFiles] = useState<TaskflowFile[]>([])
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


  // Fetch virtual machine details.
  const fetchVMInfo = useCallback(async () => {
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
  }, [envid])

  // Fetch file list.
  const fetchFiles = useCallback(async () => {
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
        toast.error(resp.message || t("consoleFiles.toast.fetchFailed"))
      }
    })
    setLoading(false)
  }, [currentPath, envid, t])

  useEffect(() => {
    fetchVMInfo()
  }, [fetchVMInfo])

  useEffect(() => {

    fetchFiles()
  }, [fetchFiles])

  const ChangeDirectory = (path: string) => {
    if (path.startsWith('/')) {
      path = normalizePath(path)
    } else {
      path = normalizePath(currentPath + '/' + path)
    }
    setCurrentPath(path)
    setSearchParams({ envid: envid, path: path })
  }

  const handleFileClick = (file: TaskflowFile) => {
    if ((file.kind === TaskflowFileKind.FileKindDir || (file.kind === TaskflowFileKind.FileKindSymlink && file.symlink_kind === TaskflowFileKind.FileKindDir)) && file.name) {
      ChangeDirectory(file.name)
    } else if (file.kind === TaskflowFileKind.FileKindFile) {
      if (file.size && file.size > 1024 * 1024) {
        toast.error(t("consoleFiles.toast.editTooLarge"))
        return
      }

      setEditingFile(normalizePath(currentPath + '/' + file.name))
      setEditFileDialogOpen(true)
    }
  }

  const handleDeleteFile = async (file: TaskflowFile) => {
    if (!file.name || !envid) {
      return
    }

    const filePath = normalizePath(currentPath + '/' + file.name)
    const fileType = file.kind === TaskflowFileKind.FileKindDir || (file.kind === TaskflowFileKind.FileKindSymlink && file.symlink_kind === TaskflowFileKind.FileKindDir)
      ? t("consoleFiles.types.directory")
      : t("consoleFiles.types.file")

    await apiRequest('v1UsersFilesDelete',{
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleFiles.toast.deleted", { type: fileType, name: file.name }))
        fetchFiles()
      } else {
        toast.error(resp.message || t("consoleFiles.toast.deleteFailed"))
      }
    })
  }


  const handleCopyFileClick = (file: TaskflowFile) => {
    if (!file.name) {
      return
    }

    const sourcePath = normalizePath(currentPath + '/' + file.name)
    setCopySourcePath(sourcePath)
    setCopyFileDialogOpen(true)
  }

  const handleMoveFileClick = (file: TaskflowFile) => {
    if (!file.name) {
      return
    }

    const sourcePath = normalizePath(currentPath + '/' + file.name)
    setMoveSourcePath(sourcePath)
    setMoveFileDialogOpen(true)
  }

  const handleDownloadFile = async (file: TaskflowFile) => {
    if (!file.name || !envid) {
      return
    }

    const filePath = normalizePath(currentPath + '/' + file.name)
    const filename = file.kind === TaskflowFileKind.FileKindDir ? `${file.name}.zip` : file.name
    const typedWindow = window as WindowWithSaveFilePicker

    try {
      if (typeof typedWindow.showSaveFilePicker === "function") {
        let fileHandle: FileSystemFileHandle | null = null

        try {
          fileHandle = await typedWindow.showSaveFilePicker({
            suggestedName: filename,
          })
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }
        }

        if (fileHandle) {
          const writable = await fileHandle.createWritable()

          await downloadFile(envid, filePath, filename, undefined, undefined, writable)
          toast.success(t("consoleFiles.toast.downloaded", { name: filename }))
          return
        }
      }

      await downloadFile(envid, filePath, filename)
    } catch (error) {
      toast.error(t("consoleFiles.toast.downloadFailed", {
        message: error instanceof Error ? error.message : t("consoleFiles.common.unknownError"),
      }))
    }
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
              {t("consoleFiles.labels.os")}
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
              {t("consoleFiles.actions.parentDirectory")}
            </Button>
            <Breadcrumb className="flex-1 bg-muted rounded-md py-1.5 text-sm px-4">
              {breadcrumbList()}
            </Breadcrumb>
            <Button variant="outline" size="sm" className="hidden sm:flex" onClick={fetchFiles}>
              <IconReload />
              {t("consoleFiles.actions.reload")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="hidden sm:flex">
                  <IconCirclePlus />
                  {t("consoleFiles.actions.new")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCreateFolderDialogOpen(true)}>
                  <IconFolder />
                  {t("consoleFiles.actions.createFolder")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setCreateFileDialogOpen(true)}>
                  <IconFile />
                  {t("consoleFiles.actions.createFile")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUploadFileDialogOpen(true)}>
                  <IconUpload />
                  {t("consoleFiles.actions.uploadFile")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Separator />
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[40%] pl-2">{t("consoleFiles.table.name")}</TableHead>
                <TableHead className="w-[10%]">{t("consoleFiles.table.size")}</TableHead>
                <TableHead className="hidden sm:table-cell w-[15%]">{t("consoleFiles.table.user")}</TableHead>
                <TableHead className="hidden md:table-cell w-[15%]">{t("consoleFiles.table.permissions")}</TableHead>
                <TableHead className="hidden lg:table-cell w-[15%]">{t("consoleFiles.table.modifiedAt")}</TableHead>
                <TableHead className="w-[5%] pr-2"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading &&
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-3.5">
                    <div className="flex items-center justify-center gap-2">
                      <Spinner className="size-4" />
                      {t("consoleFiles.common.loading")}
                    </div>
                  </TableCell>
                </TableRow>
              }
              {files.length === 0 && !loading &&
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-3.5">
                    {t("consoleFiles.common.noData")}
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
                      {file.kind === TaskflowFileKind.FileKindSymlink && file.symlink_target && (
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
                    {file.user || t("consoleFiles.common.unknown")}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {formatPermissions(file.unix_mode, t("consoleFiles.common.unknown"))}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground">
                    {formatTimestamp(file.updated_at || file.created_at, t("consoleFiles.common.unknown"), i18n.language === "cn" ? "zh-CN" : "en-US")}
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
                          {file.kind === TaskflowFileKind.FileKindFile && (
                            <DropdownMenuItem onClick={() => handleCopyFileClick(file)}>
                              <IconCopy />{t("consoleFiles.actions.copy")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleMoveFileClick(file)}>
                            <IconTransfer />{t("consoleFiles.actions.move")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            void handleDownloadFile(file)
                          }}>
                            <IconDownload />{t("consoleFiles.actions.download")}
                          </DropdownMenuItem>
                          {file.kind === TaskflowFileKind.FileKindFile && <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <DropdownMenuItem className="text-destructive" onSelect={(e) => { e.preventDefault() }}>
                                <IconTrash />{t("consoleFiles.actions.delete")}
                              </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t("consoleFiles.dialog.deleteTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("consoleFiles.dialog.deleteDescription", { path: normalizePath(currentPath + '/' + file.name) })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("consoleFiles.actions.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteFile(file)}>{t("consoleFiles.actions.confirmDelete")}</AlertDialogAction>
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

      {/* Create folder dialog */}
      <CreateFolderDialog
        open={createFolderDialogOpen}
        onOpenChange={setCreateFolderDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* Create file dialog */}
      <CreateFileDialog
        open={createFileDialogOpen}
        onOpenChange={setCreateFileDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* Upload file dialog */}
      <UploadFileDialog
        open={uploadFileDialogOpen}
        onOpenChange={setUploadFileDialogOpen}
        targetDir={currentPath}
        envid={envid}
        onSuccess={fetchFiles}
      />

      {/* Copy file dialog */}
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

      {/* Move file dialog */}
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
            <AlertDialogTitle>{t("consoleFiles.alerts.hostConnectionFailed")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
          <AlertDialogCancel onClick={() => window.close()}>{t("consoleFiles.actions.close")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => window.location.reload()}>{t("consoleFiles.actions.refresh")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
