package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/logging"
)

type ResponseReconciliationState string

const (
	ResponseReconciliationResolved    ResponseReconciliationState = "resolved"
	ResponseReconciliationPending     ResponseReconciliationState = "pending"
	ResponseReconciliationUnsupported ResponseReconciliationState = "unsupported"
)

type ResponseReconciliation struct {
	State          ResponseReconciliationState
	Call           Call
	Reason         string
	UpstreamStatus int
}

type ResponseReconciler struct {
	client *http.Client
}

func NewResponseReconciler() *ResponseReconciler {
	return &ResponseReconciler{client: &http.Client{
		Transport: DirectTransport(),
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}
}

func (r *ResponseReconciler) WithTransport(transport http.RoundTripper) *ResponseReconciler {
	if transport != nil {
		r.client.Transport = transport
	}
	return r
}

func (r *ResponseReconciler) Reconcile(ctx context.Context, target Target, responseID string) (result ResponseReconciliation, err error) {
	if target.Protocol != "openai_responses" {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "protocol_unsupported"}, nil
	}
	if responseID == "" || responseID == "." || responseID == ".." || strings.ContainsAny(responseID, `/\\`) {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "invalid_response_id"}, nil
	}
	endpoint, err := parseBaseURL(target.BaseURL)
	if err != nil {
		return ResponseReconciliation{}, err
	}
	endpoint = endpoint.JoinPath("responses", responseID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return ResponseReconciliation{}, err
	}
	req.Header.Set("Accept", "application/json")
	if target.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+target.APIKey)
		req.Header.Set("X-Api-Key", target.APIKey)
	}
	client := *r.client
	if target.ProxyURL != "" {
		transport, err := TransportFor(target.ProxyURL)
		if err != nil {
			return ResponseReconciliation{}, err
		}
		defer transport.CloseIdleConnections()
		client.Transport = transport
	}
	response, err := client.Do(req)
	if err != nil {
		return ResponseReconciliation{}, err
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil && ctx.Err() == nil && !errors.Is(closeErr, context.Canceled) && !errors.Is(closeErr, io.ErrClosedPipe) {
			logging.Event(ctx, slog.Default(), slog.LevelWarn, "proxy.operation.warn", "关闭上游对账响应失败", "module", "proxy", "operation", "Reconcile", "model_id", target.ModelID, "operation", "close_reconciliation_response", "error_type", fmt.Sprintf("%T", closeErr), "error", closeErr)
		}
	}()

	defer func() { result.UpstreamStatus = response.StatusCode }()
	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case http.StatusNotFound, http.StatusConflict, http.StatusTooEarly, http.StatusTooManyRequests:
			return ResponseReconciliation{State: ResponseReconciliationPending, Reason: "upstream_http_error"}, nil
		default:
			if response.StatusCode >= http.StatusInternalServerError {
				return ResponseReconciliation{State: ResponseReconciliationPending, Reason: "upstream_http_error"}, nil
			}
			return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "upstream_rejected"}, nil
		}
	}

	const maxResponseSize = 32 << 20
	body, err := io.ReadAll(io.LimitReader(response.Body, maxResponseSize+1))
	if err != nil {
		return ResponseReconciliation{}, err
	}
	if len(body) > maxResponseSize {
		return ResponseReconciliation{}, fmt.Errorf("上游响应对账结果超过 %d 字节", maxResponseSize)
	}
	stored, err := parseOpenAIResponse(body)
	if err != nil {
		return ResponseReconciliation{}, fmt.Errorf("解析上游响应对账结果: %w", err)
	}
	if stored.ID != "" && stored.ID != responseID {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "response_id_mismatch"}, nil
	}
	if stored.Status == "queued" || stored.Status == "in_progress" {
		return ResponseReconciliation{State: ResponseReconciliationPending, Reason: "response_pending"}, nil
	}
	if stored.Usage == nil || !stored.Usage.inputKnown || !stored.Usage.outputKnown {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "usage_missing"}, nil
	}

	callResult := "succeeded"
	switch stored.Status {
	case "", "completed":
	case "failed", "incomplete", "cancelled", "canceled":
		callResult = "failed"
	default:
		return ResponseReconciliation{State: ResponseReconciliationUnsupported, Reason: "response_status_unsupported"}, nil
	}
	requestID := stored.ID
	if requestID == "" {
		requestID = responseID
	}
	return ResponseReconciliation{
		State: ResponseReconciliationResolved,
		Call: Call{
			RequestID:         requestID,
			Known:             true,
			Result:            callResult,
			InputTokens:       stored.Usage.InputTokens,
			CachedInputTokens: stored.Usage.InputTokensDetails.CachedTokens,
			OutputTokens:      stored.Usage.OutputTokens,
		},
	}, nil
}
