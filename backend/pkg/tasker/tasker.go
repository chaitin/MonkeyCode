package tasker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Opt 配置选项
type Opt[T any] func(t *Tasker[T])

// WithPrefix 设置 Redis key 前缀
func WithPrefix[T any](prefix string) Opt[T] {
	return func(t *Tasker[T]) {
		t.keyPrefix = prefix
	}
}

// WithLogger 设置日志
func WithLogger[T any](logger *slog.Logger) Opt[T] {
	return func(t *Tasker[T]) {
		t.logger = logger
	}
}

// WithStreamTrimEnabled 设置是否启用 stream 裁剪
func WithStreamTrimEnabled[T any](enabled bool) Opt[T] {
	return func(t *Tasker[T]) {
		t.streamTrimEnabled = enabled
	}
}

// WithStreamTrimInterval 设置 stream 裁剪间隔
func WithStreamTrimInterval[T any](interval time.Duration) Opt[T] {
	return func(t *Tasker[T]) {
		if interval > 0 {
			t.streamTrimInterval = interval
		}
	}
}

// WithStreamTrimWindow 设置 stream 裁剪窗口
func WithStreamTrimWindow[T any](window time.Duration) Opt[T] {
	return func(t *Tasker[T]) {
		if window > 0 {
			t.streamTrimWindow = window
		}
	}
}

// Phase 任务阶段
type Phase string

const (
	PhaseCreated  Phase = "created"
	PhaseStarted  Phase = "started"
	PhaseRunning  Phase = "running"
	PhaseFailed   Phase = "failed"
	PhaseFinished Phase = "finished"
)

var (
	ErrTaskExists        = errors.New("task already exists")
	ErrTaskNotFound      = errors.New("task not found")
	ErrInvalidTransition = errors.New("invalid state transition")
)

var allowedTransitions = map[Phase]map[Phase]bool{
	PhaseCreated:  {PhaseStarted: true, PhaseFailed: true},
	PhaseStarted:  {PhaseRunning: true, PhaseFailed: true},
	PhaseRunning:  {PhaseFailed: true, PhaseFinished: true},
	PhaseFailed:   {PhaseRunning: true},
	PhaseFinished: {},
}

