# 用 Lifecycle Manager 替换 Tasker 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在开源项目中用 Lifecycle Manager 替换 Tasker，CreateTaskReq 临时存 Redis（10 分钟过期），VM 就绪时读取创建 taskflow 任务。

**Architecture:** Lifecycle Manager 只存状态，CreateTaskReq 临时存 Redis（key: `task:create_req:{id}`，TTL 10 分钟），TaskCreateHook 读取后删除。

**Tech Stack:** Go 1.21+ 泛型，Redis，samber/do 依赖注入

---

## 文件结构

### 已完成（feat/lifecycle-refactor 分支）

| 文件 | 状态 |
|------|------|
| `pkg/lifecycle/types.go` | ✅ |
| `pkg/lifecycle/manager.go` | ✅ |
| `pkg/lifecycle/task_types.go` | ✅ |
| `pkg/lifecycle/vm_types.go` | ✅ |
| `pkg/lifecycle/task_hooks.go` | ✅ |
| `pkg/lifecycle/vm_hooks.go` | ✅ |
| `pkg/lifecycle/*_test.go` | ✅ |
| `pkg/register.go` | ✅ |

### 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `biz/task/usecase/task.go` | 移除 tasker，改用 lifecycle.Transition；Create 时存 CreateTaskReq 到 Redis |
| `pkg/lifecycle/task_create_hook.go` | 新建：从 Redis 读取 CreateTaskReq 并创建 taskflow 任务 |
| `biz/host/handler/v1/internal.go` | 移除 tasker 字段 |

---

## 任务分解

### Task 1: 移除 TaskUsecase 中的 tasker 依赖

**Files:**
- Modify: `biz/task/usecase/task.go`

- [ ] **Step 1: 移除 tasker 字段**

删除 TaskUsecase 结构中的 tasker 字段和相关导入：
```go
type TaskUsecase struct {
    // 删除: tasker *tasker.Tasker[*domain.TaskSession]
}
```

- [ ] **Step 2: 移除 tasker 注入**

在 NewTaskUsecase 中删除：
```go
// 删除：tasker: do.MustInvoke[*tasker.Tasker[*domain.TaskSession]](i),
// 删除：go u.tasker.StartGroupConsumers(...)
```

- [ ] **Step 3: 移除 tasker.CreateTask 调用**

在 Create 方法中（约 376-394 行）删除：
```go
// 删除这段
if err := a.tasker.CreateTask(ctx, t.ID.String(), &domain.TaskSession{...}); err != nil {
    return nil, err
}
```

- [ ] **Step 4: 添加 Redis 临时存储 CreateTaskReq**

在 Create 方法中添加：
```go
// 创建任务后，临时存储 CreateTaskReq（10 分钟过期）
createReq := &taskflow.CreateTaskReq{
    ID:           t.ID,
    VMID:         vm.ID,
    Text:         req.Content,
    SystemPrompt: req.SystemPrompt,
    CodingAgent:  coding,
    LLM: taskflow.LLM{
        ApiKey:  m.APIKey,
        BaseURL: m.BaseURL,
        Model:   m.Model,
    },
    Configs:    configs,
    McpConfigs: mcps,
}
reqKey := fmt.Sprintf("task:create_req:%s", t.ID.String())
if err := a.redis.Set(ctx, reqKey, createReq, 10*time.Minute).Err(); err != nil {
    return nil, err
}
```

- [ ] **Step 5: 编译验证**

```bash
cd /Users/yoko/chaitin/ai/MonkeyCode/backend
go build ./biz/task/...
# Expected: PASS
```

- [ ] **Step 6: 提交**

```bash
git add biz/task/usecase/task.go
git commit -m "refactor(task): replace tasker with lifecycle, store CreateTaskReq in Redis with 10min TTL"
```

---

### Task 2: 创建 TaskCreateHook

**Files:**
- Create: `pkg/lifecycle/task_create_hook.go`

