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

// TeamMember holds the schema definition for the TeamMember entity.
type TeamMember struct {
	ent.Schema
}

func (TeamMember) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_members"),
	}
}

// Fields of the TeamMember.
func (TeamMember) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("user_id", uuid.UUID{}),
		field.String("role").GoType(consts.TeamMemberRole("")),
		field.Time("created_at").Default(time.Now),
	}
}

// Edges of the TeamMember.
func (TeamMember) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("user", User.Type).Field("user_id").Unique().Required(),
	}
}
