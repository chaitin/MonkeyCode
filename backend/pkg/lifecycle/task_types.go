package lifecycle

import "github.com/google/uuid"

// TaskState 任务状态
type TaskState string

const (
	TaskStatePending   TaskState = "pending"
	TaskStateRunning   TaskState = "running"
	TaskStateFailed    TaskState = "failed"
	TaskStateSucceeded TaskState = "succeeded"
)

// TaskMetadata 任务元数据
type TaskMetadata struct {
	TaskID  uuid.UUID `json:"task_id"`
	UserID  string    `json:"user_id"`
	Project string    `json:"project,omitempty"`
}
