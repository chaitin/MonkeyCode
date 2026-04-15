package vmstatus

import (
	"time"

	etypes "github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const readyTimeout = 3 * time.Minute

type Input struct {
	ReportedStatus taskflow.VirtualMachineStatus
	Online         bool
	Conditions     []*etypes.Condition
	IsRecycled     bool
	CreatedAt      time.Time
	Now            time.Time
}

func Resolve(input Input) taskflow.VirtualMachineStatus {
	if input.IsRecycled {
		return taskflow.VirtualMachineStatusOffline
	}

	if input.ReportedStatus != "" && input.ReportedStatus != taskflow.VirtualMachineStatusUnknown {
		return input.ReportedStatus
	}

	if input.Online {
		return taskflow.VirtualMachineStatusOnline
	}

	for _, cond := range input.Conditions {
		switch cond.Type {
		case etypes.ConditionTypeFailed:
			return taskflow.VirtualMachineStatusOffline
		case etypes.ConditionTypeHibernated:
			return taskflow.VirtualMachineStatusHibernated
		case etypes.ConditionTypeReady:
			if !input.CreatedAt.IsZero() && input.Now.Sub(input.CreatedAt) > readyTimeout {
				return taskflow.VirtualMachineStatusOffline
			}
		}
	}

	return taskflow.VirtualMachineStatusPending
}
