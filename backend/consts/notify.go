package consts

// NotifyEventType 通知事件类型
type NotifyEventType string

const (
	NotifyEventTaskCreated         NotifyEventType = "task.created"
	NotifyEventTaskEnded           NotifyEventType = "task.ended"
	NotifyEventVMExpiringSoon      NotifyEventType = "vm.expiring_soon"
	NotifyEventQuotaRefreshed      NotifyEventType = "quota.refreshed"
	NotifyEventQuotaBasicExhausted NotifyEventType = "quota.basic_exhausted"
	NotifyEventQuotaProExhausted   NotifyEventType = "quota.pro_exhausted"
	NotifyEventQuotaUltraExhausted NotifyEventType = "quota.ultra_exhausted"
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
	{Type: NotifyEventQuotaRefreshed, Name: "会员免费额度已刷新", Description: "每日免费额度刷新提醒（仅会员）"},
	{Type: NotifyEventQuotaBasicExhausted, Name: "今日基础模型额度已耗尽", Description: "基础模型当日免费额度耗尽提醒"},
	{Type: NotifyEventQuotaProExhausted, Name: "今日专业模型额度已耗尽", Description: "专业模型当日免费额度耗尽提醒"},
	{Type: NotifyEventQuotaUltraExhausted, Name: "今日旗舰模型额度已耗尽", Description: "旗舰模型当日免费额度耗尽提醒"},
}

// WechatMPFixedNotifyEventTypes 是微信公众号渠道固定接收的事件集合。
var WechatMPFixedNotifyEventTypes = []NotifyEventType{
	NotifyEventVMExpiringSoon,
	NotifyEventQuotaRefreshed,
	NotifyEventQuotaBasicExhausted,
	NotifyEventQuotaProExhausted,
	NotifyEventQuotaUltraExhausted,
}

// MergeWechatMPNotifyEventTypes 返回微信公众号渠道的最终事件集合：固定事件 + 数据库附加事件。
func MergeWechatMPNotifyEventTypes(extra []NotifyEventType) []NotifyEventType {
	merged := make([]NotifyEventType, 0, len(WechatMPFixedNotifyEventTypes)+len(extra))
	for _, eventType := range WechatMPFixedNotifyEventTypes {
		merged = append(merged, eventType)
	}
	for _, eventType := range extra {
		exists := false
		for _, fixedEventType := range merged {
			if fixedEventType == eventType {
				exists = true
				break
			}
		}
		if !exists {
			merged = append(merged, eventType)
		}
	}
	return merged
}

// NotifyChannelKind 通知渠道类型
type NotifyChannelKind string

const (
	NotifyChannelDingTalk NotifyChannelKind = "dingtalk"
	NotifyChannelFeishu   NotifyChannelKind = "feishu"
	NotifyChannelWeCom    NotifyChannelKind = "wecom"
	NotifyChannelWebhook  NotifyChannelKind = "webhook"
	NotifyChannelWechatMP NotifyChannelKind = "wechat_mp"
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
