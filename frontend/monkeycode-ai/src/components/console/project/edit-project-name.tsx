import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import type { DomainProject } from "@/api/Api"
import { useEffect, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"

interface EditProjectNameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function EditProjectNameDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditProjectNameDialogProps) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && project) {
      setName(project.name || "")
      setDescription(project.description || "")
    } else if (!open) {
      setName("")
      setDescription("")
    }
  }, [open, project])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("请输入项目名称")
      return
    }

    setLoading(true)

    await apiRequest('v1UsersProjectsUpdate', { 
      name: name.trim(),
      description: description.trim(),
    }, [project?.id!], (resp) => {
        if (resp.code === 0) {
          toast.success("项目修改成功")
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error("修改项目失败: " + resp.message)
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setName("")
    setDescription("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改项目</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-name">项目名称</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="请输入项目名称"
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-description">项目描述</Label>
          <Textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="请输入项目描述（选填）"
            disabled={loading}
            className="break-all"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

