package consts

// NotifyEventType 通知事件类型
type NotifyEventType string

const (
	NotifyEventTaskCreated    NotifyEventType = "task.created"
	NotifyEventTaskEnded      NotifyEventType = "task.ended"
	NotifyEventVMExpiringSoon NotifyEventType = "vm.expiring_soon"
)

// NotifyEventTypeInfo 事件类型描述信息
type NotifyEventTypeInfo struct {
	Type        NotifyEventType `json:"type"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
}

// AllNotifyEventTypes 所有支持的通知事件类型
var AllNotifyEventTypes = []NotifyEventTypeInfo{
	{Type: NotifyEventTaskCreated, Name: "创建任务", Description: "新任务创建事件"},
	{Type: NotifyEventTaskEnded, Name: "对话完成", Description: "任务过程中的一轮对话完成"},
	{Type: NotifyEventVMExpiringSoon, Name: "开发环境即将被回收", Description: "开发环境即将到期回收"},
}

// NotifyChannelKind 通知渠道类型
type NotifyChannelKind string

const (
	NotifyChannelDingTalk NotifyChannelKind = "dingtalk"
	NotifyChannelFeishu   NotifyChannelKind = "feishu"
	NotifyChannelWeCom    NotifyChannelKind = "wecom"
	NotifyChannelWebhook  NotifyChannelKind = "webhook"
)

// NotifyOwnerType 通知渠道所有者类型
type NotifyOwnerType string

const (
	NotifyOwnerUser NotifyOwnerType = "user"
	NotifyOwnerTeam NotifyOwnerType = "team"
)

// NotifySendStatus 通知发送状态
type NotifySendStatus string

const (
	NotifySendOK      NotifySendStatus = "ok"
	NotifySendFailed  NotifySendStatus = "failed"
	NotifySendSkipped NotifySendStatus = "skipped"
)

const (
	// NotifyEventStreamKey Redis Stream key for notify events
	NotifyEventStreamKey = "mcai:notify:stream"
	// NotifyEventConsumerGroup 通知事件消费组
	NotifyEventConsumerGroup = "notify-dispatcher"
	// VMExpireWarningQueueKey VM 过期预警队列 key
	VMExpireWarningQueueKey = "vmexpirewarn:queue"
)
