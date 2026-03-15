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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { getBrandFromModelName, getInterfaceTypeBadge, getModelHealthBadge, getOwnerTypeBadge } from "@/utils/common"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Badge } from "@/components/ui/badge"
import { IconAlertHexagon, IconCheck, IconHeartRateMonitor, IconLoader, IconPencil, IconStar, IconTrash, IconX } from "@tabler/icons-react"
import { useCommonData } from "../data-provider"

export default function Models() {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<DomainModel | undefined>(undefined)
  const [isCheckDialogOpen, setIsCheckDialogOpen] = useState(false)
  const [checkingModel, setCheckingModel] = useState<DomainModel | undefined>(undefined)
  const [checkStatus, setCheckStatus] = useState<'checking' | 'success' | 'error'>('checking')
  const [checkMessage, setCheckMessage] = useState<string>('')
  const { models, reloadModels, loadingModels } = useCommonData();


  const handleSetDefault = async (model: DomainModel) => {
    if (!model.id) {
      toast.error("模型信息不完整")
      return
    }

    await apiRequest('v1UsersModelsUpdate', {
      is_default: true,
    }, [model.id], (resp) => {
      if (resp.code === 0) {
        toast.success("设置成功")  
      } else {
        toast.error("设置默认模型失败: " + resp.message)
      }
    })
    reloadModels?.()
  }

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

  const handleCheck = async (model: DomainModel) => {
    if (!model.id) {
      toast.error("模型信息不完整")
      return
    }
    
    // 打开检查对话框
    setCheckingModel(model)
    setCheckStatus('checking')
    setCheckMessage('正在检查模型配置...')
    setIsCheckDialogOpen(true)
    
    await apiRequest('v1UsersModelsHealthCheckDetail', {}, [model.id], (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          setCheckStatus('success')
          setCheckMessage('模型连接正常')
          toast.success("检查成功")
          reloadModels?.()
        } else {
          setCheckStatus('error')
          setCheckMessage(resp.data?.error || '检查失败')
          toast.error("检查失败: " + resp.data?.error)
        }
      } else {
        setCheckStatus('error')
        setCheckMessage(resp.message || '检查失败')
        toast.error("检查失败: " + resp.message)
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
              {getModelHealthBadge(model)}
              {model.model || '未知模型'}
              {model.is_default && <Badge>默认</Badge>}
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
                <DropdownMenuItem onClick={() => handleSetDefault(model)} disabled={model.is_default}>
                  <IconStar />
                  设为默认
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleCheck(model)}>
                  <IconHeartRateMonitor />
                  检查
                </DropdownMenuItem>
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
      
      {/* 模型检查对话框 */}
      <Dialog open={isCheckDialogOpen} onOpenChange={(open) => {
        // 只有在检查完成时才允许关闭
        if (checkStatus !== 'checking') {
          setIsCheckDialogOpen(open)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>检查模型配置</DialogTitle>
            <DialogDescription>
              检查模型 "{checkingModel?.model || '未知模型'}" 的配置是否正确
            </DialogDescription>
          </DialogHeader>
          <div className="border border-dashed rounded-md p-4 items-center justify-center flex flex-col gap-4">
            <div className="flex flex-row gap-2 items-center justify-center py-2">
              <div className="flex items-center justify-center bg-muted rounded-md p-2">
                {checkStatus === 'checking' && <IconLoader className="size-6 animate-spin" />}
                {checkStatus === 'success' && <IconCheck className="size-6" />}
                {checkStatus === 'error' && <IconX className="size-6" />}
              </div>
              <div className="text-md font-bold text-center">
                {checkStatus === 'checking' && '正在检查...'}
                {checkStatus === 'success' && '检查成功'}
                {checkStatus === 'error' && '检查失败'}
              </div>
            </div>
            <div className="break-all text-xs text-muted-foreground max-h-[100px] overflow-y-auto text-center">
              {checkMessage}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
