import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEffect, useState } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { IconLoader } from "@tabler/icons-react"
import MarkdownEditor from "@/components/common/markdown-editor"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()

  useEffect(() => {
    if (!open) {
      setTitle("")
      setBody("")
    }
  }, [open])

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error(t("consoleProject.issue.create.toast.titleRequired"))
      return
    }

    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesCreate', { 
      title: title.trim(), 
      requirement_document: body.trim() 
    }, [projectId], (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleProject.issue.create.toast.created"))
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(resp.message || t("consoleProject.issue.create.toast.createFailed"))
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
          <DialogTitle>{t("consoleProject.issue.create.title")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">{t("consoleProject.issue.create.titleLabel")}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("consoleProject.issue.create.titlePlaceholder")}
              disabled={loading}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="body">{t("consoleProject.issue.create.requirementLabel")}</Label>
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
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading || !title.trim()}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
