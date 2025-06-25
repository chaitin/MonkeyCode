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
)

// Record holds the schema definition for the Record entity.
type Record struct {
	ent.Schema
}

func (Record) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "records",
		},
	}
}

// Fields of the Record.
func (Record) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}).Optional(),
		field.UUID("model_id", uuid.UUID{}).Optional(),
		field.String("task_id"),
		field.String("model_type").GoType(consts.ModelType("")).Optional(),
		field.String("prompt").Optional(),
		field.String("completion").Optional(),
		field.Bool("is_accept").Default(false),
		field.String("program_language").Optional(),
		field.String("work_mode").Optional(),
		field.Int64("code_lines").Optional(),
		field.Int64("input_tokens"),
		field.Int64("output_tokens"),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Record.
func (Record) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("user", User.Type).Ref("records").Field("user_id").Unique(),
		edge.From("model", Model.Type).Ref("records").Field("model_id").Unique(),
	}
}
