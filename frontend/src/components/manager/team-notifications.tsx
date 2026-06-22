import { useState, useEffect } from "react"
import { Bell, CirclePlus, Link2, MoreVertical } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
import { useTranslation } from "react-i18next"

type ReceiverType = "dingtalk" | "feishu" | "wechat_work" | "webhook"
type ApiReceiverKind = "dingtalk" | "feishu" | "wecom" | "webhook"

type Translate = (key: string, options?: Record<string, unknown>) => string

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

function toApiKind(type: ReceiverType): ApiReceiverKind {
  return RECEIVER_TO_API_KIND[type]
}

const API_KIND_TO_RECEIVER: Partial<Record<ConstsNotifyChannelKind, ReceiverType>> = {
  [ConstsNotifyChannelKind.NotifyChannelDingTalk]: "dingtalk",
  [ConstsNotifyChannelKind.NotifyChannelFeishu]: "feishu",
  [ConstsNotifyChannelKind.NotifyChannelWeCom]: "wechat_work",
  [ConstsNotifyChannelKind.NotifyChannelWebhook]: "webhook",
}

function fromApiKind(kind?: ConstsNotifyChannelKind): ReceiverType {
  return kind ? API_KIND_TO_RECEIVER[kind] ?? "webhook" : "webhook"
}

function getReceiverTypeLabel(type: ReceiverType, t: Translate): string {
  switch (type) {
    case "dingtalk":
      return t("managerNotifications.receiverTypes.dingtalk")
    case "feishu":
      return t("managerNotifications.receiverTypes.feishu")
    case "wechat_work":
      return t("managerNotifications.receiverTypes.wechat_work")
    case "webhook":
      return t("managerNotifications.receiverTypes.webhook")
  }
}

function getReceiverTypeIcon(type: ReceiverType): React.ReactNode {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? <Link2 className="size-4" />
}

