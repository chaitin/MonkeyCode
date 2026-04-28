package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
)

// TaskModelSwitch holds the schema definition for the TaskModelSwitch entity.
type TaskModelSwitch struct {
	ent.Schema
}

func (TaskModelSwitch) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("task_model_switches"),
	}
}

// Fields of the TaskModelSwitch.
func (TaskModelSwitch) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Default(uuid.New),
		field.UUID("task_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.UUID("from_model_id", uuid.UUID{}).Optional().Nillable(),
		field.UUID("to_model_id", uuid.UUID{}),
		field.Text("request_id").Default(""),
		field.Bool("load_session").Default(true),
		field.Bool("success").Optional().Nillable(),
		field.Text("message").Default(""),
		field.Text("session_id").Default(""),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Indexes of the TaskModelSwitch.
func (TaskModelSwitch) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("task_id", "created_at").StorageKey("idx_task_model_switches_task_id_created_at"),
		index.Fields("user_id", "created_at").StorageKey("idx_task_model_switches_user_id_created_at"),
	}
}

// Edges of the TaskModelSwitch.
func (TaskModelSwitch) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("task", Task.Type).Field("task_id").Ref("model_switches").Unique().Required(),
		edge.From("user", User.Type).Field("user_id").Ref("task_model_switches").Unique().Required(),
		edge.From("from_model", Model.Type).Field("from_model_id").Ref("switches_from").Unique(),
		edge.From("to_model", Model.Type).Field("to_model_id").Ref("switches_to").Unique().Required(),
	}
}
