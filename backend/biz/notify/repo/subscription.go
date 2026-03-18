package repo

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/notifysubscription"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type NotifySubscriptionRepoImpl struct {
	db     *db.Client
	logger *slog.Logger
}

func NewNotifySubscriptionRepo(i *do.Injector) (domain.NotifySubscriptionRepo, error) {
	d := do.MustInvoke[*db.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return &NotifySubscriptionRepoImpl{
		db:     d,
		logger: l.With("module", "repo.notify_subscription"),
	}, nil
}

func (r *NotifySubscriptionRepoImpl) Upsert(ctx context.Context, channelID uuid.UUID, scope string, eventTypes []consts.NotifyEventType) (*db.NotifySubscription, error) {
	existing, err := r.db.NotifySubscription.Query().
		Where(notifysubscription.ChannelIDEQ(channelID)).
		First(ctx)
	if err != nil && !db.IsNotFound(err) {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}

	if existing != nil {
		updated, err := existing.Update().
			SetScope(scope).
			SetEventTypes(eventTypes).
			Save(ctx)
		if err != nil {
			r.logger.ErrorContext(ctx, "failed to update subscription", "error", err)
			return nil, errcode.ErrDatabaseOperation.Wrap(err)
		}
		return updated, nil
	}

	sub, err := r.db.NotifySubscription.Create().
		SetChannelID(channelID).
		SetScope(scope).
		SetEventTypes(eventTypes).
		SetEnabled(true).
		Save(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to create subscription", "error", err)
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return sub, nil
}

func (r *NotifySubscriptionRepoImpl) Delete(ctx context.Context, id uuid.UUID) error {
	err := r.db.NotifySubscription.DeleteOneID(id).Exec(ctx)
	if err != nil {
		if db.IsNotFound(err) {
			return errcode.ErrNotFound
		}
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

func (r *NotifySubscriptionRepoImpl) ListByChannel(ctx context.Context, channelID uuid.UUID) ([]*db.NotifySubscription, error) {
	subs, err := r.db.NotifySubscription.Query().
		Where(notifysubscription.ChannelIDEQ(channelID)).
		All(ctx)
	if err != nil {
		return nil, errcode.ErrDatabaseOperation.Wrap(err)
	}
	return subs, nil
}
