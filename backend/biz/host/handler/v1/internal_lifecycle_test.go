package v1

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/GoYoko/web"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/patrickmn/go-cache"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	etypes "github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/lifecycle"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestVmReadyTransitionsVMLifecycleToRunning(t *testing.T) {
	rdb := newTestRedis(t)
	userID := uuid.New()
	taskID := uuid.New()
	vmID := "vm-ready"
	repo := &internalHostRepoStub{
		vm: &db.VirtualMachine{
			ID:     vmID,
			UserID: userID,
			Edges:  db.VirtualMachineEdges{Tasks: []*db.Task{{ID: taskID, UserID: userID, Status: consts.TaskStatusPending}}},
		},
	}
	vmLifecycle := lifecycle.NewManager[string, lifecycle.VMState, lifecycle.VMMetadata](
		rdb,
		lifecycle.WithLogger[string, lifecycle.VMState, lifecycle.VMMetadata](slog.New(slog.NewTextHandler(io.Discard, nil))),
		lifecycle.WithTransitions[string, lifecycle.VMState, lifecycle.VMMetadata](lifecycle.VMTransitions()),
	)
	handler := &InternalHostHandler{
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo:        repo,
		vmLifecycle: vmLifecycle,
	}

	if err := handler.VmReady(testWebContext(), taskflow.VirtualMachine{ID: vmID}); err != nil {
		t.Fatalf("VmReady() error = %v", err)
	}

	state, err := vmLifecycle.GetState(context.Background(), vmID)
	if err != nil {
		t.Fatalf("vmLifecycle.GetState() error = %v", err)
	}
	if state != lifecycle.VMStateRunning {
		t.Fatalf("vm state = %s, want %s", state, lifecycle.VMStateRunning)
	}
}

func TestVmConditionsTransitionsVMLifecycleToFailed(t *testing.T) {
	rdb := newTestRedis(t)
	userID := uuid.New()
	taskID := uuid.New()
	vmID := "vm-failed"
	envID := "env-failed"
	repo := &internalHostRepoStub{
		vm: &db.VirtualMachine{
			ID:            vmID,
			EnvironmentID: envID,
			UserID:        userID,
			Edges:         db.VirtualMachineEdges{Tasks: []*db.Task{{ID: taskID, UserID: userID, Status: consts.TaskStatusProcessing}}},
		},
	}
	vmLifecycle := lifecycle.NewManager[string, lifecycle.VMState, lifecycle.VMMetadata](
		rdb,
		lifecycle.WithLogger[string, lifecycle.VMState, lifecycle.VMMetadata](slog.New(slog.NewTextHandler(io.Discard, nil))),
		lifecycle.WithTransitions[string, lifecycle.VMState, lifecycle.VMMetadata](lifecycle.VMTransitions()),
	)
	if err := vmLifecycle.Transition(context.Background(), vmID, lifecycle.VMStatePending, lifecycle.VMMetadata{VMID: vmID, TaskID: &taskID, UserID: userID}); err != nil {
		t.Fatalf("vmLifecycle.Transition(pending) error = %v", err)
	}
	handler := &InternalHostHandler{
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		repo:        repo,
		cache:       cacheForTest(),
		vmLifecycle: vmLifecycle,
	}

	if err := handler.VmConditions(testWebContext(), taskflow.VirtualMachineCondition{
		EnvID: envID,
		Conditions: []*taskflow.Condition{{
			Type:               string(etypes.ConditionTypeFailed),
			LastTransitionTime: 1,
		}},
	}); err != nil {
		t.Fatalf("VmConditions() error = %v", err)
	}

	state, err := vmLifecycle.GetState(context.Background(), vmID)
	if err != nil {
		t.Fatalf("vmLifecycle.GetState() error = %v", err)
	}
	if state != lifecycle.VMStateFailed {
		t.Fatalf("vm state = %s, want %s", state, lifecycle.VMStateFailed)
	}
}

func testWebContext() *web.Context {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(nil))
	rec := httptest.NewRecorder()
	return &web.Context{Context: e.NewContext(req, rec)}
}

func cacheForTest() *cache.Cache {
	return cache.New(15*time.Minute, 10*time.Minute)
}
