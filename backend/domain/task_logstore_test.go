package domain_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskFromIncludesLogStore(t *testing.T) {
	src := &db.Task{
		ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		UserID:    uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		Kind:      consts.TaskTypeDevelop,
		Status:    consts.TaskStatusPending,
		Content:   "init task",
		CreatedAt: time.Unix(1710000000, 0),
	}
	store := consts.LogStoreClickHouse
	src.LogStore = &store

	got := (&domain.Task{}).From(src)
	if got.LogStore != consts.LogStoreClickHouse {
		t.Fatalf("log store = %q, want %q", got.LogStore, consts.LogStoreClickHouse)
	}
}

func TestCreateTaskReqIncludesLogStore(t *testing.T) {
	req := taskflow.CreateTaskReq{
		ID:       uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		VMID:     "vm-1",
		Text:     "hello",
		LogStore: "clickhouse",
	}

	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"log_store":"clickhouse"`) {
		t.Fatalf("marshaled request missing log_store: %s", string(b))
	}
}
