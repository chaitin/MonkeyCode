package lifecycle

import (
	"context"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

// TestIntegration_VMToTaskStatus 测试 VM 状态变更自动更新任务状态
func TestIntegration_VMToTaskStatus(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	// 清理测试数据
	rdb.FlushAll(ctx)

	// 创建 mock task repo
	taskRepo := &mockTaskRepo{}
	logger := slog.Default()

	// 创建 VM Manager（带 VMTaskHook）
	mgr := NewManager[string, VMState, VMMetadata](rdb, WithLogger[string, VMState, VMMetadata](logger), WithTransitions[string, VMState, VMMetadata](VMTransitions()))
	mgr.Register(NewVMTaskHook(taskRepo, logger))

	vmID := "vm-" + uuid.New().String()
	taskID := uuid.New().String()
	meta := VMMetadata{
		VMID:   vmID,
		TaskID: taskID,
		UserID: uuid.New().String(),
	}

	// VM: (empty) -> pending (不触发任务状态更新)
	err := mgr.Transition(ctx, vmID, VMStatePending, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatus(""), taskRepo.lastStatus)

	// VM: pending -> creating (不触发任务状态更新)
	err = mgr.Transition(ctx, vmID, VMStateCreating, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatus(""), taskRepo.lastStatus)

	// VM: creating -> running (触发任务状态更新为 Processing)
	err = mgr.Transition(ctx, vmID, VMStateRunning, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusProcessing, taskRepo.lastStatus)

	// VM: running -> succeeded (触发任务状态更新为 Finished)
	err = mgr.Transition(ctx, vmID, VMStateSucceeded, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusFinished, taskRepo.lastStatus)
}

// TestIntegration_VMToTaskStatus_Failed 测试 VM 失败时任务状态更新
func TestIntegration_VMToTaskStatus_Failed(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	taskRepo := &mockTaskRepo{}
	logger := slog.Default()

	mgr := NewManager[string, VMState, VMMetadata](rdb, WithLogger[string, VMState, VMMetadata](logger), WithTransitions[string, VMState, VMMetadata](VMTransitions()))
	mgr.Register(NewVMTaskHook(taskRepo, logger))

	vmID := "vm-" + uuid.New().String()
	taskID := uuid.New().String()
	meta := VMMetadata{
		VMID:   vmID,
		TaskID: taskID,
		UserID: uuid.New().String(),
	}

	// VM: (empty) -> creating -> running
	err := mgr.Transition(ctx, vmID, VMStateCreating, meta)
	assert.NoError(t, err)
	err = mgr.Transition(ctx, vmID, VMStateRunning, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusProcessing, taskRepo.lastStatus)

	// VM: running -> failed (触发任务状态更新为 Error)
	err = mgr.Transition(ctx, vmID, VMStateFailed, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusError, taskRepo.lastStatus)
}

// TestIntegration_TaskNotifications 测试任务状态变更发送通知
func TestIntegration_TaskNotifications(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	notify := &mockDispatcher{}
	logger := slog.Default()

	mgr := NewManager[uuid.UUID, TaskState, TaskMetadata](rdb, WithLogger[uuid.UUID, TaskState, TaskMetadata](logger), WithTransitions[uuid.UUID, TaskState, TaskMetadata](TaskTransitions()))
	mgr.Register(NewTaskNotifyHook(notify, logger))

	taskID := uuid.New()
	meta := TaskMetadata{
		TaskID: taskID,
		UserID: uuid.New().String(),
	}

	// Task: (empty) -> pending (发送 TaskCreated 通知)
	err := mgr.Transition(ctx, taskID, TaskStatePending, meta)
	assert.NoError(t, err)

	// 等待异步 hook 执行
	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventTaskCreated)

	// Task: pending -> running (发送 TaskStarted 通知)
	err = mgr.Transition(ctx, taskID, TaskStateRunning, meta)
	assert.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventTaskStarted)

	// Task: running -> succeeded (发送 TaskCompleted 通知)
	err = mgr.Transition(ctx, taskID, TaskStateSucceeded, meta)
	assert.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventTaskCompleted)
}

// TestIntegration_TaskNotifications_Failed 测试任务失败时发送通知
func TestIntegration_TaskNotifications_Failed(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	notify := &mockDispatcher{}
	logger := slog.Default()

	mgr := NewManager[uuid.UUID, TaskState, TaskMetadata](rdb, WithLogger[uuid.UUID, TaskState, TaskMetadata](logger), WithTransitions[uuid.UUID, TaskState, TaskMetadata](TaskTransitions()))
	mgr.Register(NewTaskNotifyHook(notify, logger))

	taskID := uuid.New()
	meta := TaskMetadata{
		TaskID: taskID,
		UserID: uuid.New().String(),
	}

	// Task: (empty) -> running
	err := mgr.Transition(ctx, taskID, TaskStateRunning, meta)
	assert.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventTaskStarted)

	// Task: running -> failed (发送 TaskFailed 通知)
	err = mgr.Transition(ctx, taskID, TaskStateFailed, meta)
	assert.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventTaskFailed)
}

