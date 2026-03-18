package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"
)

// TaskVirtualMachine holds the schema definition for the TaskVirtualMachine entity.
type TaskVirtualMachine struct {
	ent.Schema
}

func (TaskVirtualMachine) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("task_virtualmachines"),
	}
}

// Fields of the TaskVirtualMachine.
func (TaskVirtualMachine) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("task_id", uuid.UUID{}),
		field.String("virtualmachine_id"),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TaskVirtualMachine.
func (TaskVirtualMachine) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("task", Task.Type).Field("task_id").Unique().Required(),
		edge.To("virtualmachine", VirtualMachine.Type).Field("virtualmachine_id").Unique().Required(),
	}
}
