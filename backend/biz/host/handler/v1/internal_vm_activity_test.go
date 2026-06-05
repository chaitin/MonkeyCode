package v1

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/GoYoko/web"
)

func TestInternalHostHandler_VMActivityRefreshesIdleTimer(t *testing.T) {
	refresher := &internalVMIdleRefresherStub{ch: make(chan string, 1)}
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: refresher,
	}

	body := `{"vm_id":"vm-activity-1","last_active_at":1710000000}`
	w := web.New()
	w.POST("/internal/vm/activity", web.BindHandler(h.VMActivity))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/vm/activity", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w.Echo().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	select {
	case got := <-refresher.ch:
		if got != "vm-activity-1" {
			t.Fatalf("refreshed vm id = %q, want %q", got, "vm-activity-1")
		}
	default:
		t.Fatal("expected idle refresher to be called")
	}
}

func TestInternalHostHandler_VMActivityRejectsEmptyVMID(t *testing.T) {
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: &internalVMIdleRefresherStub{ch: make(chan string, 1)},
	}

	w := web.New()
	w.POST("/internal/vm/activity", web.BindHandler(h.VMActivity))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/vm/activity", strings.NewReader(`{"last_active_at":1710000000}`))
	req.Header.Set("Content-Type", "application/json")
	w.Echo().ServeHTTP(rec, req)

	var resp web.Resp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal resp: %v, body = %s", err, rec.Body.String())
	}
	if resp.Code == 0 {
		t.Fatalf("response = %+v, want error", resp)
	}
}

type internalVMIdleRefresherStub struct {
	ch chan string
}

func (s *internalVMIdleRefresherStub) Refresh(_ context.Context, vmID string) error {
	select {
	case s.ch <- vmID:
	default:
	}
	return nil
}
