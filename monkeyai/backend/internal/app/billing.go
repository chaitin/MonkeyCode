package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/endpoint"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/imagegen"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/model"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type applicationHandler struct {
	http.Handler
	billing   *billing.Service
	proxy     *proxy.Proxy
	images    *imagegen.Service
	inputs    *imagegen.Inputs
	endpoints *endpoint.Service
}
type modelBilling struct{ service *billing.Service }
type modelUsageRecorder struct{ models *model.Postgres }

func (r modelUsageRecorder) Record(ctx context.Context, c proxy.Call) error {
	if c.InputTokens > math.MaxInt64 || c.CachedInputTokens > math.MaxInt64 || c.OutputTokens > math.MaxInt64 || c.CachedInputTokens > c.InputTokens {
		return errors.New("模型用量无效")
	}
	return r.models.RecordCall(ctx, model.Call{
		ModelID: c.ModelID, UserID: c.UserID, RequestID: c.RequestID,
		Status: c.Result, ErrorCode: c.ErrorCode,
		InputTokens: int64(c.InputTokens), CachedInputTokens: int64(c.CachedInputTokens),
		OutputTokens: int64(c.OutputTokens), StartedAt: c.StartedAt, CompletedAt: c.CompletedAt,
	})
}

type reconciliationModels interface {
	Get(context.Context, string) (model.Model, error)
}

type modelUsageReconciler struct {
	models    reconciliationModels
	responses *proxy.ResponseReconciler
}

func (r modelUsageReconciler) Reconcile(ctx context.Context, request billing.ReconciliationRequest) (billing.ReconciliationResult, error) {
	item, err := r.models.Get(ctx, request.ResourceID)
	if errors.Is(err, model.ErrNotFound) {
		return billing.ReconciliationResult{State: billing.ReconciliationUnsupported}, nil
	}
	if err != nil {
		return billing.ReconciliationResult{}, err
	}
	result, err := r.responses.Reconcile(ctx, proxy.Target{
		ModelID:       item.ID,
		UpstreamModel: item.ModelID,
		Protocol:      string(item.Protocol),
		BaseURL:       item.BaseURL,
		APIKey:        item.APIKey,
	}, request.RequestID)
	if err != nil {
		return billing.ReconciliationResult{}, err
	}
	switch result.State {
	case proxy.ResponseReconciliationPending:
		return billing.ReconciliationResult{State: billing.ReconciliationPending}, nil
	case proxy.ResponseReconciliationUnsupported:
		return billing.ReconciliationResult{State: billing.ReconciliationUnsupported}, nil
	case proxy.ResponseReconciliationResolved:
		if result.Call.InputTokens > math.MaxInt64 || result.Call.CachedInputTokens > math.MaxInt64 || result.Call.OutputTokens > math.MaxInt64 || result.Call.CachedInputTokens > result.Call.InputTokens {
			return billing.ReconciliationResult{State: billing.ReconciliationUnsupported}, nil
		}
		return billing.ReconciliationResult{
			State: billing.ReconciliationResolved,
			Usage: billing.Usage{
				Input: int64(result.Call.InputTokens), Cached: int64(result.Call.CachedInputTokens), Output: int64(result.Call.OutputTokens),
				Known: true, Result: result.Call.Result, RequestID: result.Call.RequestID,
			},
		}, nil
	default:
		return billing.ReconciliationResult{State: billing.ReconciliationUnsupported}, nil
	}
}

func (b modelBilling) Begin(ctx context.Context, t proxy.Target, r proxy.BillingRequest) (proxy.Reservation, error) {
	var data map[string]json.RawMessage
	if err := json.Unmarshal(r.Body, &data); err != nil {
		return proxy.Reservation{}, resource.Invalid("模型请求无效")
	}
	for _, key := range []string{"n", "best_of"} {
		if raw, ok := data[key]; ok {
			var count int
			if json.Unmarshal(raw, &count) != nil || count != 1 {
				return proxy.Reservation{}, resource.Invalid("计费代理仅支持单结果模型调用")
			}
		}
	}
	if raw, ok := data["background"]; ok {
		var background bool
		if json.Unmarshal(raw, &background) != nil || background {
			return proxy.Reservation{}, resource.Invalid("计费代理暂不支持后台异步生成")
		}
	}
	var limit int64
	for _, k := range []string{"max_tokens", "max_completion_tokens", "max_output_tokens"} {
		if raw, ok := data[k]; ok {
			var v int64
			if err := json.Unmarshal(raw, &v); err != nil || v <= 0 {
				return proxy.Reservation{}, resource.Invalid("输出限制须为正整数")
			}
			if limit == 0 || v < limit {
				limit = v
			}
		}
	}
	reservation, err := b.service.Begin(ctx, billing.Request{UserID: t.UserID, ResourceID: t.ModelID, SessionID: r.SessionID, Category: "model", OutputLimit: limit, IdempotencyKey: r.IdempotencyKey, RequestHash: resource.Hash(map[string]any{"model_id": t.ModelID, "path": r.Path, "body": json.RawMessage(r.Body), "session_id": r.SessionID})})
	return proxy.Reservation{ID: reservation.ID, OutputLimit: reservation.OutputLimit}, err
}
func (b modelBilling) Start(ctx context.Context, id string) error { return b.service.Start(ctx, id) }
func (b modelBilling) Finish(ctx context.Context, id string, c proxy.Call) error {
	if c.InputTokens > math.MaxInt64 || c.CachedInputTokens > math.MaxInt64 || c.OutputTokens > math.MaxInt64 {
		return b.service.Finish(ctx, id, billing.Usage{Result: "failed", ErrorCode: "invalid_usage"})
	}
	stream := c.Stream
	return b.service.Finish(ctx, id, billing.Usage{
		Input: int64(c.InputTokens), Cached: int64(c.CachedInputTokens), Output: int64(c.OutputTokens),
		Known: c.Known, Stream: &stream, Result: c.Result, ErrorCode: c.ErrorCode,
		RequestID: c.RequestID, TerminalEvent: c.TerminalEvent,
	})
}

type toolBilling struct{ service *billing.Service }

func (b toolBilling) Begin(ctx context.Context, r mcp.Invocation) (string, error) {
	v, err := b.service.Begin(ctx, billing.Request{UserID: r.UserID, ResourceID: r.ToolID, ConnectorID: r.ConnectorID, SessionID: r.SessionID, Category: "tool", IdempotencyKey: r.IdempotencyKey, RequestHash: r.RequestHash})
	return v.ID, err
}
func (b toolBilling) Start(ctx context.Context, id string) error { return b.service.Start(ctx, id) }
func (b toolBilling) Finish(ctx context.Context, id string, r mcp.InvocationResult) error {
	return b.service.Finish(ctx, id, billing.Usage{Known: r.Known, Result: r.Result, ErrorCode: r.ErrorCode})
}
