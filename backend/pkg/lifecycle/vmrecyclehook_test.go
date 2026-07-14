package lifecycle

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/vmrecycle"
)

func TestVMRecycleHookCallsRecyclerSynchronously(t *testing.T) {
	recycler := &lifecycleRecyclerStub{result: vmrecycle.Result{VMID: "vm-1", Status: vmrecycle.StatusRecycled}}
	hook, _ := newVMRecycleHookTest(t, recycler)

	if err := hook.OnStateChange(context.Background(), "vm-1", VMStateRunning, VMStateRecycled, VMMetadata{}); err != nil {
		t.Fatal(err)
	}
	if recycler.calls != 1 || recycler.vmID != "vm-1" {
		t.Fatalf("recycler calls = %d, vm id = %q", recycler.calls, recycler.vmID)
	}
}

func TestVMRecycleHookEnqueuesRetryWhenRecyclerFails(t *testing.T) {
	wantErr := errors.New("delete failed")
	recycler := &lifecycleRecyclerStub{err: wantErr}
	hook, queue := newVMRecycleHookTest(t, recycler)
	taskID := uuid.New()
	userID := uuid.New()

	if err := hook.OnStateChange(context.Background(), "vm-2", VMStateRunning, VMStateRecycled, VMMetadata{TaskID: &taskID, UserID: userID}); err != nil {
		t.Fatal(err)
	}
	job, _, ok, err := queue.GetJobInfo(context.Background(), vmrecycle.RecycleQueueKey, "vm-2")
	if err != nil || !ok {
		t.Fatalf("retry job ok = %v, err = %v", ok, err)
	}
	if job.Payload.VmID != "vm-2" || job.Payload.UID != userID || job.Payload.TaskID != taskID.String() {
		t.Fatalf("retry payload = %+v", job.Payload)
	}
}

func TestVMRecycleHookReturnsBothRecyclerAndQueueFailures(t *testing.T) {
	recycleErr := errors.New("delete failed")
	recycler := &lifecycleRecyclerStub{err: recycleErr}
	srv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	queue := delayqueue.NewVMRecycleQueue(rdb, slog.Default())
	if err := rdb.Close(); err != nil {
		t.Fatal(err)
	}
	hook := &VMRecycleHook{
		recycler:     recycler,
		recycleQueue: queue,
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	err := hook.OnStateChange(context.Background(), "vm-3", VMStateRunning, VMStateRecycled, VMMetadata{})
	if !errors.Is(err, recycleErr) {
		t.Fatalf("error = %v, want recycle error", err)
	}
}

func newVMRecycleHookTest(t *testing.T, recycler vmrecycle.Recycler) (*VMRecycleHook, *delayqueue.VMRecycleQueue) {
	t.Helper()
	srv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	queue := delayqueue.NewVMRecycleQueue(rdb, slog.Default())
	return &VMRecycleHook{
		recycler:     recycler,
		recycleQueue: queue,
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, queue
}

type lifecycleRecyclerStub struct {
	result vmrecycle.Result
	err    error
	calls  int
	vmID   string
}

func (s *lifecycleRecyclerStub) Recycle(_ context.Context, vmID string) (vmrecycle.Result, error) {
	s.calls++
	s.vmID = vmID
	return s.result, s.err
}
