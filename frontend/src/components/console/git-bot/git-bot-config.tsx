import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import type { DomainGitBot } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { IconCopy, IconFolder, IconLoader, IconLink, IconPencil, IconTrash } from "@tabler/icons-react"
import { MoreVertical } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Input } from "@/components/ui/input"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { EditGitBotDialog } from "./edit-git-bot-dialog"
import EditGitBotPermissionDialog from "./edit-git-bot-permission-dialog"
import { Avatar } from "@/components/ui/avatar"
import { AvatarFallback } from "@/components/ui/avatar"
import { getGitPlatformIcon } from "@/utils/common"
import { IconLock } from "@tabler/icons-react"
import { Label } from "@/components/ui/label"
import { useTranslation } from "react-i18next"

export interface GitBotConfigRef {
  fetchGitBots: () => void
  showWebhook: (bot: DomainGitBot) => void
}

export const GitBotConfig = forwardRef<GitBotConfigRef>(function GitBotConfig(_, ref) {
  const { t } = useTranslation()
  const [gitBots, setGitBots] = useState<DomainGitBot[]>([])
  const [loading, setLoading] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingBot, setEditingBot] = useState<DomainGitBot | null>(null)
  const [webhookDialogOpen, setWebhookDialogOpen] = useState(false)
  const [webhookBot, setWebhookBot] = useState<DomainGitBot | null>(null)
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false)
  const [permissionBot, setPermissionBot] = useState<DomainGitBot | null>(null)

  const fetchGitBots = useCallback(async () => {
    setLoading(true)
    await apiRequest('v1UsersGitBotsList', {}, [], (resp) => {
      if (resp.code === 0) {
        setGitBots(resp.data?.bots || [])
      } else {
        toast.error(t("consoleGitBot.toast.fetchBotsFailed", { message: resp.message }))
      }
    })
    setLoading(false)
  }, [t])

  useImperativeHandle(ref, () => ({
    fetchGitBots,
    showWebhook: (bot: DomainGitBot) => {
      setWebhookBot(bot)
      setWebhookDialogOpen(true)
    }
  }), [fetchGitBots])

  useEffect(() => {
    queueMicrotask(() => fetchGitBots())
  }, [fetchGitBots])

  const handleEdit = (bot: DomainGitBot) => {
    setEditingBot(bot)
    setEditDialogOpen(true)
  }

  const handleViewWebhook = (bot: DomainGitBot) => {
    setWebhookBot(bot)
    setWebhookDialogOpen(true)
  }

  const handleEditPermission = (bot: DomainGitBot) => {
    setPermissionBot(bot)
    setPermissionDialogOpen(true)
  }

  const handleCopyWebhook = () => {
    if (webhookBot?.webhook_url) {
      navigator.clipboard.writeText(webhookBot.webhook_url)
      toast.success(t("consoleGitBot.toast.webhookCopied"))
    }
  }

  const handleCopySecretToken = () => {
    if (webhookBot?.secret_token) {
      navigator.clipboard.writeText(webhookBot.secret_token)
      toast.success(t("consoleGitBot.toast.secretCopied"))
    }
  }

  const handleDelete = (bot: DomainGitBot) => {
    if (!bot.id) {
      toast.error(t("consoleGitBot.toast.incompleteBot"))
      return
    }

    apiRequest('v1UsersGitBotsDelete', {}, [bot.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleGitBot.toast.deleteSuccess"))
        fetchGitBots()
      } else {
        toast.error(t("consoleGitBot.toast.deleteFailed", { message: resp.message }))
      }
    })
  }

  if (loading) {
    return (
      <div className="flex w-full h-full">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
            <EmptyDescription>{t("consoleGitBot.common.loading")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }


  if (gitBots.length === 0) {
    return (
      <div className="flex w-full h-full">
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFolder />
            </EmptyMedia>
            <EmptyDescription>{t("consoleGitBot.config.empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }



  return (
    <>
      <ItemGroup className="flex flex-col gap-4">
        {gitBots.map((bot, index) => (
          <Item key={index} variant="outline" className="hover:border-primary/50" size="sm">
            <ItemContent>
              <ItemTitle className="flex flex-row gap-2 items-center">
                <Avatar>
                  <AvatarFallback>
                    {getGitPlatformIcon(bot.platform)}
                  </AvatarFallback>
                </Avatar> 
                {bot.name}
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
                  <DropdownMenuItem onClick={() => handleViewWebhook(bot)}>
                    <IconLink />
                    WebHook
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEditPermission(bot)}>
                    <IconLock />
                    {t("consoleGitBot.config.permission")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleEdit(bot)}>
                    <IconPencil />
                    {t("consoleGitBot.config.edit")}
                  </DropdownMenuItem>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem 
                        className="text-destructive" 
                        onSelect={(e) => { e.preventDefault() }}
                      >
                        <IconTrash />
                        {t("consoleGitBot.config.delete")}
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("consoleGitBot.config.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("consoleGitBot.config.deleteDescription", { name: bot.name || t("consoleGitBot.common.unknown") })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("consoleGitBot.actions.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(bot)}>
                          {t("consoleGitBot.config.confirmDelete")}
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
      <EditGitBotDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        bot={editingBot}
        onSuccess={fetchGitBots}
      />
      <EditGitBotPermissionDialog
        open={permissionDialogOpen}
        onOpenChange={setPermissionDialogOpen}
        bot={permissionBot}
        onSuccess={fetchGitBots}
      />
      <Dialog open={webhookDialogOpen} onOpenChange={setWebhookDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("consoleGitBot.config.webhookTitle")}</DialogTitle>
            <DialogDescription>
              {t("consoleGitBot.config.webhookDescription", { platform: webhookBot?.platform?.toLowerCase() })}
            </DialogDescription>
          </DialogHeader>
          <Label>{t("consoleGitBot.config.webhookUrl")}</Label>
          <div className="flex gap-2">
            <Input 
              value={webhookBot?.webhook_url || ''} 
              readOnly 
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={handleCopyWebhook}>
              <IconCopy className="size-4" />
            </Button>
          </div>
          <Label>{t("consoleGitBot.config.secretToken")}</Label>
          <div className="flex gap-2">
            <Input 
              value={webhookBot?.secret_token || ''} 
              readOnly 
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={handleCopySecretToken}>
              <IconCopy className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
})
