// Package lifecycle 提供泛型化的生命周期管理
package lifecycle

import (
	"context"

	"github.com/google/uuid"
)

// State 状态类型约束（支持 string 及其派生类型）
type State interface {
	~string
}

// Hook 生命周期钩子接口
// I - ID 类型（必须是 comparable 类型，如 string, int, uuid.UUID 等）
// S - 状态类型（必须是基于 string 的类型）
// M - 元数据类型
type Hook[I comparable, S State, M any] interface {
	// Name 返回 Hook 名称
	Name() string
	// Priority 返回优先级（数字越大优先级越高，先执行）
	Priority() int
	// Async 返回是否异步执行
	Async() bool
	// OnStateChange 状态变更回调
	OnStateChange(ctx context.Context, id I, from, to S, metadata M) error
}

// TaskMetadata 任务元数据
type TaskMetadata struct {
	TaskID uuid.UUID `json:"task_id"`
	UserID uuid.UUID `json:"user_id"`
	Error  string    `json:"error,omitempty"`
}

// VMState 虚拟机状态
type VMState string

const (
	VMStatePending   VMState = "pending"
	VMStateCreating  VMState = "creating"
	VMStateRunning   VMState = "running"
	VMStateFailed    VMState = "failed"
	VMStateSucceeded VMState = "succeeded"
)

// VMMetadata 虚拟机元数据
type VMMetadata struct {
	VMID   string     `json:"vm_id"`
	TaskID *uuid.UUID `json:"task_id"`
	UserID uuid.UUID  `json:"user_id"`
	Region string     `json:"region,omitempty"`
}
