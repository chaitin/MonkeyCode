package proxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
)

type ResponseReconciliationState string

const (
	ResponseReconciliationResolved    ResponseReconciliationState = "resolved"
	ResponseReconciliationPending     ResponseReconciliationState = "pending"
	ResponseReconciliationUnsupported ResponseReconciliationState = "unsupported"
)

type ResponseReconciliation struct {
	State ResponseReconciliationState
	Call  Call
}

type ResponseReconciler struct {
	client *http.Client
}

func NewResponseReconciler() *ResponseReconciler {
	return &ResponseReconciler{client: &http.Client{
		Transport: http.DefaultTransport,
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

func (r *ResponseReconciler) Reconcile(ctx context.Context, target Target, responseID string) (ResponseReconciliation, error) {
	if target.Protocol != "openai_responses" || responseID == "" || responseID == "." || responseID == ".." || strings.ContainsAny(responseID, `/\\`) {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported}, nil
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
	response, err := r.client.Do(req)
	if err != nil {
		return ResponseReconciliation{}, err
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil && ctx.Err() == nil && !errors.Is(closeErr, context.Canceled) && !errors.Is(closeErr, io.ErrClosedPipe) {
			// 自定义 Transport 的关闭错误可能包含凭据或响应内容。
			slog.WarnContext(ctx, "关闭上游对账响应失败", "model_id", target.ModelID, "operation", "close_reconciliation_response", "error_type", fmt.Sprintf("%T", closeErr))
		}
	}()

	if response.StatusCode != http.StatusOK {
		switch response.StatusCode {
		case http.StatusNotFound, http.StatusConflict, http.StatusTooEarly, http.StatusTooManyRequests:
			return ResponseReconciliation{State: ResponseReconciliationPending}, nil
		default:
			if response.StatusCode >= http.StatusInternalServerError {
				return ResponseReconciliation{State: ResponseReconciliationPending}, nil
			}
			return ResponseReconciliation{State: ResponseReconciliationUnsupported}, nil
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
		return ResponseReconciliation{State: ResponseReconciliationUnsupported}, nil
	}
	if stored.Status == "queued" || stored.Status == "in_progress" {
		return ResponseReconciliation{State: ResponseReconciliationPending}, nil
	}
	if stored.Usage == nil || !stored.Usage.inputKnown || !stored.Usage.outputKnown {
		return ResponseReconciliation{State: ResponseReconciliationUnsupported}, nil
	}

	result := "succeeded"
	switch stored.Status {
	case "", "completed":
	case "failed", "incomplete", "cancelled", "canceled":
		result = "failed"
	default:
		return ResponseReconciliation{State: ResponseReconciliationUnsupported}, nil
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
			Result:            result,
			InputTokens:       stored.Usage.InputTokens,
			CachedInputTokens: stored.Usage.InputTokensDetails.CachedTokens,
			OutputTokens:      stored.Usage.OutputTokens,
		},
	}, nil
}
