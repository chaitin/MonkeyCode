import { useState } from "react"
import Icon from "@/components/common/Icon"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
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
import { getImageShortName, getOSFromImageName } from "@/utils/common"
import AddImage from "@/components/manager/add-image"
import EditImage from "@/components/manager/edit-image"

import {
  Box,
  MoreVertical,
} from "lucide-react"
import React from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainTeamImage } from "@/api/Api"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IconPencil, IconTrash } from "@tabler/icons-react"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"

export default function TeamManagerImages() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [images, setImages] = useState<DomainTeamImage[]>([])
  const [loading, setLoading] = useState(true)
  
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<DomainTeamImage | null>(null)
  
  const fetchImages = async () => {
    setLoading(true)
    await apiRequest('v1TeamsImagesList', {}, [], (resp) => {
      if (resp.code === 0) {
        setImages(resp.data?.images || []);
      } else {
        toast.error("获取镜像列表失败: " + resp.message)
      }
    })
    setLoading(false)
  }

  React.useEffect(() => {
    fetchImages();
  }, []);

  const handleEdit = (image: DomainTeamImage) => {
    setEditingImage(image)
    setIsEditDialogOpen(true)
  }

  const handleEditCancel = () => {
    setEditingImage(null)
    setIsEditDialogOpen(false)
  }

  const handleDelete = (image: DomainTeamImage) => {
    if (!image.id) {
      toast.error("镜像信息不完整")
      return
    }

    apiRequest('v1TeamsImagesDelete', {}, [image.id], (resp) => {
      if (resp.code === 0) {
        toast.success("镜像移除成功")
        fetchImages()
      } else {
        toast.error(resp.message || "移除镜像失败")
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box />
            系统镜像
          </CardTitle>
          <CardDescription>
            使用 Docker 镜像，用于构建开发环境
          </CardDescription>
          <CardAction>
            <AddImage
              open={isDialogOpen}
              onOpenChange={setIsDialogOpen}
              onRefresh={fetchImages}
            />
          </CardAction>
        </CardHeader>
        <CardContent>

        {loading ? (
          <Empty className="bg-muted">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="flex flex-col gap-4">
            {images.map((image) => (
              <Item key={image.name} variant="outline" className="hover:border-primary/30" size="sm">
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
                      <DropdownMenuItem onClick={() => handleEdit(image)}>
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
                <ItemFooter className="flex flex-col gap-2 items-start">
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {image.groups && image.groups.length > 0 ? image.groups?.map((group) => (
                      <Badge variant="outline" key={group.id}>{group.name}</Badge>
                    )) : (
                      <div className="text-sm text-muted-foreground">暂无分组</div>
                    )}
                  </div>
                </ItemFooter>
              </Item>)
            )}
          </ItemGroup>
        )}
        </CardContent>
        <EditImage
          open={isEditDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              handleEditCancel()
            }
          }}
          image={editingImage ? { id: editingImage.id || '', image_name: editingImage.name || '', remark: editingImage.remark || '', groups: editingImage.groups } : null}
          onRefresh={fetchImages}
        />
      </Card>
    </div>
  )
}
