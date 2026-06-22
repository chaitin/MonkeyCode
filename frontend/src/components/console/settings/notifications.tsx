import { useState, useEffect } from "react"
import { Bell, CirclePlus, Link2, MoreVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
} from "@/components/ui/alert-dialog"
import { IconPencil, IconTrash } from "@tabler/icons-react"
import {
  Api,
  ConstsNotifyChannelKind,
  type ConstsNotifyEventType,
  type ConstsNotifyEventTypeInfo,
  type DomainNotifyChannel,
} from "@/api/Api"
import Icon from "@/components/common/Icon"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { WechatMpBindDialog } from "@/components/console/wechat-mp-bind-dialog"
import { useCommonData } from "@/components/console/data-provider"
import { IS_ONLINE_EDITION } from "@/utils/edition"
import { useTranslation } from "react-i18next"

/** Receiver type used by the UI; wechat_work maps to the API wecom kind. */
export type ReceiverType = "dingtalk" | "feishu" | "wechat_work" | "webhook"
type ApiReceiverKind = "dingtalk" | "feishu" | "wecom" | "webhook"

const RECEIVER_TYPE_OPTIONS: { value: ReceiverType; icon: React.ReactNode }[] = [
  { value: "dingtalk", icon: <Icon name="dingtalk" className="size-4" /> },
  { value: "feishu", icon: <Icon name="lark" className="size-4" /> },
  { value: "wechat_work", icon: <Icon name="wecom" className="size-4" /> },
  { value: "webhook", icon: <Link2 className="size-4" /> },
]

const RECEIVER_TO_API_KIND: Record<ReceiverType, ApiReceiverKind> = {
  dingtalk: ConstsNotifyChannelKind.NotifyChannelDingTalk,
  feishu: ConstsNotifyChannelKind.NotifyChannelFeishu,
  wechat_work: ConstsNotifyChannelKind.NotifyChannelWeCom,
  webhook: ConstsNotifyChannelKind.NotifyChannelWebhook,
}

/** UI ReceiverType -> API notify channel kind */
function toApiKind(type: ReceiverType): ApiReceiverKind {
  return RECEIVER_TO_API_KIND[type]
}

const API_KIND_TO_RECEIVER: Partial<Record<ConstsNotifyChannelKind, ReceiverType>> = {
  [ConstsNotifyChannelKind.NotifyChannelDingTalk]: "dingtalk",
  [ConstsNotifyChannelKind.NotifyChannelFeishu]: "feishu",
  [ConstsNotifyChannelKind.NotifyChannelWeCom]: "wechat_work",
  [ConstsNotifyChannelKind.NotifyChannelWebhook]: "webhook",
}

/** API ConstsNotifyChannelKind -> UI ReceiverType */
function fromApiKind(kind?: ConstsNotifyChannelKind): ReceiverType {
  return kind ? API_KIND_TO_RECEIVER[kind] ?? "webhook" : "webhook"
}

function getReceiverTypeIcon(type: ReceiverType): React.ReactNode {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? <Link2 className="size-4" />
}

