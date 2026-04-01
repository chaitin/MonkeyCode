# Stream Attach 最新论次 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `mode=attach` 严格只返回最新一个论次，并在该论次结束后自动关闭 WebSocket。

**Architecture:** 在 Loki 侧补齐“历史窗口查询”能力，并把最新论次起点固定为最近一个 `user-input`。`TaskHandler.attachStream` 基于明确的历史窗口做回放，再按需拼接 `TaskLive` 实时流，避免复用 `loki.Tail()` 的混合历史/实时语义。

**Tech Stack:** Go, Loki HTTP query_range, coder/websocket, TaskLive WebSocket

---

### Task 1: 固化 attach 起点规则

**Files:**
- Modify: `pkg/loki/client.go`
- Test: `pkg/loki/client_test.go`

- [ ] **Step 1: 写失败测试，覆盖最近 user-input 起点的两种判定**

```go
func TestFindLatestRoundStart(t *testing.T) {
    // case 1: 返回最近一个 user-input
    // case 2: 没有 user-input 时返回任务创建时间
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./pkg/loki -run TestFindLatestRoundStart`
Expected: FAIL，提示缺少对应实现

- [ ] **Step 3: 在 Loki 客户端实现 attach 起点辅助函数**

```go
func (c *Client) FindLatestRoundStart(ctx context.Context, taskID string, taskCreatedAt, end time.Time) (time.Time, error)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `go test ./pkg/loki -run TestFindLatestRoundStart`
Expected: PASS

### Task 2: 固化 attach 历史窗口只回放最新一论

**Files:**
- Modify: `pkg/loki/client.go`
- Test: `pkg/loki/client_test.go`

- [ ] **Step 1: 写失败测试，覆盖历史窗口查询只返回区间内日志**

```go
func TestQueryWindowByTaskID(t *testing.T) {
    // 构造多论日志，查询最新论次窗口，只返回窗口内正序日志
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./pkg/loki -run TestQueryWindowByTaskID`
Expected: FAIL，提示缺少窗口查询实现

- [ ] **Step 3: 实现只读历史窗口的查询接口**

```go
func (c *Client) QueryWindowByTaskID(ctx context.Context, taskID string, start, end time.Time) ([]LogEntry, error)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `go test ./pkg/loki -run TestQueryWindowByTaskID`
Expected: PASS

### Task 3: 修正 attachStream 的历史与实时拼接

**Files:**
- Modify: `biz/task/handler/v1/task.go`
- Test: `biz/task/handler/v1/task_attach_test.go`

- [ ] **Step 1: 写失败测试，覆盖 attach 已结束与运行中两种语义**

```go
func TestReplayLatestRoundHistoryStopsWhenEnded(t *testing.T) {}
func TestReplayLatestRoundHistoryKeepsStreamingWhenNotEnded(t *testing.T) {}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `go test ./biz/task/handler/v1 -run 'TestReplayLatestRoundHistory|TestConsumeLiveStream'`
Expected: FAIL，旧实现无法满足最新论次窗口语义

- [ ] **Step 3: 最小改造 attachStream**

```go
attachNow := time.Now()
roundStart, err := h.loki.FindLatestRoundStart(...)
ended := h.replayLatestRoundHistory(..., roundStart, attachNow)
if !ended {
    h.consumeLiveStream(...)
}
```

- [ ] **Step 4: 运行目标测试确认通过**

Run: `go test ./biz/task/handler/v1 -run 'TestReplayLatestRoundHistory|TestConsumeLiveStream'`
Expected: PASS

### Task 4: 回归验证

**Files:**
- Modify: `docs/superpowers/plans/2026-04-01-stream-attach-latest-round.md`

- [ ] **Step 1: 运行相关测试**

Run: `go test ./pkg/loki ./biz/task/handler/v1`
Expected: PASS

- [ ] **Step 2: 更新计划状态与实施结果**

在本文档中补充“已完成”标记和简短实施结果，说明最新论次判定与 attach 历史/实时拼接已修复。

## 实施结果

- 已将最新论次起点语义固定为最近一个 `user-input`；如果不存在，则退回任务创建时间。
- 已将 `attach` 的历史阶段改为固定时间窗口查询，不再复用 `loki.Tail()` 的历史+实时混合语义。
- 已在实时消费阶段跳过历史窗口截止时间之前的 chunk，避免历史回放与实时拼接重复发送。
- 已补充 Loki 与 handler 的回归测试，并通过 `go test ./pkg/loki ./biz/task/handler/v1` 验证。
