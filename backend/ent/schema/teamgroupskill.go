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

type TeamGroupSkill struct {
	ent.Schema
}

func (TeamGroupSkill) Annotations() []schema.Annotation {
	return []schema.Annotation{
		entsql.Table("team_group_skills"),
		entx.NewCursor(entx.CursorKindCreatedAt),
	}
}

func (TeamGroupSkill) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("id", uuid.UUID{}).Unique(),
		field.UUID("group_id", uuid.UUID{}),
		field.UUID("skill_id", uuid.UUID{}),
		field.Time("created_at").Default(time.Now),
	}
}

func (TeamGroupSkill) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("group", TeamGroup.Type).Field("group_id").Unique().Required(),
		edge.To("skill", Skill.Type).Field("skill_id").Unique().Required(),
	}
}
