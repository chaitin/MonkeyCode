import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { DomainProject } from "@/api/Api"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { IconPlus, IconTrash } from "@tabler/icons-react"

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

  useEffect(() => {
    if (open && project) {
      // TODO: 从 API 获取项目环境变量，目前使用空列表
      setEnvVars([])
    } else if (!open) {
      setEnvVars([])
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

  const handleSave = () => {
    const validVars = envVars.filter((row) => row.key.trim() !== "")
    const hasEmptyKey = envVars.some((row) => row.key.trim() === "" && row.value.trim() !== "")
    if (hasEmptyKey) {
      toast.error("请填写完整的键值对，或删除空行")
      return
    }

    // TODO: 调用 API 保存环境变量
    console.log("保存环境变量:", validVars)
    toast.success("环境变量已保存（API 待实现）")
    onOpenChange(false)
    onSuccess?.()
  }

  const handleCancel = () => {
    setEnvVars([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>项目环境变量</DialogTitle>
          <p className="text-sm text-muted-foreground">
            配置项目运行时的环境变量，以键值对形式存储
          </p>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh]">
          {envVars.map((row, index) => (
            <div key={index} className="flex gap-2 items-center">
              <Input
                value={row.key}
                onChange={(e) => updateRow(index, "key", e.target.value)}
                placeholder="例如: API_KEY"
                className="flex-[1] font-mono text-sm"
              />
              <Input
                value={row.value}
                onChange={(e) => updateRow(index, "value", e.target.value)}
                placeholder="例如: your-secret-value"
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
            添加环境变量
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
