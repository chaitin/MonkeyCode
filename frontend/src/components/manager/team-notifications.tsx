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

/** 接收端类型（UI 用，wechat_work 映射到 API 的 wecom） */
type ReceiverType = "dingtalk" | "feishu" | "wechat_work" | "webhook"

const RECEIVER_TYPE_OPTIONS: { value: ReceiverType; label: string; icon: React.ReactNode }[] = [
  { value: "dingtalk", label: "钉钉机器人", icon: <Icon name="dingtalk" className="size-4" /> },
  { value: "feishu", label: "飞书机器人", icon: <Icon name="lark" className="size-4" /> },
  { value: "wechat_work", label: "企业微信机器人", icon: <Icon name="wecom" className="size-4" /> },
  { value: "webhook", label: "Webhook", icon: <Link2 className="size-4" /> },
]

const RECEIVER_TO_API_KIND: Record<ReceiverType, ConstsNotifyChannelKind> = {
  dingtalk: ConstsNotifyChannelKind.NotifyChannelDingTalk,
  feishu: ConstsNotifyChannelKind.NotifyChannelFeishu,
  wechat_work: ConstsNotifyChannelKind.NotifyChannelWeCom,
  webhook: ConstsNotifyChannelKind.NotifyChannelWebhook,
}

function toApiKind(type: ReceiverType): ConstsNotifyChannelKind {
  return RECEIVER_TO_API_KIND[type]
}

const API_KIND_TO_RECEIVER: Record<ConstsNotifyChannelKind, ReceiverType> = {
  [ConstsNotifyChannelKind.NotifyChannelDingTalk]: "dingtalk",
  [ConstsNotifyChannelKind.NotifyChannelFeishu]: "feishu",
  [ConstsNotifyChannelKind.NotifyChannelWeCom]: "wechat_work",
  [ConstsNotifyChannelKind.NotifyChannelWebhook]: "webhook",
}

function fromApiKind(kind?: ConstsNotifyChannelKind): ReceiverType {
  return kind ? API_KIND_TO_RECEIVER[kind] ?? "webhook" : "webhook"
}

function getReceiverTypeLabel(type: ReceiverType): string {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

function getReceiverTypeIcon(type: ReceiverType): React.ReactNode {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? <Link2 className="size-4" />
}

/** 企业管理后台 - 团队消息通知（使用 /api/v1/teams/notify/channels） */
export default function TeamNotifications() {
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
      toast.error("加载推送渠道失败")
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
      toast.error("加载事件类型失败")
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
      toast.error("请输入名称")
      return
    }
    if (!formWebhookUrl.trim()) return
    const name = formName.trim()
    if (formEventTypes.length === 0) {
      toast.error("请至少选择一种订阅事件")
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
          toast.success("保存成功")
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? "保存失败")
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
          toast.success("添加成功")
          setAddDialogOpen(false)
          resetForm()
          loadChannels()
        } else {
          toast.error(res.data?.message ?? "添加失败")
        }
      }
    } catch {
      toast.error("操作失败")
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
        toast.success("移除成功")
        setChannelToDelete(null)
        setDeleteDialogOpen(false)
        loadChannels()
      } else {
        toast.error(res.data?.message ?? "移除失败")
      }
    } catch {
      toast.error("移除失败")
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
        toast.success("测试消息已发送")
      } else {
        toast.error(res.data?.message ?? "测试失败")
      }
    } catch {
      toast.error("测试失败")
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
      {channels.map((ch) => (
        <Item key={ch.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden sm:flex">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {getReceiverTypeIcon(fromApiKind(ch.kind))}
            </div>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{ch.name ?? "未命名"}</ItemTitle>
            <ItemDescription className="break-all">
              {getReceiverTypeLabel(fromApiKind(ch.kind))} · 订阅{" "}
              {(ch.event_types ?? []).length > 0
                ? (ch.event_types ?? [])
                    .map((t) => getEventTypeLabel(t))
                    .join("、")
                : "无"}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleTest(ch)}
              disabled={!!testingId}
            >
              {testingId === ch.id ? <Spinner className="size-4" /> : "测试"}
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
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(ch)}
                >
                  <IconTrash />
                  移除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      ))}
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
        <EmptyDescription>正在加载推送渠道...</EmptyDescription>
      </EmptyContent>
    </Empty>
  )

  return (
    <Card className="w-full shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell />
          消息通知
        </CardTitle>
        <CardDescription>
          配置团队任务、系统等消息的接收方式，支持钉钉、飞书、企业微信机器人和 Webhook
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={openAddDialog}
            disabled={loadingEventTypes || eventTypes.length === 0}
          >
            <CirclePlus className="size-4" />
            添加接收端
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {loadingChannels ? loadingContent : channels.length > 0 ? listChannels() : null}
      </CardContent>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingChannel ? "编辑接收端" : "添加接收端"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>接收端类型</Label>
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
                        {opt.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingChannel && (
                <p className="text-xs text-muted-foreground">编辑时不可修改接收端类型</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>名称</Label>
              <Input
                placeholder={`如：${getReceiverTypeLabel(formType)}-1`}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                {formType === "webhook" ? "Webhook 地址" : "机器人 Webhook 地址"}
              </Label>
              <Input
                placeholder="https://..."
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Secret（选填）</Label>
              <Input
                type="password"
                placeholder="用于签名验证，钉钉/飞书/企业微信机器人可选填"
                value={formSecret}
                onChange={(e) => setFormSecret(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                部分机器人需要配置 Secret 以验证消息来源
              </p>
            </div>
            <div className="space-y-2">
              <Label>订阅消息</Label>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                {eventTypes.length === 0 ? (
                  <span className="text-sm text-muted-foreground">暂无可用事件类型</span>
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
              取消
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
              {saving ? <Spinner className="size-4" /> : editingChannel ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要移除接收端「{channelToDelete?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChannelToDelete(null)} disabled={deleting}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleting}>
              {deleting ? <Spinner className="size-4" /> : "确认移除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
