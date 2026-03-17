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

// TeamHost holds the schema definition for the TeamHost entity.
type TeamHost struct {
	ent.Schema
}

func (TeamHost) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_hosts"),
	}
}

// Fields of the TeamHost.
func (TeamHost) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.String("host_id"),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamHost.
func (TeamHost) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("host", Host.Type).Field("host_id").Unique().Required(),
	}
}
