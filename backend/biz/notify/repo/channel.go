package repo

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/notifychannel"
	"github.com/chaitin/MonkeyCode/backend/db/notifysubscription"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type NotifyChannelRepoImpl struct {
	db     *db.Client
	logger *slog.Logger
}

func NewNotifyChannelRepo(i *do.Injector) (domain.NotifyChannelRepo, error) {
	d := do.MustInvoke[*db.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return &NotifyChannelRepoImpl{
		db:     d,
		logger: l.With("module", "repo.notify_channel"),
	}, nil
}

func (r *NotifyChannelRepoImpl) Create(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType, req *domain.CreateNotifyChannelReq) (*db.NotifyChannel, error) {
	ch, err := r.db.NotifyChannel.Create().
		SetOwnerID(ownerID).
		SetOwnerType(ownerType).
		SetName(req.Name).
		SetKind(req.Kind).
		SetWebhookURL(req.WebhookURL).
		SetSecret(req.Secret).
		SetHeaders(req.Headers).
		SetEnabled(true).
		Save(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to create notify channel", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return ch, nil
}

func (r *NotifyChannelRepoImpl) Update(ctx context.Context, id uuid.UUID, req *domain.UpdateNotifyChannelReq) (*db.NotifyChannel, error) {
	update := r.db.NotifyChannel.UpdateOneID(id)
	if req.Name != "" {
		update.SetName(req.Name)
	}
	if req.WebhookURL != "" {
		update.SetWebhookURL(req.WebhookURL)
	}
	if req.Secret != "" {
		update.SetSecret(req.Secret)
	}
	if req.Headers != nil {
		update.SetHeaders(req.Headers)
	}
	if req.Enabled != nil {
		update.SetEnabled(*req.Enabled)
	}
	ch, err := update.Save(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return ch, nil
}

func (r *NotifyChannelRepoImpl) Delete(ctx context.Context, id uuid.UUID) error {
	err := r.db.NotifyChannel.DeleteOneID(id).Exec(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

func (r *NotifyChannelRepoImpl) Get(ctx context.Context, id uuid.UUID) (*db.NotifyChannel, error) {
	ch, err := r.db.NotifyChannel.Query().
		Where(notifychannel.IDEQ(id)).
		WithSubscriptions().
		First(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return nil, errcode.ErrNotFound
		}
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return ch, nil
}

func (r *NotifyChannelRepoImpl) ListByOwner(ctx context.Context, ownerID uuid.UUID, ownerType consts.NotifyOwnerType) ([]*db.NotifyChannel, error) {
	channels, err := r.db.NotifyChannel.Query().
		Where(
			notifychannel.OwnerIDEQ(ownerID),
			notifychannel.OwnerTypeEQ(ownerType),
		).
		WithSubscriptions().
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return channels, nil
}

func (r *NotifyChannelRepoImpl) FindMatchingChannels(ctx context.Context, subjectUserID uuid.UUID, teamIDs []uuid.UUID, eventType consts.NotifyEventType) ([]*db.NotifyChannel, error) {
	scopes := []string{"self"}
	for _, tid := range teamIDs {
		scopes = append(scopes, fmt.Sprintf("team:%s", tid.String()))
	}

	channels, err := r.db.NotifyChannel.Query().
		Where(
			notifychannel.EnabledEQ(true),
			notifychannel.Or(
				notifychannel.And(
					notifychannel.OwnerIDEQ(subjectUserID),
					notifychannel.OwnerTypeEQ(consts.NotifyOwnerUser),
				),
				notifychannel.And(
					notifychannel.OwnerIDIn(teamIDs...),
					notifychannel.OwnerTypeEQ(consts.NotifyOwnerTeam),
				),
			),
		).
		WithSubscriptions(func(q *db.NotifySubscriptionQuery) {
			q.Where(notifysubscription.EnabledEQ(true))
		}).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}

	var result []*db.NotifyChannel
	for _, ch := range channels {
		var matchingSubs []*db.NotifySubscription
		for _, sub := range ch.Edges.Subscriptions {
			scopeMatch := slices.Contains(scopes, sub.Scope)
			if !scopeMatch {
				if ch.OwnerID == subjectUserID && ch.OwnerType == consts.NotifyOwnerUser && sub.Scope == "self" {
					scopeMatch = true
				}
			}
			if !scopeMatch {
				continue
			}
			if slices.Contains(sub.EventTypes, eventType) {
				matchingSubs = append(matchingSubs, sub)
			}
		}
		if len(matchingSubs) > 0 {
			ch.Edges.Subscriptions = matchingSubs
			result = append(result, ch)
		}
	}
	return result, nil
}