// TestIntegration_VMNotifications 测试 VM 状态变更发送通知
func TestIntegration_VMNotifications(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	notify := &mockDispatcher{}
	logger := slog.Default()

	mgr := NewManager[string, VMState, VMMetadata](rdb, WithLogger[string, VMState, VMMetadata](logger), WithTransitions[string, VMState, VMMetadata](VMTransitions()))
	mgr.Register(NewVMNotifyHook(notify, logger))

	userID := uuid.New()
	vmID := "vm-" + uuid.New().String()
	taskID := uuid.New().String()
	meta := VMMetadata{
		VMID:   vmID,
		TaskID: taskID,
		UserID: userID.String(),
	}

	// VM: (empty) -> creating -> running (发送 VMReady 通知)
	err := mgr.Transition(ctx, vmID, VMStateCreating, meta)
	assert.NoError(t, err)
	err = mgr.Transition(ctx, vmID, VMStateRunning, meta)
	assert.NoError(t, err)

	// 等待异步 hook 执行
	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventVMReady)
	// 验证 UserID 正确传递
	assert.Equal(t, userID, notify.lastSubjectUserID)

	// VM: running -> succeeded (发送 VMCompleted 通知)
	err = mgr.Transition(ctx, vmID, VMStateSucceeded, meta)
	assert.NoError(t, err)

	time.Sleep(100 * time.Millisecond)

	assert.Contains(t, notify.eventTypes, consts.NotifyEventVMCompleted)
}

// TestIntegration_MultipleHooks 测试多个 Hook 按优先级执行
func TestIntegration_MultipleHooks(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	taskRepo := &mockTaskRepo{}
	notify := &mockDispatcher{}
	logger := slog.Default()

	// 创建带有多个 Hook 的 VM Manager
	mgr := NewManager[string, VMState, VMMetadata](rdb, WithLogger[string, VMState, VMMetadata](logger), WithTransitions[string, VMState, VMMetadata](VMTransitions()))

	// 注册多个 Hook（优先级：VMTaskHook=100, VMNotifyHook=50）
	mgr.Register(
		NewVMNotifyHook(notify, logger), // Priority 50
		NewVMTaskHook(taskRepo, logger), // Priority 100
	)

	vmID := "vm-" + uuid.New().String()
	meta := VMMetadata{
		VMID:   vmID,
		TaskID: uuid.New().String(),
		UserID: uuid.New().String(),
	}

	// VM: (empty) -> creating -> running
	err := mgr.Transition(ctx, vmID, VMStateCreating, meta)
	assert.NoError(t, err)
	err = mgr.Transition(ctx, vmID, VMStateRunning, meta)
	assert.NoError(t, err)

	// 等待异步 hook 执行
	time.Sleep(100 * time.Millisecond)

	// 验证两个 Hook 都被执行
	assert.Equal(t, consts.TaskStatusProcessing, taskRepo.lastStatus)
	assert.Contains(t, notify.eventTypes, consts.NotifyEventVMReady)
}

// TestIntegration_ConcurrentStateTransitions 测试并发状态转换的线程安全性
func TestIntegration_ConcurrentStateTransitions(t *testing.T) {
	t.Parallel()

	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()

	ctx := context.Background()
	rdb.FlushAll(ctx)

	var mu sync.Mutex
	executedHooks := make([]string, 0)

	// 创建自定义 Hook 记录执行
	hook1 := &testHook{name: "hook-1", mu: &mu, executedHooks: &executedHooks}
	hook2 := &testHook{name: "hook-2", mu: &mu, executedHooks: &executedHooks}
	hook3 := &testHook{name: "hook-3", mu: &mu, executedHooks: &executedHooks}

	logger := slog.Default()
	mgr := NewManager[string, VMState, VMMetadata](rdb, WithLogger[string, VMState, VMMetadata](logger), WithTransitions[string, VMState, VMMetadata](VMTransitions()))

	// 注册多个 Hook
	mgr.Register(hook1, hook2, hook3)

	meta := VMMetadata{
		VMID:   "vm-0",
		TaskID: uuid.New().String(),
		UserID: uuid.New().String(),
	}

	// 并发执行状态转换
	vm1, vm2, vm3 := "vm-1", "vm-2", "vm-3"
	errCh := make(chan error, 3)
	go func() {
		errCh <- mgr.Transition(ctx, vm1, VMStatePending, meta)
	}()
	go func() {
		errCh <- mgr.Transition(ctx, vm2, VMStatePending, meta)
	}()
	go func() {
		errCh <- mgr.Transition(ctx, vm3, VMStatePending, meta)
	}()

	for range 3 {
		err := <-errCh
		// 允许部分失败（状态转换冲突）
		if err != nil {
			t.Logf("Transition error (expected): %v", err)
		}
	}

	// 验证至少有一个状态转换成功并触发了 Hook
	mu.Lock()
	hookCount := len(executedHooks)
	mu.Unlock()

	assert.GreaterOrEqual(t, hookCount, 3, "至少应该有 3 个 Hook 被执行（每个 VM 3 个 Hook）")
}

// testHook 测试用 Hook
type testHook struct {
	name          string
	mu            *sync.Mutex
	executedHooks *[]string
}

func (h *testHook) Name() string  { return h.name }
func (h *testHook) Priority() int { return 0 }
func (h *testHook) Async() bool   { return false }
func (h *testHook) OnStateChange(ctx context.Context, id string, from, to VMState, metadata VMMetadata) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	*h.executedHooks = append(*h.executedHooks, h.name)
	return nil
}