- [ ] **Step 1: 创建 TaskCreateHook**

新建 `pkg/lifecycle/task_create_hook.go`：
```go
package lifecycle

import (
    "context"
    "encoding/json"
    "fmt"
    "log/slog"
    "time"

    "github.com/google/uuid"
    "github.com/redis/go-redis/v9"

    "github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// TaskCreateHook 在 TaskStateRunning 时从 Redis 读取 CreateTaskReq 并创建 taskflow 任务
type TaskCreateHook struct {
    redis    *redis.Client
    taskflow taskflow.Clienter
    logger   *slog.Logger
}

// NewTaskCreateHook 创建 TaskCreateHook
func NewTaskCreateHook(redis *redis.Client, taskflow taskflow.Clienter, logger *slog.Logger) *TaskCreateHook {
    return &TaskCreateHook{
        redis:    redis,
        taskflow: taskflow,
        logger:   logger.With("hook", "task-create-hook"),
    }
}

func (h *TaskCreateHook) Name() string     { return "task-create-hook" }
func (h *TaskCreateHook) Priority() int    { return 80 } // 介于 VMTaskHook(100) 和 TaskNotifyHook(50) 之间
func (h *TaskCreateHook) Async() bool      { return false } // 同步执行

func (h *TaskCreateHook) OnStateChange(ctx context.Context, taskID uuid.UUID, from, to TaskState, metadata TaskMetadata) error {
    // 只在第一次进入 Running 状态时创建 taskflow 任务
    if to != TaskStateRunning {
        return nil
    }

    // 从 Redis 读取 CreateTaskReq
    reqKey := fmt.Sprintf("task:create_req:%s", taskID.String())
    val, err := h.redis.Get(ctx, reqKey).Result()
    if err == redis.Nil {
        h.logger.WarnContext(ctx, "CreateTaskReq not found in Redis (may be expired)", "task_id", taskID)
        return nil
    }
    if err != nil {
        return fmt.Errorf("failed to get CreateTaskReq from Redis: %w", err)
    }

    // 删除 key（用完即删）
    h.redis.Del(ctx, reqKey)

    // 反序列化
    var createReq taskflow.CreateTaskReq
    if err := json.Unmarshal([]byte(val), &createReq); err != nil {
        return fmt.Errorf("failed to unmarshal CreateTaskReq: %w", err)
    }

    h.logger.InfoContext(ctx, "creating taskflow task", "task_id", taskID)
    return h.taskflow.TaskManager().Create(ctx, createReq)
}
```

- [ ] **Step 2: 编译验证**

```bash
go build ./pkg/lifecycle/...
# Expected: PASS
```

- [ ] **Step 3: 提交**

```bash
git add pkg/lifecycle/task_create_hook.go
git commit -m "feat(lifecycle): add TaskCreateHook to read CreateTaskReq from Redis and create taskflow task"
```

---

### Task 3: 在 TaskUsecase 中注册 TaskCreateHook

**Files:**
- Modify: `biz/task/usecase/task.go`

- [ ] **Step 1: 注册 TaskCreateHook**

在 NewTaskUsecase 中添加：
```go
// 注册 Task Hooks
u.taskLifecycle.Register(
    lifecycle.NewTaskNotifyHook(u.notifyDispatcher, u.logger),
    lifecycle.NewTaskCreateHook(u.redis, u.taskflow, u.logger), // 新增
)
```

- [ ] **Step 2: 编译验证**

```bash
go build ./...
# Expected: PASS
```

- [ ] **Step 3: 提交**

```bash
git add biz/task/usecase/task.go
git commit -m "refactor(task): register TaskCreateHook in TaskUsecase"
```

---

### Task 4: 移除 InternalHostHandler 中的 tasker 依赖

**Files:**
- Modify: `biz/host/handler/v1/internal.go`

- [ ] **Step 1: 移除 tasker 字段**

