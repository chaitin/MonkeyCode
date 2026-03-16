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

// TeamModel holds the schema definition for the TeamModel entity.
type TeamModel struct {
	ent.Schema
}

func (TeamModel) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_models"),
	}
}

// Fields of the TeamModel.
func (TeamModel) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("model_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamModel.
func (TeamModel) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("model", Model.Type).Field("model_id").Unique().Required(),
	}
}
