package lifecycle

import "context"

type InstancePhase string

const (
	InstanceAbsent  InstancePhase = "absent"
	InstanceCreated InstancePhase = "created"
	InstanceRunning InstancePhase = "running"
	InstanceStopped InstancePhase = "stopped"
)

type Instance struct {
	Ref   string        `json:"ref,omitempty"`
	Phase InstancePhase `json:"phase"`
}

// Driver 的操作必须按环境和实例标识幂等。Inspect 在 ref 为空时仍须按标识查找，
// 用于恢复 Create 成功但引用尚未持久化的情况。Remove 只删除实例资源，不删除持久卷。
type Driver interface {
	Prepare(context.Context, Spec) error
	Create(context.Context, Spec) (string, error)
	Start(context.Context, Spec, string) error
	Stop(context.Context, Spec, string) error
	Inspect(context.Context, Spec, string) (Instance, error)
	Remove(context.Context, Spec, string) error
}
