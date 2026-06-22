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
import { IconAlertHexagon, IconPencil, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"
import { useTranslation } from "react-i18next"

export default function Images() {
  const { t } = useTranslation()
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
      toast.error(t("consoleSettings.images.toast.incomplete"))
      return
    }

    apiRequest('v1UsersImagesDelete', {}, [image.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.images.toast.removeSuccess"))
        reloadImages()
      } else {
        toast.error(t("consoleSettings.images.toast.removeFailed", { message: resp.message }))
      }
    })
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
            {t("consoleSettings.images.loading")}
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
            {t("consoleSettings.images.empty")}
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
                <DropdownMenuItem onClick={() => handleEdit(image)} disabled={image.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                  <IconPencil />
                  {t("consoleSettings.images.actions.edit")}
                </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                      >
                        <IconTrash />
                        {t("consoleSettings.images.actions.remove")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("consoleSettings.images.delete.title")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("consoleSettings.images.delete.description", { name: image.remark || getImageShortName(image.name || '') })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("consoleSettings.images.actions.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(image)
                          }}
                        >
                          {t("consoleSettings.images.delete.confirm")}
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
            {t("consoleSettings.images.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.images.description")}
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
