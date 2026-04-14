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
import { getBrandFromModelName, getInterfaceTypeBadge, getOwnerTypeBadge } from "@/utils/common"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { IconAlertHexagon, IconPencil, IconTrash } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"

export default function Models() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<DomainModel | undefined>(undefined)
  const { models, reloadModels, loadingModels } = useCommonData();


  const handleEdit = (model: DomainModel) => {
    setSelectedModel(model)
    setIsEditDialogOpen(true)
  }

  const handleDelete = (model: DomainModel) => {
    if (!model.id) {
      toast.error("模型信息不完整")
      return
    }

    apiRequest('v1UsersModelsDelete', {}, [model.id], (resp) => {
      if (resp.code === 0) {
        toast.success("模型移除成功")
        reloadModels?.()
      } else {
        toast.error("移除模型失败: " + resp.message)
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
            正在加载模型列表...
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
            暂无配置，请先绑定模型
          </EmptyDescription>
        </EmptyContent>
      </Empty>
    )
  }


  const listModels = () => {
    return (
      <ItemGroup className="flex flex-col gap-4">
        {models.map((model) => (
        <Item key={model.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden md:flex">
            <Avatar>
              <AvatarFallback>
                <Icon name={getBrandFromModelName(model.model || '')} className="size-4" />
              </AvatarFallback>
            </Avatar> 
          </ItemMedia>
            <ItemContent>
              <ItemTitle className="break-all">
              {model.model || '未知模型'}
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
                  修改
                </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                        disabled={model.owner?.type !== ConstsOwnerType.OwnerTypePrivate}
                      >
                        <IconTrash />
                        移除
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认移除</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要移除模型 "{model.model || '未知模型'}" 吗？此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => {
                            handleDelete(model)
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
            AI 大模型
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            配置 AI 大模型，用于代码生成和分析项目
          </p>
        </div>
        <AddModel
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onRefresh={reloadModels}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {loadingModels ? loadModels() : models.length === 0 ? noModels() : listModels()}
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
