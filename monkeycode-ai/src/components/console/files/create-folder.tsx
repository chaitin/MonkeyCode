import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"

interface CreateFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDir: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

export default function CreateFolderDialog({
  open,
  onOpenChange,
  targetDir,
  envid,
  baseDir = '',
  onSuccess,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setFolderName('')
    }
  }, [open])

  const handleCreate = async () => {
    if (!folderName.trim() || !envid) {
      toast.error('请输入文件夹名称')
      return
    }

    const folderPath = normalizePath(baseDir + '/' + targetDir + '/' + folderName.trim())
    setCreating(true)
    await apiRequest('v1UsersFoldersCreate', {
        id: envid,
        path: folderPath
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(`已创建文件夹 "${folderName.trim()}"`)
          onOpenChange(false)
          if (onSuccess) {
            onSuccess()
          }
        } else {
          toast.error("创建文件夹失败: " + resp.message);
        }
      })
    setCreating(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建文件夹</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>目标目录</FieldLabel>
            <Input
              value={targetDir || './'}
              readOnly
              className="bg-muted"
            />
          </Field>
          <Field>
            <FieldLabel>新文件夹名称</FieldLabel>
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={!folderName.trim() || creating}>
            {creating && <Spinner />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