export default function Notifications() {
  const { t } = useTranslation()
  const { user, reloadUser } = useCommonData()
  const [channels, setChannels] = useState<DomainNotifyChannel[]>([])
  const [eventTypes, setEventTypes] = useState<ConstsNotifyEventTypeInfo[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [loadingEventTypes, setLoadingEventTypes] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [wechatMpBindDialogOpen, setWechatMpBindDialogOpen] = useState(false)
  const [wechatMpUnbindDialogOpen, setWechatMpUnbindDialogOpen] = useState(false)
  const [unbindingWechatMp, setUnbindingWechatMp] = useState(false)
  const [editingChannel, setEditingChannel] = useState<DomainNotifyChannel | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [channelToDelete, setChannelToDelete] = useState<DomainNotifyChannel | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const [formType, setFormType] = useState<ReceiverType>("webhook")
  const [formName, setFormName] = useState("")
  const [formWebhookUrl, setFormWebhookUrl] = useState("")
  const [formSecret, setFormSecret] = useState("")
  const [formEventTypes, setFormEventTypes] = useState<ConstsNotifyEventType[]>([])

  const api = new Api()
  const getReceiverTypeLabel = (type: ReceiverType): string =>
    t(`consoleSettings.notifications.receiverTypes.${type}`)

  const loadChannels = async () => {
    if (!IS_ONLINE_EDITION) {
      setLoadingChannels(false)
      return
    }

    setLoadingChannels(true)
    try {
      const res = await api.api.v1UsersNotifyChannelsList()
      if (res.data?.code === 0 && res.data?.data) {
        setChannels(res.data.data)
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.loadChannelsFailed"))
    } finally {
      setLoadingChannels(false)
    }
  }

  const loadEventTypes = async () => {
    if (!IS_ONLINE_EDITION) {
      setLoadingEventTypes(false)
      return
    }

    setLoadingEventTypes(true)
    try {
      const res = await api.api.v1UsersNotifyEventTypesList()
      if (res.data?.code === 0 && res.data?.data) {
        setEventTypes(res.data.data)
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.loadEventTypesFailed"))
    } finally {
      setLoadingEventTypes(false)
    }
  }

  useEffect(() => {
    loadChannels()
    loadEventTypes()
  }, [])

  const resetForm = () => {
    setFormType("webhook")
    setFormName("")
    setFormWebhookUrl("")
    setFormSecret("")
    setFormEventTypes([])
    setEditingChannel(null)
  }

  const openAddDialog = () => {
    resetForm()
    setAddDialogOpen(true)
  }

  const openEditDialog = (ch: DomainNotifyChannel) => {
    setEditingChannel(ch)
    setFormType(fromApiKind(ch.kind))
    setFormName(ch.name ?? "")
    setFormWebhookUrl(ch.webhook_url ?? "")
    setFormSecret("")
    setFormEventTypes(ch.event_types ?? [])
    setAddDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error(t("consoleSettings.notifications.toast.nameRequired"))
      return
    }
    if (!formWebhookUrl.trim()) return
    const name = formName.trim()
    if (formEventTypes.length === 0) {
      toast.error(t("consoleSettings.notifications.toast.eventRequired"))
      return
    }

    setSaving(true)
    try {
      if (editingChannel?.id) {
        const res = await api.api.v1UsersNotifyChannelsUpdate(
          editingChannel.id,
          {
            name,
            webhook_url: formWebhookUrl.trim(),
            event_types: formEventTypes,
            ...(formSecret.trim() && { secret: formSecret.trim() }),
          }
        )
        if (res.data?.code === 0) {
          toast.success(t("consoleSettings.notifications.toast.saveSuccess"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.saveFailed"))
        }
      } else {
        const res = await api.api.v1UsersNotifyChannelsCreate({
          kind: toApiKind(formType),
          name,
          webhook_url: formWebhookUrl.trim(),
          event_types: formEventTypes,
          ...(formSecret.trim() && { secret: formSecret.trim() }),
        })
        if (res.data?.code === 0) {
          toast.success(t("consoleSettings.notifications.toast.addSuccess"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.addFailed"))
        }
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.operationFailed"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (ch: DomainNotifyChannel) => {
    setChannelToDelete(ch)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!channelToDelete?.id) return
    setDeleting(true)
    try {
      const res = await api.api.v1UsersNotifyChannelsDelete(channelToDelete.id)
      if (res.data?.code === 0) {
        toast.success(t("consoleSettings.notifications.toast.removeSuccess"))
        setChannelToDelete(null)
        setDeleteDialogOpen(false)
        loadChannels()
      } else {
        toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.removeFailed"))
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.removeFailed"))
    } finally {
      setDeleting(false)
    }
  }

  const handleTest = async (ch: DomainNotifyChannel) => {
    if (!ch.id) return
    setTestingId(ch.id)
    try {
      const res = await api.api.v1UsersNotifyChannelsTestCreate(ch.id)
      if (res.data?.code === 0) {
        toast.success(t("consoleSettings.notifications.toast.testSent"))
      } else {
        toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.testFailed"))
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.testFailed"))
    } finally {
      setTestingId(null)
    }
  }

  const handleUnbindWechatMp = async () => {
    setUnbindingWechatMp(true)
    try {
      const res = await api.api.v1UsersWechatMpBindDelete()
      if (res.data?.code === 0) {
        toast.success(t("consoleSettings.notifications.toast.wechatUnbound"))
        setWechatMpUnbindDialogOpen(false)
        await reloadUser()
      } else {
        toast.error(res.data?.message ?? t("consoleSettings.notifications.toast.wechatUnbindFailed"))
      }
    } catch {
      toast.error(t("consoleSettings.notifications.toast.wechatUnbindFailed"))
    } finally {
      setUnbindingWechatMp(false)
    }
  }

  const toggleEventType = (et: ConstsNotifyEventType) => {
    setFormEventTypes((prev) =>
      prev.includes(et) ? prev.filter((e) => e !== et) : [...prev, et]
    )
  }

  const getEventTypeLabel = (type: ConstsNotifyEventType) => {
    return eventTypes.find((e) => e.type === type)?.name ?? type
  }

  const listChannels = () => (
    <ItemGroup className="flex flex-col gap-4">
      {channels.map((ch) => (
        <Item key={ch.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden sm:flex">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {getReceiverTypeIcon(fromApiKind(ch.kind))}
            </div>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{ch.name ?? t("consoleSettings.notifications.fallback.unnamed")}</ItemTitle>
            <ItemDescription className="break-all">
              {t("consoleSettings.notifications.channelDescription", {
                receiver: getReceiverTypeLabel(fromApiKind(ch.kind)),
                events: (ch.event_types ?? []).length > 0
                  ? (ch.event_types ?? [])
                      .map((eventType) => getEventTypeLabel(eventType))
                      .join(t("consoleSettings.notifications.eventSeparator"))
                  : t("consoleSettings.notifications.none"),
              })}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTest(ch)}
              disabled={!!testingId}
            >
              {testingId === ch.id ? <Spinner className="size-4" /> : t("consoleSettings.notifications.actions.test")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEditDialog(ch)}>
                  <IconPencil />
                  {t("consoleSettings.notifications.actions.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(ch)}
                >
                  <IconTrash />
                  {t("consoleSettings.notifications.actions.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  )

  const loadingContent = (
    <Empty className="min-h-full border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner className="size-6" />
        </EmptyMedia>
      </EmptyHeader>
      <EmptyContent>
        <EmptyDescription>{t("consoleSettings.notifications.loading")}</EmptyDescription>
      </EmptyContent>
    </Empty>
  )

  const wechatMpBound = user.wechat_mp_bound === true
  const wechatMpStatusCard = (
    <Item variant="outline" className="mb-4">
      <ItemMedia className="hidden sm:flex">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Bell className="size-4" />
        </div>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex items-center gap-2">
          {t("consoleSettings.notifications.wechat.title")}
          <Badge variant={wechatMpBound ? "default" : "outline"}>
            {wechatMpBound ? t("consoleSettings.notifications.wechat.bound") : t("consoleSettings.notifications.wechat.unbound")}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {t("consoleSettings.notifications.wechat.description")}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {wechatMpBound ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWechatMpUnbindDialogOpen(true)}
            disabled={unbindingWechatMp}
          >
            {unbindingWechatMp ? <Spinner className="size-4" /> : t("consoleSettings.notifications.actions.unbind")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWechatMpBindDialogOpen(true)}
          >
            {t("consoleSettings.notifications.actions.bind")}
          </Button>
        )}
      </ItemActions>
    </Item>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 pb-4">
        <div>
          <div className="flex items-center gap-2 font-semibold leading-none">
            <Bell />
            {t("consoleSettings.notifications.title")}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("consoleSettings.notifications.description")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={openAddDialog}
          disabled={loadingEventTypes || eventTypes.length === 0}
        >
          <CirclePlus className="size-4" />
          {t("consoleSettings.notifications.actions.addReceiver")}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        {IS_ONLINE_EDITION && wechatMpStatusCard}
        {loadingChannels ? (
          loadingContent
        ) : channels.length > 0 ? (
          listChannels()
        ) : (
          <Empty className="min-h-full border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bell className="size-6" />
              </EmptyMedia>
              <EmptyDescription>
                {t("consoleSettings.notifications.empty")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingChannel ? t("consoleSettings.notifications.dialog.editTitle") : t("consoleSettings.notifications.dialog.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.receiverType")}</Label>
              <Select
                value={formType}
                onValueChange={(v) => setFormType(v as ReceiverType)}
                disabled={!!editingChannel}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECEIVER_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-2">
                        {opt.icon}
                        {getReceiverTypeLabel(opt.value)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingChannel && (
                <p className="text-xs text-muted-foreground">{t("consoleSettings.notifications.receiverTypeLocked")}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.name")}</Label>
              <Input
                placeholder={t("consoleSettings.notifications.placeholders.name", { receiver: getReceiverTypeLabel(formType) })}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {formType === "webhook" ? t("consoleSettings.notifications.labels.webhookUrl") : t("consoleSettings.notifications.labels.robotWebhookUrl")}
              </Label>
              <Input
                placeholder="https://..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.secret")}</Label>
              <Input
                type="password"
                placeholder={t("consoleSettings.notifications.placeholders.secret")}
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("consoleSettings.notifications.secretDescription")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("consoleSettings.notifications.labels.events")}</Label>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                {eventTypes.length === 0 ? (
                  <span className="text-sm text-muted-foreground">{t("consoleSettings.notifications.noEventTypes")}</span>
                ) : (
                  eventTypes.map((et) => (
                    <div
                      key={et.type}
                      className="flex cursor-pointer items-start gap-2 text-sm"
                      onClick={() => toggleEventType(et.type!)}
                    >
                      <Checkbox
                        checked={formEventTypes.includes(et.type!)}
                        onCheckedChange={() => toggleEventType(et.type!)}
                        className="mt-0.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="flex flex-col gap-0.5">
                        <span>{et.name ?? et.type}</span>
                        {et.description && (
                          <span className="text-xs text-muted-foreground">
                            {et.description}
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              {t("consoleSettings.notifications.actions.cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !formName.trim() ||
                !formWebhookUrl.trim() ||
                formEventTypes.length === 0 ||
                saving
              }
            >
              {saving ? <Spinner className="size-4" /> : editingChannel ? t("consoleSettings.notifications.actions.save") : t("consoleSettings.notifications.actions.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("consoleSettings.notifications.remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("consoleSettings.notifications.remove.description", { name: channelToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChannelToDelete(null)} disabled={deleting}>
              {t("consoleSettings.notifications.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner className="size-4" /> : t("consoleSettings.notifications.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {IS_ONLINE_EDITION && (
        <>
          <WechatMpBindDialog
            open={wechatMpBindDialogOpen}
            onOpenChange={(open) => {
              setWechatMpBindDialogOpen(open)
              if (!open) {
                reloadUser()
              }
            }}
          />
          <AlertDialog open={wechatMpUnbindDialogOpen} onOpenChange={setWechatMpUnbindDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("consoleSettings.notifications.wechatUnbind.title")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("consoleSettings.notifications.wechatUnbind.description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={unbindingWechatMp}>
                  {t("consoleSettings.notifications.actions.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction onClick={handleUnbindWechatMp} disabled={unbindingWechatMp}>
                  {unbindingWechatMp ? <Spinner className="size-4" /> : t("consoleSettings.notifications.wechatUnbind.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}
