package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

// Manager 泛型生命周期管理器
type Manager[I comparable, S State, M any] struct {
	redis       *redis.Client
	hooks       []Hook[I, S, M]
	logger      *slog.Logger
	mu          sync.RWMutex
	transitions map[S][]S // 允许的状态转换规则
}

// Opt 配置选项
type Opt[I comparable, S State, M any] func(*Manager[I, S, M])

// WithLogger 设置日志器
func WithLogger[I comparable, S State, M any](logger *slog.Logger) Opt[I, S, M] {
	return func(m *Manager[I, S, M]) {
		m.logger = logger
	}
}

// WithTransitions 设置允许的状态转换规则
//
//	例如：WithTransitions(map[TaskState][]TaskState{
//	    TaskStatePending:   {TaskStateRunning, TaskStateFailed},
//	    TaskStateRunning:   {TaskStateSucceeded, TaskStateFailed},
//	    TaskStateFailed:    {TaskStateRunning},
//	    TaskStateSucceeded: {},
//	})
func WithTransitions[I comparable, S State, M any](transitions map[S][]S) Opt[I, S, M] {
	return func(m *Manager[I, S, M]) {
		m.transitions = transitions
	}
}

// NewManager 创建生命周期管理器
func NewManager[I comparable, S State, M any](redis *redis.Client, opts ...Opt[I, S, M]) *Manager[I, S, M] {
	m := &Manager[I, S, M]{
		redis:       redis,
		hooks:       make([]Hook[I, S, M], 0),
		logger:      slog.Default(),
		transitions: make(map[S][]S),
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// Register 注册 Hook（按优先级排序）
func (m *Manager[I, S, M]) Register(hooks ...Hook[I, S, M]) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.hooks = append(m.hooks, hooks...)
	sort.Slice(m.hooks, func(i, j int) bool {
		return m.hooks[i].Priority() > m.hooks[j].Priority()
	})
}

// Transition 状态转换
func (m *Manager[I, S, M]) Transition(ctx context.Context, id I, to S, metadata M) error {
	key := m.stateKey(id)

	// 1. 获取当前状态
	fromRaw, _ := m.redis.HGet(ctx, key, "state").Result()
	var from S
	if fromRaw != "" {
		from = m.parseState(fromRaw)
	}
	if fromRaw == "" {
		from = m.defaultState()
	}

	// 2. 验证状态转换合法性
	if !m.isValidTransition(from, to) {
		return fmt.Errorf("invalid transition: %v -> %v", from, to)
	}

	// 3. 更新状态
	now := time.Now()
	if err := m.redis.HSet(ctx, key, map[string]any{
		"state":      fmt.Sprintf("%v", to),
		"from_state": fmt.Sprintf("%v", from),
		"updated_at": now.UnixMilli(),
	}).Err(); err != nil {
		return err
	}

	// 4. 触发 Hook 链
	m.mu.RLock()
	hooks := m.hooks
	m.mu.RUnlock()

	var errs []error
	for _, hook := range hooks {
		if hook.Async() {
			go m.execHook(ctx, hook, id, from, to, metadata)
		} else {
			if err := m.execHook(ctx, hook, id, from, to, metadata); err != nil {
				m.logger.Error("hook failed", "hook", hook.Name(), "error", err)
				errs = append(errs, fmt.Errorf("hook %s failed: %w", hook.Name(), err))
			}
		}
	}

	m.logger.Info("state transitioned", "id", id, "from", from, "to", to)
	return errors.Join(errs...)
}

// GetState 获取当前状态
func (m *Manager[I, S, M]) GetState(ctx context.Context, id I) (S, error) {
	state, err := m.redis.HGet(ctx, m.stateKey(id), "state").Result()
	if err != nil {
		var zero S
		return zero, err
	}
	return m.parseState(state), nil
}

func (m *Manager[I, S, M]) execHook(ctx context.Context, hook Hook[I, S, M], id I, from, to S, metadata M) error {
	defer func() {
		if r := recover(); r != nil {
			m.logger.Error("hook panic", "hook", hook.Name(), "recover", r)
		}
	}()
	return hook.OnStateChange(ctx, id, from, to, metadata)
}

func (m *Manager[I, S, M]) stateKey(id I) string {
	return fmt.Sprintf("lifecycle:%v", id)
}

func (m *Manager[I, S, M]) defaultState() S {
	var zero S
	return zero
}

func (m *Manager[I, S, M]) parseState(s string) S {
	// 将 string 转换为状态类型 S（S 必须是基于 string 的类型）
	return S(s)
}

func (m *Manager[I, S, M]) isValidTransition(from, to S) bool {
	if len(m.transitions) == 0 {
		return true // 没有配置规则时，允许所有转换
	}
	allowed := m.transitions[from]
	if allowed == nil {
		return false
	}
	return slices.Contains(allowed, to)
}

// 以下是预定义的状态转换规则，可直接使用

// TaskTransitions 任务的默认状态转换规则
func TaskTransitions() map[consts.TaskStatus][]consts.TaskStatus {
	return map[consts.TaskStatus][]consts.TaskStatus{
		"":                          {consts.TaskStatusPending, consts.TaskStatusFinished},
		consts.TaskStatusPending:    {consts.TaskStatusProcessing, consts.TaskStatusFinished, consts.TaskStatusError},
		consts.TaskStatusProcessing: {consts.TaskStatusFinished, consts.TaskStatusError},
		consts.TaskStatusError:      {consts.TaskStatusProcessing},
	}
}

// VMTransitions VM 的默认状态转换规则
func VMTransitions() map[VMState][]VMState {
	return map[VMState][]VMState{
		"":               {VMStatePending, VMStateCreating, VMStateRunning, VMStateFailed, VMStateRecycled},
		VMStatePending:   {VMStateCreating, VMStateFailed, VMStateRecycled},
		VMStateCreating:  {VMStateRunning, VMStateFailed, VMStateRecycled},
		VMStateRunning:   {VMStateSucceeded, VMStateFailed, VMStateRecycled},
		VMStateFailed:    {VMStateRunning, VMStateRecycled},
		VMStateSucceeded: {VMStateRecycled},
	}
}
