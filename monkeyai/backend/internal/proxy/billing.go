package proxy

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type BillingRequest struct {
	Path, IdempotencyKey, SessionID string
	Body                            []byte
}
type Reservation struct {
	ID          string
	OutputLimit int64
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
		pc.settled.Do(func() {
			c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
			defer cancel()
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
				p.logger.ErrorContext(c, "记录自配模型用量失败", "model_id", call.ModelID, "error", err)
			}
		})
		return
	}
	if p.billing == nil || pc.reservation.ID == "" {
		return
	}
	pc.settled.Do(func() {
		c, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancel()
		if err := p.billing.Finish(c, pc.reservation.ID, call); err != nil {
			p.logger.ErrorContext(c, "模型计费结算待恢复", "transaction_id", pc.reservation.ID, "error", err)
		}
	})
}
func prepareRequest(body []byte, path string, limit int64, stream bool) ([]byte, error) {
	var data map[string]json.RawMessage
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, err
	}
	if limit > 0 {
		field := "max_tokens"
		switch path {
		case "/v1/responses":
			field = "max_output_tokens"
		case "/v1/chat/completions":
			if _, ok := data["max_tokens"]; !ok {
				field = "max_completion_tokens"
			}
			delete(data, "max_completion_tokens")
			delete(data, "max_tokens")
		}
		data[field], _ = json.Marshal(limit)
	}
	if stream && path == "/v1/chat/completions" {
		options := map[string]json.RawMessage{}
		if b, ok := data["stream_options"]; ok {
			if err := json.Unmarshal(b, &options); err != nil || options == nil {
				return nil, resource.Invalid("stream_options 无效")
			}
		}
		options["include_usage"] = json.RawMessage("true")
		data["stream_options"], _ = json.Marshal(options)
	}
	return json.Marshal(data)
}
func billingError(w http.ResponseWriter, err error) { resource.Fail(w, err) }

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
