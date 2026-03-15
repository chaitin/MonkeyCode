import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { IconCopy, IconDotsVertical, IconDownload, IconFile, IconFolder, IconReload, IconTrash, IconTransfer, IconUpload } from "@tabler/icons-react"
import { RepoFileEntryMode, type RepoFileStatus } from "./ws-manager"
import { normalizePath, downloadFile } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import CreateFolderDialog from "@/components/console/files/create-folder"
import CreateFileDialog from "@/components/console/files/create-file"
import UploadFileDialog from "@/components/console/files/upload-file"
import CopyFileDialog from "@/components/console/files/copy"
import MoveFileDialog from "@/components/console/files/move"

interface FileActionsDropdownProps {
  file: RepoFileStatus
  envid?: string
  /** 手动刷新（由“刷新”菜单项触发） */
  onRefresh?: () => void
  /** 文件/目录操作成功后的回调 */
  onSuccess?: () => void
  /** 是否始终显示按钮（不依赖 hover） */
  alwaysVisible?: boolean
  /** 隐藏移动和删除操作（用于根目录） */
  hideDestructive?: boolean
}

export function FileActionsDropdown({ file, envid, onRefresh, onSuccess, alwaysVisible, hideDestructive }: FileActionsDropdownProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false)
  const [createFileDialogOpen, setCreateFileDialogOpen] = useState(false)
  const [uploadFileDialogOpen, setUploadFileDialogOpen] = useState(false)
  const [copyFileDialogOpen, setCopyFileDialogOpen] = useState(false)
  const [moveFileDialogOpen, setMoveFileDialogOpen] = useState(false)

  const isDirectory = file.entry_mode === RepoFileEntryMode.RepoEntryModeTree
  // 完整路径用于 API 调用
  const filePath = normalizePath('/workspace/' + file.path)
  // 显示路径用于界面展示（不含 /workspace 前缀）
  const displayPath = file.path
  const downloadFilename = isDirectory ? `${file.name}.zip` : file.name
  const fileType = isDirectory ? '目录' : '文件'

  const handleDelete = async () => {
    if (!envid) return

    await apiRequest('v1UsersFilesDelete', {
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已删除${fileType} "${file.name}"`)
        onSuccess?.()
      } else {
        toast.error(resp.message || "删除失败")
      }
    })
    setDeleteDialogOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`shrink-0 leading-none p-0 ${alwaysVisible ? 'size-8' : 'size-5 opacity-0 group-hover:opacity-100 transition-opacity'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <IconDotsVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {/* 目录专属操作 */}
          {isDirectory && (
            <>
              {/* 刷新单独一组，放在最上面 */}
              <DropdownMenuItem onClick={() => onRefresh?.()}>
                <IconReload className="h-4 w-4" />
                刷新
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateFileDialogOpen(true)}>
                <IconFile className="h-4 w-4" />
                创建文件
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateFolderDialogOpen(true)}>
                <IconFolder className="h-4 w-4" />
                创建目录
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUploadFileDialogOpen(true)}>
                <IconUpload className="h-4 w-4" />
                上传文件
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          
          {/* 文件专属操作 */}
          {!isDirectory && (
            <DropdownMenuItem onClick={() => setCopyFileDialogOpen(true)}>
              <IconCopy className="h-4 w-4" />
              复制
            </DropdownMenuItem>
          )}
          
          {/* 通用操作 */}
          {!hideDestructive && (
            <DropdownMenuItem onClick={() => setMoveFileDialogOpen(true)}>
              <IconTransfer className="h-4 w-4" />
              移动
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={async () => {
            if (!envid) return
            try {
              await downloadFile(envid, filePath, downloadFilename)
            } catch (error) {
              toast.error('下载失败：' + (error instanceof Error ? error.message : '未知错误'))
            }
          }}>
            <IconDownload className="h-4 w-4" />
            下载
          </DropdownMenuItem>
          {!hideDestructive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <IconTrash className="h-4 w-4" />
                删除
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 删除确认对话框 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除{fileType} "{displayPath}" 吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 创建文件夹对话框 */}
      {envid && (
        <CreateFolderDialog
          open={createFolderDialogOpen}
          onOpenChange={setCreateFolderDialogOpen}
          targetDir={displayPath}
          envid={envid}
          baseDir="/workspace"
          onSuccess={onSuccess}
        />
      )}

      {/* 创建文件对话框 */}
      {envid && (
        <CreateFileDialog
          open={createFileDialogOpen}
          onOpenChange={setCreateFileDialogOpen}
          targetDir={displayPath}
          envid={envid}
          baseDir="/workspace"
          onSuccess={onSuccess}
        />
      )}

      {/* 上传文件对话框 */}
      {envid && (
        <UploadFileDialog
          open={uploadFileDialogOpen}
          onOpenChange={setUploadFileDialogOpen}
          targetDir={displayPath}
          envid={envid}
          baseDir="/workspace"
          onSuccess={onSuccess}
        />
      )}

      {/* 复制文件对话框 */}
      {envid && (
        <CopyFileDialog
          open={copyFileDialogOpen}
          onOpenChange={setCopyFileDialogOpen}
          sourcePath={displayPath}
          envid={envid}
          baseDir="/workspace"
          onSuccess={onSuccess}
        />
      )}

      {/* 移动文件对话框 */}
      {envid && (
        <MoveFileDialog
          open={moveFileDialogOpen}
          onOpenChange={setMoveFileDialogOpen}
          sourcePath={displayPath}
          envid={envid}
          baseDir="/workspace"
          onSuccess={onSuccess}
        />
      )}
    </>
  )
}
