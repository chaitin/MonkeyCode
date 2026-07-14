package vmrecycle

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/delayqueue"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestRecyclerRecyclesVMAndCleansLocalState(t *testing.T) {
	ctx := context.Background()
	rdb := newTestRedis(t)
	processingTaskID := uuid.New()
	finishedTaskID := uuid.New()
	vm := &db.VirtualMachine{
		ID:            "vm-1",
		UserID:        uuid.New(),
		HostID:        "host-1",
		EnvironmentID: "env-1",
		Edges: db.VirtualMachineEdges{Tasks: []*db.Task{
			{ID: processingTaskID, Status: consts.TaskStatusProcessing},
			{ID: finishedTaskID, Status: consts.TaskStatusFinished},
		}},
	}
	hostRepo := &recycleHostRepoStub{vm: vm}
	taskRepo := &recycleTaskRepoStub{}
	vmClient := &recycleVMStub{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	sleepQueue := delayqueue.NewVMSleepQueue(rdb, logger)
	notifyQueue := delayqueue.NewVMNotifyQueue(rdb, logger)
	recycleQueue := delayqueue.NewVMRecycleQueue(rdb, logger)
	expireQueue := delayqueue.NewVMExpireQueue(rdb, logger)
	r := &recycler{
		redis:        rdb,
		logger:       logger,
		hostRepo:     hostRepo,
		taskRepo:     taskRepo,
		taskflow:     &recycleTaskflowStub{vm: vmClient},
		sleepQueue:   sleepQueue,
		notifyQueue:  notifyQueue,
		recycleQueue: recycleQueue,
		expireQueue:  expireQueue,
		now:          func() time.Time { return time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC) },
	}
	payload := &domain.VmIdleInfo{VmID: vm.ID}
	runAt := time.Now().Add(time.Hour)
	mustEnqueue(t, sleepQueue, ctx, SleepQueueKey, payload, runAt, vm.ID)
	mustEnqueue(t, notifyQueue, ctx, NotifyQueueKey, payload, runAt, vm.ID+":default")
	mustEnqueue(t, notifyQueue, ctx, NotifyQueueKey, payload, runAt, vm.ID+":wechat900s")
	mustEnqueue(t, notifyQueue, ctx, wechat2hQueueKey, payload, runAt, vm.ID)
	mustEnqueue(t, notifyQueue, ctx, wechat15mQueueKey, payload, runAt, vm.ID)
	mustEnqueue(t, recycleQueue, ctx, RecycleQueueKey, payload, runAt, vm.ID)
	if _, err := expireQueue.Enqueue(ctx, VMExpireQueueKey, &domain.VmExpireInfo{VmID: vm.ID}, runAt, vm.ID); err != nil {
		t.Fatal(err)
	}
	keys := []string{
		"lifecycle:" + vm.ID,
		"vm:idle:debounce:" + vm.ID,
		"vm:idle:debounce:" + vm.ID + ":keep-awake",
		"vm:idle:debounce:" + vm.ID + ":activity",
		"vm:idle:not-found:" + vm.ID,
		"task:create_req:" + processingTaskID.String(),
		"mcai:task:" + processingTaskID.String() + ":last_input",
	}
	for _, key := range keys {
		if err := rdb.Set(ctx, key, "value", time.Hour).Err(); err != nil {
			t.Fatal(err)
		}
	}

	result, err := r.Recycle(ctx, vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusRecycled || result.VMID != vm.ID || len(result.TaskIDs) != 2 {
		t.Fatalf("result = %+v", result)
	}
	if vmClient.deleteCalls != 1 || vmClient.lastDelete.ID != vm.EnvironmentID {
		t.Fatalf("delete calls = %d, request = %+v", vmClient.deleteCalls, vmClient.lastDelete)
	}
	if hostRepo.updateCalls != 1 || !vm.IsRecycled {
		t.Fatalf("update calls = %d, recycled = %v", hostRepo.updateCalls, vm.IsRecycled)
	}
	if len(taskRepo.updated) != 1 || taskRepo.updated[0] != processingTaskID {
		t.Fatalf("updated tasks = %v, want [%s]", taskRepo.updated, processingTaskID)
	}
	assertJobMissing(t, sleepQueue.RedisDelayQueue, ctx, SleepQueueKey, vm.ID)
	assertJobMissing(t, notifyQueue.RedisDelayQueue, ctx, NotifyQueueKey, vm.ID+":default")
	assertJobMissing(t, notifyQueue.RedisDelayQueue, ctx, NotifyQueueKey, vm.ID+":wechat900s")
	assertJobMissing(t, notifyQueue.RedisDelayQueue, ctx, wechat2hQueueKey, vm.ID)
	assertJobMissing(t, notifyQueue.RedisDelayQueue, ctx, wechat15mQueueKey, vm.ID)
	assertJobMissing(t, recycleQueue.RedisDelayQueue, ctx, RecycleQueueKey, vm.ID)
	if _, _, ok, err := expireQueue.GetJobInfo(ctx, VMExpireQueueKey, vm.ID); err != nil || ok {
		t.Fatalf("expire job ok = %v, err = %v", ok, err)
	}
	for _, key := range keys {
		if exists, err := rdb.Exists(ctx, key).Result(); err != nil || exists != 0 {
			t.Fatalf("key %q exists = %d, err = %v", key, exists, err)
		}
	}
}

