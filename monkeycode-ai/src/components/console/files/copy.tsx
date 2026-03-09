import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"

interface CopyFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourcePath: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

const generateNewFileName = (fileName: string): string => {
  // 在文件名后添加 _new
  const lastDotIndex = fileName.lastIndexOf('.')
  if (lastDotIndex > 0) {
    // 有扩展名的情况：test.txt -> test_new.txt
    const nameWithoutExt = fileName.substring(0, lastDotIndex)
    const ext = fileName.substring(lastDotIndex)
    return nameWithoutExt + '_new' + ext
  } else {
    // 没有扩展名的情况：test -> test_new
    return fileName + '_new'
  }
}

export default function CopyFileDialog({
  open,
  onOpenChange,
  sourcePath,
  envid,
  baseDir = '',
  onSuccess,
}: CopyFileDialogProps) {
  const [targetDir, setTargetDir] = useState('')
  const [targetFileName, setTargetFileName] = useState('')
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (open && sourcePath) {
      // 从源文件路径推断目标目录和文件名
      const pathParts = sourcePath.split('/')
      const fileName = pathParts[pathParts.length - 1]
      const dirPath = pathParts.slice(0, -1).join('/')
      
      setTargetDir(dirPath || './')
      setTargetFileName(generateNewFileName(fileName))
    }
  }, [open, sourcePath])

  const handleCopy = async () => {
    if (!sourcePath || !targetFileName.trim() || !envid) {
      toast.error('请填写完整信息')
      return
    }

    // API 调用时添加 baseDir 前缀
    const fullSourcePath = normalizePath(baseDir + '/' + sourcePath)
    const fullTargetPath = normalizePath(baseDir + '/' + targetDir + '/' + targetFileName.trim())
    
    setCopying(true)
    await apiRequest('v1UsersFilesCopyCreate', {
      id: envid,
      source: fullSourcePath,
      target: fullTargetPath
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已复制文件 "${targetFileName.trim()}"`)
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error("复制文件失败: " + resp.message);
      }
    })
    setCopying(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>复制文件</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field>
            <FieldLabel>源文件路径</FieldLabel>
            <Input
              value={sourcePath || './'}
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
          <Button onClick={handleCopy} disabled={!sourcePath || !targetDir.trim() || !targetFileName.trim() || copying}>
            {copying && <Spinner />}
            确认复制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
