package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/dispatcher"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/template"
)

type NotifyChannelUsecaseImpl struct {
	repo        domain.NotifyChannelRepo
	subRepo     domain.NotifySubscriptionRepo
	dispatcher  *dispatcher.Dispatcher
	senderReg   *channel.Registry
	templateReg *template.Registry
	logger      *slog.Logger
}

func NewNotifyChannelUsecase(i *do.Injector) (domain.NotifyChannelUsecase, error) {
	return &NotifyChannelUsecaseImpl{
		repo:        do.MustInvoke[domain.NotifyChannelRepo](i),
		subRepo:     do.MustInvoke[domain.NotifySubscriptionRepo](i),
		dispatcher:  do.MustInvoke[*dispatcher.Dispatcher](i),
		senderReg:   do.MustInvoke[*channel.Registry](i),
		templateReg: do.MustInvoke[*template.Registry](i),
		logger:      do.MustInvoke[*slog.Logger](i).With("module", "usecase.notify_channel"),
	}, nil
}

func (u *NotifyChannelUsecaseImpl) Create(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType, req *domain.CreateNotifyChannelReq) (*domain.NotifyChannel, error) {
	// 微信公众号渠道由扫码 callback (HandleBindEvent) 自动创建，不允许从这里手动建。
	if req.Kind == consts.NotifyChannelWechatMP {
		return nil, errcode.ErrInvalidParameter
	}
	if err := channel.ValidateWebhookURL(req.WebhookURL); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	if err := channel.ValidateHeaders(req.Headers); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}
	ch, err := u.repo.Create(ctx, ownerID, ownerType, req)
	if err != nil {
		return nil, err
	}
	scope := ownerScope(ownerType, ownerID)
	_, err = u.subRepo.Upsert(ctx, ch.ID, scope, req.EventTypes)
	if err != nil {
		_ = u.repo.Delete(ctx, ch.ID)
		return nil, err
	}
	ch, err = u.repo.Get(ctx, ch.ID)
	if err != nil {
		return nil, err
	}
	return toNotifyChannel(ch), nil
}

func (u *NotifyChannelUsecaseImpl) Update(ctx context.Context, ownerID uuid.UUID, id uuid.UUID, req *domain.UpdateNotifyChannelReq) (*domain.NotifyChannel, error) {
	ch, err := u.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if ch.OwnerID != ownerID {
		return nil, errcode.ErrForbidden
	}
	// 微信公众号渠道对 CRUD 接口隐藏，仅由扫码/取关回调维护。
	if ch.Kind == consts.NotifyChannelWechatMP {
		return nil, errcode.ErrNotFound
	}

	if req.WebhookURL != "" {
		if err := channel.ValidateWebhookURL(req.WebhookURL); err != nil {
			return nil, errcode.ErrInvalidParameter.Wrap(err)
		}
	}
	if err := channel.ValidateHeaders(req.Headers); err != nil {
		return nil, errcode.ErrInvalidParameter.Wrap(err)
	}

	_, err = u.repo.Update(ctx, id, req)
	if err != nil {
		return nil, err
	}
	if len(req.EventTypes) > 0 {
		scope := ownerScope(ch.OwnerType, ch.OwnerID)
		if subs := ch.Edges.Subscriptions; len(subs) > 0 {
			scope = subs[0].Scope
		}
		_, err = u.subRepo.Upsert(ctx, id, scope, req.EventTypes)
		if err != nil {
			return nil, err
		}
	}
	updated, err := u.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return toNotifyChannel(updated), nil
}

func (u *NotifyChannelUsecaseImpl) Delete(ctx context.Context, ownerID uuid.UUID, id uuid.UUID) error {
	ch, err := u.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if ch.OwnerID != ownerID {
		return errcode.ErrForbidden
	}
	if ch.Kind == consts.NotifyChannelWechatMP {
		return errcode.ErrNotFound
	}
	return u.repo.Delete(ctx, id)
}

func (u *NotifyChannelUsecaseImpl) List(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType) ([]*domain.NotifyChannel, error) {
	channels, err := u.repo.ListByOwner(ctx, ownerID, ownerType)
	if err != nil {
		return nil, err
	}
	result := make([]*domain.NotifyChannel, 0, len(channels))
	for _, ch := range channels {
		// 微信公众号渠道对 CRUD 接口隐藏。
		if ch.Kind == consts.NotifyChannelWechatMP {
			continue
		}
		result = append(result, toNotifyChannel(ch))
	}
	return result, nil
}

func (u *NotifyChannelUsecaseImpl) Test(ctx context.Context, ownerID uuid.UUID, id uuid.UUID) error {
	ch, err := u.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if ch.OwnerID != ownerID {
		return errcode.ErrForbidden
	}
	if ch.Kind == consts.NotifyChannelWechatMP {
		return errcode.ErrNotFound
	}

	sender, ok := u.senderReg.Get(ch.Kind)
	if !ok {
		return errcode.ErrInvalidParameter
	}

	cfg := &channel.ChannelConfig{
		WebhookURL: ch.WebhookURL,
		Secret:     ch.Secret,
		Headers:    ch.Headers,
		TargetID:   ch.TargetID,
	}

	// 由 sender 自己判定哪些字段需要校验（URL 类做 SSRF，ID 类做 target_id 非空等）。
	if err := sender.Validate(cfg); err != nil {
		return errcode.ErrInvalidParameter.Wrap(err)
	}

	msg := channel.Message{
		Title: "🔔 通知渠道测试",
		Body:  "这是一条测试消息，说明您的通知渠道配置正确。\n\n**时间**: " + time.Now().Format("2006-01-02 15:04:05"),
	}

	return sender.Send(ctx, cfg, nil, msg)
}

func ownerScope(ownerType consts.NotifyOwnerType, ownerID uuid.UUID) string {
	switch ownerType {
	case consts.NotifyOwnerTeam:
		return fmt.Sprintf("team:%s", ownerID.String())
	default:
		return "self"
	}
}

func toNotifyChannel(ch *db.NotifyChannel) *domain.NotifyChannel {
	result := &domain.NotifyChannel{
		ID:         ch.ID,
		OwnerID:    ch.OwnerID,
		OwnerType:  ch.OwnerType,
		Name:       ch.Name,
		Kind:       ch.Kind,
		WebhookURL: ch.WebhookURL,
		Enabled:    ch.Enabled,
		CreatedAt:  ch.CreatedAt.Unix(),
	}
	if ch.Kind == consts.NotifyChannelWechatMP {
		result.Scope = "self"
		var dbEventTypes []consts.NotifyEventType
		for _, sub := range ch.Edges.Subscriptions {
			if result.Scope == "self" && sub.Scope != "" {
				result.Scope = sub.Scope
			}
			for _, eventType := range sub.EventTypes {
				if !slices.Contains(dbEventTypes, eventType) {
					dbEventTypes = append(dbEventTypes, eventType)
				}
			}
		}
		result.EventTypes = consts.MergeWechatMPNotifyEventTypes(dbEventTypes)
		return result
	}
	if subs := ch.Edges.Subscriptions; len(subs) > 0 {
		result.Scope = subs[0].Scope
		result.EventTypes = subs[0].EventTypes
	}
	return result
}