func TestRecyclerAlreadyRecycledSkipsRemoteDeleteAndRepairsCleanup(t *testing.T) {
	vm := &db.VirtualMachine{ID: "vm-recycled", IsRecycled: true, Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{ID: uuid.New(), Status: consts.TaskStatusProcessing}}}}
	r, _, taskRepo, vmClient := newStubRecycler(t, vm)

	result, err := r.Recycle(context.Background(), vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusAlreadyRecycled {
		t.Fatalf("status = %s, want %s", result.Status, StatusAlreadyRecycled)
	}
	if vmClient.deleteCalls != 0 {
		t.Fatalf("delete calls = %d, want 0", vmClient.deleteCalls)
	}
	if len(taskRepo.updated) != 1 {
		t.Fatalf("updated tasks = %v", taskRepo.updated)
	}
}

func TestRecyclerRemoteFailureDoesNotMarkOrClean(t *testing.T) {
	wantErr := errors.New("remote delete failed")
	vm := &db.VirtualMachine{ID: "vm-delete-fail", UserID: uuid.New()}
	r, hostRepo, _, vmClient := newStubRecycler(t, vm)
	vmClient.err = wantErr
	queues := r.sleepQueue.(*recycleQueueStub)

	result, err := r.Recycle(context.Background(), vm.ID)
	if !errors.Is(err, wantErr) {
		t.Fatalf("error = %v, want %v", err, wantErr)
	}
	if !errors.Is(err, ErrRemoteDelete) {
		t.Fatalf("error = %v, want ErrRemoteDelete", err)
	}
	if result.Status != "" || hostRepo.updateCalls != 0 || len(queues.removed) != 0 {
		t.Fatalf("result = %+v, update calls = %d, cleanup = %v", result, hostRepo.updateCalls, queues.removed)
	}
}

