package v1

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/GoYoko/web"
)

func TestInternalHostHandler_VMActivityPersistsAndRefreshesIdleTimer(t *testing.T) {
	refresher := &internalVMIdleRefresherStub{ch: make(chan string, 1)}
	activity := &internalVMActivityTaskRepoStub{ch: make(chan internalVMActivityCall, 1)}
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: refresher,
		taskActivity:  activity,
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
	select {
	case got := <-activity.ch:
		if got.vmID != "vm-activity-1" || !got.at.Equal(time.Unix(1710000000, 0)) || got.minInterval != vmActivityTaskRefreshInterval {
			t.Fatalf("activity call = %+v", got)
		}
	default:
		t.Fatal("expected task activity to be persisted")
	}
}

func TestInternalHostHandler_VMActivityRefreshesIdleTimerWhenPersistFails(t *testing.T) {
	refresher := &internalVMIdleRefresherStub{ch: make(chan string, 1)}
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: refresher,
		taskActivity: &internalVMActivityTaskRepoStub{
			ch:  make(chan internalVMActivityCall, 1),
			err: errors.New("persist failed"),
		},
	}

	w := web.New()
	w.POST("/internal/vm/activity", web.BindHandler(h.VMActivity))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/vm/activity", strings.NewReader(`{"vm_id":"vm-activity-1","last_active_at":1710000000}`))
	req.Header.Set("Content-Type", "application/json")
	w.Echo().ServeHTTP(rec, req)

	select {
	case got := <-refresher.ch:
		if got != "vm-activity-1" {
			t.Fatalf("refreshed vm id = %q", got)
		}
	default:
		t.Fatal("expected idle refresher to run after persist failure")
	}

	var resp web.Resp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal resp: %v, body = %s", err, rec.Body.String())
	}
	if resp.Code == 0 {
		t.Fatalf("response = %+v, want error", resp)
	}
}

func TestInternalHostHandler_VMActivityRejectsEmptyVMID(t *testing.T) {
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: &internalVMIdleRefresherStub{ch: make(chan string, 1)},
		taskActivity:  &internalVMActivityTaskRepoStub{ch: make(chan internalVMActivityCall, 1)},
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

func TestInternalHostHandler_VMActivityRejectsMissingTimestamp(t *testing.T) {
	h := &InternalHostHandler{
		logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		idleRefresher: &internalVMIdleRefresherStub{ch: make(chan string, 1)},
		taskActivity:  &internalVMActivityTaskRepoStub{ch: make(chan internalVMActivityCall, 1)},
	}

	w := web.New()
	w.POST("/internal/vm/activity", web.BindHandler(h.VMActivity))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/vm/activity", strings.NewReader(`{"vm_id":"vm-activity-1"}`))
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

func (s *internalVMIdleRefresherStub) KeepAwake(context.Context, string) error { return nil }

func (s *internalVMIdleRefresherStub) RecordActivity(_ context.Context, vmID string) error {
	select {
	case s.ch <- vmID:
	default:
	}
	return nil
}

type internalVMActivityCall struct {
	vmID        string
	at          time.Time
	minInterval time.Duration
}

type internalVMActivityTaskRepoStub struct {
	ch  chan internalVMActivityCall
	err error
}

func (s *internalVMActivityTaskRepoStub) RefreshLastActiveAtByVMID(_ context.Context, vmID string, at time.Time, minInterval time.Duration) error {
	select {
	case s.ch <- internalVMActivityCall{vmID: vmID, at: at, minInterval: minInterval}:
	default:
	}
	return s.err
}
