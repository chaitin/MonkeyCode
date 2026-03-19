import { useState } from "react"
import Icon from "@/components/common/Icon"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { getImageShortName, getOSFromImageName, getOwnerTypeBadge } from "@/utils/common"
import AddImage from "../settings/add-image"
import EditImage from "../settings/edit-image"

import {
  Box,
  MoreVertical,
} from "lucide-react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { ConstsOwnerType, type DomainImage } from "@/api/Api"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IconAlertHexagon, IconPencil, IconStar, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../common-data"
import { Badge } from "@/components/ui/badge"

export default function Images() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<DomainImage | null>(null)
  
  const { images, reloadImages, loadingImages } = useCommonData();
  
  const handleEdit = (image: DomainImage) => {
    setEditingImage(image)
    setIsEditDialogOpen(true)
  }

  const handleEditCancel = () => {
    setEditingImage(null)
    setIsEditDialogOpen(false)
  }

  const handleDelete = (image: DomainImage) => {
    if (!image.id) {
      toast.error("镜像信息不完整")
      return
    }

    apiRequest('v1UsersImagesDelete', {}, [image.id], (resp) => {
      if (resp.code === 0) {
        toast.success("镜像移除成功")
        reloadImages()
      } else {
        toast.error("移除镜像失败: " + resp.message)
      }
    })
  }

  const handleSetDefault = async (image: DomainImage) => {
    if (!image.id) {
      toast.error("镜像信息不完整")
      return
    }

    await apiRequest('v1UsersImagesUpdate', { is_default: true }, [image.id], (resp) => {
      if (resp.code === 0) {
        toast.success("设置成功")
      } else {
        toast.error("设置默认镜像失败: " + resp.message)
      }
    })
    reloadImages()
  }

  const loadImages = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            正在加载镜像列表...
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const noImages = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertHexagon />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            暂无配置，请先绑定镜像
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const listImages = () => {
    return (
      <ItemGroup className="flex flex-col gap-4">
        {images.map((image) => (
          <Item key={image.name} variant="outline" className="hover:border-primary/50" size="sm">
            <ItemMedia className="hidden sm:flex">
              <Avatar>
                <AvatarFallback>
                  <Icon name={getOSFromImageName(image.name || '')} className="size-4" />
                </AvatarFallback>
              </Avatar> 
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="break-all">
                {image.remark || getImageShortName(image.name || '')}
                {image.is_default && <Badge>默认</Badge>}
                {getOwnerTypeBadge(image.owner)}
              </ItemTitle>
              <ItemDescription className="hidden md:block">
                {image.name}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <MoreVertical className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSetDefault(image)} disabled={image.is_default}>
                  <IconStar />
                  设为默认
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleEdit(image)} disabled={image.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                  <IconPencil />
                  修改
                </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                      >
                        <IconTrash />
                        移除
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认移除</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要移除镜像 "{image.remark || getImageShortName(image.name || '')}" 吗？此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(image)
                          }}
                        >
                          确认移除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>)
        )}
      </ItemGroup>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <Box />
            系统镜像
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            使用 Docker 镜像，用于构建开发环境
          </p>
        </div>
        <AddImage
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onRefresh={reloadImages}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingImages ? loadImages() : images.length === 0 ? noImages() : listImages()}
      </div>
      <EditImage
        open={isEditDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleEditCancel()
          }
        }}
        image={editingImage ? { id: editingImage.id || '', image_name: editingImage.name || '', remark: editingImage.remark || '' } : null}
        onRefresh={reloadImages}
      />
    </div>
  )
}
