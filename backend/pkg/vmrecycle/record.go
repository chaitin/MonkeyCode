package vmrecycle

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/samber/do"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/db"
	"github.com/chaitin/MonkeyCode/backend/db/virtualmachinerecyclerecord"
)

type Record struct {
	VMID          string
	EnvironmentID string
	HostID        string
	UserID        uuid.UUID
	TaskIDs       []uuid.UUID
	Method        consts.VMRecycleMethod
	RemoteDeleted bool
	RecycledAt    time.Time
}

type Recorder interface {
	Create(ctx context.Context, record Record) error
}

type recorder struct {
	db *db.Client
}

func NewRecorder(i *do.Injector) (Recorder, error) {
	return &recorder{db: do.MustInvoke[*db.Client](i)}, nil
}

func (r *recorder) Create(ctx context.Context, record Record) error {
	create := r.db.VirtualMachineRecycleRecord.Create().
		SetID(uuid.New()).
		SetVirtualmachineID(record.VMID).
		SetEnvironmentID(record.EnvironmentID).
		SetHostID(record.HostID).
		SetTaskIds(record.TaskIDs).
		SetMethod(record.Method).
		SetRemoteDeleted(record.RemoteDeleted).
		SetRecycledAt(record.RecycledAt)
	if record.UserID != uuid.Nil {
		create.SetUserID(record.UserID)
	}
	return create.
		OnConflictColumns(virtualmachinerecyclerecord.FieldVirtualmachineID).
		Ignore().
		Exec(ctx)
}

var _ Recorder = (*recorder)(nil)
