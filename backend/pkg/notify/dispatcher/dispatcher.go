package dispatcher

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/channel"
	"github.com/chaitin/MonkeyCode/backend/pkg/notify/template"
)

// Dispatcher 事件分发器
type Dispatcher struct {
	redis         *redis.Client
	channelRepo   domain.NotifyChannelRepo
	sendLogRepo   domain.NotifySendLogRepo
	senderReg     *channel.Registry
	templateReg   *template.Registry
	logger        *slog.Logger
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	teamResolver  func(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	sendSemaphore chan struct{}
}

// NewDispatcher 创建事件分发器
func NewDispatcher(
	i *do.Injector,
	teamResolver func(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error),
) *Dispatcher {
	return &Dispatcher{
		redis:         do.MustInvoke[*redis.Client](i),
		channelRepo:   do.MustInvoke[domain.NotifyChannelRepo](i),
		sendLogRepo:   do.MustInvoke[domain.NotifySendLogRepo](i),
		senderReg:     do.MustInvoke[*channel.Registry](i),
		templateReg:   do.MustInvoke[*template.Registry](i),
		teamResolver:  teamResolver,
		logger:        do.MustInvoke[*slog.Logger](i).With("module", "notify.dispatcher"),
		sendSemaphore: make(chan struct{}, 20),
	}
}

// Start 启动分发器消费循环
func (d *Dispatcher) Start(ctx context.Context) {
	ctx, d.cancel = context.WithCancel(ctx)

	if err := d.redis.XGroupCreateMkStream(ctx, consts.NotifyEventStreamKey, consts.NotifyEventConsumerGroup, "0").Err(); err != nil {
		if !isAlreadyExistsErr(err) {
			d.logger.ErrorContext(ctx, "failed to create consumer group", "error", err)
		}
	}

	d.wg.Add(2)
	go func() {
		defer d.wg.Done()
		d.consume(ctx)
	}()
	go func() {
		defer d.wg.Done()
		d.startStreamTrim(ctx)
	}()
}

// Close 停止分发器
func (d *Dispatcher) Close() {
	if d.cancel != nil {
		d.cancel()
	}
	d.wg.Wait()
}

// Publish 发布通知事件到 Redis Stream
func (d *Dispatcher) Publish(ctx context.Context, event *domain.NotifyEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	return d.redis.XAdd(ctx, &redis.XAddArgs{
		Stream: consts.NotifyEventStreamKey,
		ID:     "*",
		MaxLen: 10000,
		Approx: true,
		Values: map[string]any{"data": string(data)},
	}).Err()
}

func (d *Dispatcher) consume(ctx context.Context) {
	consumerName := fmt.Sprintf("consumer-%s", uuid.NewString()[:8])
	streams := []string{consts.NotifyEventStreamKey, ">"}

	for {
		res, err := d.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    consts.NotifyEventConsumerGroup,
			Consumer: consumerName,
			Streams:  streams,
			Count:    10,
			Block:    time.Second,
		}).Result()
		if err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return
			}
			time.Sleep(time.Second)
			continue
		}

		for _, stream := range res {
			for _, msg := range stream.Messages {
				d.handleMessage(ctx, stream.Stream, msg)
			}
		}
	}
}

func (d *Dispatcher) handleMessage(ctx context.Context, streamKey string, msg redis.XMessage) {
	raw, ok := msg.Values["data"]
	if !ok {
		d.ackMessage(streamKey, msg.ID)
		return
	}
	dataStr, ok := raw.(string)
	if !ok {
		d.ackMessage(streamKey, msg.ID)
		return
	}

	var event domain.NotifyEvent
	if err := json.Unmarshal([]byte(dataStr), &event); err != nil {
		d.logger.ErrorContext(ctx, "unmarshal event failed", "error", err)
		d.ackMessage(streamKey, msg.ID)
		return
	}

	d.dispatchOne(ctx, &event)
	d.ackMessage(streamKey, msg.ID)
}

