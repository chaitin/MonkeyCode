package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"github.com/google/uuid"

	"github.com/chaitin/MonkeyCode/backend/pkg/entx"
)

// TeamGroupModel holds the schema definition for the TeamGroupModel entity.
type TeamGroupModel struct {
	ent.Schema
}

func (TeamGroupModel) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_models"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

// Fields of the TeamGroupModel.
func (TeamGroupModel) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("group_id", uuid.UUID{}),
		field.UUID("model_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamGroupModel.
func (TeamGroupModel) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("model", Model.Type).Field("model_id").Unique().Required(),
	}
}
