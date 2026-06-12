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

type TeamSkill struct {
	ent.Schema
}

func (TeamSkill) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_skills"),
	}
}

func (TeamSkill) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}),
		field.UUID("team_id", uuid.UUID{}),
		field.UUID("skill_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (TeamSkill) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("team", Team.Type).Field("team_id").Unique().Required(),
		edge.To("skill", Skill.Type).Field("skill_id").Unique().Required(),
	}
}
