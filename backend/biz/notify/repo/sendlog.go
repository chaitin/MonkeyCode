package repo

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/notifysendlog"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/errcode"
)

type NotifySendLogRepoImpl struct {
	db     *db.Client
	logger *slog.Logger
}

func NewNotifySendLogRepo(i *do.Injector) (domain.NotifySendLogRepo, error) {
	d := do.MustInvoke[*db.Client](i)
	l := do.MustInvoke[*slog.Logger](i)
	return &NotifySendLogRepoImpl{
		db:     d,
		logger: l.With("module", "repo.notify_send_log"),
	}, nil
}

func (r *NotifySendLogRepoImpl) Create(ctx context.Context, req *domain.CreateNotifySendLogReq) error {
	_, err := r.db.NotifySendLog.Create().
		SetSubscriptionID(req.SubscriptionID).
		SetChannelID(req.ChannelID).
		SetEventType(req.EventType).
		SetEventRefID(req.EventRefID).
		SetStatus(req.Status).
		SetError(req.Error).
		Save(ctx)
	if err != nil {
		r.logger.ErrorContext(ctx, "failed to create send log", "error", err)
		return errcode.ErrDatabaseOperation.Wrap(err)
	}
	return nil
}

func (r *NotifySendLogRepoImpl) Exists(ctx context.Context, subscriptionID uuid.UUID, eventType consts.NotifyEventType, eventRefID string) (bool, error) {
	count, err := r.db.NotifySendLog.Query().
		Where(
			notifysendlog.SubscriptionIDEQ(subscriptionID),
			notifysendlog.EventTypeEQ(eventType),
			notifysendlog.EventRefIDEQ(eventRefID),
			notifysendlog.StatusEQ(consts.NotifySendOK),
		).
		Count(ctx)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}
