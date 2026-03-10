import { useState } from "react"
import { Bell, CirclePlus, Link2, MoreVertical } from "lucide-react"
import { MessageCircle, Bot, Send } from "lucide-react"
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
  DialogDescription,
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

/** 接收端类型 */
export type ReceiverType = "dingtalk" | "feishu" | "wechat_work" | "webhook"

/** 消息订阅类型 */
export type SubscriptionType =
  | "task_created"      // 任务创建
  | "task_completed"     // 任务执行完成
  | "task_failed"        // 任务执行失败
  | "vm_recycled"        // 开发环境被回收
  | "vm_expiring"       // 开发环境即将到期

export interface NotificationReceiver {
  id: string
  type: ReceiverType
  name: string
  /** 机器人 Webhook URL 或自定义 Webhook 地址 */
  webhookUrl: string
  /** 订阅的消息类型 */
  subscriptions: SubscriptionType[]
}

const RECEIVER_TYPE_OPTIONS: { value: ReceiverType; label: string; icon: React.ReactNode }[] = [
  { value: "dingtalk", label: "钉钉机器人", icon: <Bot className="size-4" /> },
  { value: "feishu", label: "飞书机器人", icon: <MessageCircle className="size-4" /> },
  { value: "wechat_work", label: "企业微信机器人", icon: <Send className="size-4" /> },
  { value: "webhook", label: "Webhook", icon: <Link2 className="size-4" /> },
]

const SUBSCRIPTION_OPTIONS: { value: SubscriptionType; label: string }[] = [
  { value: "task_created", label: "任务创建" },
  { value: "task_completed", label: "任务执行完成" },
  { value: "task_failed", label: "任务执行失败" },
  { value: "vm_recycled", label: "开发环境被回收" },
  { value: "vm_expiring", label: "开发环境即将到期" },
]

function getReceiverTypeLabel(type: ReceiverType): string {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

function getReceiverTypeIcon(type: ReceiverType): React.ReactNode {
  return RECEIVER_TYPE_OPTIONS.find((o) => o.value === type)?.icon ?? <Bot className="size-4" />
}

export default function Notifications() {
  const [receivers, setReceivers] = useState<NotificationReceiver[]>([])
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingReceiver, setEditingReceiver] = useState<NotificationReceiver | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [receiverToDelete, setReceiverToDelete] = useState<NotificationReceiver | null>(null)

  const [formType, setFormType] = useState<ReceiverType>("webhook")
  const [formName, setFormName] = useState("")
  const [formWebhookUrl, setFormWebhookUrl] = useState("")
  const [formSubscriptions, setFormSubscriptions] = useState<SubscriptionType[]>([])

  const resetForm = () => {
    setFormType("webhook")
    setFormName("")
    setFormWebhookUrl("")
    setFormSubscriptions([])
    setEditingReceiver(null)
  }

  const openAddDialog = () => {
    resetForm()
    setAddDialogOpen(true)
  }

  const openEditDialog = (receiver: NotificationReceiver) => {
    setEditingReceiver(receiver)
    setFormType(receiver.type)
    setFormName(receiver.name)
    setFormWebhookUrl(receiver.webhookUrl)
    setFormSubscriptions([...receiver.subscriptions])
    setAddDialogOpen(true)
  }

  const handleSave = () => {
    if (!formWebhookUrl.trim()) return
    const name = formName.trim() || getReceiverTypeLabel(formType)

    if (editingReceiver) {
      setReceivers((prev) =>
        prev.map((r) =>
          r.id === editingReceiver.id
            ? {
                ...r,
                type: formType,
                name,
                webhookUrl: formWebhookUrl.trim(),
                subscriptions: formSubscriptions,
              }
            : r
        )
      )
    } else {
      setReceivers((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: formType,
          name,
          webhookUrl: formWebhookUrl.trim(),
          subscriptions: formSubscriptions,
        },
      ])
    }
    setAddDialogOpen(false)
    resetForm()
  }

  const handleDelete = (receiver: NotificationReceiver) => {
    setReceiverToDelete(receiver)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = () => {
    if (receiverToDelete) {
      setReceivers((prev) => prev.filter((r) => r.id !== receiverToDelete.id))
      setReceiverToDelete(null)
    }
    setDeleteDialogOpen(false)
  }

  const toggleSubscription = (sub: SubscriptionType) => {
    setFormSubscriptions((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    )
  }

  const listReceivers = () => (
    <ItemGroup className="flex flex-col gap-4">
      {receivers.map((receiver) => (
        <Item key={receiver.id} variant="outline" className="hover:border-primary/50" size="sm">
          <ItemMedia className="hidden sm:flex">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              {getReceiverTypeIcon(receiver.type)}
            </div>
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{receiver.name}</ItemTitle>
            <ItemDescription className="break-all">
              {getReceiverTypeLabel(receiver.type)} · 订阅{" "}
              {receiver.subscriptions.length > 0
                ? receiver.subscriptions
                    .map((s) => SUBSCRIPTION_OPTIONS.find((o) => o.value === s)?.label)
                    .join("、")
                : "无"}
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
                <DropdownMenuItem onClick={() => openEditDialog(receiver)}>
                  <IconPencil />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => handleDelete(receiver)}
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

  return (
    <Card className="w-full shadow-none">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell />
          消息通知
        </CardTitle>
        <CardDescription>
          配置任务、系统等消息的接收方式，支持钉钉、飞书、企业微信机器人和 Webhook
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={openAddDialog} disabled>
            <CirclePlus className="size-4" />
            添加接收端
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {receivers.length > 0 && listReceivers()}
      </CardContent>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingReceiver ? "编辑接收端" : "添加接收端"}</DialogTitle>
            <DialogDescription>
              选择接收端类型并配置 Webhook 地址，订阅需要接收的消息类型
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>接收端类型</Label>
              <Select value={formType} onValueChange={(v) => setFormType(v as ReceiverType)}>
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
            </div>
            <div className="space-y-2">
              <Label>名称（可选）</Label>
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
              <Label>订阅消息</Label>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                {SUBSCRIPTION_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={formSubscriptions.includes(opt.value)}
                      onCheckedChange={() => toggleSubscription(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={!formWebhookUrl.trim()}>
              {editingReceiver ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要移除接收端「{receiverToDelete?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setReceiverToDelete(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>确认移除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
