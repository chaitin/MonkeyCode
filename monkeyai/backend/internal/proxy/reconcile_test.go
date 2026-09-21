package proxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestResponseReconcilerRetrievesUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/gateway/v1/responses/resp_test" || r.URL.RawQuery != "api-version=2026-09-01" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
		if r.Header.Get("Authorization") != "Bearer upstream-secret" || r.Header.Get("X-Api-Key") != "upstream-secret" {
			t.Fatal("upstream credentials missing")
		}
		_, _ = w.Write([]byte(`{
			"id":"resp_test",
			"status":"completed",
			"usage":{"input_tokens":13,"output_tokens":5,"input_tokens_details":{"cached_tokens":3}}
		}`))
	}))
	t.Cleanup(server.Close)
	target := testTarget(server.URL + "/gateway/v1?api-version=2026-09-01")
	target.Protocol = "openai_responses"

	result, err := NewResponseReconciler().Reconcile(context.Background(), target, "resp_test")
	if err != nil {
		t.Fatal(err)
	}
	if result.State != ResponseReconciliationResolved || !result.Call.Known || result.Call.Result != "succeeded" {
		t.Fatalf("reconciliation = %+v", result)
	}
	if result.Call.InputTokens != 13 || result.Call.CachedInputTokens != 3 || result.Call.OutputTokens != 5 {
		t.Fatalf("usage = %+v", result.Call)
	}
}

func TestResponseReconcilerKeepsUncertainResultsPending(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		want   ResponseReconciliationState
	}{
		{name: "record delayed", status: http.StatusNotFound, want: ResponseReconciliationPending},
		{name: "still running", status: http.StatusOK, body: `{"id":"resp_test","status":"in_progress"}`, want: ResponseReconciliationPending},
		{name: "terminal without usage", status: http.StatusOK, body: `{"id":"resp_test","status":"failed"}`, want: ResponseReconciliationUnsupported},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()
			target := testTarget(server.URL + "/v1")
			target.Protocol = "openai_responses"
			result, err := NewResponseReconciler().Reconcile(context.Background(), target, "resp_test")
			if err != nil {
				t.Fatal(err)
			}
			if result.State != test.want {
				t.Fatalf("state = %q, want %q", result.State, test.want)
			}
		})
	}
}
