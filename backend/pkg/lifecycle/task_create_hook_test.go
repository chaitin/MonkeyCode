package lifecycle

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"

	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

func TestTaskCreateHook_OnStateChange(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	defer rdb.Close()
	rdb.FlushAll(context.Background())

	taskID := uuid.New()
	ctx := context.Background()

	// 准备 CreateTaskReq 存 Redis
	createReq := &taskflow.CreateTaskReq{
		ID:   taskID,
		VMID: "vm-test-1",
		Text: "test task",
	}
	reqKey := fmt.Sprintf("task:create_req:%s", taskID.String())
	data, _ := json.Marshal(createReq)
	rdb.Set(ctx, reqKey, string(data), 10*time.Minute)

	// 创建 Hook（使用 mock taskflow）
	mockTaskflow := &mockTaskflowClient{}
	logger := slog.Default()
	hook := NewTaskCreateHook(rdb, mockTaskflow, logger)

	// 触发 Running 状态
	err := hook.OnStateChange(ctx, taskID, TaskStatePending, TaskStateRunning, TaskMetadata{})
	assert.NoError(t, err)
	assert.True(t, mockTaskflow.called)
	assert.Equal(t, createReq.ID, mockTaskflow.lastReq.ID)

	// 验证 key 已被删除
	_, err = rdb.Get(ctx, reqKey).Result()
	assert.Equal(t, redis.Nil, err)
}

type mockTaskflowClient struct {
	called bool
	lastReq taskflow.CreateTaskReq
}

func (m *mockTaskflowClient) VirtualMachiner() taskflow.VirtualMachiner {
	return nil
}

func (m *mockTaskflowClient) Host() taskflow.Hoster {
	return nil
}

func (m *mockTaskflowClient) FileManager() taskflow.FileManager {
	return nil
}

func (m *mockTaskflowClient) TaskManager() taskflow.TaskManager {
	return &mockTaskManager{m: m}
}

func (m *mockTaskflowClient) PortForwarder() taskflow.PortForwarder {
	return nil
}

func (m *mockTaskflowClient) Stats(ctx context.Context) (*taskflow.Stats, error) {
	return nil, nil
}

type mockTaskManager struct {
	m *mockTaskflowClient
}

func (m *mockTaskManager) Create(ctx context.Context, req taskflow.CreateTaskReq) error {
	m.m.called = true
	m.m.lastReq = req
	return nil
}

func (m *mockTaskManager) Stop(ctx context.Context, req taskflow.TaskReq) error {
	return nil
}

func (m *mockTaskManager) Restart(ctx context.Context, req taskflow.RestartTaskReq) error {
	return nil
}

func (m *mockTaskManager) Cancel(ctx context.Context, req taskflow.TaskReq) error {
	return nil
}

func (m *mockTaskManager) Continue(ctx context.Context, req taskflow.TaskReq) error {
	return nil
}

func (m *mockTaskManager) AutoApprove(ctx context.Context, req taskflow.TaskApproveReq) error {
	return nil
}

func (m *mockTaskManager) AskUserQuestion(ctx context.Context, req taskflow.AskUserQuestionResponse) error {
	return nil
}

func (m *mockTaskManager) ListFiles(ctx context.Context, req taskflow.RepoListFilesReq) (*taskflow.RepoListFiles, error) {
	return nil, nil
}

func (m *mockTaskManager) ReadFile(ctx context.Context, req taskflow.RepoReadFileReq) (*taskflow.RepoReadFile, error) {
	return nil, nil
}

func (m *mockTaskManager) FileDiff(ctx context.Context, req taskflow.RepoFileDiffReq) (*taskflow.RepoFileDiff, error) {
	return nil, nil
}

func (m *mockTaskManager) FileChanges(ctx context.Context, req taskflow.RepoFileChangesReq) (*taskflow.RepoFileChanges, error) {
	return nil, nil
}
