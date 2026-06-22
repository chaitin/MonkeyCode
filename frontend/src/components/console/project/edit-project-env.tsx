import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { DomainProject } from "@/api/Api"
import { apiRequest } from "@/utils/requestUtils"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { IconLoader, IconPlus, IconTrash } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export type EnvVar = { key: string; value: string }

interface EditProjectEnvDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function EditProjectEnvDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditProjectEnvDialogProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [loading, setLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open && project) {
      const dict = project.env_variables ?? {}
      const vars: EnvVar[] = Object.entries(dict).map(([key, value]) => ({ key, value: String(value ?? "") }))
      setEnvVars(vars.length > 0 ? vars : [])
    }
  }, [open, project])

  const addRow = () => {
    setEnvVars((prev) => [...prev, { key: "", value: "" }])
  }

  const removeRow = (index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index))
  }

  const updateRow = (index: number, field: "key" | "value", value: string) => {
    setEnvVars((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  const handleSave = async () => {
    const validVars = envVars.filter((row) => row.key.trim() !== "")
    const hasEmptyKey = envVars.some((row) => row.key.trim() === "" && row.value.trim() !== "")
    if (hasEmptyKey) {
      toast.error(t("consoleProject.env.toast.incompletePair"))
      return
    }

    if (!project?.id) return

    setLoading(true)
    const envVariables = Object.fromEntries(validVars.map((v) => [v.key.trim(), v.value]))
    await apiRequest(
      "v1UsersProjectsUpdate",
      { env_variables: envVariables },
      [project.id],
      (resp) => {
        if (resp.code === 0) {
          toast.success(t("consoleProject.env.toast.saved"))
          onOpenChange(false)
          onSuccess?.()
        } else {
          toast.error(resp.message || t("consoleProject.env.toast.saveFailed"))
        }
      }
    )
    setLoading(false)
  }

  const handleCancel = () => {
    setEnvVars([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("consoleProject.env.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("consoleProject.env.description")}
          </p>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh]">
          {envVars.map((row, index) => (
            <div key={index} className="flex gap-2 items-center">
              <Input
                value={row.key}
                onChange={(e) => updateRow(index, "key", e.target.value)}
                placeholder={t("consoleProject.env.keyPlaceholder")}
                className="flex-[1] font-mono text-sm"
              />
              <Input
                value={row.value}
                onChange={(e) => updateRow(index, "value", e.target.value)}
                placeholder={t("consoleProject.env.valuePlaceholder")}
                className="flex-[2] font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(index)}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
            <IconPlus className="size-4" />
            {t("consoleProject.env.add")}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={loading}>
            {t("consoleProject.common.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <IconLoader className="size-4 animate-spin" />}
            {t("consoleProject.common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
