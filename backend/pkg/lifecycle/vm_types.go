package lifecycle

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
	VMID   string `json:"vm_id"`
	TaskID string `json:"task_id"`
	UserID string `json:"user_id"`
	Region string `json:"region,omitempty"`
}
