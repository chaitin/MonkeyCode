package types

import (
	"github.com/chaitin/MonkeyCode/backend/pkg/cvt"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

// ConditionStatus 条件状态
type ConditionStatus int32

const (
	ConditionStatus_CONDITION_STATUS_UNKNOWN     ConditionStatus = 0
	ConditionStatus_CONDITION_STATUS_IN_PROGRESS ConditionStatus = 1
	ConditionStatus_CONDITION_STATUS_TRUE        ConditionStatus = 2
	ConditionStatus_CONDITION_STATUS_FALSE       ConditionStatus = 3
)

// ConditionType 条件类型
type ConditionType string

const (
	ConditionTypeScheduled        ConditionType = "Scheduled"
	ConditionTypeImagePulled      ConditionType = "ImagePulled"
	ConditionTypeProjectCloned    ConditionType = "ProjectCloned"
	ConditionTypeImageBuilt       ConditionType = "ImageBuilt"
	ConditionTypeContainerCreated ConditionType = "ContainerCreated"
	ConditionTypeContainerStarted ConditionType = "ContainerStarted"
	ConditionTypeReady            ConditionType = "Ready"
	ConditionTypeFailed           ConditionType = "Failed"
	ConditionTypeHibernated       ConditionType = "Hibernated"
)

// Condition 细粒度状态条件
type Condition struct {
	Type               ConditionType   `json:"type,omitempty"`
	Status             ConditionStatus `json:"status,omitempty"`
	Reason             string          `json:"reason,omitempty"`
	Message            string          `json:"message,omitempty"`
	LastTransitionTime int64           `json:"last_transition_time,omitempty"`
	Progress           *int32          `json:"progress,omitempty"`
}

// From 从 taskflow 类型转换
func (c *Condition) From(src *taskflow.Condition) *Condition {
	if src == nil {
		return c
	}
	c.Type = ConditionType(src.Type)
	c.Status = ConditionStatus(src.Status)
	c.Reason = src.Reason
	c.Message = src.Message
	c.LastTransitionTime = src.LastTransitionTime
	c.Progress = src.Progress
	return c
}

// VirtualMachineCondition 虚拟机条件集合
type VirtualMachineCondition struct {
	EnvID      string       `json:"env_id"`
	Conditions []*Condition `json:"conditions,omitempty"`
}

// From 从 taskflow 类型转换
func (v *VirtualMachineCondition) From(src *taskflow.VirtualMachineCondition) *VirtualMachineCondition {
	if src == nil {
		return v
	}
	v.EnvID = src.EnvID
	v.Conditions = cvt.Iter(src.Conditions, func(_ int, c *taskflow.Condition) *Condition {
		return cvt.From(c, &Condition{})
	})
	return v
}
