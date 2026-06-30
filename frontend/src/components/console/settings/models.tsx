import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Bot,
  MoreVertical,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Item,
  ItemActions,
  ItemContent,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import { ConstsOwnerType, type DomainModel } from "@/api/Api"
import AddModel from "../settings/add-model"
import EditModel from "../settings/edit-model"
import Icon from "@/components/common/Icon"
import { getBrandFromModel, getInterfaceTypeBadge, getModelDisplayNameForModel, getOwnerTypeBadge } from "@/utils/common"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { IconAlertHexagon, IconCopy, IconPencil, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"
import { useTranslation } from "react-i18next"

export default function Models() {
  const { t } = useTranslation()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<DomainModel | undefined>(undefined)
  const [copySourceModel, setCopySourceModel] = useState<DomainModel | undefined>(undefined)
  const { models, reloadModels, loadingModels } = useCommonData();
  const privateModels = models.filter((model) => model.owner?.type === ConstsOwnerType.OwnerTypePrivate)


  const handleAddDialogOpenChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setCopySourceModel(undefined)
    }
  }

  const handleEdit = (model: DomainModel) => {
    setSelectedModel(model)
    setIsEditDialogOpen(true)
  }

  const handleCopy = (model: DomainModel) => {
    setCopySourceModel(model)
    setIsDialogOpen(true)
  }

  const handleDelete = (model: DomainModel) => {
    if (!model.id) {
      toast.error(t("consoleSettings.models.toast.incomplete"))
      return
    }

    apiRequest('v1UsersModelsDelete', {}, [model.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleSettings.models.toast.removeSuccess"))
        reloadModels?.()
      } else {
        toast.error(t("consoleSettings.models.toast.removeFailed", { message: resp.message }))
      }
    })
  }

  const loadModels = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="size-6" />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            {t("consoleSettings.models.loading")}
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }

  const noModels = () => {
    return (
      <Empty className="min-h-full border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertHexagon />
          </EmptyMedia>
        </EmptyHeader>
        <EmptyContent>
          <EmptyDescription>
            {t("consoleSettings.models.empty")}
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }


  const listModels = () => {
    return (
      <ItemGroup className="flex flex-col gap-4">
        {privateModels.map((model) => (
        <Item key={model.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden md:flex">
            <Avatar>
              <AvatarFallback>
                <Icon name={getBrandFromModel(model)} className="size-4" />
              </AvatarFallback>
            </Avatar> 
          </ItemMedia>
            <ItemContent>
              <ItemTitle className="break-all">
              {getModelDisplayNameForModel(model) || t("consoleSettings.models.fallback.unknownModel")}
              {getInterfaceTypeBadge(model.interface_type)}
              {getOwnerTypeBadge(model.owner)}
            </ItemTitle>
          </ItemContent>
          <ItemActions>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleEdit(model)} disabled={model.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                  <IconPencil />
                  {t("consoleSettings.models.actions.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCopy(model)} disabled={model.owner?.type !== ConstsOwnerType.OwnerTypePrivate}>
                  <IconCopy />
                  {t("consoleSettings.models.actions.copy")}
                </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                        disabled={model.owner?.type !== ConstsOwnerType.OwnerTypePrivate}
                      >
                        <IconTrash />
                        {t("consoleSettings.models.actions.remove")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("consoleSettings.models.remove.title")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("consoleSettings.models.remove.description", { name: getModelDisplayNameForModel(model) || t("consoleSettings.models.fallback.unknownModel") })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("consoleSettings.models.actions.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(model)
                          }}
                        >
                          {t("consoleSettings.models.remove.confirm")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      ))}
      </ItemGroup>
    )
  }
  

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <Bot />
            {t("consoleSettings.models.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.models.description")}
          </p>
        </div>
        <AddModel
          open={isDialogOpen}
          onOpenChange={handleAddDialogOpenChange}
          initialModel={copySourceModel}
          onRefresh={reloadModels}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingModels ? loadModels() : privateModels.length === 0 ? noModels() : listModels()}
      </div>
      <EditModel
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        model={selectedModel}
        onRefresh={reloadModels}
      />
    </div>
  )
}
