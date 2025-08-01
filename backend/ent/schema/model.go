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
	"github.com/chaitin/MonkeyCode/backend/ent/types"
)

// Model holds the schema definition for the Model entity.
type Model struct {
	ent.Schema
}

func (Model) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Annotation{
			Table: "models",
		},
	}
}

// Fields of the Model.
func (Model) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}).Optional(),
		field.String("model_name"),
		field.String("model_type").GoType(consts.ModelType("")),
		field.String("show_name").Optional(),
		field.String("api_base"),
		field.String("api_key").Optional(),
		field.String("api_version").Optional(),
		field.String("api_header").Optional(),
		field.String("description").Optional(),
		field.Bool("is_internal").Default(false),
		field.String("provider").GoType(consts.ModelProvider("")),
		field.String("status").GoType(consts.ModelStatus("")).Default(string(consts.ModelStatusActive)),
		field.JSON("parameters", &types.ModelParam{}).Optional(),
		field.Int("context_length").Optional(),
		field.Time("created_at").Default(time.Now),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the Model.
func (Model) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("tasks", Task.Type),
		edge.From("user", User.Type).Ref("models").Field("user_id").Unique(),
	}
}
