import { useState, useEffect } from "react"
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

interface EditImageProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: { id: string; image_name: string; remark: string } | null
  onRefresh?: () => void
  trigger?: React.ReactNode
}

export default function EditImage({
  open,
  onOpenChange,
  image,
  onRefresh,
  trigger,
}: EditImageProps) {
  const [imageName, setImageName] = useState("")
  const [remark, setRemark] = useState("")

  useEffect(() => {
    if (image) {
      setImageName(image.image_name)
      setRemark(image.remark)
    }
  }, [image])

  const handleSave = () => {
    if (!image?.id) {
      toast.error("镜像信息不完整")
      return
    }

    if (!imageName.trim()) {
      toast.error("请输入镜像名称")
      return
    }

    apiRequest('v1UsersImagesUpdate',
      { image_name: imageName.trim(), remark: remark.trim() },
      [image.id],
      () => {
        toast.success("镜像修改成功")
        setImageName("")
        setRemark("")
        onOpenChange(false)
        onRefresh?.()
      }
    )
  }

  const handleCancel = () => {
    setImageName("")
    setRemark("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改操作系统镜像</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field>
            <FieldLabel>镜像名称</FieldLabel>
            <FieldContent>
              <Input
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

