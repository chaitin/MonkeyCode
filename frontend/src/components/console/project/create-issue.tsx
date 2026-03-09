import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEffect, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import MarkdownEditor from "@/components/common/markdown-editor"

interface CreateIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onSuccess?: () => void
}

export default function CreateIssueDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: CreateIssueDialogProps) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setTitle("")
      setBody("")
    }
  }, [open])

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("请输入需求标题")
      return
    }

    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesCreate', { 
      title: title.trim(), 
      requirement_document: body.trim() 
    }, [projectId], (resp) => {
        if (resp.code === 0) {
          toast.success("需求创建成功")
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(resp.message || "创建需求失败")
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setTitle("")
    setBody("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建需求</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">需求标题</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入需求标题"
              disabled={loading}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="body">原始需求说明</Label>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              disabled={loading}
              className="min-h-60 max-h-[50vh]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || !title.trim()}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

