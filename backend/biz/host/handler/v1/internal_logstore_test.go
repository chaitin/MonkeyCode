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

	"github.com/GoYoko/web"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	taskflowpkg "github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

type taskLogStoreRepoStub struct {
	store consts.LogStore
	err   error
}

func (s *taskLogStoreRepoStub) GetLogStore(context.Context, uuid.UUID) (consts.LogStore, error) {
	return s.store, s.err
}

func TestInternalHostHandler_GetTaskLogStore_EmptyMeansLoki(t *testing.T) {
	h := &InternalHostHandler{
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskRepo: &taskLogStoreRepoStub{},
	}
	req := taskflowpkg.GetTaskLogStoreReq{TaskID: uuid.New()}
	resp := callGetTaskLogStore(t, h, req)
	if resp.LogStore != string(consts.LogStoreLoki) {
		t.Fatalf("log_store = %q, want %q", resp.LogStore, consts.LogStoreLoki)
	}
}

func TestInternalHostHandler_GetTaskLogStore_ClickHousePassthrough(t *testing.T) {
	h := &InternalHostHandler{
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskRepo: &taskLogStoreRepoStub{store: consts.LogStoreClickHouse},
	}
	req := taskflowpkg.GetTaskLogStoreReq{TaskID: uuid.New()}
	resp := callGetTaskLogStore(t, h, req)
	if resp.LogStore != string(consts.LogStoreClickHouse) {
		t.Fatalf("log_store = %q, want %q", resp.LogStore, consts.LogStoreClickHouse)
	}
}

func TestInternalHostHandler_GetTaskLogStore_RepoError(t *testing.T) {
	h := &InternalHostHandler{
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
		taskRepo: &taskLogStoreRepoStub{err: errors.New("boom")},
	}
	req := taskflowpkg.GetTaskLogStoreReq{TaskID: uuid.New()}
	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	w := web.New()
	w.POST("/internal/task-log-store", web.BindHandler(h.GetTaskLogStore))
	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "/internal/task-log-store", strings.NewReader(string(body)))
	httpReq.Header.Set("Content-Type", "application/json")
	w.Echo().ServeHTTP(rec, httpReq)

	var resp web.Resp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal resp: %v", err)
	}
	if resp.Code == 0 {
		t.Fatalf("response = %+v, want error", resp)
	}
}

func callGetTaskLogStore(t *testing.T, h *InternalHostHandler, req taskflowpkg.GetTaskLogStoreReq) taskflowpkg.GetTaskLogStoreResp {
	t.Helper()

	body, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}

	w := web.New()
	w.POST("/internal/task-log-store", web.BindHandler(h.GetTaskLogStore))

	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest(http.MethodPost, "/internal/task-log-store", strings.NewReader(string(body)))
	httpReq.Header.Set("Content-Type", "application/json")
	w.Echo().ServeHTTP(rec, httpReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp web.Resp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal resp: %v", err)
	}
	data, err := json.Marshal(resp.Data)
	if err != nil {
		t.Fatalf("marshal resp data: %v", err)
	}

	var out taskflowpkg.GetTaskLogStoreResp
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal typed resp: %v", err)
	}
	return out
}
