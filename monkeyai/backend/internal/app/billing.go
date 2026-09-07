package app

import (
	"context"
	"encoding/json"
	"math"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/mcp"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/proxy"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
)

type applicationHandler struct {
	http.Handler
	billing *billing.Service
	proxy   *proxy.Proxy
}
type modelBilling struct{ service *billing.Service }

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
	return b.service.Finish(ctx, id, billing.Usage{Input: int64(c.InputTokens), Cached: int64(c.CachedInputTokens), Output: int64(c.OutputTokens), Known: c.Known, Result: c.Result, ErrorCode: c.ErrorCode, RequestID: c.RequestID})
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
