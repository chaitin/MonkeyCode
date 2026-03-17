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

// TeamGroupHost holds the schema definition for the TeamGroupHost entity.
type TeamGroupHost struct {
	ent.Schema
}

func (TeamGroupHost) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_hosts"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

// Fields of the TeamGroupHost.
func (TeamGroupHost) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("group_id", uuid.UUID{}),
		field.String("host_id"),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamGroupHost.
func (TeamGroupHost) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("host", Host.Type).Field("host_id").Unique().Required(),
	}
}
