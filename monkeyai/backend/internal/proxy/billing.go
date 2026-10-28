package proxy

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type BillingRequest struct {
	Path, IdempotencyKey, SessionID string
	Body                            []byte
}
type Reservation struct {
	ID string
}
type Billing interface {
	Begin(context.Context, Target, BillingRequest) (Reservation, error)
	Start(context.Context, string) error
	Finish(context.Context, string, Call) error
}

func (p *Proxy) WithBilling(b Billing) *Proxy { p.billing = b; return p }
func (p *Proxy) finish(ctx context.Context, pc *proxyContext, call Call) {
	if pc == nil {
		return
	}
	if pc.target.OwnershipType == "user" {
		if p.recorder == nil {
			return
		}
	} else if p.billing == nil || pc.reservation.ID == "" {
		return
	}
	pc.settled.Do(func() {
		p.captures.Go(func() {
			c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
			if pc.target.OwnershipType == "user" {
				call.ModelID, call.UserID = pc.target.ModelID, pc.target.UserID
				call.SessionID = pc.target.SessionID
				if call.StartedAt.IsZero() {
					call.StartedAt = pc.startedAt
				}
				if call.CompletedAt.IsZero() {
					call.CompletedAt = time.Now()
				}
				if call.Result == "" {
					call.Result = "succeeded"
				}
				if !call.Known && call.ErrorCode == "" {
					call.ErrorCode = "usage_unknown"
				}
				if err := p.recorder.Record(c, call); err != nil {
					logging.Event(c, p.logger, slog.LevelError, "proxy.operation.error", "记录自配模型用量失败", "module", "proxy", "operation", "finish", "model_id", call.ModelID, "error", err)
				}
				return
			}
			if err := p.billing.Finish(c, pc.reservation.ID, call); err != nil {
				logging.Event(c, p.logger, slog.LevelError, "billing.settlement.pending", "模型计费结算待恢复", "module", "proxy", "operation", "finish", "transaction_id", pc.reservation.ID, "error", err)
			}
		})
	})
}
func billingError(ctx context.Context, w http.ResponseWriter, err error) { resource.Fail(ctx, w, err) }

func (p *Proxy) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() { p.captures.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
