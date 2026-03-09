import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"

interface MoveFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourcePath: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

export default function MoveFileDialog({
  open,
  onOpenChange,
  sourcePath,
  envid,
  baseDir = '',
  onSuccess,
}: MoveFileDialogProps) {
  const [targetDir, setTargetDir] = useState('')
  const [targetFileName, setTargetFileName] = useState('')
  const [moving, setMoving] = useState(false)

  useEffect(() => {
    if (open && sourcePath) {
      // 从源文件路径推断目标目录和文件名
      const pathParts = sourcePath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const dirPath = pathParts.slice(0, -1).join('/')
      
      setTargetDir(dirPath || './')
      setTargetFileName(fileName)
    }
  }, [open, sourcePath])

  const handleMove = async () => {
    if (!sourcePath || !targetFileName.trim() || !envid) {
      toast.error('请填写完整信息')
      return
    }

    // API 调用时添加 baseDir 前缀
    const fullSourcePath = normalizePath(baseDir + '/' + sourcePath)
    const fullTargetPath = normalizePath(baseDir + '/' + targetDir + '/' + targetFileName.trim())
    
    setMoving(true)
    await apiRequest('v1UsersFilesMoveUpdate', {
        id: envid,
        source: fullSourcePath,
        target: fullTargetPath
      }, [], (resp) => {
        if (resp.code === 0) {
          toast.success(`已移动文件 "${targetFileName.trim()}"`)
          onOpenChange(false)
          if (onSuccess) {
            onSuccess()
          }
        } else {
          toast.error("移动文件失败: " + resp.message);
        }
      })
    setMoving(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>移动文件</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>源文件路径</FieldLabel>
            <Input
              value={sourcePath}
              readOnly
              className="bg-muted"
            />
          </Field>
          <Field>
            <FieldLabel>目标目录</FieldLabel>
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>新文件名称</FieldLabel>
            <Input
              value={targetFileName}
              onChange={(e) => setTargetFileName(e.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleMove} disabled={!sourcePath || !targetDir.trim() || !targetFileName.trim() || moving}>
            {moving && <Spinner />}
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
