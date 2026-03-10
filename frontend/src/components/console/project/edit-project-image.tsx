import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { DomainImage, DomainProject } from "@/api/Api"
import Icon from "@/components/common/Icon"
import { useCommonData } from "@/components/console/data-provider"
import { getImageShortName, getOSFromImageName } from "@/utils/common"
import { useEffect, useState } from "react"
import { toast } from "sonner"

interface EditProjectImageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: DomainProject
  onSuccess?: () => void
}

export default function EditProjectImageDialog({
  open,
  onOpenChange,
  project,
  onSuccess,
}: EditProjectImageDialogProps) {
  const { images, loadingImages } = useCommonData()
  const [selectedImageId, setSelectedImageId] = useState<string>("")

  useEffect(() => {
    if (open && project) {
      // TODO: 从 API 获取项目绑定的开发镜像，目前使用空
      setSelectedImageId("")
    } else if (!open) {
      setSelectedImageId("")
    }
  }, [open, project])

  const handleSave = () => {
    // TODO: 调用 API 保存项目开发镜像
    console.log("保存开发镜像:", selectedImageId)
    toast.success("开发镜像已保存（API 待实现）")
    onOpenChange(false)
    onSuccess?.()
  }

  const handleCancel = () => {
    setSelectedImageId("")
    onOpenChange(false)
  }

  const selectableImages = images.filter((img): img is DomainImage & { id: string } => !!img.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>开发镜像</DialogTitle>
          <p className="text-sm text-muted-foreground">
            为项目绑定开发环境使用的 Docker 镜像
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Select value={selectedImageId || "none"} onValueChange={(v) => setSelectedImageId(v === "none" ? "" : v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={loadingImages ? "加载中..." : "选择镜像"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未选择</SelectItem>
                {selectableImages.map((image) => (
                  <SelectItem key={image.id} value={image.id}>
                    <div className="flex items-center gap-2">
                      <Icon name={getOSFromImageName(image.name || "")} className="size-4 shrink-0" />
                      <span>{image.remark || getImageShortName(image.name || "")}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