// Task 泛型任务
type Task[T any] struct {
	ID        string    `json:"id"`
	Phase     Phase     `json:"phase"`
	Payload   T         `json:"payload,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type taskEvent struct {
	ID        string `json:"id"`
	Phase     Phase  `json:"phase"`
	UpdatedAt int64  `json:"updated_at"`
}

// EventHandler 事件处理器
type EventHandler[T any] func(ctx context.Context, task Task[T])

// TaskUpdateFunc 任务更新函数
type TaskUpdateFunc[T any] func(task *Task[T]) error

// Tasker 泛型 Redis 任务状态机
type Tasker[T any] struct {
	redis              *redis.Client
	handlers           map[Phase][]EventHandler[T]
	keyPrefix          string
	logger             *slog.Logger
	streamMax          int64
	streamTrimEnabled  bool
	streamTrimInterval time.Duration
	streamTrimWindow   time.Duration
}

// NewTasker 创建任务状态机
func NewTasker[T any](redis *redis.Client, opts ...Opt[T]) *Tasker[T] {
	t := &Tasker[T]{
		redis:              redis,
		handlers:           make(map[Phase][]EventHandler[T]),
		keyPrefix:          "tasker",
		logger:             slog.Default(),
		streamMax:          0,
		streamTrimEnabled:  true,
		streamTrimInterval: 5 * time.Minute,
		streamTrimWindow:   72 * time.Hour,
	}

	for _, opt := range opts {
		opt(t)
	}

	if t.streamTrimEnabled {
		go t.startStreamTrim(context.Background())
	}

	return t
}

// On 注册阶段事件处理器
func (t *Tasker[T]) On(phase Phase, handler EventHandler[T]) {
	if handler == nil {
		return
	}
	t.handlers[phase] = append(t.handlers[phase], handler)
}

// CreateTask 创建任务并触发 created 事件
func (t *Tasker[T]) CreateTask(ctx context.Context, id string, payload T) error {
	key := t.taskKey(id)

	exists, err := t.redis.Exists(ctx, key).Result()
	if err != nil {
		return err
	}
	if exists > 0 {
		return ErrTaskExists
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	now := time.Now()
	if err := t.redis.HSet(ctx, key, map[string]any{
		"id":         id,
		"phase":      string(PhaseCreated),
		"payload":    string(payloadJSON),
		"created_at": now.UnixMilli(),
		"updated_at": now.UnixMilli(),
	}).Err(); err != nil {
		return err
	}

	if err := t.redis.SAdd(ctx, t.phaseSetKey(PhaseCreated), id).Err(); err != nil {
		return err
	}

	task := Task[T]{
		ID:        id,
		Phase:     PhaseCreated,
		Payload:   payload,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := t.publishEvent(ctx, PhaseCreated, task); err != nil {
		return err
	}
	t.triggerLocalHandlers(ctx, PhaseCreated, task)
	return nil
}

// SetTaskTTL 设置任务过期时间
func (t *Tasker[T]) SetTaskTTL(ctx context.Context, id string, ttl time.Duration) error {
	if ttl <= 0 {
		return nil
	}
	return t.redis.Expire(ctx, t.taskKey(id), ttl).Err()
}

// CleanupTask 清理任务
func (t *Tasker[T]) CleanupTask(ctx context.Context, id string, _ Phase) error {
	phases := []Phase{PhaseCreated, PhaseStarted, PhaseRunning, PhaseFailed, PhaseFinished}
	for _, p := range phases {
		if err := t.redis.SRem(ctx, t.phaseSetKey(p), id).Err(); err != nil {
			return err
		}
	}
	return t.redis.Del(ctx, t.taskKey(id)).Err()
}

// GetTask 获取任务
func (t *Tasker[T]) GetTask(ctx context.Context, id string) (Task[T], error) {
	key := t.taskKey(id)
	data, err := t.redis.HGetAll(ctx, key).Result()
	if err != nil {
		return Task[T]{}, err
	}
	if len(data) == 0 {
		return Task[T]{}, ErrTaskNotFound
	}

	var payload T
	if p := data["payload"]; p != "" {
		_ = json.Unmarshal([]byte(p), &payload)
	}

	createdMs, _ := strconv.ParseInt(data["created_at"], 10, 64)
	updatedMs, _ := strconv.ParseInt(data["updated_at"], 10, 64)

	return Task[T]{
		ID:        data["id"],
		Phase:     Phase(data["phase"]),
		Payload:   payload,
		CreatedAt: time.UnixMilli(createdMs),
		UpdatedAt: time.UnixMilli(updatedMs),
	}, nil
}

// Transition 阶段转换
func (t *Tasker[T]) Transition(ctx context.Context, id string, to Phase) error {
	return t.TransitionWithUpdate(ctx, id, to, nil)
}

// TransitionWithUpdate 阶段转换并更新任务数据
func (t *Tasker[T]) TransitionWithUpdate(ctx context.Context, id string, to Phase, update TaskUpdateFunc[T]) error {
	key := t.taskKey(id)

	task, err := t.GetTask(ctx, id)
	if err != nil {
		return err
	}
	from := task.Phase

	if !t.canTransition(from, to) {
		return ErrInvalidTransition
	}

	if update != nil {
		if err := update(&task); err != nil {
			return err
		}
	}

	now := time.Now()
	task.Phase = to
	task.UpdatedAt = now

	payloadJSON, err := json.Marshal(task.Payload)
	if err != nil {
		return err
	}

	if err := t.redis.HSet(ctx, key, map[string]any{
		"phase":      string(task.Phase),
		"payload":    string(payloadJSON),
		"updated_at": task.UpdatedAt.UnixMilli(),
	}).Err(); err != nil {
		return err
	}

	if err := t.redis.SRem(ctx, t.phaseSetKey(from), id).Err(); err != nil {
		return err
	}
	if err := t.redis.SAdd(ctx, t.phaseSetKey(to), id).Err(); err != nil {
		return err
	}

	if err := t.publishEvent(ctx, to, task); err != nil {
		return err
	}
	t.triggerLocalHandlers(ctx, to, task)
	return nil
}

// EnsureStreamsAndGroup 确保各阶段事件流与消费组存在
func (t *Tasker[T]) EnsureStreamsAndGroup(ctx context.Context, group string) error {
	phases := []Phase{PhaseStarted, PhaseRunning, PhaseFailed, PhaseFinished}
	for _, p := range phases {
		if err := t.redis.XGroupCreateMkStream(ctx, t.streamKey(p), group, "0").Err(); err != nil {
			if err.Error() != "BUSYGROUP Consumer Group name already exists" {
				return err
			}
		}
	}
	return nil
}

// StartGroupConsumers 启动消费者组阻塞消费
func (t *Tasker[T]) StartGroupConsumers(ctx context.Context, group, consumer string, block time.Duration, count int64) error {
	if count <= 0 {
		count = 10
	}
	if block <= 0 {
		block = time.Second
	}
	streams := []string{
		t.streamKey(PhaseStarted), ">",
		t.streamKey(PhaseRunning), ">",
		t.streamKey(PhaseFailed), ">",
		t.streamKey(PhaseFinished), ">",
	}
	for {
		res, err := t.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    group,
			Consumer: consumer,
			Streams:  streams,
			Count:    count,
			Block:    block,
		}).Result()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			time.Sleep(time.Second)
			continue
		}
		for _, strm := range res {
			phase := t.phaseFromStreamKey(strm.Stream)
			for _, msg := range strm.Messages {
				raw, _ := t.extractTaskJSON(msg)
				if len(raw) == 0 {
					_ = t.redis.XAck(ctx, strm.Stream, group, msg.ID).Err()
					continue
				}
				var evt taskEvent
				if err := json.Unmarshal(raw, &evt); err != nil {
					_ = t.redis.XAck(ctx, strm.Stream, group, msg.ID).Err()
					continue
				}
				task, err := t.GetTask(ctx, evt.ID)
				if err != nil {
					_ = t.redis.XAck(ctx, strm.Stream, group, msg.ID).Err()
					continue
				}
				t.triggerLocalHandlers(ctx, phase, task)
				_ = t.redis.XAck(ctx, strm.Stream, group, msg.ID).Err()
			}
		}
	}
}

// ClaimStalePending 认领陈旧的待处理消息
func (t *Tasker[T]) ClaimStalePending(ctx context.Context, phase Phase, group, consumer string, minIdle time.Duration, count int64) error {
	if count <= 0 {
		count = 100
	}
	stream := t.streamKey(phase)
	start := "0-0"
	for {
		msgs, next, err := t.redis.XAutoClaim(ctx, &redis.XAutoClaimArgs{
			Stream:   stream,
			Group:    group,
			Consumer: consumer,
			MinIdle:  minIdle,
			Start:    start,
			Count:    count,
		}).Result()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		for _, msg := range msgs {
			raw, _ := t.extractTaskJSON(msg)
			var evt taskEvent
			if len(raw) > 0 && json.Unmarshal(raw, &evt) == nil {
				task, err := t.GetTask(ctx, evt.ID)
				if err == nil {
					t.triggerLocalHandlers(ctx, phase, task)
				}
			}
			_ = t.redis.XAck(ctx, stream, group, msg.ID).Err()
		}
		if next == start {
			break
		}
		start = next
	}
	return nil
}

// ReconcileStartup 启动期对账扫描
func (t *Tasker[T]) ReconcileStartup(ctx context.Context) error {
	phases := []Phase{PhaseStarted, PhaseRunning, PhaseFailed, PhaseFinished}
	for _, p := range phases {
		visited := make(map[string]struct{})
		if err := t.scanSetAndTrigger(ctx, t.phaseSetKey(p), p, visited); err != nil {
			return err
		}
	}
	return nil
}

func (t *Tasker[T]) scanSetAndTrigger(ctx context.Context, setKey string, phase Phase, visited map[string]struct{}) error {
	cursor := uint64(0)
	for {
		members, next, err := t.redis.SScan(ctx, setKey, cursor, "", 100).Result()
		if err != nil {
			return err
		}
		for _, id := range members {
			if _, ok := visited[id]; ok {
				continue
			}
			visited[id] = struct{}{}
			task, err := t.GetTask(ctx, id)
			if err != nil {
				continue
			}
			t.triggerLocalHandlers(ctx, phase, task)
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return nil
}

func (t *Tasker[T]) publishEvent(ctx context.Context, phase Phase, task Task[T]) error {
	evt := taskEvent{
		ID:        task.ID,
		Phase:     phase,
		UpdatedAt: task.UpdatedAt.UnixMilli(),
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}
	args := &redis.XAddArgs{
		Stream: t.streamKey(phase),
		ID:     "*",
		Values: map[string]any{"data": data},
	}
	if t.streamMax > 0 {
		args.MaxLen = t.streamMax
		args.Approx = false
	}
	return t.redis.XAdd(ctx, args).Err()
}

func (t *Tasker[T]) startStreamTrim(ctx context.Context) {
	ticker := time.NewTicker(t.streamTrimInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			t.trimStreams(ctx)
		}
	}
}

func (t *Tasker[T]) trimStreams(ctx context.Context) {
	if !t.streamTrimEnabled {
		return
	}
	phases := []Phase{PhaseStarted, PhaseRunning, PhaseFailed, PhaseFinished}
	for _, phase := range phases {
		if err := t.trimStream(ctx, t.streamKey(phase)); err != nil {
			t.logger.With("error", err, "key", t.streamKey(phase)).ErrorContext(ctx, "failed to trim task stream")
		}
	}
}

func (t *Tasker[T]) trimStream(ctx context.Context, stream string) error {
	windowMinID := fmt.Sprintf("%d-0", time.Now().Add(-t.streamTrimWindow).UnixMilli())
	err := t.redis.XTrimMinID(ctx, stream, windowMinID).Err()
	if err != nil && isNoSuchStreamErr(err) {
		return nil
	}
	return err
}

func isNoSuchStreamErr(err error) bool {
	if errors.Is(err, redis.Nil) {
		return true
	}
	return strings.Contains(err.Error(), "no such key")
}

func (t *Tasker[T]) triggerLocalHandlers(ctx context.Context, phase Phase, task Task[T]) {
	if handlers := t.handlers[phase]; len(handlers) > 0 {
		for _, h := range handlers {
			h(ctx, task)
		}
	}
}

func (t *Tasker[T]) extractTaskJSON(msg redis.XMessage) ([]byte, bool) {
	if v, ok := msg.Values["data"]; ok {
		switch vv := v.(type) {
		case string:
			return []byte(vv), true
		case []byte:
			return vv, true
		default:
			bs, _ := json.Marshal(v)
			return bs, true
		}
	}
	return nil, false
}

func (t *Tasker[T]) canTransition(from, to Phase) bool {
	nexts := allowedTransitions[from]
	return nexts != nil && nexts[to]
}

func (t *Tasker[T]) taskKey(id string) string {
	return fmt.Sprintf("%s:task:%s", t.keyPrefix, id)
}

func (t *Tasker[T]) phaseSetKey(phase Phase) string {
	return fmt.Sprintf("%s:phase:%s", t.keyPrefix, phase)
}

func (t *Tasker[T]) streamKey(phase Phase) string {
	return fmt.Sprintf("%s:stream:%s", t.keyPrefix, phase)
}

func (t *Tasker[T]) phaseFromStreamKey(stream string) Phase {
	for i := len(stream) - 1; i >= 0; i-- {
		if stream[i] == ':' {
			return Phase(stream[i+1:])
		}
	}
	return PhaseStarted
}
