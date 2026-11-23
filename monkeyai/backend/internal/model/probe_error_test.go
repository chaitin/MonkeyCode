package model

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestUpstreamErrorMessage(t *testing.T) {
	for _, tc := range []struct {
		name, body, want string
	}{
		{"嵌套 message", `{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}`, "Rate limit reached"},
		{"字符串 error", `{"error":"unauthorized"}`, "unauthorized"},
		{"顶层 message", `{"message":"quota exceeded"}`, "quota exceeded"},
		{"非 JSON", `<html>bad gateway</html>`, ""},
		{"空对象", `{}`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := upstreamErrorMessage([]byte(tc.body)); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestProbeEndpointReportsUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":{"message":"Rate limit reached for model grok","type":"rate_limit_error"}}`)
	}))
	defer server.Close()

	request := httptest.NewRequest(http.MethodPost, "/api/admin/v1/models/model-1/probe", bytes.NewBufferString(`{"message":"ping"}`))
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("modelID", "model-1")
	request = request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
	response := httptest.NewRecorder()
	service := NewService(&repositoryStub{models: []Model{{
		ID: "model-1", OwnershipType: "system", Kind: KindText,
		Protocol: ProtocolOpenAIResponses, Provider: ProviderPassthrough,
		ModelID: "grok", BaseURL: server.URL, APIKey: "secret", Enabled: true,
	}}})

	service.probeModel(response, request)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("状态码 = %d, want %d", response.Code, http.StatusBadGateway)
	}
	var payload struct {
		Error struct {
			Message         string `json:"message"`
			UpstreamStatus  int    `json:"upstream_status"`
			UpstreamMessage string `json:"upstream_message"`
			UpstreamBody    string `json:"upstream_body"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.UpstreamStatus != http.StatusTooManyRequests {
		t.Fatalf("upstream_status = %d", payload.Error.UpstreamStatus)
	}
	if payload.Error.UpstreamMessage != "Rate limit reached for model grok" {
		t.Fatalf("upstream_message = %q", payload.Error.UpstreamMessage)
	}
	if !strings.Contains(payload.Error.Message, "上游返回 HTTP 429") || !strings.Contains(payload.Error.Message, "Rate limit reached") {
		t.Fatalf("提示语 = %q", payload.Error.Message)
	}
	if !strings.Contains(payload.Error.UpstreamBody, "rate_limit_error") {
		t.Fatalf("upstream_body = %q", payload.Error.UpstreamBody)
	}
}
