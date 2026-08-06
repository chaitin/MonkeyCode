package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
)

type VirtualMachineRecycleRecord struct {
	ent.Schema
}

func (VirtualMachineRecycleRecord) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("virtualmachine_recycle_records"),
	}
}

func (VirtualMachineRecycleRecord) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.String("virtualmachine_id").Unique(),
		field.String("environment_id"),
		field.String("host_id"),
		field.UUID("user_id", uuid.UUID{}).Optional().Nillable(),
		field.JSON("task_ids", []uuid.UUID{}),
		field.String("method").GoType(consts.VMRecycleMethod("")),
		field.Bool("remote_deleted").Default(false),
		field.Time("recycled_at"),
		field.Time("created_at").Default(time.Now),
	}
}

func (VirtualMachineRecycleRecord) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("method", "recycled_at"),
		index.Fields("user_id", "recycled_at"),
	}
}
