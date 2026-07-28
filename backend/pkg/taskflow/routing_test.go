package taskflow

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/request"
)

func TestMutationWritesHeadersAndSafelyRetries(t *testing.T) {
	taskID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	var requestIDs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(HeaderRouteCapability) != string(CapabilityAgent) {
			t.Errorf("capability = %q", r.Header.Get(HeaderRouteCapability))
		}
		if r.Header.Get(HeaderRouteTargetID) != "vm-1" {
			t.Errorf("target id = %q", r.Header.Get(HeaderRouteTargetID))
		}
		if r.Header.Get(HeaderRequestScope) != "task:"+taskID.String() {
			t.Errorf("request scope = %q", r.Header.Get(HeaderRequestScope))
		}
		requestIDs = append(requestIDs, r.Header.Get(HeaderRequestID))
		if len(requestIDs) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(&TaskflowError{
				Code:           ErrorRegistryUnavailable,
				Message:        "registry unavailable",
				Retryable:      true,
				ExecutionState: ExecutionNotDispatched,
				RequestID:      taskID.String(),
			})
			return
		}
		_ = json.NewEncoder(w).Encode(Resp[any]{})
	}))
	defer server.Close()

	taskClient := newTestTaskClient(t, server.URL)
	err := taskClient.Create(context.Background(), CreateTaskReq{ID: taskID, VMID: "vm-1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(requestIDs) != 2 {
		t.Fatalf("request count = %d, want 2", len(requestIDs))
	}
	if requestIDs[0] != taskID.String() || requestIDs[1] != requestIDs[0] {
		t.Fatalf("request ids = %v", requestIDs)
	}
}

func TestMutationUsesExplicitFence(t *testing.T) {
	taskID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(HeaderRouteCapability) != string(CapabilityTask) || r.Header.Get(HeaderRouteTargetID) != taskID.String() {
			t.Errorf("unexpected route headers: %v", r.Header)
		}
		if r.Header.Get(HeaderRequestScope) != "team:1" || r.Header.Get(HeaderRequestID) != "request-1" {
			t.Errorf("unexpected fence headers: %v", r.Header)
		}
		_ = json.NewEncoder(w).Encode(Resp[any]{})
	}))
	defer server.Close()

	ctx := WithRequestFence(context.Background(), "team:1", "request-1")
	err := newTestTaskClient(t, server.URL).Stop(ctx, TaskReq{Task: &Task{ID: taskID}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestMutationDoesNotRetryUnknownExecution(t *testing.T) {
	taskID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests++
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(&TaskflowError{
			Code:           ErrorOwnerUnavailable,
			Message:        "owner unavailable",
			Retryable:      true,
			ExecutionState: ExecutionUnknown,
		})
	}))
	defer server.Close()

	err := newTestTaskClient(t, server.URL).Continue(context.Background(), TaskReq{Task: &Task{ID: taskID}})
	var protocolErr *TaskflowError
	if !errors.As(err, &protocolErr) {
		t.Fatalf("error = %T, want *TaskflowError", err)
	}
	if requests != 1 {
		t.Fatalf("request count = %d, want 1", requests)
	}
	if protocolErr.CanAutoRetry() {
		t.Fatal("unknown execution state must not be retried")
	}
}

func newTestTaskClient(t *testing.T, rawURL string) TaskManager {
	t.Helper()
	endpoint, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return newTaskClient(request.NewClient(endpoint.Scheme, endpoint.Host, time.Second))
}