删除 InternalHostHandler 结构中的 tasker 字段：
```go
type InternalHostHandler struct {
    // 删除：tasker *tasker.Tasker[*domain.TaskSession]
}
```

- [ ] **Step 2: 移除 tasker 注入**

在 NewInternalHostHandler 中删除：
```go
// 删除：tasker: do.MustInvoke[*tasker.Tasker[*domain.TaskSession]](i),
```

- [ ] **Step 3: 编译验证**

```bash
go build ./biz/host/...
# Expected: PASS
```

- [ ] **Step 4: 提交**

```bash
git add biz/host/handler/v1/internal.go
git commit -m "refactor(host): remove tasker dependency from InternalHostHandler"
```

---

### Task 5: 测试验证

**Files:**
- Create: `pkg/lifecycle/task_create_hook_test.go`

- [ ] **Step 1: 创建单元测试**

新建 `pkg/lifecycle/task_create_hook_test.go`：
```go
package lifecycle

import (
    "context"
    "encoding/json"
    "fmt"
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
    hook := NewTaskCreateHook(rdb, mockTaskflow, nil)

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

func (m *mockTaskflowClient) TaskManager() taskflow.TaskManager {
    return &mockTaskManager{m: m}
}

type mockTaskManager struct {
    m *mockTaskflowClient
}

func (m *mockTaskManager) Create(ctx context.Context, req taskflow.CreateTaskReq) error {
    m.m.called = true
    m.m.lastReq = req
    return nil
}
```

- [ ] **Step 2: 运行测试**

```bash
go test ./pkg/lifecycle/... -v -run TestTaskCreateHook
# Expected: PASS
```

- [ ] **Step 3: 提交**

```bash
git add pkg/lifecycle/task_create_hook_test.go
git commit -m "test(lifecycle): add unit test for TaskCreateHook"
```

---

### Task 6: 清理无用的 tasker 代码（可选）

**Files:**
- Delete: `pkg/tasker/tasker.go` (仅当确认内部项目不再依赖)

- [ ] **Step 1: 检查依赖**

```bash
grep -r "tasker\." --include="*.go" . | grep -v "_test.go" | grep -v "pkg/tasker/"
# Expected: 无输出或只有内部项目相关
```

- [ ] **Step 2: 如果无依赖，删除文件**

```bash
rm pkg/tasker/tasker.go
git add -A
git commit -m "chore: remove unused tasker package"
```

---

## 验证清单

- [ ] 所有单元测试通过：`go test ./pkg/lifecycle/... -v`
- [ ] 所有集成测试通过：`go test ./pkg/lifecycle/... -run Integration -v`
- [ ] 整个项目编译通过：`go build ./...`
- [ ] Redis 临时存储正常：手动创建任务后检查 `task:create_req:{id}` key 存在
- [ ] Hook 正常删除 key：VM 就绪后检查 key 已被删除

---

## 完整流程

```
1. TaskUsecase.Create()
   ├─ 创建任务记录（数据库）
   ├─ 创建 VM（taskflow）
   ├─ 存储 CreateTaskReq 到 Redis（10 分钟过期）
   │   key: task:create_req:{taskID}
   ├─ taskLifecycle.Transition() → TaskStatePending
   └─ vmLifecycle.Transition() → VMStateRunning

2. VM 就绪（InternalHandler.VmReady 或 VM 条件检查）
   └─ taskLifecycle.Transition() → TaskStateRunning
       ├─ VMTaskHook: 更新任务状态为 Processing
       ├─ TaskCreateHook: 从 Redis 读取 CreateTaskReq，创建 taskflow 任务，删除 key
       └─ TaskNotifyHook: 发送 TaskStarted 通知
```

---

**Plan complete.**

执行方式选择：
1. **Subagent-Driven (recommended)** - 每个 Task 独立 subagent 执行
2. **Inline Execution** - 当前 session 批量执行

选择哪种？