func TestRecyclerTreatsMissingRemoteEnvironmentAsDeleted(t *testing.T) {
	vm := &db.VirtualMachine{ID: "vm-remote-missing", UserID: uuid.New()}
	r, hostRepo, taskRepo, vmClient := newStubRecycler(t, vm)
	vmClient.err = errors.New("recv err failed to stop environment: environment not found: env-1")

	result, err := r.Recycle(context.Background(), vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusRecycled || hostRepo.updateCalls != 1 || !vm.IsRecycled {
		t.Fatalf("result = %+v, update calls = %d, recycled = %v", result, hostRepo.updateCalls, vm.IsRecycled)
	}
	if vmClient.deleteCalls != 1 || len(taskRepo.updated) != 0 {
		t.Fatalf("delete calls = %d, updated tasks = %v", vmClient.deleteCalls, taskRepo.updated)
	}
	if !r.recycleQueue.(*recycleQueueStub).removedContains(RecycleQueueKey, vm.ID) {
		t.Fatal("recycle cleanup must continue when the remote environment is already absent")
	}
}

func TestForceRecyclerContinuesAfterOpaqueRemoteDeleteFailure(t *testing.T) {
	taskID := uuid.New()
	vm := &db.VirtualMachine{
		ID:     "vm-force-remote-fail",
		UserID: uuid.New(),
		Edges: db.VirtualMachineEdges{Tasks: []*db.Task{{
			ID: taskID, Status: consts.TaskStatusProcessing,
		}}},
	}
	r, hostRepo, taskRepo, vmClient := newStubRecycler(t, vm)
	vmClient.err = errors.New(`HTTP 500: {"code":500,"message":"服务器错误 [trace_id: test]"}`)
	forceRecycler, ok := any(r).(interface {
		ForceRecycle(context.Context, string) (Result, error)
	})
	if !ok {
		t.Fatal("recycler must support force recycle")
	}

	result, err := forceRecycler.ForceRecycle(context.Background(), vm.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusRecycled || hostRepo.updateCalls != 1 || !vm.IsRecycled {
		t.Fatalf("result = %+v, update calls = %d, recycled = %v", result, hostRepo.updateCalls, vm.IsRecycled)
	}
	if vmClient.deleteCalls != 1 || len(taskRepo.updated) != 1 || taskRepo.updated[0] != taskID {
		t.Fatalf("delete calls = %d, updated tasks = %v", vmClient.deleteCalls, taskRepo.updated)
	}
	if !r.recycleQueue.(*recycleQueueStub).removedContains(RecycleQueueKey, vm.ID) {
		t.Fatal("force recycle must continue local cleanup after remote delete failure")
	}
}

func TestRecyclerRetriesCleanupWithoutDeletingRemoteAgain(t *testing.T) {
	vm := &db.VirtualMachine{ID: "vm-cleanup-retry", UserID: uuid.New()}
	r, hostRepo, _, vmClient := newStubRecycler(t, vm)
	sleepQueue := r.sleepQueue.(*recycleQueueStub)
	sleepQueue.err = errors.New("redis unavailable")

	result, err := r.Recycle(context.Background(), vm.ID)
	if err == nil || result.Status != StatusRecycled {
		t.Fatalf("first result = %+v, error = %v", result, err)
	}
	if vmClient.deleteCalls != 1 || hostRepo.updateCalls != 1 || !vm.IsRecycled {
		t.Fatalf("delete calls = %d, update calls = %d, recycled = %v", vmClient.deleteCalls, hostRepo.updateCalls, vm.IsRecycled)
	}
	if r.recycleQueue.(*recycleQueueStub).removedContains(RecycleQueueKey, vm.ID) {
		t.Fatal("recycle job must remain when cleanup fails")
	}

	sleepQueue.err = nil
	result, err = r.Recycle(context.Background(), vm.ID)
	if err != nil || result.Status != StatusAlreadyRecycled {
		t.Fatalf("retry result = %+v, error = %v", result, err)
	}
	if vmClient.deleteCalls != 1 {
		t.Fatalf("delete calls = %d, want 1", vmClient.deleteCalls)
	}
	if !r.recycleQueue.(*recycleQueueStub).removedContains(RecycleQueueKey, vm.ID) {
		t.Fatal("recycle job should be removed after cleanup succeeds")
	}
}

func TestRecyclerReturnsInProgressWhenLockExists(t *testing.T) {
	vm := &db.VirtualMachine{ID: "vm-locked"}
	r, _, _, vmClient := newStubRecycler(t, vm)
	if err := r.redis.Set(context.Background(), recycleLockKey(vm.ID), "other", time.Minute).Err(); err != nil {
		t.Fatal(err)
	}

	_, err := r.Recycle(context.Background(), vm.ID)
	if !errors.Is(err, ErrInProgress) {
		t.Fatalf("error = %v, want ErrInProgress", err)
	}
	if vmClient.deleteCalls != 0 {
		t.Fatalf("delete calls = %d, want 0", vmClient.deleteCalls)
	}
}

func TestRecyclerReturnsNotFoundResult(t *testing.T) {
	r, _, _, _ := newStubRecycler(t, nil)
	r.hostRepo.(*recycleHostRepoStub).err = &db.NotFoundError{}

	result, err := r.Recycle(context.Background(), "missing-vm")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusNotFound {
		t.Fatalf("status = %s, want %s", result.Status, StatusNotFound)
	}
}

func newStubRecycler(t *testing.T, vm *db.VirtualMachine) (*recycler, *recycleHostRepoStub, *recycleTaskRepoStub, *recycleVMStub) {
	t.Helper()
	rdb := newTestRedis(t)
	hostRepo := &recycleHostRepoStub{vm: vm}
	taskRepo := &recycleTaskRepoStub{}
	vmClient := &recycleVMStub{}
	return &recycler{
		redis:        rdb,
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		hostRepo:     hostRepo,
		taskRepo:     taskRepo,
		taskflow:     &recycleTaskflowStub{vm: vmClient},
		sleepQueue:   &recycleQueueStub{},
		notifyQueue:  &recycleQueueStub{},
		recycleQueue: &recycleQueueStub{},
		expireQueue:  &recycleQueueStub{},
		now:          time.Now,
	}, hostRepo, taskRepo, vmClient
}

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	srv := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func mustEnqueue(t *testing.T, queue interface {
	Enqueue(context.Context, string, *domain.VmIdleInfo, time.Time, string) (string, error)
}, ctx context.Context, queueKey string, payload *domain.VmIdleInfo, runAt time.Time, id string) {
	t.Helper()
	if _, err := queue.Enqueue(ctx, queueKey, payload, runAt, id); err != nil {
		t.Fatal(err)
	}
}

func assertJobMissing(t *testing.T, queue *delayqueue.RedisDelayQueue[*domain.VmIdleInfo], ctx context.Context, queueKey, id string) {
	t.Helper()
	if _, _, ok, err := queue.GetJobInfo(ctx, queueKey, id); err != nil || ok {
		t.Fatalf("job %q in %q ok = %v, err = %v", id, queueKey, ok, err)
	}
}

type recycleHostRepoStub struct {
	domain.HostRepo
	vm          *db.VirtualMachine
	err         error
	updateErr   error
	updateCalls int
}

func (s *recycleHostRepoStub) GetVirtualMachine(context.Context, string) (*db.VirtualMachine, error) {
	return s.vm, s.err
}

func (s *recycleHostRepoStub) UpdateVirtualMachine(context.Context, string, func(*db.VirtualMachineUpdateOne) error) error {
	s.updateCalls++
	if s.updateErr == nil && s.vm != nil {
		s.vm.IsRecycled = true
	}
	return s.updateErr
}

type recycleTaskRepoStub struct {
	domain.TaskRepo
	updated []uuid.UUID
	err     error
}

func (s *recycleTaskRepoStub) Update(_ context.Context, _ *domain.User, id uuid.UUID, _ func(*db.TaskUpdateOne) error) error {
	s.updated = append(s.updated, id)
	return s.err
}

type recycleTaskflowStub struct {
	taskflow.Clienter
	vm taskflow.VirtualMachiner
}

func (s *recycleTaskflowStub) VirtualMachiner() taskflow.VirtualMachiner { return s.vm }

type recycleVMStub struct {
	taskflow.VirtualMachiner
	deleteCalls int
	lastDelete  *taskflow.DeleteVirtualMachineReq
	err         error
}

func (s *recycleVMStub) Delete(_ context.Context, req *taskflow.DeleteVirtualMachineReq) error {
	s.deleteCalls++
	s.lastDelete = req
	return s.err
}

type recycleQueueStub struct {
	removed []queueRemoval
	err     error
}

type queueRemoval struct {
	queue string
	id    string
}

func (s *recycleQueueStub) Remove(_ context.Context, queue, id string) error {
	s.removed = append(s.removed, queueRemoval{queue: queue, id: id})
	return s.err
}

func (s *recycleQueueStub) RemoveByPrefix(_ context.Context, queue, prefix string) (int, error) {
	s.removed = append(s.removed, queueRemoval{queue: queue, id: prefix})
	return 0, s.err
}

func (s *recycleQueueStub) removedContains(queue, id string) bool {
	for _, item := range s.removed {
		if item.queue == queue && item.id == id {
			return true
		}
	}
	return false
}
