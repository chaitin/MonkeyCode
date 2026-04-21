package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/consts"
	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// Task holds the schema definition for the Task entity.
type Task struct {
	ent.Schema
}

func (Task) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("tasks"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (Task) Mixin() []ent.Mixin {
	return []ent.Mixin{
		entx.SoftDeleteMixin2{},
	}
}

// Fields of the Task.
func (Task) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("kind").GoType(consts.TaskType("")),
		field.String("sub_type").GoType(consts.TaskSubType("")).Optional(),
		field.Text("content").NotEmpty(),
		field.Text("title").Optional(),
		field.Text("summary").Optional(),
		field.String("status").GoType(consts.TaskStatus("")),
		field.Time("created_at").Default(time.Now),
		field.Time("last_active_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
		field.Time("completed_at").Optional(),
	}
}

// Edges of the Task.
func (Task) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("project_tasks", ProjectTask.Type),
		edge.From("user", User.Type).Ref("tasks").Field("user_id").Unique().Required(),
		edge.From("vms", VirtualMachine.Type).Through("task_vms", TaskVirtualMachine.Type).Ref("tasks"),
		edge.To("git_bot_tasks", GitBotTask.Type),
	}
}
