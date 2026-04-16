package vmstatus

import (
	"time"

	etypes "github.com/chaitin/MonkeyCode/backend/ent/types"
	"github.com/chaitin/MonkeyCode/backend/pkg/taskflow"
)

const readyTimeout = 3 * time.Minute

type Input struct {
	Online     bool
	Conditions []*etypes.Condition
	IsRecycled bool
	CreatedAt  time.Time
	Now        time.Time
}

func Resolve(input Input) taskflow.VirtualMachineStatus {
	if input.IsRecycled {
		return taskflow.VirtualMachineStatusOffline
	}

	if input.Online {
		return taskflow.VirtualMachineStatusOnline
	}

	if cs := input.Conditions; len(cs) > 0 {
		last := cs[len(cs)-1]
		switch last.Type {
		case etypes.ConditionTypeFailed:
			return taskflow.VirtualMachineStatusOffline

		case etypes.ConditionTypeHibernated:
			if last.Reason == "Hibernated" {
				return taskflow.VirtualMachineStatusHibernated
			}
		}
	}

	if input.Now.Sub(input.CreatedAt) > readyTimeout {
		return taskflow.VirtualMachineStatusOffline
	}

	return taskflow.VirtualMachineStatusPending
}