export default function TeamNotifications() {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<DomainNotifyChannel[]>([])
  const [eventTypes, setEventTypes] = useState<ConstsNotifyEventTypeInfo[]>([])
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [loadingEventTypes, setLoadingEventTypes] = useState(true)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
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

  const loadChannels = async () => {
    setLoadingChannels(true)
    try {
      const res = await api.api.v1TeamsNotifyChannelsList()
      if (res.data?.code === 0 && res.data?.data) {
        setChannels(res.data.data)
      }
    } catch {
      toast.error(t("managerNotifications.toast.loadChannelsFailed"))
    } finally {
      setLoadingChannels(false)
    }
  }

  const loadEventTypes = async () => {
    setLoadingEventTypes(true)
    try {
      const res = await api.api.v1TeamsNotifyEventTypesList()
      if (res.data?.code === 0 && res.data?.data) {
        setEventTypes(res.data.data)
      }
    } catch {
      toast.error(t("managerNotifications.toast.loadEventTypesFailed"))
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
      toast.error(t("managerNotifications.toast.nameRequired"))
      return
    }
    if (!formWebhookUrl.trim()) return
    const name = formName.trim()
    if (formEventTypes.length === 0) {
      toast.error(t("managerNotifications.toast.eventRequired"))
      return
    }

    setSaving(true)
    try {
      if (editingChannel?.id) {
        const res = await api.api.v1TeamsNotifyChannelsUpdate(
          editingChannel.id,
          {
            name,
            webhook_url: formWebhookUrl.trim(),
            event_types: formEventTypes,
            ...(formSecret.trim() && { secret: formSecret.trim() }),
          }
        )
        if (res.data?.code === 0) {
          toast.success(t("managerNotifications.toast.saved"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("managerNotifications.toast.saveFailed"))
        }
      } else {
        const res = await api.api.v1TeamsNotifyChannelsCreate({
          kind: toApiKind(formType),
          name,
          webhook_url: formWebhookUrl.trim(),
          event_types: formEventTypes,
          ...(formSecret.trim() && { secret: formSecret.trim() }),
        })
        if (res.data?.code === 0) {
          toast.success(t("managerNotifications.toast.added"))
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? t("managerNotifications.toast.addFailed"))
        }
      }
    } catch {
      toast.error(t("managerNotifications.toast.operationFailed"))
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
      const res = await api.api.v1TeamsNotifyChannelsDelete(channelToDelete.id)
      if (res.data?.code === 0) {
        toast.success(t("managerNotifications.toast.removed"))
        setChannelToDelete(null)
        setDeleteDialogOpen(false)
        loadChannels()
      } else {
        toast.error(res.data?.message ?? t("managerNotifications.toast.removeFailed"))
      }
    } catch {
      toast.error(t("managerNotifications.toast.removeFailed"))
    } finally {
      setDeleting(false)
    }
  }

  const handleTest = async (ch: DomainNotifyChannel) => {
    if (!ch.id) return
    setTestingId(ch.id)
    try {
      const res = await api.api.v1TeamsNotifyChannelsTestCreate(ch.id)
      if (res.data?.code === 0) {
        toast.success(t("managerNotifications.toast.testSent"))
      } else {
        toast.error(res.data?.message ?? t("managerNotifications.toast.testFailed"))
      }
    } catch {
      toast.error(t("managerNotifications.toast.testFailed"))
    } finally {
      setTestingId(null)
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
      {channels.map((ch) => {
        const receiver = getReceiverTypeLabel(fromApiKind(ch.kind), t)
        const eventNames = (ch.event_types ?? [])
          .map((eventType) => getEventTypeLabel(eventType))
          .join(t("managerNotifications.eventSeparator"))
        return (
          <Item key={ch.id} variant="outline" className="hover:border-primary/50" size="sm">
            <ItemMedia className="hidden sm:flex">
              <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {getReceiverTypeIcon(fromApiKind(ch.kind))}
              </div>
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{ch.name ?? t("managerNotifications.fallback.unnamed")}</ItemTitle>
              <ItemDescription className="break-all">
                {t("managerNotifications.subscriptionSummary", {
                  receiver,
                  events: eventNames || t("managerNotifications.none"),
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
                {testingId === ch.id ? (
                  <Spinner className="size-4" />
                ) : (
                  t("managerNotifications.actions.test")
                )}
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
                    {t("managerNotifications.actions.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => handleDelete(ch)}
                  >
                    <IconTrash />
                    {t("managerNotifications.actions.remove")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )

  const loadingContent = (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner className="size-6" />
        </EmptyMedia>
      </EmptyHeader>
      <EmptyContent>
        <EmptyDescription>{t("managerNotifications.loading")}</EmptyDescription>
      </EmptyContent>
    </Empty>
  )

  return (
    <Card className="w-full shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell />
          {t("managerNotifications.title")}
        </CardTitle>
        <CardDescription>
          {t("managerNotifications.description")}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={openAddDialog}
            disabled={loadingEventTypes || eventTypes.length === 0}
          >
            <CirclePlus className="size-4" />
            {t("managerNotifications.actions.addReceiver")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loadingChannels ? loadingContent : channels.length > 0 ? listChannels() : null}
      </CardContent>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingChannel
                ? t("managerNotifications.dialog.editTitle")
                : t("managerNotifications.dialog.addTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("managerNotifications.fields.receiverType")}</Label>
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
                        {getReceiverTypeLabel(opt.value, t)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingChannel && (
                <p className="text-xs text-muted-foreground">
                  {t("managerNotifications.hints.receiverTypeLocked")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("managerNotifications.fields.name")}</Label>
              <Input
                placeholder={t("managerNotifications.namePlaceholder", {
                  receiver: getReceiverTypeLabel(formType, t),
                })}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {formType === "webhook"
                  ? t("managerNotifications.fields.webhookUrl")
                  : t("managerNotifications.fields.robotWebhookUrl")}
              </Label>
              <Input
                placeholder="https://..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("managerNotifications.fields.secret")}</Label>
              <Input
                type="password"
                placeholder={t("managerNotifications.secretPlaceholder")}
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("managerNotifications.hints.secret")}
              </p>
            </div>
            <div className="space-y-2">
              <Label>{t("managerNotifications.fields.subscribedMessages")}</Label>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                {eventTypes.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    {t("managerNotifications.hints.noEventTypes")}
                  </span>
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
              {t("managerNotifications.actions.cancel")}
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
              {saving ? (
                <Spinner className="size-4" />
              ) : editingChannel ? (
                t("managerNotifications.actions.save")
              ) : (
                t("managerNotifications.actions.add")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("managerNotifications.dialog.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("managerNotifications.dialog.deleteDescription", {
                name: channelToDelete?.name ?? t("managerNotifications.fallback.unnamed"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChannelToDelete(null)} disabled={deleting}>
              {t("managerNotifications.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? (
                <Spinner className="size-4" />
              ) : (
                t("managerNotifications.dialog.confirmRemove")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
