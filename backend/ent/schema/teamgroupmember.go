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

// TeamGroupMember holds the schema definition for the TeamGroupMember entity.
type TeamGroupMember struct {
	ent.Schema
}

func (TeamGroupMember) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_members"),
	}
}

// Fields of the TeamGroupMember.
func (TeamGroupMember) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("group_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamGroupMember.
func (TeamGroupMember) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("user", User.Type).Field("user_id").Unique().Required(),
	}
}
