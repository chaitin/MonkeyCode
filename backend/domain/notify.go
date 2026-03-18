package domain

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
)

// NotifyChannelUsecase 通知渠道业务逻辑接口
type NotifyChannelUsecase interface {
	Create(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType, req *CreateNotifyChannelReq) (*NotifyChannel, error)
	Update(ctx context.Context, ownerID uuid.UUID, id uuid.UUID, req *UpdateNotifyChannelReq) (*NotifyChannel, error)
	Delete(ctx context.Context, ownerID uuid.UUID, id uuid.UUID) error
	List(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType) ([]*NotifyChannel, error)
	Test(ctx context.Context, ownerID uuid.UUID, id uuid.UUID) error
}

// NotifyChannelRepo 通知渠道数据访问接口
type NotifyChannelRepo interface {
	Create(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType, req *CreateNotifyChannelReq) (*db.NotifyChannel, error)
	Update(ctx context.Context, id uuid.UUID, req *UpdateNotifyChannelReq) (*db.NotifyChannel, error)
	Delete(ctx context.Context, id uuid.UUID) error
	Get(ctx context.Context, id uuid.UUID) (*db.NotifyChannel, error)
	ListByOwner(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType) ([]*db.NotifyChannel, error)
	FindMatchingChannels(ctx context.Context, subjectUserID uuid.UUID, teamIDs []uuid.UUID, eventType consts.NotifyEventType) ([]*db.NotifyChannel, error)
}

// NotifySubscriptionRepo 通知订阅数据访问接口
type NotifySubscriptionRepo interface {
	Upsert(ctx context.Context, channelID uuid.UUID, scope string, eventTypes []consts.NotifyEventType) (*db.NotifySubscription, error)
	Delete(ctx context.Context, id uuid.UUID) error
	ListByChannel(ctx context.Context, channelID uuid.UUID) ([]*db.NotifySubscription, error)
}

// NotifySendLogRepo 通知发送日志数据访问接口
type NotifySendLogRepo interface {
	Create(ctx context.Context, log *CreateNotifySendLogReq) error
	Exists(ctx context.Context, subscriptionID uuid.UUID, eventType consts.NotifyEventType, eventRefID string) (bool, error)
}

// CreateNotifyChannelReq 创建通知渠道请求
type CreateNotifyChannelReq struct {
	Name       string                   `json:"name" validate:"required,max=64"`
	Kind       consts.NotifyChannelKind `json:"kind" validate:"required,oneof=dingtalk feishu wecom webhook"`
	WebhookURL string                   `json:"webhook_url" validate:"required,url"`
	Secret     string                   `json:"secret,omitempty"`
	Headers    map[string]string        `json:"headers,omitempty"`
	EventTypes []consts.NotifyEventType `json:"event_types" validate:"required,min=1"`
}

// UpdateNotifyChannelReq 更新通知渠道请求
type UpdateNotifyChannelReq struct {
	Name       string                   `json:"name,omitempty"`
	WebhookURL string                   `json:"webhook_url,omitempty"`
	Secret     string                   `json:"secret,omitempty"`
	Headers    map[string]string        `json:"headers,omitempty"`
	Enabled    *bool                    `json:"enabled,omitempty"`
	EventTypes []consts.NotifyEventType `json:"event_types,omitempty"`
}

// NotifyChannel 通知渠道
type NotifyChannel struct {
	ID         uuid.UUID                `json:"id"`
	OwnerID    uuid.UUID                `json:"owner_id"`
	OwnerType  consts.NotifyOwnerType   `json:"owner_type"`
	Name       string                   `json:"name"`
	Kind       consts.NotifyChannelKind `json:"kind"`
	WebhookURL string                   `json:"webhook_url"`
	Enabled    bool                     `json:"enabled"`
	Scope      string                   `json:"scope"`
	EventTypes []consts.NotifyEventType `json:"event_types"`
	CreatedAt  int64                    `json:"created_at"`
}

// NotifyEvent 通知事件
type NotifyEvent struct {
	EventType     consts.NotifyEventType `json:"event_type"`
	SubjectUserID uuid.UUID              `json:"subject_user_id"`
	RefID         string                 `json:"ref_id"`
	OccurredAt    time.Time              `json:"occurred_at"`
	Payload       NotifyEventPayload     `json:"payload"`
}

// NotifyEventPayload 通知事件载荷
type NotifyEventPayload struct {
	TaskID      string     `json:"task_id,omitempty"`
	TaskContent string     `json:"task_content,omitempty"`
	TaskStatus  string     `json:"task_status,omitempty"`
	RepoURL     string     `json:"repo_url,omitempty"`
	ModelName   string     `json:"model_name,omitempty"`
	UserName    string     `json:"user_name,omitempty"`
	TaskURL     string     `json:"task_url,omitempty"`
	VMID        string     `json:"vm_id,omitempty"`
	HostID      string     `json:"host_id,omitempty"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
	VMName      string     `json:"vm_name,omitempty"`
	VMArch      string     `json:"vm_arch,omitempty"`
	VMCores     int        `json:"vm_cores,omitempty"`
	VMMemory    int64      `json:"vm_memory,omitempty"`
	VMOS        string     `json:"vm_os,omitempty"`
}

// CreateNotifySendLogReq 创建通知发送日志请求
type CreateNotifySendLogReq struct {
	SubscriptionID uuid.UUID                `json:"subscription_id"`
	ChannelID      uuid.UUID                `json:"channel_id"`
	EventType      consts.NotifyEventType   `json:"event_type"`
	EventRefID     string                   `json:"event_ref_id"`
	Status         consts.NotifySendStatus  `json:"status"`
	Error          string                   `json:"error"`
}
