package lifecycle

import (
	"context"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/domain"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestVMTaskHook_OnStateChange(t *testing.T) {
	mockRepo := &mockTaskRepo{}
	logger := slog.Default()
	hook := NewVMTaskHook(mockRepo, logger)

	ctx := context.Background()
	vmID := uuid.New().String()
	meta := VMMetadata{TaskID: "task-1", UserID: uuid.New().String()}

	// VM Running -> 任务状态应为 Processing
	err := hook.OnStateChange(ctx, vmID, VMStatePending, VMStateRunning, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusProcessing, mockRepo.lastStatus)

	// VM Failed -> 任务状态应为 Error
	err = hook.OnStateChange(ctx, vmID, VMStateRunning, VMStateFailed, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusError, mockRepo.lastStatus)

	// VM Succeeded -> 任务状态应为 Finished
	err = hook.OnStateChange(ctx, vmID, VMStateRunning, VMStateSucceeded, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusFinished, mockRepo.lastStatus)

	// VM Pending/Creating -> 不更新状态
	err = hook.OnStateChange(ctx, vmID, "", VMStatePending, meta)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusFinished, mockRepo.lastStatus) // 保持上一次状态

	// 空 TaskID -> 不更新状态
	metaEmpty := VMMetadata{TaskID: "", UserID: uuid.New().String()}
	err = hook.OnStateChange(ctx, vmID, VMStatePending, VMStateRunning, metaEmpty)
	assert.NoError(t, err)
	assert.Equal(t, consts.TaskStatusFinished, mockRepo.lastStatus) // 保持上一次状态
}

func TestVMNotifyHook_OnStateChange(t *testing.T) {
	mockNotify := &mockDispatcher{}
	logger := slog.Default()
	userID := uuid.New()
	vmID := uuid.New().String()
	meta := VMMetadata{VMID: vmID, TaskID: "task-1", UserID: userID.String()}

	hook := NewVMNotifyHook(mockNotify, logger)

	ctx := context.Background()

	// VM Running -> 发送 VMReady 通知
	err := hook.OnStateChange(ctx, vmID, VMStatePending, VMStateRunning, meta)
	assert.NoError(t, err)
	assert.Contains(t, mockNotify.eventTypes, consts.NotifyEventVMReady)

	// VM Failed -> 发送 VMFailed 通知
	err = hook.OnStateChange(ctx, vmID, VMStateRunning, VMStateFailed, meta)
	assert.NoError(t, err)
	assert.Contains(t, mockNotify.eventTypes, consts.NotifyEventVMFailed)

	// VM Succeeded -> 发送 VMCompleted 通知
	err = hook.OnStateChange(ctx, vmID, VMStateRunning, VMStateSucceeded, meta)
	assert.NoError(t, err)
	assert.Contains(t, mockNotify.eventTypes, consts.NotifyEventVMCompleted)

	// VM Pending/Creating -> 不发送通知
	mockNotify.eventTypes = mockNotify.eventTypes[:0]
	err = hook.OnStateChange(ctx, vmID, "", VMStatePending, meta)
	assert.NoError(t, err)
	assert.Len(t, mockNotify.eventTypes, 0)
}

func TestVMNotifyHook_SubjectUserID(t *testing.T) {
	mockNotify := &mockDispatcher{}
	logger := slog.Default()
	userID := uuid.New()
	vmID := uuid.New().String()
	meta := VMMetadata{VMID: vmID, TaskID: "task-1", UserID: userID.String()}

	hook := NewVMNotifyHook(mockNotify, logger)
	ctx := context.Background()

	err := hook.OnStateChange(ctx, vmID, VMStatePending, VMStateRunning, meta)
	assert.NoError(t, err)
	assert.Equal(t, userID, mockNotify.lastSubjectUserID)
}

// mockTaskRepo 模拟 TaskRepo
type mockTaskRepo struct {
	lastStatus consts.TaskStatus
}

func (m *mockTaskRepo) GetByID(ctx context.Context, id uuid.UUID) (*db.Task, error) {
	return nil, nil
}

func (m *mockTaskRepo) Stat(ctx context.Context, id uuid.UUID) (*domain.TaskStats, error) {
	return nil, nil
}

func (m *mockTaskRepo) StatByIDs(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]*domain.TaskStats, error) {
	return nil, nil
}

func (m *mockTaskRepo) Info(ctx context.Context, user *domain.User, id uuid.UUID) (*db.Task, error) {
	return nil, nil
}

func (m *mockTaskRepo) List(ctx context.Context, user *domain.User, req domain.TaskListReq) ([]*db.ProjectTask, *db.PageInfo, error) {
	return nil, nil, nil
}

func (m *mockTaskRepo) Create(ctx context.Context, user *domain.User, req domain.CreateTaskReq, token string, fn func(*db.ProjectTask, *db.Model, *db.Image) (*taskflow.VirtualMachine, error)) (*db.ProjectTask, error) {
	return nil, nil
}

func (m *mockTaskRepo) Update(ctx context.Context, user *domain.User, id uuid.UUID, fn func(up *db.TaskUpdateOne) error) error {
	return nil
}

func (m *mockTaskRepo) Stop(ctx context.Context, user *domain.User, id uuid.UUID, fn func(*db.Task) error) error {
	return nil
}

func (m *mockTaskRepo) UpdateStatus(ctx context.Context, taskID string, status consts.TaskStatus) error {
	m.lastStatus = status
	return nil
}

// mockDispatcher 模拟 Dispatcher
type mockDispatcher struct {
	eventTypes      []consts.NotifyEventType
	lastSubjectUserID uuid.UUID
}

func (m *mockDispatcher) Publish(ctx context.Context, event *domain.NotifyEvent) error {
	m.eventTypes = append(m.eventTypes, event.EventType)
	m.lastSubjectUserID = event.SubjectUserID
	return nil
}
