import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { normalizePath } from "@/utils/common"
import AceEditor from "react-ace"
import "ace-builds/src-noconflict/theme-github"
import "ace-builds/src-noconflict/theme-terminal"
import { useTheme } from "@/components/theme-provider"

interface CreateFileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  targetDir: string
  envid: string
  baseDir?: string
  onSuccess?: () => void
}

export default function CreateFileDialog({
  open,
  onOpenChange,
  targetDir,
  envid,
  baseDir = '',
  onSuccess,
}: CreateFileDialogProps) {
  const { theme } = useTheme()
  const [fileName, setFileName] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (open) {
      setFileName('')
      setFileContent('')
    }
  }, [open])

  const handleCreate = async () => {
    if (!fileName.trim() || !envid) {
      toast.error('请输入文件名称')
      return
    }

    const filePath = normalizePath(baseDir + '/' + targetDir + '/' + fileName.trim())
    
    setCreating(true)
    await apiRequest('v1UsersFilesSaveUpdate', {
      id: envid,
      path: filePath,
      content: fileContent
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success(`已创建文件 "${fileName.trim()}"`)
        onOpenChange(false)
        if (onSuccess) {
          onSuccess()
        }
      } else {
        toast.error("创建文件失败: " + resp.message);
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
          <DialogTitle>创建文件</DialogTitle>
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
            <FieldLabel>新文件名称</FieldLabel>
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel>文件内容</FieldLabel>
            <div className="border rounded-md overflow-hidden p-0 overflow-y-hidden">
              <AceEditor
                mode="text"
                theme={theme === 'dark' ? 'terminal' : 'github'}
                value={fileContent}
                onChange={setFileContent}
                width="100%"
                fontSize={13}
                showPrintMargin={false}
                highlightActiveLine={false}
                height="30vh"
                setOptions={{
                  enableBasicAutocompletion: true,
                  enableLiveAutocompletion: true,
                  enableSnippets: true,
                  showLineNumbers: false,
                  showGutter: false,
                  tabSize: 2,
                  useWorker: false,
                }}
              />
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleCreate} disabled={!fileName.trim() || !fileContent.trim() || creating}>
            {creating && <Spinner />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