func (d *Dispatcher) ackMessage(streamKey, msgID string) {
	ackCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = d.redis.XAck(ackCtx, streamKey, consts.NotifyEventConsumerGroup, msgID).Err()
}

func (d *Dispatcher) dispatchOne(ctx context.Context, event *domain.NotifyEvent) {
	logger := d.logger.With("event_type", event.EventType, "ref_id", event.RefID, "user_id", event.SubjectUserID)

	logger.InfoContext(ctx, "dispatching event")

	var teamIDs []uuid.UUID
	if d.teamResolver != nil {
		var err error
		teamIDs, err = d.teamResolver(ctx, event.SubjectUserID)
		if err != nil {
			logger.WarnContext(ctx, "failed to resolve teams", "error", err)
		}
	}

	channels, err := d.channelRepo.FindMatchingChannels(ctx, event.SubjectUserID, teamIDs, event.EventType)
	if err != nil {
		logger.ErrorContext(ctx, "failed to find matching channels", "error", err)
		return
	}

	if len(channels) == 0 {
		logger.InfoContext(ctx, "no matching channels found", "team_ids", teamIDs)
		return
	}

	msg, err := d.templateReg.Render(event)
	if err != nil {
		logger.ErrorContext(ctx, "failed to render message", "error", err)
		return
	}

	var wg sync.WaitGroup
	for _, ch := range channels {
		for _, sub := range ch.Edges.Subscriptions {
			exists, err := d.sendLogRepo.Exists(ctx, sub.ID, event.EventType, event.RefID)
			if err != nil {
				logger.WarnContext(ctx, "failed to check send log", "error", err)
			}
			if exists {
				continue
			}

			ch := ch
			sub := sub
			wg.Go(func() {
				d.sendSemaphore <- struct{}{}
				defer func() { <-d.sendSemaphore }()

				sender, ok := d.senderReg.Get(ch.Kind)
				if !ok {
					logger.WarnContext(ctx, "no sender for channel kind", "kind", ch.Kind)
					return
				}

				cfg := &channel.ChannelConfig{
					WebhookURL: ch.WebhookURL,
					Secret:     ch.Secret,
					Headers:    ch.Headers,
				}

				if err := channel.ValidateWebhookURL(cfg.WebhookURL); err != nil {
					logger.WarnContext(ctx, "blocked webhook url", "channel_id", ch.ID, "error", err)
					return
				}
				if err := channel.ValidateHeaders(cfg.Headers); err != nil {
					logger.WarnContext(ctx, "blocked webhook headers", "channel_id", ch.ID, "error", err)
					return
				}

				sendErr := sender.Send(ctx, cfg, msg)

				status := consts.NotifySendOK
				errMsg := ""
				if sendErr != nil {
					status = consts.NotifySendFailed
					errMsg = sendErr.Error()
					logger.WarnContext(ctx, "send failed", "channel_id", ch.ID, "error", sendErr)
				}

				_ = d.sendLogRepo.Create(ctx, &domain.CreateNotifySendLogReq{
					SubscriptionID: sub.ID,
					ChannelID:      ch.ID,
					EventType:      event.EventType,
					EventRefID:     event.RefID,
					Status:         status,
					Error:          errMsg,
				})
			})
		}
	}
	wg.Wait()
}

func isAlreadyExistsErr(err error) bool {
	return err != nil && err.Error() == "BUSYGROUP Consumer Group name already exists"
}

func (d *Dispatcher) startStreamTrim(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			minID := fmt.Sprintf("%d-0", time.Now().Add(-72*time.Hour).UnixMilli())
			if err := d.redis.XTrimMinID(ctx, consts.NotifyEventStreamKey, minID).Err(); err != nil {
				if !errors.Is(err, redis.Nil) {
					d.logger.WarnContext(ctx, "failed to trim notify stream", "error", err)
				}
			}
		}
	}
}
