import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"

interface AddImageProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh?: () => void
}

export default function AddImage({
  open,
  onOpenChange,
  onRefresh,
}: AddImageProps) {
  const [imageName, setImageName] = useState("")
  const [remark, setRemark] = useState("")

  const handleSave = () => {
    if (!imageName.trim()) {
      toast.error("请输入镜像名称")
      return
    }

    apiRequest('v1UsersImagesCreate', { image_name: imageName.trim(), remark: remark.trim() || undefined }, [], (resp) => {
      if (resp.code === 0) {
        toast.success("镜像绑定成功")
        setImageName("")
        setRemark("")
        onOpenChange(false)
        onRefresh?.()
      } else {
        toast.error("绑定镜像失败: " + resp.message)
      }
    })
  }

  const handleCancel = () => {
    setImageName("")
    setRemark("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={"outline"} size="sm">绑定</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>绑定系统镜像</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>镜像名称</FieldLabel>
            <FieldContent>
              <Input
                placeholder="docker.io/library/ubuntu:24.04"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
            </FieldContent>
          </Field>
          <Field>
            <FieldLabel>备注</FieldLabel>
            <FieldContent>
              <Input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </FieldContent>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            取消
          </Button>
          <Button onClick={handleSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

