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
import { nativeDownloadFile, normalizePath } from "@/utils/common"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { RepoFileEntryMode, type RepoFileStatus } from "./task-shared"
import CreateFolderDialog from "@/components/console/files/create-folder"
import CreateFileDialog from "@/components/console/files/create-file"
import UploadFileDialog from "@/components/console/files/upload-file"
import CopyFileDialog from "@/components/console/files/copy"
import MoveFileDialog from "@/components/console/files/move"
import { FileDownloadDialog } from "./file-download-dialog"
import { useTranslation } from "react-i18next"

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: {
    suggestedName?: string
  }) => Promise<FileSystemFileHandle>
}

interface FileActionsDropdownProps {
  file: RepoFileStatus
  envid?: string
  /** Manual refresh triggered by the refresh menu item. */
  onRefresh?: () => void
  /** Called after a file or directory operation succeeds. */
  onSuccess?: () => void
  /** Always show the trigger without relying on hover. */
  alwaysVisible?: boolean
  /** Hide move and delete actions, used for the root directory. */
  hideDestructive?: boolean
}

export function FileActionsDropdown({ file, envid, onRefresh, onSuccess, alwaysVisible, hideDestructive }: FileActionsDropdownProps) {
  const { t } = useTranslation()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [createFolderDialogOpen, setCreateFolderDialogOpen] = useState(false)
  const [createFileDialogOpen, setCreateFileDialogOpen] = useState(false)
  const [uploadFileDialogOpen, setUploadFileDialogOpen] = useState(false)
  const [copyFileDialogOpen, setCopyFileDialogOpen] = useState(false)
  const [moveFileDialogOpen, setMoveFileDialogOpen] = useState(false)
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false)
  const [downloadFileHandle, setDownloadFileHandle] = useState<FileSystemFileHandle | null>(null)

  const isDirectory = file.entry_mode === RepoFileEntryMode.RepoEntryModeTree
  const filePath = normalizePath('/workspace/' + file.path)
  const displayPath = filePath
  const downloadFilename = isDirectory ? `${file.name}.zip` : file.name
  const fileType = isDirectory ? t("taskDetail.fileActions.directory") : t("taskDetail.fileActions.file")

  const handleDelete = async () => {
    if (!envid) return

    await apiRequest('v1UsersFilesDelete', {
      id: envid,
      path: filePath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(t("taskDetail.fileActions.deleteSuccess", { fileType, fileName: file.name }))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("taskDetail.fileActions.deleteFailed"))
      }
    })
    setDeleteDialogOpen(false)
  }

  const handleDownloadClick = async () => {
    let nextFileHandle: FileSystemFileHandle | null = null
    const typedWindow = window as WindowWithSaveFilePicker

    if (typeof typedWindow.showSaveFilePicker === "function") {
      try {
        nextFileHandle = await typedWindow.showSaveFilePicker({
          suggestedName: downloadFilename,
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return
        }
      }
    }

    if (!nextFileHandle) {
      if (!envid) return
      nativeDownloadFile(envid, filePath, downloadFilename)
      return
    }

    setDownloadFileHandle(nextFileHandle)
    setDownloadDialogOpen(true)
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
          {isDirectory && (
            <>
              <DropdownMenuItem onClick={() => onRefresh?.()}>
                <IconReload className="h-4 w-4" />
                {t("taskDetail.fileActions.refresh")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setCreateFileDialogOpen(true)}>
                <IconFile className="h-4 w-4" />
                {t("taskDetail.fileActions.createFile")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCreateFolderDialogOpen(true)}>
                <IconFolder className="h-4 w-4" />
                {t("taskDetail.fileActions.createFolder")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setUploadFileDialogOpen(true)}>
                <IconUpload className="h-4 w-4" />
                {t("taskDetail.fileActions.uploadFile")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          
          {!isDirectory && (
            <DropdownMenuItem onClick={() => setCopyFileDialogOpen(true)}>
              <IconCopy className="h-4 w-4" />
              {t("taskDetail.fileActions.copy")}
            </DropdownMenuItem>
          )}
          
          {!hideDestructive && (
            <DropdownMenuItem onClick={() => setMoveFileDialogOpen(true)}>
              <IconTransfer className="h-4 w-4" />
              {t("taskDetail.fileActions.move")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => {
            void handleDownloadClick()
          }}>
            <IconDownload className="h-4 w-4" />
            {t("taskDetail.fileActions.download")}
          </DropdownMenuItem>
          {!hideDestructive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <IconTrash className="h-4 w-4" />
                {t("taskDetail.fileActions.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("taskDetail.fileActions.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("taskDetail.fileActions.deleteDescription", { fileType, displayPath })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("taskDetail.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t("taskDetail.fileActions.confirmDelete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {envid && (
        <FileDownloadDialog
          open={downloadDialogOpen}
          onOpenChange={(open) => {
            setDownloadDialogOpen(open)
            if (!open) {
              setDownloadFileHandle(null)
            }
          }}
          envid={envid}
          filePath={filePath}
          displayPath={displayPath}
          downloadFilename={downloadFilename}
          fileName={file.name}
          fileType={fileType}
          fileHandle={downloadFileHandle}
        />
      )}

      {envid && (
        <CreateFolderDialog
          open={createFolderDialogOpen}
          onOpenChange={setCreateFolderDialogOpen}
          targetDir={displayPath}
          envid={envid}
          onSuccess={onSuccess}
        />
      )}

      {envid && (
        <CreateFileDialog
          open={createFileDialogOpen}
          onOpenChange={setCreateFileDialogOpen}
          targetDir={displayPath}
          envid={envid}
          onSuccess={onSuccess}
        />
      )}

      {envid && (
        <UploadFileDialog
          open={uploadFileDialogOpen}
          onOpenChange={setUploadFileDialogOpen}
          targetDir={displayPath}
          envid={envid}
          onSuccess={onSuccess}
        />
      )}

      {envid && (
        <CopyFileDialog
          open={copyFileDialogOpen}
          onOpenChange={setCopyFileDialogOpen}
          sourcePath={displayPath}
          envid={envid}
          onSuccess={onSuccess}
        />
      )}

      {envid && (
        <MoveFileDialog
          open={moveFileDialogOpen}
          onOpenChange={setMoveFileDialogOpen}
          sourcePath={displayPath}
          envid={envid}
          onSuccess={onSuccess}
        />
      )}
    </>
  )
}
