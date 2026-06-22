import { useState } from "react"
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
  Bot,
  MoreVertical,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Item,
  ItemActions,
  ItemContent,
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
import React from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainTeamModel } from "@/api/Api"
import AddModel from "@/components/manager/add-model"
import EditModel from "@/components/manager/edit-model"
import Icon from "@/components/common/Icon"
import { getBrandFromModelName, getInterfaceTypeBadge, getModelDisplayNameForModel } from "@/utils/common"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { IconCheck, IconHeartRateMonitor, IconLoader, IconPencil, IconTrash, IconX } from "@tabler/icons-react"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"

export default function TeamManagerModels() {
  const { t } = useTranslation()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedModel, setSelectedModel] = useState<DomainTeamModel | null>(null)
  const [models, setModels] = useState<DomainTeamModel[]>([])
  const [loading, setLoading] = useState(true)
  const [isCheckDialogOpen, setIsCheckDialogOpen] = useState(false)
  const [checkingModel, setCheckingModel] = useState<DomainTeamModel | null>(null)
  const [checkStatus, setCheckStatus] = useState<'checking' | 'success' | 'error'>('checking')
  const [checkMessage, setCheckMessage] = useState<string>('')
  
  const fetchModels = async () => {
    setLoading(true)
    await apiRequest('v1TeamsModelsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setModels(resp.data?.models || []);
      } else {
        toast.error(resp.message || t("managerModels.toast.fetchFailed"))
      }
    })
    setLoading(false)
  }

  const handleEdit = (model: DomainTeamModel) => {
    setSelectedModel(model)
    setIsEditDialogOpen(true)
  }

  const handleDelete = (model: DomainTeamModel) => {
    if (!model.id) {
      toast.error(t("managerModels.toast.incomplete"))
      return
    }

    apiRequest('v1TeamsModelsDelete', {}, [model.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("managerModels.toast.removed"))
        fetchModels()
      } else {
        toast.error(resp.message || t("managerModels.toast.removeFailed"))
      }
    })
  }

  const handleCheck = async (model: DomainTeamModel) => {
    if (!model.id) {
      toast.error(t("managerModels.toast.incomplete"))
      return
    }
    
    setCheckingModel(model)
    setCheckStatus('checking')
    setCheckMessage(t("managerModels.check.checkingMessage"))
    setIsCheckDialogOpen(true)
    
    await apiRequest('v1TeamsModelsHealthCheckDetail', {}, [model.id], (resp) => {
      if (resp.code === 0) {
        if (resp.data?.success) {
          setCheckStatus('success')
          setCheckMessage(t("managerModels.check.connectionOk"))
          toast.success(t("managerModels.toast.checkSuccess"))
          fetchModels()
        } else {
          setCheckStatus('error')
          setCheckMessage(resp.data?.error || t("managerModels.toast.checkFailed"))
          toast.error(t("managerModels.toast.checkFailedWithMessage", { message: resp.data?.error }))
        }
      } else {
        setCheckStatus('error')
        setCheckMessage(resp.message || t("managerModels.toast.checkFailed"))
        toast.error(t("managerModels.toast.checkFailedWithMessage", { message: resp.message }))
      }
    })
  }

  React.useEffect(() => {
    fetchModels();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot />
            {t("managerModels.title")}
          </CardTitle>
          <CardDescription>
            {t("managerModels.description")}
          </CardDescription>
          <CardAction>
            <AddModel
              open={isDialogOpen}
              onOpenChange={setIsDialogOpen}
              onRefresh={fetchModels}
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
            {models.map((model) => (
              <Item key={model.id} variant="outline" className="hover:border-primary/30" size="sm">
                <ItemMedia className="hidden md:flex">
                  <Avatar>
                    <AvatarFallback>
                      <Icon name={getBrandFromModelName(model.model || '')} className="size-4" />
                    </AvatarFallback>
                  </Avatar> 
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="break-all">
                    {getModelDisplayNameForModel(model) || t("managerModels.fallback.unknownModel")}
                    {getInterfaceTypeBadge(model.interface_type)}
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
                      <DropdownMenuItem onClick={() => handleCheck(model)}>
                        <IconHeartRateMonitor />
                        {t("managerModels.actions.check")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleEdit(model)}>
                        <IconPencil />
                        {t("managerModels.actions.edit")}
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem 
                            className="text-destructive" 
                            onSelect={(e) => { e.preventDefault() }}
                          >
                            <IconTrash />
                            {t("managerModels.actions.remove")}
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("managerModels.remove.title")}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t("managerModels.remove.description", {
                                name: getModelDisplayNameForModel(model) || t("managerModels.fallback.unknownModel"),
                              })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("managerModels.actions.cancel")}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => {
                                handleDelete(model)
                              }}
                            >
                              {t("managerModels.actions.confirmRemove")}
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
                    {model.groups && model.groups.length > 0 ? model.groups?.map((group) => (
                      <Badge variant="outline" key={group.id}>{group.name}</Badge>
                    )) : (
                      <div className="text-sm text-muted-foreground">
                        {t("managerModels.fallback.noGroups")}
                      </div>
                    )}
                  </div>
                </ItemFooter>
              </Item>
            ))}
          </ItemGroup>
        )}
        </CardContent>
        <EditModel
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          model={selectedModel}
          onRefresh={fetchModels}
        />
        
        <Dialog open={isCheckDialogOpen} onOpenChange={(open) => {
          if (checkStatus !== 'checking') {
            setIsCheckDialogOpen(open)
          }
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("managerModels.check.title")}</DialogTitle>
              <DialogDescription>
                {t("managerModels.check.description", {
                  name: checkingModel?.model || t("managerModels.fallback.unknownModel"),
                })}
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
                  {checkStatus === 'checking' && t("managerModels.check.checking")}
                  {checkStatus === 'success' && t("managerModels.check.success")}
                  {checkStatus === 'error' && t("managerModels.check.failed")}
                </div>
              </div>
              <div className="break-all text-xs text-muted-foreground max-h-[100px] overflow-y-auto text-center">
                {checkMessage}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </Card>
    </div>
  )
}
